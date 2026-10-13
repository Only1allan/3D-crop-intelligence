"""SQLite store. The MCP server is the only module that writes here; the REST bridge
calls the same tool functions, so every write is audit-logged whichever door it came in."""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS offices (
  office_id TEXT PRIMARY KEY, name TEXT, country TEXT, officers_json TEXT);
CREATE TABLE IF NOT EXISTS agro_zones (
  agro_zone_id TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, timezone TEXT, seasons_json TEXT);
CREATE TABLE IF NOT EXISTS farms (
  farm_id TEXT PRIMARY KEY, name TEXT, region TEXT, crop TEXT, agro_zone_id TEXT, lat REAL, lon REAL,
  elevation_m REAL, total_ha REAL, today TEXT, office_id TEXT, notes TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS plots (
  plot_id TEXT PRIMARY KEY, farm_id TEXT, display_name TEXT, grid_json TEXT, household_id TEXT,
  household_name TEXT, contact_method TEXT, agro_zone_id TEXT, last_visit_json TEXT, state_json TEXT,
  updated_at TEXT);
CREATE TABLE IF NOT EXISTS rainfall_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id TEXT, agro_zone_id TEXT, kind TEXT, date TEXT, mm REAL,
  probability REAL, tmax REAL, tmin REAL, source TEXT, fetched_at TEXT, UNIQUE(farm_id, kind, date));
CREATE TABLE IF NOT EXISTS pest_alerts (
  alert_id TEXT PRIMARY KEY, agro_zone_id TEXT, pest TEXT, crop TEXT, severity TEXT, issued_at TEXT,
  expires_at TEXT, stages_json TEXT, summary TEXT, source TEXT, recommended_action TEXT);
CREATE TABLE IF NOT EXISTS advisories (
  advisory_id TEXT PRIMARY KEY, plot_id TEXT, farm_id TEXT, household_id TEXT, action TEXT, message TEXT,
  reasoning TEXT, citations_json TEXT, findings_json TEXT, status TEXT, created_at TEXT, run_id TEXT,
  drafter_json TEXT, decision_json TEXT);
CREATE TABLE IF NOT EXISTS followups (
  followup_id TEXT PRIMARY KEY, plot_id TEXT, farm_id TEXT, date TEXT, note TEXT, created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS flags (
  flag_id TEXT PRIMARY KEY, plot_id TEXT, farm_id TEXT, reason TEXT, severity TEXT, created_by TEXT,
  created_at TEXT, resolved INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, tool TEXT, actor TEXT, run_id TEXT, input_json TEXT,
  output_json TEXT, ok INTEGER, duration_ms INTEGER, plot_id TEXT, advisory_id TEXT);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY, kind TEXT, plot_id TEXT, status TEXT, created_at TEXT, events_json TEXT, thread_id TEXT);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER);
CREATE INDEX IF NOT EXISTS idx_audit_plot ON audit_log(plot_id);
CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_log(run_id);
CREATE INDEX IF NOT EXISTS idx_adv_plot ON advisories(plot_id, status);
"""

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None
_conn_path: Path | None = None


def connect(path: Path | None = None) -> sqlite3.Connection:
    """Process-wide connection (re-opened if the configured path changes, e.g. in tests)."""
    global _conn, _conn_path
    path = path or settings().db_path
    with _lock:
        if _conn is None or _conn_path != path:
            if _conn is not None:
                _conn.close()
            path.parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.execute("PRAGMA foreign_keys=ON")
            _conn.executescript(SCHEMA)
            _conn_path = path
        return _conn


def reset_for_tests(path: Path) -> None:
    global _conn, _conn_path
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn, _conn_path = None, None
        if path.exists():
            path.unlink()
        connect(path)


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    """Serialised transaction; SQLite is fine with this at hackathon scale."""
    conn = connect()
    with _lock:
        if conn.in_transaction:  # re-entrant: join the outer transaction
            yield conn
            return
        conn.execute("BEGIN")
        try:
            yield conn
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise


def q(sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
    conn = connect()
    with _lock:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def one(sql: str, params: tuple | dict = ()) -> dict[str, Any] | None:
    rows = q(sql, params)
    return rows[0] if rows else None


_ID_TABLES = {"farm": ("farms", "farm_id"), "household": ("plots", "household_id"), "advisory": ("advisories", "advisory_id"),
              "followup": ("followups", "followup_id"), "flag": ("flags", "flag_id")}


def next_id(prefix: str, name: str, width: int = 4) -> str:
    """Monotonic ids per kind; skips ids that already exist (seeded fixtures use the same scheme)."""
    table = _ID_TABLES.get(name)
    with tx() as conn:
        row = conn.execute("SELECT value FROM counters WHERE name=?", (name,)).fetchone()
        value = (row["value"] if row else 0)
        while True:
            value += 1
            candidate = f"{prefix}-{value:0{width}d}"
            if not table or not conn.execute(f"SELECT 1 FROM {table[0]} WHERE {table[1]}=?", (candidate,)).fetchone():
                break
        conn.execute("INSERT OR REPLACE INTO counters(name, value) VALUES (?, ?)", (name, value))
    return candidate


def j(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def uj(s: str | None, default: Any = None) -> Any:
    if not s:
        return default
    return json.loads(s)
