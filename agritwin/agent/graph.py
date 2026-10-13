"""The advisory graph.

    gather ──► cross_check ──► draft ──► await_officer ──► finalize
       │            │                         (interrupt)
       └─ missing_data ◄──────────────────────── (fail closed: no advisory on missing/stale data)

* gather       : get_plot, get_climate_signals, get_pest_alerts over MCP; a second opinion on the forecast
                 from the borrowed Open-Meteo MCP server; retries each call once.
* cross_check  : check_advisory_rules (deterministic, cited). `blocked` => missing_data.
* draft        : the LLM reads the evidence pack and must call `file_draft` (a thin wrapper over the MCP
                 `draft_advisory` tool). The tool rejects unsourced numbers; the error is fed back and the model
                 retries (self-correction). After N failures, or with no model, the template drafter files it.
* await_officer: LangGraph `interrupt()` — the run stops until a named officer resumes it with a decision.
* finalize     : record_officer_decision ran in the console (human actor); here we log the outcome and, on
                 approval, schedule the follow-up check.
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import timedelta
from typing import Any, TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.types import interrupt

from ..config import settings
from ..rules import get_profile
from ..rules.templates import render
from . import bus
from .llm import ModelInfo, resolve
from .mcp_client import ToolBox, load_toolbox

MAX_DRAFT_TURNS = 6
MAX_DRAFT_FAILURES = 2

# Small local models (Qwen3-4B class on Ollama) narrate instead of emitting native tool calls; for them the
# draft step asks for one JSON object under a schema (Ollama structured output) and the graph files it through
# the same file_draft -> draft_advisory path. Hosted models use native tool calls.
DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["plant", "spray", "irrigate", "hold", "harvest", "lime", "fertilise", "scout", "none"]},
        "message": {"type": "string"},
        "reasoning": {"type": "string"},
        "citation_fields": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["action", "message", "reasoning", "citation_fields"],
}
SYSTEM_JSON_SUFFIX = """
Respond with ONE JSON object only, no prose, with keys: action, message, reasoning, citation_fields (list of the
citation `field` names you used). Do not call tools; the desk files your JSON through file_draft for you."""


def _json_mode(info: "ModelInfo") -> bool:
    mode = os.environ.get("AGRITWIN_DRAFT_MODE", "auto")
    if mode in ("json", "tools"):
        return mode == "json"
    return info.provider == "ollama"


def _structured(model, schema: dict):
    """A copy of the model constrained to `schema` where the backend supports it (Ollama `format`)."""
    try:
        return model.model_copy(update={"format": schema})
    except Exception:  # noqa: BLE001
        return model


class AdvisoryState(TypedDict, total=False):
    run_id: str
    plot_id: str
    plot: dict
    signals: dict
    alerts: list
    borrowed_forecast: dict | None
    rules: dict
    draft: dict | None
    decision: dict | None
    error: str | None
    model: dict
    provider: str | None
    outcome: str


def new_run_id() -> str:
    return "run-" + uuid.uuid4().hex[:10]


# ------------------------------------------------------------------ nodes
async def _retry(tb: ToolBox, name: str, run_id: str, **kw: Any) -> Any:
    try:
        return await tb.call(name, **kw)
    except Exception as e:  # noqa: BLE001
        bus.emit(run_id, "error", {"text": f"{name} failed ({e}); retrying once", "recoverable": True})
        return await tb.call(name, **kw)


async def gather(state: AdvisoryState) -> AdvisoryState:
    run_id, pid = state["run_id"], state["plot_id"]
    bus.emit(run_id, "status", {"node": "gather", "text": f"Gathering evidence for plot {pid}"})
    tb = await load_toolbox(run_id)
    plot = await _retry(tb, "get_plot", run_id, plot_id=pid)
    signals = await _retry(tb, "get_climate_signals", run_id, plot_id=pid)
    if not signals.get("available"):
        # Recovery: no rainfall stored for this farm -> try to ingest it now, then look again.
        bus.emit(run_id, "status", {"node": "gather", "text": "No rainfall signal stored for this farm; trying to ingest weather"})
        try:
            await tb.call("ingest_weather", farm_id=plot["farmId"])
            signals = await tb.call("get_climate_signals", plot_id=pid)
        except Exception as e:  # noqa: BLE001
            bus.emit(run_id, "error", {"text": f"weather ingestion failed ({str(e)[:160]}); continuing without a rainfall signal",
                                       "recoverable": True})
    alerts = await _retry(tb, "get_pest_alerts", run_id, plot_id=pid)
    borrowed = None
    if tb.has("get_weather_forecast") and signals.get("available"):
        try:
            borrowed = await tb.call("get_weather_forecast", latitude=signals["lat"], longitude=signals["lon"],
                                     daily="precipitation_sum", forecast_days=3, current_weather=False)
        except Exception as e:  # noqa: BLE001
            bus.emit(run_id, "error", {"text": f"borrowed forecast unavailable: {e}", "recoverable": True})
    return {"plot": plot, "signals": signals, "alerts": alerts.get("alerts", []), "borrowed_forecast": borrowed}


async def cross_check(state: AdvisoryState) -> AdvisoryState:
    run_id, pid = state["run_id"], state["plot_id"]
    bus.emit(run_id, "status", {"node": "cross_check", "text": "Cross-checking plot state against the crop calendar rules"})
    tb = await load_toolbox(run_id, include_borrowed=False)
    rules = await _retry(tb, "check_advisory_rules", run_id, plot_id=pid)
    return {"rules": rules}


def route_after_rules(state: AdvisoryState) -> str:
    rules = state.get("rules") or {}
    if rules.get("blocked"):
        return "missing_data"
    if not state.get("signals", {}).get("available") and rules.get("primaryRuleId", "").endswith("no_rainfall_signal"):
        return "missing_data"
    return "draft"


async def missing_data(state: AdvisoryState) -> AdvisoryState:
    run_id, pid = state["run_id"], state["plot_id"]
    rules = state.get("rules") or {}
    why = (rules.get("blocked") or {}).get("detail") or next((f["reasoning"] for f in rules.get("findings", [])), "insufficient data")
    bus.emit(run_id, "status", {"node": "missing_data", "text": "Refusing to draft: " + why})
    tb = await load_toolbox(run_id, include_borrowed=False)
    flag = await tb.call("flag_plot", plot_id=pid, reason=why, severity="warning", created_by="agent")
    bus.emit(run_id, "error", {"text": f"No advisory drafted for {pid}: {why}. Plot flagged ({flag['flagId']}) for the officer.",
                               "recoverable": False})
    bus.emit(run_id, "done", {"runId": run_id, "outcome": "no_advisory", "flagId": flag["flagId"]})
    return {"outcome": "no_advisory", "draft": None, "error": why}


def _evidence_pack(state: AdvisoryState) -> str:
    plot, rules, signals = state["plot"], state["rules"], state["signals"]
    cites = [c for f in rules["findings"] for c in f["citations"]]
    seen, uniq = set(), []
    for c in cites:
        if c["field"] not in seen:
            seen.add(c["field"]); uniq.append(c)
    lines = [
        f"PLOT {plot['plotId']} '{plot['displayName']}' on farm {plot['farmId']} · household {plot['householdName']} ({plot['householdId']}, contact {plot['contactMethod']})",
        f"Crop stage: {plot['crop']['growthStage']}, {plot['crop']['daysAfterPlanting']} days after planting, variety {plot['agronomy'].get('variety')}.",
        f"Last officer visit: {json.dumps(plot.get('lastVisit'))}",
        "",
        f"RULE ENGINE ({rules['profile']}): primary action = {rules['primaryAction']} [{rules['primaryRuleId']}]",
    ]
    for f in rules["findings"]:
        lines.append(f"- [{f['ruleId']}] action={f['action']} severity={f['severity']}: {f['reasoning']}")
    lines += ["", "CITATIONS you may use (refer to them by `field`; every number in your message must appear here or in a finding above):"]
    for c in uniq:
        src = c['source'].split(' · ')[-1] if c['field'].startswith(('soil.', 'crop.', 'atmosphere.', 'agronomy.')) else c['source']
        lines.append(f"- {c['field']} = {c['value']} {c['unit']}  ← {src[:70]}")
    if signals.get("available"):
        r = signals["rainfall"]
        lines += ["", f"ZONE RAINFALL: last 7 days {r['last7Mm']} mm; next 3 days " + ", ".join(f"{d['date']}: {d['mm']} mm" for d in r["forecast"][:3]) + f" ({r['source']})"]
    if state.get("borrowed_forecast"):
        d = state["borrowed_forecast"].get("daily") or {}
        lines.append(f"SECOND OPINION (borrowed Open-Meteo MCP server, 3-day precipitation_sum): {d.get('precipitation_sum')} on {d.get('time')} — "
                     "use only to comment on agreement in the officer reasoning, never as a number in the household message.")
    if state["alerts"]:
        lines += ["", "ZONE PEST ALERTS: " + "; ".join(f"{a['alertId']} {a['pest']} ({a['crop']}, {a['severity']}, stages {a['stages']})" for a in state["alerts"])]
    return "\n".join(lines)


SYSTEM = """You are the drafting agent inside an agricultural extension office's advisory desk. You write ONE draft advisory for a
named officer to approve; you never talk to the farmer and you never claim anything was sent.
Hard rules:
1. Use only numbers that appear in the CITATIONS list or in a rule finding. Do not compute, round differently, or add figures.
2. The household message is plain, warm, concrete, <= 320 characters, in English, no jargon, no markdown. Say what to do and the one or
   two numbers that justify it. Name the plot. If the action is 'hold', say what to wait for.
