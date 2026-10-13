"""Runtime settings. Everything comes from the environment (or a .env at the repo root)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


@dataclass(frozen=True)
class Settings:
    db_path: Path
    audit_jsonl: Path
    fixtures_dir: Path
    profile_dirs: list[Path]
    today: date
    live_weather: bool
    host: str
    port: int
    model_provider: str
    ollama_host: str
    ollama_model: str
    openrouter_key: str
    openrouter_model: str
    openrouter_fallback_model: str
    anthropic_key: str
    anthropic_model: str


def settings() -> Settings:
    """Read settings fresh each call so tests and the CLI can override via env."""
    today_s = _env("AGRITWIN_TODAY")
    today = date.fromisoformat(today_s) if today_s else date.today()
    extra = [Path(p) for p in _env("AGRITWIN_PROFILE_DIRS").split(os.pathsep) if p]
    return Settings(
        db_path=ROOT / _env("AGRITWIN_DB", "data/agritwin.db"),
        audit_jsonl=ROOT / _env("AGRITWIN_AUDIT_JSONL", "data/audit.jsonl"),
        fixtures_dir=ROOT / _env("AGRITWIN_FIXTURES", "fixtures"),
        profile_dirs=[ROOT / "agritwin" / "rules" / "profiles", *extra],
        today=today,
        live_weather=_env("AGRITWIN_LIVE_WEATHER", "1") not in ("0", "false", "no"),
        host=_env("AGRITWIN_HOST", "127.0.0.1"),
        port=int(_env("AGRITWIN_PORT", "8000")),
        model_provider=_env("AGRITWIN_MODEL_PROVIDER", "auto"),
        ollama_host=_env("OLLAMA_HOST", "http://localhost:11434"),
        ollama_model=_env("OLLAMA_MODEL", "qwen3:8b"),
        openrouter_key=_env("OPENROUTER_API_KEY"),
        openrouter_model=_env("OPENROUTER_MODEL", "google/gemma-4-26b-a4b-it:free"),
        openrouter_fallback_model=_env("OPENROUTER_FALLBACK_MODEL", "nvidia/nemotron-3-super-120b-a12b:free"),
        anthropic_key=_env("ANTHROPIC_API_KEY"),
        anthropic_model=_env("ANTHROPIC_MODEL", "claude-sonnet-5"),
    )
