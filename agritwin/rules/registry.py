"""Crop profiles are YAML files. Drop a new one in `agritwin/rules/profiles/` (or any directory
listed in AGRITWIN_PROFILE_DIRS) and the engine, the MCP resources and the agent pick it up.
That is the main extension point for other crops / regions."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from ..config import ROOT, settings


def _load_all() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for d in settings().profile_dirs:
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.yaml")):
            with f.open(encoding="utf-8") as fh:
                p = yaml.safe_load(fh)
            if not p or "crop" not in p:
                continue
            try:
                p["_file"] = str(f.relative_to(ROOT))
            except ValueError:
                p["_file"] = str(f)
            out[p["crop"]] = p  # later directories override bundled ones
    return out


@lru_cache(maxsize=1)
def _cache() -> dict[str, dict]:
    return _load_all()


def reload() -> None:
    _cache.cache_clear()


def list_profiles() -> list[dict]:
    return [{"crop": c, "version": p.get("version", 1), "stages": p.get("stages", []), "file": p["_file"]}
            for c, p in _cache().items()]


def get_profile(crop: str) -> dict:
    p = _cache().get(crop)
    if p is None:
        raise KeyError(f"no crop profile for '{crop}'; known: {sorted(_cache())}")
    return p
