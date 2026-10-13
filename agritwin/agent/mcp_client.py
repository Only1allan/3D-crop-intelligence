"""MCP client side of the agent: our AgriTwin server (streamable HTTP) + the borrowed Open-Meteo server (stdio).

Sessions are opened once per process/event loop and reused (one borrowed-server spawn per process, not per
call). Every tool call is emitted to the run bus as tool_call / tool_result so the console and the CLI can
show the agent working."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools

from ..config import settings
from . import bus

log = logging.getLogger("agritwin.agent.mcp")
BORROWED_NAME = "chuk-mcp-open-meteo"
BORROWED_TOOLS = {"get_weather_forecast", "get_historical_weather", "geocode_location", "get_air_quality", "interpret_weather_code",
                  "get_marine_forecast", "batch_get_weather_forecasts", "batch_get_historical_weather", "batch_geocode_locations",
                  "batch_get_air_quality", "batch_get_marine_forecasts", "batch_interpret_weather_codes"}


def agritwin_url() -> str:
    s = settings()
    return os.environ.get("AGRITWIN_MCP_URL") or f"http://{s.host}:{s.port}/mcp/"


def borrowed_command() -> str | None:
    """Find the borrowed server's launcher (installed from PyPI next to our interpreter)."""
    if os.environ.get("AGRITWIN_BORROWED_MCP", "1") in ("0", "false", "no"):
        return None
    cand = Path(sys.executable).parent / BORROWED_NAME
    if cand.exists():
        return str(cand)
    return shutil.which(BORROWED_NAME)


def connections(include_borrowed: bool = True) -> dict[str, dict]:
    conns: dict[str, dict] = {"agritwin": {"transport": "streamable_http", "url": agritwin_url()}}
    cmd = borrowed_command() if include_borrowed else None
    if cmd:
        conns["open-meteo"] = {"transport": "stdio", "command": cmd, "args": [], "env": {**os.environ}}
    return conns


# ------------------------------------------------------------------ persistent sessions
_state: dict[str, Any] = {"loop": None, "task": None, "close": None, "tools": None, "borrowed_ok": False, "lock": None}


def borrowed_status() -> dict:
    return {"name": BORROWED_NAME, "installed": borrowed_command() is not None, "connected": bool(_state.get("borrowed_ok"))}


async def _connect() -> list[BaseTool]:
    """Open the sessions inside one long-lived owner task (anyio cancel scopes must be exited by the task
    that entered them), publish the tools, and keep the task alive until _disconnect()."""
    await _disconnect()
    ready, close_evt = asyncio.Event(), asyncio.Event()
    box: dict[str, Any] = {}

    async def owner() -> None:
        try:
            async with contextlib.AsyncExitStack() as stack:
                conns = connections(True)
                client = MultiServerMCPClient(conns)
                tools: list[BaseTool] = []
                session = await stack.enter_async_context(client.session("agritwin"))
                tools += await load_mcp_tools(session, server_name="agritwin")
                borrowed_ok = False
                if "open-meteo" in conns:
                    try:
                        s2 = await asyncio.wait_for(stack.enter_async_context(client.session("open-meteo")), timeout=40)
                        tools += await load_mcp_tools(s2, server_name="open-meteo")
                        borrowed_ok = True
                    except Exception as e:  # noqa: BLE001
                        log.warning("borrowed MCP server unavailable: %s", e)
                for t in tools:
                    t.metadata = {**(t.metadata or {}), "server_name": "open-meteo" if t.name in BORROWED_TOOLS else "agritwin"}
                box.update(tools=tools, borrowed_ok=borrowed_ok)
                ready.set()
                await close_evt.wait()
        except Exception as e:  # noqa: BLE001
            box["error"] = e
            ready.set()

    task = asyncio.create_task(owner(), name="agritwin-mcp-sessions")
    await ready.wait()
    if "error" in box:
        raise box["error"]
    _state.update(loop=asyncio.get_running_loop(), task=task, close=close_evt, tools=box["tools"], borrowed_ok=box["borrowed_ok"])
    return box["tools"]


async def _disconnect() -> None:
    task, close_evt = _state.get("task"), _state.get("close")
    _state.update(task=None, close=None, tools=None, borrowed_ok=False)
    if task is not None and close_evt is not None and not task.done():
        close_evt.set()
        with contextlib.suppress(Exception):
            await asyncio.wait_for(task, timeout=10)


async def get_tools() -> list[BaseTool]:
    loop = asyncio.get_running_loop()
    if _state.get("lock") is None or _state.get("loop") is not loop:
        _state["lock"] = asyncio.Lock()
    async with _state["lock"]:
        if _state.get("tools") is None or _state.get("loop") is not loop:
            await _connect()
        return list(_state["tools"])


async def reconnect() -> list[BaseTool]:
    async with _state["lock"]:
        return await _connect()


