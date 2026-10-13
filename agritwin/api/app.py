"""REST + SSE bridge (see docs/API_CONTRACT.md).

One process serves: the MCP server (streamable HTTP at /mcp), the REST bridge the browser uses (/api/*),
and the built console (web/dist) at /. The REST handlers call the same audit-logged tool functions the MCP
server exposes; the agent itself always goes through MCP over HTTP (loopback) so its calls are real MCP calls."""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from .. import __version__, audit, db
from ..agent import bus
from ..agent.chat import run_chat
from ..agent.llm import resolve
from ..agent.mcp_client import borrowed_command
from ..agent.service import decide, start_advisory_run
from ..config import ROOT, settings
from ..mcp_server import tools as T
from ..mcp_server.server import build_server

mcp = build_server(streamable_http_path="/")
mcp_app = mcp.streamable_http_app()


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    db.connect()
    if not db.one("SELECT 1 FROM farms LIMIT 1"):
        from ..ingest.fixture import seed
        seed()
    os.environ.setdefault("AGRITWIN_MCP_URL", f"http://{settings().host}:{settings().port}/mcp/")
    async with mcp.session_manager.run():
        yield


app = FastAPI(title="AgriTwin Advisory Desk API", version=__version__, lifespan=lifespan)
app.mount("/mcp", mcp_app)


def _api(fn, *a, **kw):
    token = audit.current_actor.set("api")
    try:
        return fn(*a, **kw)
    except KeyError as e:
        raise HTTPException(404, str(e).strip("'")) from e
    except (ValueError, PermissionError) as e:
        raise HTTPException(400, str(e)) from e
    finally:
        audit.current_actor.reset(token)


@app.exception_handler(Exception)
async def _unhandled(_: Request, exc: Exception):
    return JSONResponse({"detail": f"{type(exc).__name__}: {exc}"}, status_code=500)


# ------------------------------------------------------------------ health / office / farms
@app.get("/api/health")
def health():
    _, info = resolve()
    n_tools = len(T.READ_TOOLS) + len(T.ACT_TOOLS) + len(T.GATE_TOOLS)
    return {"ok": True, "version": __version__, "model": info.dict(), "mcp": {"server": "agritwin", "tools": n_tools, "url": "/mcp/"},
            "borrowedMcp": {"name": "chuk-mcp-open-meteo", "ok": borrowed_command() is not None}, "today": settings().today.isoformat(),
            "liveWeather": settings().live_weather}


@app.get("/api/office")
def office():
    return _api(T.get_office.__wrapped_tool__)


@app.get("/api/farms")
def farms():
    return _api(T.list_farms.__wrapped_tool__)["farms"]


@app.get("/api/farms/{farm_id}")
def farm(farm_id: str):
    return _api(T.get_farm_twin.__wrapped_tool__, farm_id)


class PlotIn(BaseModel):
    plotId: str | None = None
    displayName: str | None = None
    householdName: str | None = None
    contactMethod: str = "sms"
    areaHa: float | None = None
    variety: str | None = None
    plantingDate: str | None = None


class FarmIn(BaseModel):
    name: str
    region: str
    crop: str
    lat: float
    lon: float
    agroZoneId: str | None = None
    notes: str = ""
    plots: list[PlotIn] = []


@app.post("/api/farms")
def create_farm(body: FarmIn):
    return _api(T.register_farm, body.name, body.region, body.crop, body.lat, body.lon, body.agroZoneId,
                [p.model_dump() for p in body.plots], None, body.notes)


@app.post("/api/farms/{farm_id}/ingest/weather")
def ingest_weather(farm_id: str):
    try:
        return _api(T.ingest_weather, farm_id)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 - network failures are reported, not raised
        return {"ok": False, "error": str(e)}


class ReadingsIn(BaseModel):
    readings: list[dict]
    source: str = "ingested"


@app.post("/api/farms/{farm_id}/ingest/readings")
def ingest_readings(farm_id: str, body: ReadingsIn):
    return _api(T.ingest_plot_readings, farm_id, body.readings, body.source)


# ------------------------------------------------------------------ plots
@app.get("/api/plots/{plot_id}")
def plot(plot_id: str):
    p = _api(T.get_plot.__wrapped_tool__, plot_id)
    sig = _api(T.get_climate_signals.__wrapped_tool__, plot_id)
    p["signals"] = {"rainfall": sig["rainfall"] if sig.get("available") else None}
    p["alerts"] = _api(T.get_pest_alerts.__wrapped_tool__, None, plot_id)["alerts"]
    return p


