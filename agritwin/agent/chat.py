"""Officer chat: a ReAct agent over the READ tools (plus flag/follow-up), streaming tokens and tool calls to the
run bus. Without a model it still answers the common desk questions deterministically from the rule engine."""
from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.tools import StructuredTool
from langgraph.prebuilt import create_react_agent

from ..config import settings
from . import bus
from .llm import resolve
from .mcp_client import ToolBox, load_toolbox

CHAT_TOOLS = ["list_farms", "get_farm_twin", "get_plot", "get_climate_signals", "get_pest_alerts", "check_advisory_rules",
              "list_advisories", "get_advisory", "get_audit_log", "list_followups", "list_flags", "get_crop_profile",
              "schedule_follow_up", "flag_plot", "get_weather_forecast"]

SYSTEM = """You are the desk assistant of an agricultural extension office. The officer asks you about the farms, plots,
households, rainfall, pest alerts, drafted advisories and the audit trail. Use the tools; never guess a number — quote
what a tool returned and say which record it came from. You cannot send anything to a farmer and you cannot approve a
draft: only the officer can, from the console. Keep answers short (under 150 words), plain, and specific. When the
officer asks which plots need attention, call check_advisory_rules for each plot of the farm and rank by severity."""

_threads: dict[str, list] = {}


def _wrap(tb: ToolBox, name: str) -> StructuredTool:
    orig = tb.by_name[name]

    async def call(**kwargs: Any) -> str:
        try:
            out = await tb.call(name, **kwargs)
        except Exception as e:  # noqa: BLE001
            return f"ERROR: {e}"
        return json.dumps(out)[:12000]

    return StructuredTool.from_function(coroutine=call, name=name, description=orig.description, args_schema=orig.args_schema)


async def _deterministic(tb: ToolBox, message: str, farm_id: str | None, plot_id: str | None) -> str:
    q = message.lower()
    if plot_id and any(w in q for w in ("why", "flag", "what", "how", "status", "advis")):
        r = await tb.call("check_advisory_rules", plot_id=plot_id)
        lines = [f"Plot {plot_id}: primary action {r['primaryAction']} [{r['primaryRuleId']}]."]
        lines += [f"- {f['reasoning']}" for f in r["findings"][:4]]
        return "\n".join(lines)
    if "forecast" in q or "rain" in q:
        s = await tb.call("get_climate_signals", plot_id=plot_id) if plot_id else await tb.call("get_climate_signals", farm_id=farm_id or "F-001")
        if not s.get("available"):
            return "No rainfall signal is stored for this farm yet (run weather ingestion)."
        r = s["rainfall"]
        return (f"Zone rainfall ({r['source']}): {r['last7Mm']} mm in the last 7 days; forecast " +
                ", ".join(f"{d['date']} {d['mm']} mm" for d in r["forecast"][:5]) + ".")
    if "audit" in q or "log" in q:
        log = await tb.call("get_audit_log", plot_id=plot_id, limit=8)
        return "Recent tool calls: " + "; ".join(f"{e['ts']} {e['actor']} {e['tool']}" for e in log["entries"]) or "No entries."
    farm = await tb.call("get_farm_twin", farm_id=farm_id or "F-001")
    ranked = []
    for p in farm["plots"]:
        r = await tb.call("check_advisory_rules", plot_id=p["plotId"])
        sev = max((f["severity"] for f in r["findings"]), key=lambda s: {"critical": 3, "warning": 2, "info": 1}.get(s, 0), default="info")
        ranked.append((sev, p["plotId"], p["householdName"], r["primaryAction"], r["primaryRuleId"]))
    ranked.sort(key=lambda x: -{"critical": 3, "warning": 2, "info": 1}[x[0]])
    return "Plots needing attention this week (rule engine, no LLM):\n" + "\n".join(
        f"- {pid} ({hh}): {act} · {sev} · {rid}" for sev, pid, hh, act, rid in ranked)


async def run_chat(run_id: str, message: str, plot_id: str | None = None, farm_id: str | None = None,
                   thread_id: str | None = None, provider: str | None = None) -> str:
    thread_id = thread_id or run_id
    bus.create(run_id, "chat", plot_id, thread_id=thread_id)
    model, info = resolve(provider)
    bus.emit(run_id, "llm", {**info.dict(), "attempt": 1})
    tb = await load_toolbox(run_id, include_borrowed=True)
    context = f"(context: farm {farm_id or 'F-001'}" + (f", selected plot {plot_id}" if plot_id else "") + f", today {settings().today})"
    try:
        if model is None:
            text = await _deterministic(tb, message, farm_id, plot_id)
        else:
            tools = [_wrap(tb, n) for n in CHAT_TOOLS if tb.has(n)]
            agent = create_react_agent(model, tools, prompt=SystemMessage(SYSTEM))
            history = _threads.setdefault(thread_id, [])
            msgs = history[-10:] + [HumanMessage(f"{message}\n{context}")]
            text = ""
            async for ev in agent.astream_events({"messages": msgs}, version="v2"):
                kind = ev.get("event")
                if kind == "on_chat_model_stream":
                    chunk = ev["data"]["chunk"]
                    piece = chunk.content if isinstance(chunk.content, str) else "".join(
                        c.get("text", "") for c in chunk.content if isinstance(c, dict))
                    if piece and not getattr(chunk, "tool_call_chunks", None):
                        bus.emit(run_id, "token", {"text": piece})
                elif kind == "on_chain_end" and ev.get("name") == "LangGraph":
                    out = ev["data"].get("output") or {}
                    last = (out.get("messages") or [None])[-1]
                    if isinstance(last, AIMessage):
                        text = last.content if isinstance(last.content, str) else "".join(
                            c.get("text", "") for c in last.content if isinstance(c, dict))
            history += [HumanMessage(message), AIMessage(text)]
        bus.emit(run_id, "message", {"text": text, "model": info.dict()})
        bus.emit(run_id, "done", {"runId": run_id, "threadId": thread_id})
        return text
    except Exception as e:  # noqa: BLE001
        bus.emit(run_id, "error", {"text": f"{type(e).__name__}: {e}", "recoverable": False})
        bus.emit(run_id, "done", {"runId": run_id, "outcome": "error"})
        raise
