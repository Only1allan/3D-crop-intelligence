"""Run event bus: one ordered event list per run, persisted to the `runs` table and fanned out live to
SSE subscribers. Event types are the ones in docs/API_CONTRACT.md."""
from __future__ import annotations

import asyncio
import threading
from typing import Any

from .. import db
from ..audit import now_iso

_runs: dict[str, dict] = {}
_subs: dict[str, list[asyncio.Queue]] = {}
_lock = threading.RLock()  # emit() may call create() while holding it


def create(run_id: str, kind: str, plot_id: str | None, thread_id: str | None = None) -> dict:
    run = {"runId": run_id, "kind": kind, "plotId": plot_id, "status": "running", "events": [], "threadId": thread_id,
           "createdAt": now_iso()}
    with _lock:
        _runs[run_id] = run
    with db.tx() as conn:
        conn.execute("INSERT OR REPLACE INTO runs VALUES (?,?,?,?,?,?,?)",
                     (run_id, kind, plot_id, "running", run["createdAt"], db.j([]), thread_id))
    return run


def get(run_id: str) -> dict | None:
    with _lock:
        run = _runs.get(run_id)
    if run:
        return run
    r = db.one("SELECT * FROM runs WHERE run_id=?", (run_id,))
    if not r:
        return None
    return {"runId": r["run_id"], "kind": r["kind"], "plotId": r["plot_id"], "status": r["status"], "events": db.uj(r["events_json"], []),
            "threadId": r["thread_id"], "createdAt": r["created_at"]}


def emit(run_id: str, event: str, data: dict[str, Any] | None = None) -> dict:
    ev = {"event": event, "data": data or {}, "ts": now_iso()}
    with _lock:
        run = _runs.get(run_id)
        if run is None:
            run = create(run_id, "unknown", None)
        run["events"].append(ev)
        if event == "awaiting_officer":
            run["status"] = "awaiting_officer"
        elif event == "done":
            run["status"] = "done"
        elif event == "error" and not data.get("recoverable"):
            run["status"] = "error"
        queues = list(_subs.get(run_id, []))
        snapshot = (run["status"], db.j(run["events"]))
    with db.tx() as conn:
        conn.execute("UPDATE runs SET status=?, events_json=? WHERE run_id=?", (snapshot[0], snapshot[1], run_id))
    for q in queues:
        try:
            q.put_nowait(ev)
        except asyncio.QueueFull:
            pass
    return ev


def subscribe(run_id: str) -> tuple[list[dict], asyncio.Queue]:
    """Return (replay of events so far, live queue). Caller must call unsubscribe()."""
    q: asyncio.Queue = asyncio.Queue(maxsize=1000)
    with _lock:
        run = _runs.get(run_id)
        replay = list(run["events"]) if run else []
        _subs.setdefault(run_id, []).append(q)
    return replay, q


def unsubscribe(run_id: str, q: asyncio.Queue) -> None:
    with _lock:
        if q in _subs.get(run_id, []):
            _subs[run_id].remove(q)


def set_thread(run_id: str, thread_id: str) -> None:
    with _lock:
        if run_id in _runs:
            _runs[run_id]["threadId"] = thread_id
    with db.tx() as conn:
        conn.execute("UPDATE runs SET thread_id=? WHERE run_id=?", (thread_id, run_id))
