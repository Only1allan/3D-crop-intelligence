"""Seed the store from the JSON fixtures, shifting every date so the demo is always 'today'."""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from .. import db
from ..audit import now_iso
from ..config import settings

_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(T[0-9:.]+Z?)?$")


def shift_dates(obj: Any, delta: timedelta) -> Any:
    """Recursively shift ISO date / datetime strings by delta."""
    if isinstance(obj, str):
        m = _DATE.match(obj)
        if m:
            d = date(int(m[1]), int(m[2]), int(m[3])) + delta
            return d.isoformat() + (m[4] or "")
        return obj
    if isinstance(obj, list):
        return [shift_dates(x, delta) for x in obj]
    if isinstance(obj, dict):
        return {k: shift_dates(v, delta) for k, v in obj.items()}
    return obj


def seed(fixtures_dir: Path | None = None, today: date | None = None, *, reset: bool = True) -> dict:
    s = settings()
    fixtures_dir = fixtures_dir or s.fixtures_dir
    today = today or s.today
    farm_fx = json.loads((fixtures_dir / "farm_demo.json").read_text(encoding="utf-8"))
    fixture_today = date.fromisoformat(farm_fx["farms"][0]["today"])
    delta = today - fixture_today
    farm_fx = shift_dates(farm_fx, delta)
    pests = json.loads((fixtures_dir / "pest_alerts.json").read_text(encoding="utf-8"))
    rain = json.loads((fixtures_dir / "rainfall_cache.json").read_text(encoding="utf-8"))
    now = now_iso()

    with db.tx() as conn:
        if reset:
            for t in ("offices", "agro_zones", "farms", "plots", "rainfall_signals", "pest_alerts", "advisories",
                      "followups", "flags", "audit_log", "runs", "counters"):
                conn.execute(f"DELETE FROM {t}")
        o = farm_fx["office"]
        conn.execute("INSERT OR REPLACE INTO offices VALUES (?,?,?,?)", (o["officeId"], o["name"], o["country"], db.j(o["officers"])))
        for z in farm_fx["agroZones"]:
            conn.execute("INSERT OR REPLACE INTO agro_zones VALUES (?,?,?,?,?,?)",
                         (z["agroZoneId"], z["name"], z["lat"], z["lon"], z.get("timezone", "UTC"), db.j(z["seasons"])))
        for f in farm_fx["farms"]:
            conn.execute("INSERT OR REPLACE INTO farms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                         (f["farmId"], f["name"], f["region"], f["crop"], f["agroZoneId"], f["lat"], f["lon"], f.get("elevationM"),
                          f.get("totalHa"), f["today"], f.get("officeId"), f.get("notes", ""), now))
        for p in farm_fx["plots"]:
            state = {k: v for k, v in p.items() if k not in ("plotId", "farmId", "householdId", "householdName", "contactMethod",
                                                              "lastVisit", "agroZoneId", "displayName", "grid")}
            state["zoneId"] = p["zoneId"]
            conn.execute("INSERT OR REPLACE INTO plots VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                         (p["plotId"], p["farmId"], p["displayName"], db.j(p.get("grid")), p["householdId"], p["householdName"],
                          p["contactMethod"], p["agroZoneId"], db.j(p.get("lastVisit")), db.j(state), p.get("lastUpdateTime", now)))
        for a in pests["alerts"]:
            issued = (today + timedelta(days=a["issuedDayOffset"])).isoformat() + "T06:00:00Z"
            expires = (today + timedelta(days=a["expiresDayOffset"])).isoformat() + "T23:59:59Z"
            conn.execute("INSERT OR REPLACE INTO pest_alerts VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                         (a["alertId"], a["agroZoneId"], a["pest"], a.get("crop"), a["severity"], issued, expires,
                          db.j(a.get("stages", [])), a.get("summary", ""), a.get("source", ""), a.get("recommendedAction")))
        for zone_id, series in rain["zones"].items():
            farms = [f for f in farm_fx["farms"] if f["agroZoneId"] == zone_id]
            for f in farms:
                for kind in ("observed", "forecast"):
                    for d in series[kind]:
                        day = (today + timedelta(days=d["dayOffset"])).isoformat()
                        conn.execute(
                            "INSERT OR REPLACE INTO rainfall_signals(farm_id,agro_zone_id,kind,date,mm,probability,tmax,tmin,source,fetched_at)"
                            " VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (f["farmId"], zone_id, kind, day, d["mm"], d.get("probability"), d.get("tmax"), d.get("tmin"),
                             rain.get("source", "seeded cache"), now))
    return {"farms": len(farm_fx["farms"]), "plots": len(farm_fx["plots"]), "alerts": len(pests["alerts"]),
            "today": today.isoformat(), "shiftedDays": delta.days}


class FixtureAdapter:
    name = "fixture"
    description = "Seed the twin store from the bundled JSON fixtures (synthetic demo farm)."

    def run(self, **kwargs: Any) -> dict:
        return seed(**kwargs)
