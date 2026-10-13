"""Every tool call is logged: inputs, outputs, timestamp, duration, who called it, and which run.

The log goes to the `audit_log` table (what the console renders) and to an append-only JSONL
file (what a reviewer can grep). Logging happens *inside* the tool wrapper, so it is the same
whether the call arrived over MCP (agent), over REST (officer console) or from a test.
"""
from __future__ import annotations

import contextvars
import functools
import inspect
import json
import time
from datetime import datetime, timezone
from typing import Any, Callable

from . import db
from .config import settings

current_actor: contextvars.ContextVar[str] = contextvars.ContextVar("agritwin_actor", default="agent")
current_run_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("agritwin_run", default=None)

_subscribers: list[Callable[[dict], None]] = []


def subscribe(fn: Callable[[dict], None]) -> Callable[[], None]:
    """Live audit feed (the API uses it to stream tool calls to the browser)."""
    _subscribers.append(fn)
    return lambda: _subscribers.remove(fn)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _truncate(obj: Any, limit: int = 6000) -> Any:
    s = db.j(obj)
    if len(s) <= limit:
        return obj
    return {"_truncated": True, "preview": s[:limit]}


def record(tool: str, inp: dict, out: Any, ok: bool, duration_ms: int, *,
           actor: str | None = None, run_id: str | None = None) -> dict:
    actor = actor or current_actor.get()
    run_id = run_id or inp.get("run_id") or current_run_id.get()
    plot_id = inp.get("plot_id") or (out.get("plotId") if isinstance(out, dict) else None)
    advisory_id = inp.get("advisory_id") or (out.get("advisoryId") if isinstance(out, dict) else None)
    if advisory_id and not plot_id:
        row = db.one("SELECT plot_id FROM advisories WHERE advisory_id=?", (advisory_id,))
        plot_id = row["plot_id"] if row else None
    entry = {
        "ts": now_iso(), "tool": tool, "actor": actor, "runId": run_id,
        "input": inp, "output": _truncate(out), "ok": ok, "durationMs": duration_ms,
        "plotId": plot_id, "advisoryId": advisory_id,
    }
    with db.tx() as conn:
        cur = conn.execute(
            "INSERT INTO audit_log(ts,tool,actor,run_id,input_json,output_json,ok,duration_ms,plot_id,advisory_id)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (entry["ts"], tool, actor, run_id, db.j(inp), db.j(entry["output"]), int(ok), duration_ms,
             plot_id, advisory_id))
        entry["id"] = cur.lastrowid
    try:
        path = settings().audit_jsonl
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass
    for fn in list(_subscribers):
        try:
            fn(entry)
        except Exception:
            pass
    return entry


def logged_tool(fn: Callable) -> Callable:
    """Decorator: log the call (even when it raises) and re-raise."""
    sig = inspect.signature(fn)

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        bound = sig.bind_partial(*args, **kwargs)
        bound.apply_defaults()
        inp = {k: v for k, v in bound.arguments.items() if v is not None}
        t0 = time.perf_counter()
        try:
            out = fn(*args, **kwargs)
        except Exception as e:  # noqa: BLE001 - we log then re-raise
            record(fn.__name__, inp, {"error": str(e)}, False, int((time.perf_counter() - t0) * 1000))
            raise
        record(fn.__name__, inp, out, True, int((time.perf_counter() - t0) * 1000))
        return out

    wrapper.__wrapped_tool__ = fn  # type: ignore[attr-defined]
    return wrapper


def rows(plot_id: str | None = None, advisory_id: str | None = None, run_id: str | None = None,
         limit: int = 100) -> list[dict]:
    where, params = [], []
    if plot_id:
        where.append("plot_id=?"); params.append(plot_id)
    if advisory_id:
        where.append("advisory_id=?"); params.append(advisory_id)
    if run_id:
        where.append("run_id=?"); params.append(run_id)
    sql = "SELECT * FROM audit_log" + (" WHERE " + " AND ".join(where) if where else "") + \
          " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    out = []
    for r in db.q(sql, tuple(params)):
        out.append({
            "id": r["id"], "ts": r["ts"], "tool": r["tool"], "actor": r["actor"], "runId": r["run_id"],
            "input": db.uj(r["input_json"], {}), "output": db.uj(r["output_json"]), "ok": bool(r["ok"]),
            "durationMs": r["duration_ms"], "plotId": r["plot_id"], "advisoryId": r["advisory_id"],
        })
    return out
