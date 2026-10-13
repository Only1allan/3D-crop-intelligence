"""The deterministic rule engine.

It is the ONLY source of numbers in an advisory. The LLM phrases; it never measures. Every
finding carries citations (field -> value -> source -> observedAt) so an officer, or a farmer
asking "why?", can trace each number to the record it came from.

Inputs are plain dicts so the engine is usable from the MCP server, the API, tests and
notebooks without any framework.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

SEVERITY_RANK = {"critical": 3, "warning": 2, "info": 1}
ACTION_PRIORITY = ["check_sensor", "spray", "irrigate", "hold", "plant", "harvest", "scout", "lime",
                   "fertilise", "none"]

SOURCE_LABEL = {
    "agrifusion_assessment": "soil assessment schema (synthetic demo values)",
    "farmwise_snapshot": "crop snapshot schema (synthetic demo values)",
    "synthetic": "model stub (synthetic)",
    "ingested": "ingested reading",
    "unknown": "no reading yet",
}
STAGE_LABEL = {
    "unplanted": "unplanted", "emergence": "emergence", "tuber_initiation": "tuber initiation",
    "tuber_bulking": "tuber bulking", "maturation": "maturation", "harvested": "harvested",
    "vegetative": "vegetative growth", "tasseling": "tasseling", "grain_fill": "grain fill",
}


# ---------------------------------------------------------------- helpers
def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _plot_source(plot: dict, group: str) -> str:
    src = (plot.get("source") or {}).get(group, "unknown")
    return SOURCE_LABEL.get(src, src)


def cite(field: str, value: Any, unit: str, source: str, observed_at: str | None) -> dict:
    return {"field": field, "value": value, "unit": unit, "source": source, "observedAt": observed_at}


class _Cites:
    """Builds citations against one plot so each rule stays one line per number."""

    def __init__(self, plot: dict):
        self.p = plot
        self.obs = plot.get("lastUpdateTime")
        self.pid = plot.get("plotId") or plot.get("zoneId")

    def soil(self, key: str, unit: str) -> dict:
        return cite(f"soil.{key}", self.p["soil"][key], unit,
                    f"plot {self.pid} twin state · farmSensor:{key} · {_plot_source(self.p, 'soil')}", self.obs)

    def atm(self, key: str, unit: str) -> dict:
        return cite(f"atmosphere.{key}", self.p["atmosphere"][key], unit,
                    f"plot {self.pid} twin state · farmSensor:{key} · {_plot_source(self.p, 'soil')}", self.obs)

    def crop(self, key: str, unit: str) -> dict:
        return cite(f"crop.{key}", self.p["crop"][key], unit,
                    f"plot {self.pid} twin state · farmZone:{key} · {_plot_source(self.p, 'crop')}", self.obs)

    def agro(self, key: str, unit: str) -> dict:
        return cite(f"agronomy.{key}", self.p["agronomy"][key], unit,
                    f"plot {self.pid} twin state · cropModel:{key} · {_plot_source(self.p, 'model')}", self.obs)

    def ph(self) -> dict:
        return cite("soilPH", self.p["soilPH"], "pH",
                    f"plot {self.pid} twin state · farmSensor:soilPH · {_plot_source(self.p, 'soil')}", self.obs)

    def threshold(self, name: str, value: Any, profile: dict) -> dict:
        return cite(f"profile.thresholds.{name}", value, "",
                    f"crop profile {profile['crop']}@{profile.get('version', 1)} ({profile.get('_file', 'bundled')})",
                    None)


def _rain_cites(signals: dict | None, today: date) -> dict[str, Any]:
    """Derive last-7-day totals and forecast windows from a signals dict, with citations."""
    out: dict[str, Any] = {"available": False}
    if not signals or not signals.get("days") and not signals.get("forecast"):
        return out
    src = signals.get("source", "rainfall signal")
    fetched = signals.get("fetchedAt")
    days = [d for d in signals.get("days", []) if d.get("mm") is not None]
    fc = [d for d in signals.get("forecast", []) if d.get("mm") is not None]
    last7 = round(sum(d["mm"] for d in days[-7:]), 1)
    f24 = round(fc[0]["mm"], 1) if fc else 0.0
    f3 = round(sum(d["mm"] for d in fc[:3]), 1)
    f7 = round(sum(d["mm"] for d in fc[:7]), 1)
    span = f"{days[0]['date']}..{days[-1]['date']}" if days else "n/a"
    fspan = f"{fc[0]['date']}..{fc[min(6, len(fc) - 1)]['date']}" if fc else "n/a"
    out.update({
        "available": True, "stale": bool(signals.get("stale")),
        "last7Mm": last7, "forecast24Mm": f24, "forecast3Mm": f3, "forecast7Mm": f7,
        "c_last7": cite("rainfall.last7Mm", last7, "mm", f"{src} · daily precipitation {span}", fetched),
        "c_f24": cite("rainfall.forecast24Mm", f24, "mm", f"{src} · forecast {fc[0]['date'] if fc else 'n/a'}", fetched),
        "c_f3": cite("rainfall.forecast3Mm", f3, "mm", f"{src} · forecast {fspan}", fetched),
        "c_f7": cite("rainfall.forecast7Mm", f7, "mm", f"{src} · forecast {fspan}", fetched),
    })
    return out


def _in_window(today: date, start_mmdd: str, end_mmdd: str) -> bool:
    s = date(today.year, int(start_mmdd[:2]), int(start_mmdd[3:]))
    e = date(today.year, int(end_mmdd[:2]), int(end_mmdd[3:]))
    if s <= e:
        return s <= today <= e
    return today >= s or today <= e  # window wraps the new year


# ---------------------------------------------------------------- engine
def evaluate(plot: dict, profile: dict, signals: dict | None, alerts: list[dict], today: date,
             seasons: list[dict] | None = None) -> dict:
    """Return {"primaryAction", "blocked", "findings", "profile", "context"}.

    `plot` is the twin state (v0 zone shape + plotId). `signals` is the zone rainfall dict from
    get_climate_signals (or None). `alerts` are active pest alerts for the zone (any crop).
    """
    T = profile["thresholds"]
    c = _Cites(plot)
    pid = c.pid
    stage = plot["crop"]["growthStage"]
    findings: list[dict] = []
    rain = _rain_cites(signals, today)
    ctx: dict[str, Any] = {"plot": pid, "stage": STAGE_LABEL.get(stage, stage), "variety": plot["agronomy"].get("variety"),
                           "lastUpdateTime": plot.get("lastUpdateTime"), **{k: v for k, v in rain.items() if not k.startswith("c_")}}
    for k in ("moisture_dry_pct", "ph_min"):
        ctx[k] = T[k]

    def add(rule: str, action: str, severity: str, reasoning: str, cites: list[dict], **extra) -> None:
        findings.append({"ruleId": f"{profile['crop']}.{rule}", "action": action, "severity": severity,
                         "reasoning": reasoning, "citations": [x for x in cites if x], **extra})

    # 0. Stale readings block everything: we would rather say nothing than recommend on old numbers.
    last = _parse_dt(plot.get("lastUpdateTime"))
    now = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=9)
    age_h = (now - last).total_seconds() / 3600 if last else None
    if plot.get("status") == "offline" or age_h is None or age_h > profile.get("stale_hours", 48):
        reason = (f"Probe last reported {plot.get('lastUpdateTime')} ({age_h:.0f} h ago), beyond the "
                  f"{profile.get('stale_hours', 48)} h freshness limit" if age_h is not None else "No reading timestamp")
        add("data.stale_readings", "check_sensor", "warning",
            reason + ". No agronomic advisory is drafted on stale readings; check the probe first.",
            [cite("lastUpdateTime", plot.get("lastUpdateTime"), "", f"plot {pid} twin state · farmSensor:lastUpdateTime", None),
             cite("status", plot.get("status"), "", f"plot {pid} twin state · status token", plot.get("lastUpdateTime")),
             c.threshold("stale_hours", profile.get("stale_hours", 48), profile)])
        return _finish(findings, profile, {"reason": "stale_readings", "detail": reason}, ctx)

    # 1. Pest alerts for this zone: applicable ones feed the rules below; others are cited as not applicable.
    applicable: list[dict] = []
    for a in alerts:
        pest_cfg = (profile.get("pests") or {}).get(a.get("pest"), {})
        same_crop = a.get("crop") in (None, "", profile["crop"])
        stage_ok = stage in (a.get("stages") or pest_cfg.get("stages") or [])
        a_cite = cite(f"pestAlert.{a['alertId']}", a.get("severity"), "",
                      f"{a.get('source', 'pest bulletin')} · {a.get('pest')} · issued {a.get('issuedAt')}", a.get("issuedAt"))
        if same_crop and stage_ok:
            applicable.append({**a, "_cite": a_cite, "_action": pest_cfg.get("action") or a.get("recommendedAction") or "scout"})
        else:
            why = "different crop" if not same_crop else f"crop stage '{STAGE_LABEL.get(stage, stage)}' is outside the alert's stages"
            add(f"pest.{a.get('pest')}.not_applicable", "none", "info",
                f"Zone alert {a['alertId']} ({a.get('pest')}, {a.get('severity')}) does not apply to this plot: {why}.",
                [a_cite], alertId=a["alertId"])

    # 2. Planting window (only for unplanted plots).
    if stage == "unplanted":
        seasons = seasons or []
        open_now = [s for s in seasons if _in_window(today, s["plantStart"], s["plantEnd"])]
        win_cite = cite("cropCalendar.plantWindows", [f"{s['name']} {s['plantStart']}..{s['plantEnd']}" for s in seasons], "",
                        f"agroclimatic zone calendar · {plot.get('agroZoneId', 'zone')}", None)
        if not open_now:
            add("planting.outside_window", "hold", "info",
                "Today is outside every planting window in the zone calendar; hold planting.", [win_cite])
        elif not rain["available"]:
            add("planting.no_rainfall_signal", "hold", "warning",
                "Planting window is open but no rainfall signal is available for the zone, so onset cannot be confirmed. "
                "Hold and ingest weather first.", [win_cite])
        elif rain["last7Mm"] >= T["planting_onset_7d_mm"] and rain["forecast7Mm"] >= T["planting_forecast_7d_mm"]:
            add("planting.onset_confirmed", "plant", "warning",
                f"Season onset: {rain['last7Mm']} mm fell in the last 7 days (threshold {T['planting_onset_7d_mm']} mm) and "
                f"{rain['forecast7Mm']} mm is forecast (threshold {T['planting_forecast_7d_mm']} mm); the {open_now[0]['name']} window is open.",
                [rain["c_last7"], rain["c_f7"], win_cite, c.threshold("planting_onset_7d_mm", T["planting_onset_7d_mm"], profile),
                 c.threshold("planting_forecast_7d_mm", T["planting_forecast_7d_mm"], profile)])
        else:
            add("planting.await_onset", "hold", "info",
                f"The {open_now[0]['name']} window is open but onset is not confirmed: {rain['last7Mm']} mm in the last 7 days "
                f"(needs {T['planting_onset_7d_mm']}) and {rain['forecast7Mm']} mm forecast (needs {T['planting_forecast_7d_mm']}). Hold.",
                [rain["c_last7"], rain["c_f7"], win_cite, c.threshold("planting_onset_7d_mm", T["planting_onset_7d_mm"], profile)])
        return _finish(findings, profile, None, ctx)

    if stage == "harvested":
        add("season.harvested", "none", "info", "Plot is harvested; nothing to advise until the next season.", [c.crop("growthStage", "")])
        return _finish(findings, profile, None, ctx)

    atm, soil, crop, agro = plot["atmosphere"], plot["soil"], plot["crop"], plot["agronomy"]

    # 3. Late-blight / wet-weather fungal pressure -> spray, or hold the spray if rain would wash it off.
    lo, hi = T["blight_temp_c"]
    weather_cond = (atm["relativeHumidity"] >= T["blight_humidity_pct"] and lo <= atm["ambientTemperature"] <= hi
                    and (atm["precipitation"] >= T["blight_rain_24h_mm"] or (rain["available"] and rain["last7Mm"] >= T["blight_rain_7d_mm"])))
    model_cond = agro.get("simcastBlightRisk") in ("high", "severe")
    blight_alerts = [a for a in applicable if a["_action"] == "spray"]
    if weather_cond or model_cond:
        cites = [c.atm("relativeHumidity", "%"), c.atm("ambientTemperature", "°C"), c.atm("precipitation", "mm/24h"),
                 c.agro("simcastBlightRisk", ""), c.threshold("blight_humidity_pct", T["blight_humidity_pct"], profile)]
        cites += [a["_cite"] for a in blight_alerts]
        if rain["available"]:
            cites.append(rain["c_last7"])
        why = []
        if weather_cond:
            why.append(f"humidity {atm['relativeHumidity']}% (≥{T['blight_humidity_pct']}%) at {atm['ambientTemperature']} °C with "
                       f"{atm['precipitation']} mm rain in 24 h")
        if model_cond:
            why.append(f"blight model risk '{agro['simcastBlightRisk']}'")
        if blight_alerts:
            why.append("zone alert " + ", ".join(a["alertId"] for a in blight_alerts))
        if rain["available"] and rain["forecast24Mm"] >= T["rain_blocks_spray_24h_mm"]:
            add("blight.hold_spray_for_rain", "hold", "warning",
                "Late-blight pressure (" + "; ".join(why) + f") but {rain['forecast24Mm']} mm is forecast in the next 24 h "
                f"(≥{T['rain_blocks_spray_24h_mm']} mm washes a protectant off). Hold the spray for the first dry morning; scout daily.",
                cites + [rain["c_f24"], c.threshold("rain_blocks_spray_24h_mm", T["rain_blocks_spray_24h_mm"], profile)])
        else:
            add("blight.spray_window", "spray", "critical",
                "Late-blight pressure: " + "; ".join(why) + ". Apply a protectant fungicide within 24 h and scout lower leaves for dark, "
                "water-soaked lesions." + (f" Forecast rain in 24 h is {rain['forecast24Mm']} mm, so a spray will hold." if rain["available"] else ""),
                cites + ([rain["c_f24"]] if rain["available"] else []))
    elif blight_alerts:
        # A zone alert alone does not justify a spray on a plot that is not in blight weather: scout instead.
        add("blight.zone_alert_scout", "scout", "warning",
            "Zone late-blight alert " + ", ".join(a["alertId"] for a in blight_alerts) + " is active for this crop stage, but this plot is "
            f"not in blight weather (humidity {atm['relativeHumidity']}%, {atm['precipitation']} mm rain in 24 h). Scout lower leaves "
            "twice this week; spray only if lesions appear or humidity stays above "
            f"{T['blight_humidity_pct']}%.",
            [a["_cite"] for a in blight_alerts] + [c.atm("relativeHumidity", "%"), c.atm("precipitation", "mm/24h"), c.crop("growthStage", ""),
                                                  c.threshold("blight_humidity_pct", T["blight_humidity_pct"], profile)],
            alertIds=[a["alertId"] for a in blight_alerts])
    elif agro.get("simcastBlightRisk") == "moderate":
        add("blight.watch", "scout", "warning", f"Blight model risk is 'moderate' with humidity {atm['relativeHumidity']}%; scout after wet spells.",
            [c.agro("simcastBlightRisk", ""), c.atm("relativeHumidity", "%")])

    # Other applicable pest alerts (scout-type).
    for a in applicable:
        if a["_action"] != "spray":
            add(f"pest.{a['pest']}.alert", a["_action"], "warning" if a.get("severity") in ("high", "severe") else "info",
                f"Zone alert {a['alertId']}: {a.get('summary') or a.get('pest')} — applies at this crop stage; {a['_action']} this week.",
                [a["_cite"], c.crop("growthStage", "")], alertId=a["alertId"])

    # 4. Moisture: dry -> irrigate (or hold if rain is coming); waterlogged -> hold.
    m = soil["soilMoisture"]
    sensitive = stage in profile.get("drought_sensitive_stages", [])
    if m < T["moisture_dry_pct"]:
        cites = [c.soil("soilMoisture", "% VWC"), c.crop("growthStage", ""), c.threshold("moisture_dry_pct", T["moisture_dry_pct"], profile)]
        series = (plot.get("series") or {}).get("soilMoisture")
        if series:
            cites.append(cite("series.soilMoisture", series, "% VWC (7-day)", f"plot {pid} twin state · 7-day series", plot.get("lastUpdateTime")))
        if rain["available"] and rain["forecast3Mm"] >= T["rain_covers_irrigation_3d_mm"]:
            add("irrigation.hold_for_forecast_rain", "hold", "warning",
                f"Soil moisture {m}% VWC is below the {T['moisture_dry_pct']}% floor during {STAGE_LABEL.get(stage, stage)}, but "
                f"{rain['forecast3Mm']} mm is forecast in the next 3 days (≥{T['rain_covers_irrigation_3d_mm']} mm). Hold irrigation; re-check after the rain.",
                cites + [rain["c_f3"], c.threshold("rain_covers_irrigation_3d_mm", T["rain_covers_irrigation_3d_mm"], profile)])
        else:
            trend = f" It fell from {series[0]}% to {series[-1]}% over 7 days." if series and len(series) > 1 else ""
            fc_note = f" Forecast rain in the next 3 days is only {rain['forecast3Mm']} mm." if rain["available"] else " No rainfall signal is available."
            add("irrigation.dry_at_sensitive_stage" if sensitive else "irrigation.dry", "irrigate",
                "warning" if sensitive else "info",
                f"Soil moisture {m}% VWC is below the {T['moisture_dry_pct']}% floor" + (f" during {STAGE_LABEL.get(stage, stage)}, when drought cuts yield most." if sensitive else ".")
                + trend + fc_note + " Irrigate within a day.",
                cites + ([rain["c_f3"]] if rain["available"] else []))
    elif m > T["moisture_waterlogged_pct"]:
        add("irrigation.waterlogged", "hold", "warning",
            f"Soil moisture {m}% VWC is above the {T['moisture_waterlogged_pct']}% waterlogging line; do not irrigate, open drains, scout for rot.",
            [c.soil("soilMoisture", "% VWC"), c.threshold("moisture_waterlogged_pct", T["moisture_waterlogged_pct"], profile)])

    # 5. Canopy.
    if crop["ndvi"] < T["ndvi_weak"] and stage not in ("emergence", "maturation"):
        add("canopy.weak", "scout", "warning",
            f"NDVI {crop['ndvi']} is below {T['ndvi_weak']} during {STAGE_LABEL.get(stage, stage)}; check water, nutrients and disease on the ground.",
            [c.crop("ndvi", ""), c.crop("growthStage", ""), c.threshold("ndvi_weak", T["ndvi_weak"], profile)])

    # 6. Harvest timing.
    if stage == "maturation":
        add("harvest.plan", "harvest", "warning" if crop["daysAfterPlanting"] >= profile.get("maturity_days", 100) else "info",
            f"Plot is at maturation, {crop['daysAfterPlanting']} days after planting ({crop['accumulatedGDD']} GDD). Plan harvest in about "
            "2 weeks once vines die back and skins set.", [c.crop("growthStage", ""), c.crop("daysAfterPlanting", "days"), c.crop("accumulatedGDD", "GDD")])

    # 7. Soil chemistry (between-season actions, lower priority).
    if plot["soilPH"] < T["ph_min"]:
        al = soil.get("aluminiumLevel")
        add("soil.acidic", "lime", "warning" if (al or 0) > T["aluminium_toxic_cmol"] else "info",
            f"Soil pH {plot['soilPH']} is below {T['ph_min']}" + (f" and aluminium {al} cmol/kg is above the {T['aluminium_toxic_cmol']} toxicity line" if (al or 0) > T["aluminium_toxic_cmol"] else "")
            + ". Lime between seasons (1–2 t/ha after a lab test).",
            [c.ph(), c.soil("aluminiumLevel", "cmol/kg"), c.threshold("ph_min", T["ph_min"], profile)])
    low = []
    if soil["nitrogenLevel"] < T["nitrogen_low_pct"]:
        low.append(("nitrogenLevel", "%", f"N {soil['nitrogenLevel']}% < {T['nitrogen_low_pct']}%"))
    if soil["phosphorusLevel"] < T["phosphorus_low_ppm"]:
        low.append(("phosphorusLevel", "ppm", f"P {soil['phosphorusLevel']} ppm < {T['phosphorus_low_ppm']} ppm"))
    if soil["potassiumLevel"] < T["potassium_low_cmol"]:
        low.append(("potassiumLevel", "cmol/kg", f"K {soil['potassiumLevel']} < {T['potassium_low_cmol']} cmol/kg"))
    if low:
        add("soil.nutrients_low", "fertilise", "info", "Nutrients below profile floors: " + "; ".join(x[2] for x in low) + ".",
            [c.soil(k, u) for k, u, _ in low])
        ctx["nutrients"] = ", ".join(x[2] for x in low)

    in_range_cites = [c.soil("soilMoisture", "% VWC"), c.ph(), c.crop("ndvi", ""), c.atm("relativeHumidity", "%"), c.crop("growthStage", "")]
    return _finish(findings, profile, None, ctx, in_range_cites)


def _finish(findings: list[dict], profile: dict, blocked: dict | None, ctx: dict, in_range_cites: list[dict] | None = None) -> dict:
    actionable = [f for f in findings if f["action"] != "none"]
    if actionable:
        primary = sorted(actionable, key=lambda f: (-SEVERITY_RANK.get(f["severity"], 0), ACTION_PRIORITY.index(f["action"])))[0]
        action = primary["action"]
    else:
        action = "none"
        cites = in_range_cites or []
        vals = ", ".join(f"{x['field'].split('.')[-1]} {x['value']}{(' ' + x['unit']) if x['unit'] else ''}" for x in cites)
        findings.append({"ruleId": f"{profile['crop']}.in_range", "action": "none", "severity": "info",
                         "reasoning": "All monitored values are inside the profile ranges this week" + (f" ({vals})." if vals else "."),
                         "citations": cites})
        primary = findings[-1]
    ctx["reason"] = primary["reasoning"]
    return {"primaryAction": action, "primaryRuleId": primary["ruleId"], "blocked": blocked, "findings": findings,
            "profile": f"{profile['crop']}@{profile.get('version', 1)}", "context": ctx}


# ---------------------------------------------------------------- draft guard
_NUM = re.compile(r"(?<![A-Za-z0-9-])(\d+(?:[.,]\d+)?)")


def numbers_in(text: str) -> set[str]:
    return {m.replace(",", ".") for m in _NUM.findall(text or "")}


def _num_variants(v: Any) -> set[str]:
    out: set[str] = set()
    if isinstance(v, bool):
        return out
    if isinstance(v, (int, float)):
        out.add(str(v))
        out.add(f"{v:.0f}")
        out.add(f"{v:.1f}")
        out.add(f"{v:.2f}")
        if isinstance(v, float) and v.is_integer():
            out.add(str(int(v)))
    elif isinstance(v, str):
        out |= numbers_in(v)
    elif isinstance(v, (list, tuple)):
        for x in v:
            out |= _num_variants(x)
    return out


def validate_draft(message: str, citations: list[dict], findings: list[dict], profile: dict | None = None) -> list[str]:
    """Return the list of numbers in `message` that are not backed by a citation, a finding's reasoning
    or a profile threshold. Empty list = the draft is fully sourced. Small counting words (1, 2, 3, 7, 24, 48)
    used for durations are tolerated."""
    allowed: set[str] = {"1", "2", "3", "7", "10", "14", "24", "48"}
    for cit in citations:
        allowed |= _num_variants(cit.get("value"))
    for f in findings:
        allowed |= numbers_in(f.get("reasoning", ""))
    if profile:
        allowed |= _num_variants(list((profile.get("thresholds") or {}).values()))
        allowed |= _num_variants(profile.get("maturity_days"))
    return sorted(n for n in numbers_in(message) if n not in allowed and n.rstrip("0").rstrip(".") not in allowed)
