"""Seed (or reseed) the twin store from the fixtures, then optionally pull live weather.

    python scripts/seed.py            # reseed, dates shifted to today, live weather if enabled
    python scripts/seed.py --no-live  # keep the seeded rainfall cache
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agritwin import audit  # noqa: E402
from agritwin.config import settings  # noqa: E402
from agritwin.ingest.fixture import seed  # noqa: E402
from agritwin.mcp_server import tools as T  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-live", action="store_true", help="do not call Open-Meteo after seeding")
    args = ap.parse_args()
    s = settings()
    out = seed()
    print(f"seeded {out['farms']} farm(s), {out['plots']} plots, {out['alerts']} alerts; today={out['today']} "
          f"(fixture shifted {out['shiftedDays']:+d} days) -> {s.db_path}")
    if not args.no_live and s.live_weather:
        audit.current_actor.set("api:seed")
        for f in T.list_farms.__wrapped_tool__()["farms"]:  # type: ignore[attr-defined]
            try:
                r = T.ingest_weather(f["farmId"])
                print(f"weather {f['farmId']}: {r}")
            except Exception as e:  # noqa: BLE001
                print(f"weather {f['farmId']}: FAILED ({e}); seeded cache kept")


if __name__ == "__main__":
    main()
