"""Glue used by both the API and the CLI: start a run, pause at the gate, resume with a human decision."""
from __future__ import annotations

import asyncio
import os
import threading
import time
from typing import Any

import httpx
import logging
from langgraph.types import Command

from .. import audit
from ..config import settings
from ..mcp_server import tools as T
from . import bus
from .graph import GRAPH, new_run_id, thread_config

for _n in ("httpx", "httpcore", "mcp", "uvicorn", "uvicorn.access", "mcp.server.streamable_http_manager", "mcp.server.lowlevel.server"):
    logging.getLogger(_n).setLevel(logging.WARNING)

_paused: dict[str, str] = {}  # advisoryId -> runId waiting at the gate


async def start_advisory_run(plot_id: str, provider: str | None = None, run_id: str | None = None) -> dict:
    """Run the graph until it pauses at the officer gate (or ends). Returns the run record."""
    run_id = run_id or new_run_id()
    bus.create(run_id, "advisory", plot_id, thread_id=run_id)
    t0 = time.perf_counter()
    try:
        result = await GRAPH.ainvoke({"run_id": run_id, "plot_id": plot_id, "provider": provider}, config=thread_config(run_id))
    except Exception as e:  # noqa: BLE001
        bus.emit(run_id, "error", {"text": f"{type(e).__name__}: {e}", "recoverable": False})
        bus.emit(run_id, "done", {"runId": run_id, "outcome": "error", "durationMs": int((time.perf_counter() - t0) * 1000)})
        raise
    if result.get("draft") and result.get("outcome") is None:
        _paused[result["draft"]["advisoryId"]] = run_id
    return bus.get(run_id)


async def resume_run(run_id: str, decision: dict) -> dict:
    result = await GRAPH.ainvoke(Command(resume=decision), config=thread_config(run_id))
    return result


def paused_run_for(advisory_id: str) -> str | None:
    return _paused.get(advisory_id)


async def decide(advisory_id: str, officer_name: str, decision: str, reason: str | None = None) -> dict:
    """The human gate. Records the decision as the named officer, then resumes the paused graph (if any)."""
    token = audit.current_actor.set(f"human:{officer_name}")
    try:
        adv = T.record_officer_decision(advisory_id, officer_name, decision, reason)
    finally:
        audit.current_actor.reset(token)
    run_id = _paused.pop(advisory_id, None)
    if run_id:
        try:
            await resume_run(run_id, {"officerName": officer_name, "decision": decision, "reason": reason})
        except Exception as e:  # noqa: BLE001
            bus.emit(run_id, "error", {"text": f"finalize failed: {e}", "recoverable": False})
    return adv


# ------------------------------------------------------------------ embedded MCP server (CLI / evals)
_embedded: dict[str, Any] = {}


def ensure_local_mcp(port: int | None = None) -> str:
    port = port or int(os.environ.get("AGRITWIN_EMBEDDED_MCP_PORT", "8765"))
    """For the CLI and evals: if no AgriTwin MCP endpoint is reachable, serve one from this process on `port`."""
    url = os.environ.get("AGRITWIN_MCP_URL") or f"http://127.0.0.1:{settings().port}/mcp/"
    if _reachable(url):
        os.environ["AGRITWIN_MCP_URL"] = url
        return url
    if "thread" not in _embedded:
        import uvicorn

        from ..mcp_server.server import build_server

        server = build_server(host="127.0.0.1", port=port, streamable_http_path="/mcp")
        app = server.streamable_http_app()
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
        uv = uvicorn.Server(config)
        th = threading.Thread(target=uv.run, daemon=True, name="agritwin-mcp-embedded")
        th.start()
        _embedded.update(thread=th, server=uv)
        for _ in range(50):
            if _reachable(f"http://127.0.0.1:{port}/mcp"):
                break
            time.sleep(0.1)
    url = f"http://127.0.0.1:{port}/mcp"
    os.environ["AGRITWIN_MCP_URL"] = url
    return url


def _reachable(url: str) -> bool:
    try:
        r = httpx.get(url, timeout=0.8, headers={"Accept": "text/event-stream"})
        return r.status_code in (200, 400, 405, 406)
    except Exception:  # noqa: BLE001
        return False


async def wait_for_event(run_id: str, kinds: set[str], timeout: float = 600) -> dict | None:
    replay, q = bus.subscribe(run_id)
    try:
        for ev in replay:
            if ev["event"] in kinds:
                return ev
        loop = asyncio.get_event_loop()
        end = loop.time() + timeout
        while loop.time() < end:
            try:
                ev = await asyncio.wait_for(q.get(), timeout=max(0.1, end - loop.time()))
            except asyncio.TimeoutError:
                return None
            if ev["event"] in kinds:
                return ev
    finally:
        bus.unsubscribe(run_id, q)
    return None