3. The officer reasoning (2-4 sentences) explains why, mentions other findings worth a look, and notes whether the borrowed forecast agrees.
4. The action must be the rule engine's primary action unless a finding gives a clear reason to prefer a lower-priority one; explain if so.
5. Finish by calling file_draft exactly once with action, message, reasoning and the list of citation `field` names you relied on
   (include every field whose number you used). If file_draft returns an error, fix the message and call it again."""


def _make_file_draft(tb: ToolBox, state: AdvisoryState, model_info: ModelInfo, attempts: dict) -> StructuredTool:
    rules = state["rules"]
    cites_by_field: dict[str, dict] = {}
    for f in rules["findings"]:
        for c in f["citations"]:
            cites_by_field.setdefault(c["field"], c)

    async def file_draft(action: str, message: str, reasoning: str, citation_fields: list[str]) -> str:
        """File the draft advisory for officer review. citation_fields: the `field` names from the CITATIONS list you used."""
        attempts["n"] += 1
        fields = [f for f in citation_fields if f in cites_by_field]
        if not fields:  # fall back to the primary finding's citations so the audit stays meaningful
            primary = next((f for f in rules["findings"] if f["ruleId"] == rules["primaryRuleId"]), rules["findings"][0])
            fields = [c["field"] for c in primary["citations"]]
        cites = [cites_by_field[f] for f in fields]
        try:
            adv = await tb.call("draft_advisory", plot_id=state["plot_id"], action=action.strip().lower(), message=message.strip(),
                                reasoning=reasoning.strip(), citations=cites, findings=rules["findings"],
                                drafter={"kind": "llm", **model_info.dict(), "attempt": attempts["n"]})
        except Exception as e:  # noqa: BLE001
            attempts["failures"] += 1
            return f"ERROR: {e}"
        attempts["draft"] = adv
        return f"OK: filed {adv['advisoryId']} ({adv['action']}, {len(adv['citations'])} citations)"

    return StructuredTool.from_function(coroutine=file_draft, name="file_draft", description=file_draft.__doc__)


async def _template_draft(tb: ToolBox, state: AdvisoryState, model_info: ModelInfo, reason: str) -> dict:
    rules, plot = state["rules"], state["plot"]
    profile = get_profile(rules["profile"].split("@")[0])
    t = render(rules, plot, profile)
    primary = next((f for f in rules["findings"] if f["ruleId"] == rules["primaryRuleId"]), rules["findings"][0])
    cites = primary["citations"] or [c for f in rules["findings"] for c in f["citations"]][:1]
    return await tb.call("draft_advisory", plot_id=state["plot_id"], action=rules["primaryAction"], message=t["message"],
                         reasoning=t["reasoning"], citations=cites, findings=rules["findings"],
                         drafter={"kind": "template", "provider": "template", "model": None, "openWeights": True, "note": reason,
                                  "llmAttempted": model_info.kind == "llm"})


async def draft(state: AdvisoryState) -> AdvisoryState:
    run_id = state["run_id"]
    model, info = resolve(state.get("provider"))
    bus.emit(run_id, "status", {"node": "draft", "text": f"Drafting with {info.provider}" + (f" · {info.model}" if info.model else "")})
    bus.emit(run_id, "llm", {**info.dict(), "attempt": 1})
    tb = await load_toolbox(run_id, include_borrowed=False)
    attempts = {"n": 0, "failures": 0, "draft": None}
    reason = info.note
    if model is not None:
        file_draft = _make_file_draft(tb, state, info, attempts)
        json_mode = _json_mode(info)
        llm = _structured(model, DRAFT_SCHEMA) if json_mode else model.bind_tools([file_draft])
        msgs: list = [SystemMessage(SYSTEM + (SYSTEM_JSON_SUFFIX if json_mode else "")), HumanMessage(_evidence_pack(state))]
        try:
            for turn in range(MAX_DRAFT_TURNS):
                ai: AIMessage = await llm.ainvoke(msgs)
                msgs.append(ai)
                text = ai.content if isinstance(ai.content, str) else json.dumps(ai.content)
                if json_mode or not ai.tool_calls:
                    if attempts["draft"]:
                        break
                    parsed = _parse_prose_draft(text)
                    if parsed:
                        res = await file_draft.ainvoke(parsed)
                        if res.startswith("OK"):
                            break
                        bus.emit(run_id, "error", {"text": f"draft rejected by the server ({res[:160]}); asking the model to fix it",
                                                   "recoverable": True})
                        bus.emit(run_id, "llm", {**info.dict(), "attempt": attempts["n"] + 1})
                        msgs.append(HumanMessage(f"file_draft said: {res}. Fix the message (use only cited numbers) and answer again"
                                                 + (" with one JSON object." if json_mode else " by calling file_draft.")))
                    else:
                        msgs.append(HumanMessage("Answer with one JSON object with keys action, message, reasoning, citation_fields." if json_mode
                                                 else "You must call the file_draft tool with action, message, reasoning and citation_fields."))
                    if attempts["failures"] > MAX_DRAFT_FAILURES:
                        break
                    continue
                for tc in ai.tool_calls:
                    if tc["name"] != "file_draft":
                        msgs.append(ToolMessage(content=f"unknown tool {tc['name']}", tool_call_id=tc["id"]))
                        continue
                    res = await file_draft.ainvoke(tc["args"])
                    msgs.append(ToolMessage(content=res, tool_call_id=tc["id"]))
                    if not res.startswith("OK"):
                        bus.emit(run_id, "error", {"text": f"draft rejected by the server ({res[:160]}); asking the model to fix it",
                                                   "recoverable": True})
                        bus.emit(run_id, "llm", {**info.dict(), "attempt": attempts["n"] + 1})
                if attempts["draft"] or attempts["failures"] > MAX_DRAFT_FAILURES:
                    break
        except Exception as e:  # noqa: BLE001
            reason = f"model call failed: {type(e).__name__}: {str(e)[:200]}"
            bus.emit(run_id, "error", {"text": reason + " — falling back to the template drafter", "recoverable": True})
        if attempts["draft"] is None and attempts["failures"]:
            reason = f"model draft rejected {attempts['failures']}x by the citation guard"
    adv = attempts["draft"]
    if adv is None:
        bus.emit(run_id, "status", {"node": "draft", "text": "Using the deterministic template drafter (" + reason + ")"})
        adv = await _template_draft(tb, state, info, reason)
    bus.emit(run_id, "draft", adv)
    return {"draft": adv, "model": info.dict()}


_PROSE = re.compile(r"\{.*\}", re.S)


def _parse_prose_draft(text: str) -> dict | None:
    m = _PROSE.search(text or "")
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if {"action", "message", "reasoning"} <= set(d):
        d.setdefault("citation_fields", [])
        return {k: d[k] for k in ("action", "message", "reasoning", "citation_fields")}
    return None


async def await_officer(state: AdvisoryState) -> AdvisoryState:
    run_id, adv = state["run_id"], state["draft"]
    run = bus.get(run_id) or {"events": []}
    if not any(e["event"] == "awaiting_officer" for e in run["events"]):  # LangGraph re-runs this node on resume
        bus.emit(run_id, "awaiting_officer", {"advisoryId": adv["advisoryId"], "plotId": state["plot_id"],
                                              "text": "Draft filed. Waiting for a named officer to approve or reject."})
    decision = interrupt({"advisoryId": adv["advisoryId"], "plotId": state["plot_id"], "action": adv["action"], "message": adv["message"]})
    return {"decision": decision}


async def finalize(state: AdvisoryState) -> AdvisoryState:
    run_id, adv, dec = state["run_id"], state["draft"], state.get("decision") or {}
    bus.emit(run_id, "status", {"node": "finalize", "text": f"Officer {dec.get('officerName')} decided: {dec.get('decision')}"})
    tb = await load_toolbox(run_id, include_borrowed=False)
    final = await tb.call("get_advisory", advisory_id=adv["advisoryId"])
    if final.get("status") == "approved":
        when = (settings().today + timedelta(days=7)).isoformat()
        await tb.call("schedule_follow_up", plot_id=state["plot_id"], date=when,
                      note=f"Re-check after advisory {adv['advisoryId']} ({adv['action']}) approved by {dec.get('officerName')}", created_by="agent")
    bus.emit(run_id, "decision", final)
    bus.emit(run_id, "done", {"runId": run_id, "outcome": final.get("status")})
    return {"outcome": final.get("status")}


# ------------------------------------------------------------------ graph
def build_graph(checkpointer=None):
    g = StateGraph(AdvisoryState)
    g.add_node("gather", gather)
    g.add_node("cross_check", cross_check)
    g.add_node("missing_data", missing_data)
    g.add_node("draft", draft)
    g.add_node("await_officer", await_officer)
    g.add_node("finalize", finalize)
    g.set_entry_point("gather")
    g.add_edge("gather", "cross_check")
    g.add_conditional_edges("cross_check", route_after_rules, {"missing_data": "missing_data", "draft": "draft"})
    g.add_edge("missing_data", END)
    g.add_edge("draft", "await_officer")
    g.add_edge("await_officer", "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer or MemorySaver())


GRAPH = build_graph()


def thread_config(run_id: str) -> dict:
    return {"configurable": {"thread_id": run_id}}
