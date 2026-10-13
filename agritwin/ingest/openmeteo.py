"""Open-Meteo rainfall ingestion (the external API lives *inside* the MCP server, as a data adapter).

One call returns the last `past_days` of analysed precipitation plus a `forecast_days` forecast for
the farm's coordinates. No API key. Rows are stored per farm so each twin carries its own signal."""
from __future__ import annotations

import os
from datetime import date
from typing import Any

import httpx

from .. import db
from ..audit import now_iso
from ..config import settings

URL = "https://api.open-meteo.com/v1/forecast"
SOURCE = "Open-Meteo forecast API (past-days analysis + 7-day forecast)"


def fetch(lat: float, lon: float, past_days: int = 7, forecast_days: int = 7, timeout: float = 12.0) -> dict:
    if os.environ.get("AGRITWIN_FAIL_WEATHER") == "1":  # used by the evals to test fail-closed behaviour
        raise httpx.ConnectError("simulated weather outage (AGRITWIN_FAIL_WEATHER=1)")
    params = {
        "latitude": lat, "longitude": lon, "timezone": "auto",
        "daily": "precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min",
        "past_days": past_days, "forecast_days": forecast_days,
    }
    with httpx.Client(timeout=timeout) as client:
        r = client.get(URL, params=params)
        r.raise_for_status()
        return r.json()


def store(farm_id: str, agro_zone_id: str, payload: dict, today: date) -> dict:
    d = payload["daily"]
    fetched = now_iso()
    n_obs = n_fc = 0
    with db.tx() as conn:
        for i, day in enumerate(d["time"]):
            kind = "observed" if date.fromisoformat(day) < today else "forecast"
            conn.execute(
                "INSERT OR REPLACE INTO rainfall_signals(farm_id,agro_zone_id,kind,date,mm,probability,tmax,tmin,source,fetched_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (farm_id, agro_zone_id, kind, day, d["precipitation_sum"][i], (d.get("precipitation_probability_max") or [None] * 99)[i],
                 d["temperature_2m_max"][i], d["temperature_2m_min"][i], SOURCE, fetched))
            n_obs += kind == "observed"
            n_fc += kind == "forecast"
    return {"observedDays": n_obs, "forecastDays": n_fc, "source": SOURCE, "fetchedAt": fetched,
            "timezone": payload.get("timezone"), "elevationM": payload.get("elevation")}


class OpenMeteoAdapter:
    name = "open-meteo"
    description = "Pull analysed + forecast daily rainfall for a farm's coordinates from Open-Meteo (keyless)."

    def run(self, *, farm_id: str, lat: float, lon: float, agro_zone_id: str, past_days: int = 7,
            forecast_days: int = 7, **_: Any) -> dict:
        s = settings()
        if os.environ.get("AGRITWIN_FAIL_WEATHER") == "1":
            fetch(lat, lon)  # raises the simulated outage
        if os.environ.get("AGRITWIN_TODAY"):
            # Today is pinned (evals / reproducible demo): a live forecast would be for the wrong dates.
            return {"ok": True, "skipped": True, "reason": "AGRITWIN_TODAY is pinned; keeping the seeded rainfall cache",
                    "source": "seeded rainfall cache"}
        payload = fetch(lat, lon, past_days, forecast_days)
        out = store(farm_id, agro_zone_id, payload, s.today)
        return {"ok": True, **out}
