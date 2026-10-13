import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def _isolated_store(tmp_path, monkeypatch):
    """Fresh SQLite + audit file per test, demo date pinned, no network."""
    monkeypatch.setenv("AGRITWIN_DB", str(tmp_path / "t.db"))
    monkeypatch.setenv("AGRITWIN_AUDIT_JSONL", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGRITWIN_TODAY", "2026-09-27")
    monkeypatch.setenv("AGRITWIN_LIVE_WEATHER", "0")
    monkeypatch.delenv("AGRITWIN_FAIL_WEATHER", raising=False)
    os.chdir(ROOT)
    from agritwin import db
    from agritwin.ingest.fixture import seed
    db.reset_for_tests(tmp_path / "t.db")
    seed()
    yield