class ToolBox:
    """Loaded MCP tools, callable by name, with run-bus tracing and JSON-decoded results."""

    def __init__(self, tools: list[BaseTool], run_id: str | None = None):
        self.by_name: dict[str, BaseTool] = {t.name: t for t in tools}
        self.run_id = run_id
        self._n = 0

    def has(self, name: str) -> bool:
        return name in self.by_name

    def server_of(self, name: str) -> str:
        t = self.by_name.get(name)
        return ((t.metadata or {}).get("server_name") if t else None) or ("open-meteo" if name in BORROWED_TOOLS else "agritwin")

    async def call(self, name: str, **kwargs: Any) -> Any:
        tool = self.by_name[name]
        self._n += 1
        tc_id = f"tc-{self._n}"
        if self.run_id and "run_id" in (tool.args or {}) and "run_id" not in kwargs:
            kwargs["run_id"] = self.run_id
        if self.run_id:
            bus.emit(self.run_id, "tool_call", {"id": tc_id, "server": self.server_of(name), "tool": name, "input": kwargs})
        t0 = time.perf_counter()
        try:
            raw = await tool.ainvoke(kwargs)
        except Exception as e:  # noqa: BLE001
            ms = int((time.perf_counter() - t0) * 1000)
            if self.run_id:
                bus.emit(self.run_id, "tool_result", {"id": tc_id, "tool": name, "ok": False, "durationMs": ms, "summary": str(e)[:300]})
            if not _is_app_error(e):  # transport trouble: reconnect so the caller's retry gets a fresh session
                with contextlib.suppress(Exception):
                    self.by_name = {t.name: t for t in await reconnect()}
            raise
        out = _decode(raw)
        ms = int((time.perf_counter() - t0) * 1000)
        ok = not (isinstance(out, dict) and out.get("_error"))
        if self.run_id:
            bus.emit(self.run_id, "tool_result", {"id": tc_id, "tool": name, "ok": ok, "durationMs": ms,
                                                  "summary": _summary(name, out), "output": _trim(out)})
        if not ok:
            raise RuntimeError(out["_error"])
        return out


def _is_app_error(e: Exception) -> bool:
    """True when the *tool* raised (validation, unknown id, simulated outage), not the MCP transport."""
    from langchain_core.tools import ToolException
    return isinstance(e, ToolException) or str(e).startswith("Error executing tool")


def _decode(raw: Any) -> Any:
    if isinstance(raw, tuple):  # (content, artifact)
        raw = raw[0]
    if isinstance(raw, list) and raw and all(isinstance(x, dict) and x.get("type") == "text" for x in raw):
        raw = "".join(x.get("text", "") for x in raw)
    if isinstance(raw, (dict, list)):
        return raw
    s = str(raw).strip()
    if s.startswith("Error") or s.lower().startswith("error:"):
        return {"_error": s}
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return {"text": s}


def _trim(obj: Any, limit: int = 4000) -> Any:
    s = json.dumps(obj, ensure_ascii=False)
    if len(s) <= limit:
        return obj
    return {"_truncated": True, "preview": s[:limit]}


def _summary(name: str, out: Any) -> str:
    if not isinstance(out, dict):
        return str(out)[:160]
    if "_error" in out:
        return out["_error"][:200]
    if name == "get_plot":
        return f"{out.get('plotId')} {out.get('displayName')} · {out.get('status')} · stage {out.get('crop', {}).get('growthStage')} · household {out.get('householdName')}"
    if name == "get_climate_signals":
        if not out.get("available"):
            return "no rainfall signal: " + str(out.get("reason"))
        r = out["rainfall"]
        return f"last 7 d {r['last7Mm']} mm · next 3 d {round(sum(d['mm'] or 0 for d in r['forecast'][:3]), 1)} mm · {r['source']}"
    if name == "get_pest_alerts":
        return f"{len(out.get('alerts', []))} active alert(s): " + ", ".join(a['pest'] for a in out.get('alerts', []))
    if name == "check_advisory_rules":
        return f"primary {out.get('primaryAction')} ({out.get('primaryRuleId')}) · {len(out.get('findings', []))} findings" + \
            (" · BLOCKED " + out['blocked']['reason'] if out.get('blocked') else "")
    if name == "draft_advisory":
        return f"{out.get('advisoryId')} drafted: {out.get('action')} · {len(out.get('citations', []))} citations"
    if name == "get_weather_forecast":
        d = out.get("daily") or {}
        p = d.get("precipitation_sum") if isinstance(d, dict) else None
        return f"borrowed forecast · precipitation_sum {p} on {d.get('time')}" if p else "borrowed forecast received"
    if name == "ingest_weather":
        return "skipped: " + str(out.get("reason")) if out.get("skipped") else f"ingested {out.get('observedDays')} observed + {out.get('forecastDays')} forecast days"
    if name == "flag_plot":
        return f"{out.get('flagId')} {out.get('severity')}: {out.get('reason', '')[:100]}"
    if name == "schedule_follow_up":
        return f"{out.get('followupId')} on {out.get('date')}"
    return (", ".join(f"{k}={v}" for k, v in list(out.items())[:4] if not isinstance(v, (dict, list))) or "ok")[:160]


async def load_toolbox(run_id: str | None = None, include_borrowed: bool = True) -> ToolBox:
    tools = await get_tools()
    if not include_borrowed:
        tools = [t for t in tools if t.name not in BORROWED_TOOLS]
    return ToolBox(tools, run_id)