@app.get("/api/plots/{plot_id}/rules")
def plot_rules(plot_id: str):
    return _api(T.check_advisory_rules.__wrapped_tool__, plot_id)


# ------------------------------------------------------------------ advisories & the gate
@app.get("/api/advisories")
def advisories(status: str | None = None, farmId: str | None = None, plotId: str | None = None, limit: int = 100):
    return _api(T.list_advisories.__wrapped_tool__, farmId, status, plotId, limit)["advisories"]


@app.get("/api/advisories/{advisory_id}")
def advisory(advisory_id: str):
    return _api(T.get_advisory.__wrapped_tool__, advisory_id)


class DecisionIn(BaseModel):
    officerName: str
    decision: str
    reason: str | None = None


@app.post("/api/advisories/{advisory_id}/decision")
async def decision(advisory_id: str, body: DecisionIn):
    try:
        return await decide(advisory_id, body.officerName, body.decision, body.reason)
    except KeyError as e:
        raise HTTPException(404, str(e).strip("'")) from e
    except (ValueError, PermissionError) as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/audit")
def audit_log(plotId: str | None = None, advisoryId: str | None = None, runId: str | None = None, limit: int = 100):
    return audit.rows(plotId, advisoryId, runId, limit)


@app.get("/api/followups")
def followups(farmId: str | None = None):
    return _api(T.list_followups.__wrapped_tool__, farmId)["followups"]


@app.get("/api/flags")
def flags(farmId: str | None = None):
    return _api(T.list_flags.__wrapped_tool__, farmId)["flags"]


# ------------------------------------------------------------------ agent runs
class RunIn(BaseModel):
    plotId: str
    provider: str | None = None


@app.post("/api/agent/run")
async def agent_run(body: RunIn):
    _api(T.get_plot.__wrapped_tool__, body.plotId)
    run_id = "run-" + uuid.uuid4().hex[:10]
    bus.create(run_id, "advisory", body.plotId, run_id)

    async def go():
        try:
            await start_advisory_run(body.plotId, body.provider, run_id)
        except Exception:  # noqa: BLE001 - already emitted on the bus
            pass

    asyncio.create_task(go())
    return {"runId": run_id, "plotId": body.plotId}


class ChatIn(BaseModel):
    message: str
    plotId: str | None = None
    farmId: str | None = None
    threadId: str | None = None
    provider: str | None = None


@app.post("/api/chat")
async def chat(body: ChatIn):
    run_id = "run-" + uuid.uuid4().hex[:10]
    thread_id = body.threadId or "thr-" + uuid.uuid4().hex[:8]
    bus.create(run_id, "chat", body.plotId, thread_id)

    async def go():
        try:
            await run_chat(run_id, body.message, body.plotId, body.farmId, thread_id, body.provider)
        except Exception:  # noqa: BLE001
            pass

    asyncio.create_task(go())
    return {"runId": run_id, "threadId": thread_id}


@app.get("/api/agent/runs/{run_id}")
def run_info(run_id: str):
    run = bus.get(run_id)
    if not run:
        raise HTTPException(404, "unknown run")
    return run


@app.get("/api/agent/runs/{run_id}/events")
async def run_events(run_id: str, request: Request):
    run = bus.get(run_id)
    if not run:
        raise HTTPException(404, "unknown run")

    async def gen():
        replay, q = bus.subscribe(run_id)
        try:
            for ev in replay:
                yield {"event": ev["event"], "data": json.dumps(ev["data"])}
                if ev["event"] == "done":
                    return
            deadline = asyncio.get_event_loop().time() + 600
            while asyncio.get_event_loop().time() < deadline:
                if await request.is_disconnected():
                    return
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
                    continue
                yield {"event": ev["event"], "data": json.dumps(ev["data"])}
                if ev["event"] == "done":
                    return
        finally:
            bus.unsubscribe(run_id, q)

    return EventSourceResponse(gen())


# ------------------------------------------------------------------ static console
DIST = ROOT / "web" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        candidate = DIST / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")


def main() -> None:
    import uvicorn

    s = settings()
    print(f"AgriTwin Advisory Desk v{__version__} · http://{s.host}:{s.port}  (console) · /mcp (MCP) · /api (REST)")
    uvicorn.run("agritwin.api.app:app", host=s.host, port=s.port, log_level="info")


if __name__ == "__main__":
    main()
