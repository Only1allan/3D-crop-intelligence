"""The LLM drafting loop, exercised with a fake chat model so the test needs no network or GPU:
the model first invents a number (the citation guard rejects it), then corrects itself and files the draft."""
from __future__ import annotations

import asyncio
from typing import Any

import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from agritwin.agent import graph as G
from agritwin.agent.llm import ModelInfo
from agritwin.mcp_server import tools as T


class ScriptedModel(BaseChatModel):
    """Returns pre-scripted AIMessages in order; records what it was asked."""

    script: list[AIMessage]
    calls: int = 0

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools: Any, **kwargs: Any) -> "ScriptedModel":  # noqa: D401
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        msg = self.script[min(self.calls, len(self.script) - 1)]
        self.calls += 1
        return ChatResult(generations=[ChatGeneration(message=msg)])


class LocalToolBox:
    """Stand-in for the MCP toolbox: calls the tool functions in-process (same audit path)."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def has(self, name: str) -> bool:
        return True

    async def call(self, name: str, **kw: Any) -> Any:
        self.calls.append((name, kw))
        fn = getattr(T, name)
        try:
            return fn(**kw)
        except Exception as e:  # mimic the MCP adapter surfacing tool errors
            raise RuntimeError(f"Error executing tool {name}: {e}") from e


def _state(plot_id: str) -> dict:
    plot = T.get_plot.__wrapped_tool__(plot_id)
    sig = T.get_climate_signals.__wrapped_tool__(plot_id)
    rules = T.check_advisory_rules.__wrapped_tool__(plot_id)
    return {"run_id": "run-fake", "plot_id": plot_id, "plot": plot, "signals": sig, "alerts": [], "rules": rules}


def _tc(args: dict, cid: str) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": "file_draft", "args": args, "id": cid, "type": "tool_call"}])


@pytest.mark.asyncio
async def test_llm_draft_is_guarded_then_corrected(monkeypatch):
    bad = _tc({"action": "hold", "message": "B2: hold irrigation, 40 mm of rain is coming in 2 days.", "reasoning": "r",
               "citation_fields": ["soil.soilMoisture", "rainfall.forecast3Mm"]}, "c1")
    good = _tc({"action": "hold", "message": "B2 South Slope: soil is dry at 13.2% VWC but 21.5 mm of rain is forecast in 3 days. Hold irrigation.",
                "reasoning": "Forecast covers the deficit; borrowed forecast agrees.", "citation_fields": ["soil.soilMoisture", "rainfall.forecast3Mm"]}, "c2")
    model = ScriptedModel(script=[bad, good, AIMessage(content="done")])
    info = ModelInfo("fake", "scripted", True, "llm")
    tb = LocalToolBox()
    monkeypatch.setattr(G, "resolve", lambda provider=None: (model, info))

    async def fake_toolbox(run_id=None, include_borrowed=True):
        return tb
    monkeypatch.setattr(G, "load_toolbox", fake_toolbox)

    out = await G.draft(_state("B2"))
    adv = out["draft"]
    assert adv["status"] == "draft" and adv["action"] == "hold"
    assert adv["drafter"]["kind"] == "llm" and adv["drafter"]["attempt"] == 2
    assert "21.5" in adv["message"] and "40" not in adv["message"]
    # first attempt was rejected by draft_advisory, second accepted; both went through the audited tool
    drafts = [c for c in tb.calls if c[0] == "draft_advisory"]
    assert len(drafts) == 2
    assert model.calls == 2


@pytest.mark.asyncio
async def test_template_fallback_when_model_keeps_inventing(monkeypatch):
    bad = _tc({"action": "irrigate", "message": "Apply 99 mm now.", "reasoning": "r", "citation_fields": ["soil.soilMoisture"]}, "c1")
    model = ScriptedModel(script=[bad, bad, bad, bad])
    info = ModelInfo("fake", "scripted", True, "llm")
    tb = LocalToolBox()
    monkeypatch.setattr(G, "resolve", lambda provider=None: (model, info))

    async def fake_toolbox(run_id=None, include_borrowed=True):
        return tb
    monkeypatch.setattr(G, "load_toolbox", fake_toolbox)

    out = await G.draft(_state("B2"))
    adv = out["draft"]
    assert adv["drafter"]["kind"] == "template" and adv["drafter"]["llmAttempted"] is True
    assert adv["action"] == "hold"  # the rule engine's action, not the model's


@pytest.mark.asyncio
async def test_json_mode_for_small_local_models(monkeypatch):
    """Ollama-class models answer with one JSON object (structured output) instead of a native tool call."""
    good = AIMessage(content='{"action": "hold", "message": "B2 South Slope: dry at 13.2% VWC but 21.5 mm forecast in 3 days. Hold irrigation.", '
                             '"reasoning": "forecast covers it", "citation_fields": ["soil.soilMoisture", "rainfall.forecast3Mm"]}')
    model = ScriptedModel(script=[AIMessage(content="Okay, let me think about this plot..."), good])
    info = ModelInfo("ollama", "qwen3:4b", True, "llm")
    tb = LocalToolBox()
    monkeypatch.setattr(G, "resolve", lambda provider=None: (model, info))

    async def fake_toolbox(run_id=None, include_borrowed=True):
        return tb
    monkeypatch.setattr(G, "load_toolbox", fake_toolbox)

    out = await G.draft(_state("B2"))
    adv = out["draft"]
    assert adv["drafter"]["kind"] == "llm" and adv["action"] == "hold" and "21.5" in adv["message"]
    assert adv["drafter"]["attempt"] == 1  # narration was nudged, then the JSON object was accepted first time
