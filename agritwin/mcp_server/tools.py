"""Tool implementations. Every public function here is wrapped with @logged_tool, so each call —
from the agent over MCP, from the officer console over REST, or from a test — lands in the audit log
with its inputs, outputs, timestamp, duration and actor.

Conventions:
  * read tools never write (annotated readOnlyHint in server.py);
  * act tools write rows an officer can see (draft, flag, follow-up, ingest) but reach no one outside;
  * `record_officer_decision` is the one gate: it needs a named officer from the office roster and is
    the only function that can mark anything as (simulated-)dispatched.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from .. import db
from ..audit import logged_tool, now_iso, rows as audit_rows
from ..config import settings
from ..ingest import get_adapter
from ..rules import evaluate, get_profile, list_profiles, validate_draft
from ..rules.templates import SMS_LIMIT

ACTIONS = {"plant", "spray", "irrigate", "hold", "harvest", "lime", "fertilise", "scout", "check_sensor", "none"}
CONTACT_METHODS = {"sms", "ussd", "visit"}


# ---------------------------------------------------------------- payload builders
def _farm_payload(f: dict) -> dict:
    counts = db.one("SELECT COUNT(*) AS n FROM plots WHERE farm_id=?", (f["farm_id"],)) or {"n": 0}
    pending = db.one("SELECT COUNT(*) AS n FROM advisories WHERE farm_id=? AND status='draft'", (f["farm_id"],)) or {"n": 0}
    return {"farmId": f["farm_id"], "name": f["name"], "region": f["region"], "crop": f["crop"], "agroZoneId": f["agro_zone_id"],
            "lat": f["lat"], "lon": f["lon"], "elevationM": f["elevation_m"], "totalHa": f["total_ha"], "today": f["today"],
            "officeId": f["office_id"], "notes": f["notes"], "plotCount": counts["n"], "pendingAdvisories": pending["n"],
            "createdAt": f["created_at"]}


def _plot_payload(p: dict) -> dict:
    state = db.uj(p["state_json"], {})
    latest = db.one("SELECT advisory_id, status FROM advisories WHERE plot_id=? ORDER BY created_at DESC, advisory_id DESC LIMIT 1",
                    (p["plot_id"],))
    pending = db.one("SELECT advisory_id FROM advisories WHERE plot_id=? AND status='draft' ORDER BY created_at DESC LIMIT 1",
                     (p["plot_id"],))
    flags = db.q("SELECT * FROM flags WHERE plot_id=? AND resolved=0 ORDER BY created_at DESC", (p["plot_id"],))
    return {
        **state,
        "plotId": p["plot_id"], "zoneId": state.get("zoneId", p["plot_id"]), "farmId": p["farm_id"],
        "displayName": p["display_name"], "grid": db.uj(p["grid_json"], [0, 0]),
        "householdId": p["household_id"], "householdName": p["household_name"], "contactMethod": p["contact_method"],
        "lastVisit": db.uj(p["last_visit_json"]), "agroZoneId": p["agro_zone_id"],
        "pendingAdvisoryId": pending["advisory_id"] if pending else None,
        "latestAdvisoryStatus": latest["status"] if latest else None,
        "flags": [{"flagId": x["flag_id"], "reason": x["reason"], "severity": x["severity"], "createdBy": x["created_by"],
                   "createdAt": x["created_at"]} for x in flags],
    }


def _advisory_payload(a: dict) -> dict:
    plot = db.one("SELECT household_name, contact_method, display_name FROM plots WHERE plot_id=?", (a["plot_id"],)) or {}
    return {"advisoryId": a["advisory_id"], "plotId": a["plot_id"], "farmId": a["farm_id"], "householdId": a["household_id"],
            "householdName": plot.get("household_name"), "plotName": plot.get("display_name"), "contactMethod": plot.get("contact_method"),
            "action": a["action"], "message": a["message"], "reasoning": a["reasoning"],
            "citations": db.uj(a["citations_json"], []), "findings": db.uj(a["findings_json"], []),
            "status": a["status"], "createdAt": a["created_at"], "runId": a["run_id"],
            "drafter": db.uj(a["drafter_json"]), "decision": db.uj(a["decision_json"])}


def _plot_row(plot_id: str) -> dict:
    p = db.one("SELECT * FROM plots WHERE plot_id=?", (plot_id,))
    if not p:
        raise KeyError(f"unknown plot '{plot_id}'")
    return p


def _farm_row(farm_id: str) -> dict:
    f = db.one("SELECT * FROM farms WHERE farm_id=?", (farm_id,))
    if not f:
        raise KeyError(f"unknown farm '{farm_id}'")
    return f


def _seasons(agro_zone_id: str, crop: str) -> list[dict]:
    z = db.one("SELECT seasons_json FROM agro_zones WHERE agro_zone_id=?", (agro_zone_id,))
    return (db.uj(z["seasons_json"], {}) if z else {}).get(crop, [])


def _signals_for_farm(farm_id: str, days: int = 7) -> dict | None:
    today = settings().today
    start = (today - timedelta(days=days)).isoformat()
    obs = db.q("SELECT * FROM rainfall_signals WHERE farm_id=? AND kind='observed' AND date>=? AND date<? ORDER BY date",
               (farm_id, start, today.isoformat()))
    fc = db.q("SELECT * FROM rainfall_signals WHERE farm_id=? AND kind='forecast' AND date>=? ORDER BY date LIMIT 7",
              (farm_id, today.isoformat()))
    if not obs and not fc:
        return None
    fetched = max((r["fetched_at"] for r in obs + fc), default=None)
    stale = False
    if fetched:
        age = datetime.now(datetime.fromisoformat(fetched.replace("Z", "+00:00")).tzinfo) - datetime.fromisoformat(fetched.replace("Z", "+00:00"))
        stale = age > timedelta(hours=72)
    return {"last7Mm": round(sum(r["mm"] or 0 for r in obs), 1),
            "days": [{"date": r["date"], "mm": r["mm"], "tmax": r["tmax"], "tmin": r["tmin"]} for r in obs],
            "forecast": [{"date": r["date"], "mm": r["mm"], "probability": r["probability"], "tmax": r["tmax"], "tmin": r["tmin"]} for r in fc],
            "source": (obs + fc)[0]["source"], "fetchedAt": fetched, "stale": stale, "today": today.isoformat()}


def _active_alerts(agro_zone_id: str, crop: str | None = None, include_expired: bool = False) -> list[dict]:
    today = settings().today.isoformat()
    sql = "SELECT * FROM pest_alerts WHERE agro_zone_id=?"
    params: list[Any] = [agro_zone_id]
    if not include_expired:
        sql += " AND substr(issued_at,1,10)<=? AND substr(expires_at,1,10)>=?"
        params += [today, today]
    if crop:
        sql += " AND (crop IS NULL OR crop='' OR crop=?)"
        params.append(crop)
    sql += " ORDER BY issued_at DESC"
    return [{"alertId": a["alert_id"], "agroZoneId": a["agro_zone_id"], "pest": a["pest"], "crop": a["crop"], "severity": a["severity"],
             "issuedAt": a["issued_at"], "expiresAt": a["expires_at"], "stages": db.uj(a["stages_json"], []), "summary": a["summary"],
             "source": a["source"], "recommendedAction": a["recommended_action"]} for a in db.q(sql, tuple(params))]


# ---------------------------------------------------------------- read tools
@logged_tool
def list_farms() -> dict:
    return {"farms": [_farm_payload(f) for f in db.q("SELECT * FROM farms ORDER BY created_at, farm_id")]}


@logged_tool
def get_office() -> dict:
    o = db.one("SELECT * FROM offices LIMIT 1")
    if not o:
        return {"officeId": None, "name": None, "officers": []}
    return {"officeId": o["office_id"], "name": o["name"], "country": o["country"], "officers": db.uj(o["officers_json"], [])}


@logged_tool
def get_farm_twin(farm_id: str) -> dict:
    f = _farm_row(farm_id)
    plots = [_plot_payload(p) for p in db.q("SELECT * FROM plots WHERE farm_id=? ORDER BY plot_id", (farm_id,))]
    return {**_farm_payload(f), "plots": plots}


@logged_tool
def get_plot(plot_id: str, run_id: str | None = None) -> dict:
    p = _plot_row(plot_id)
    out = _plot_payload(p)
    out["followups"] = [{"followupId": x["followup_id"], "date": x["date"], "note": x["note"], "createdBy": x["created_by"],
                         "createdAt": x["created_at"]} for x in db.q("SELECT * FROM followups WHERE plot_id=? ORDER BY date", (plot_id,))]
    return out


@logged_tool
def get_climate_signals(plot_id: str | None = None, farm_id: str | None = None, days: int = 7, run_id: str | None = None) -> dict:
    if not farm_id:
        if not plot_id:
            raise ValueError("give plot_id or farm_id")
        farm_id = _plot_row(plot_id)["farm_id"]
    f = _farm_row(farm_id)
    sig = _signals_for_farm(farm_id, days)
    if sig is None:
        return {"available": False, "farmId": farm_id, "agroZoneId": f["agro_zone_id"],
                "reason": "no rainfall signal stored for this farm; run ingest_weather first"}
    return {"available": True, "farmId": farm_id, "agroZoneId": f["agro_zone_id"], "lat": f["lat"], "lon": f["lon"], "rainfall": sig}


@logged_tool
def get_pest_alerts(agro_zone_id: str | None = None, plot_id: str | None = None, crop: str | None = None,
                    include_expired: bool = False, run_id: str | None = None) -> dict:
    if not agro_zone_id:
        if not plot_id:
            raise ValueError("give agro_zone_id or plot_id")
        agro_zone_id = _plot_row(plot_id)["agro_zone_id"]
    return {"agroZoneId": agro_zone_id, "today": settings().today.isoformat(),
            "alerts": _active_alerts(agro_zone_id, crop, include_expired)}


def _rules_for(plot_id: str) -> tuple[dict, dict, dict]:
    p = _plot_row(plot_id)
    f = _farm_row(p["farm_id"])
    plot = _plot_payload(p)
    profile = get_profile(f["crop"])
    signals = _signals_for_farm(f["farm_id"])
    alerts = _active_alerts(p["agro_zone_id"])
    result = evaluate(plot, profile, signals, alerts, settings().today, _seasons(p["agro_zone_id"], f["crop"]))
    result["plotId"] = plot_id
    result["signalsAvailable"] = signals is not None
    result["alertsConsidered"] = [a["alertId"] for a in alerts]
    return result, plot, profile


@logged_tool
def check_advisory_rules(plot_id: str, run_id: str | None = None) -> dict:
    result, _, _ = _rules_for(plot_id)
    return result


@logged_tool
def list_advisories(farm_id: str | None = None, status: str | None = None, plot_id: str | None = None, limit: int = 50) -> dict:
    where, params = [], []
    if farm_id:
        where.append("farm_id=?"); params.append(farm_id)
    if status:
        where.append("status=?"); params.append(status)
    if plot_id:
        where.append("plot_id=?"); params.append(plot_id)
    sql = "SELECT * FROM advisories" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY created_at DESC, advisory_id DESC LIMIT ?"
    params.append(limit)
    return {"advisories": [_advisory_payload(a) for a in db.q(sql, tuple(params))]}


@logged_tool
def get_advisory(advisory_id: str) -> dict:
    a = db.one("SELECT * FROM advisories WHERE advisory_id=?", (advisory_id,))
    if not a:
        raise KeyError(f"unknown advisory '{advisory_id}'")
    return _advisory_payload(a)


@logged_tool
def get_audit_log(plot_id: str | None = None, advisory_id: str | None = None, run_id: str | None = None, limit: int = 50) -> dict:
    return {"entries": audit_rows(plot_id, advisory_id, run_id, limit)}


@logged_tool
def list_crop_profiles() -> dict:
    return {"profiles": list_profiles()}


@logged_tool
def get_crop_profile(crop: str) -> dict:
    p = dict(get_profile(crop))
    p.pop("_file", None)
    return p


@logged_tool
def list_followups(farm_id: str | None = None) -> dict:
    sql, params = "SELECT f.*, p.household_name, p.display_name FROM followups f JOIN plots p ON p.plot_id=f.plot_id", ()
    if farm_id:
        sql, params = sql + " WHERE f.farm_id=?", (farm_id,)
    return {"followups": [{"followupId": x["followup_id"], "plotId": x["plot_id"], "farmId": x["farm_id"], "householdName": x["household_name"],
                           "plotName": x["display_name"], "date": x["date"], "note": x["note"], "createdBy": x["created_by"],
                           "createdAt": x["created_at"]} for x in db.q(sql + " ORDER BY f.date", params)]}


@logged_tool
def list_flags(farm_id: str | None = None, include_resolved: bool = False) -> dict:
    sql, params = "SELECT f.*, p.household_name, p.display_name FROM flags f JOIN plots p ON p.plot_id=f.plot_id WHERE 1=1", []
    if farm_id:
        sql += " AND f.farm_id=?"; params.append(farm_id)
    if not include_resolved:
        sql += " AND f.resolved=0"
    return {"flags": [{"flagId": x["flag_id"], "plotId": x["plot_id"], "farmId": x["farm_id"], "householdName": x["household_name"],
                       "plotName": x["display_name"], "reason": x["reason"], "severity": x["severity"], "createdBy": x["created_by"],
                       "createdAt": x["created_at"], "resolved": bool(x["resolved"])} for x in db.q(sql + " ORDER BY f.created_at DESC", tuple(params))]}


# ---------------------------------------------------------------- act tools (write, but reach no one)
def _default_state(crop: str, variety: str | None, planting_date: str | None, area_ha: float | None) -> dict:
    stages = get_profile(crop)["stages"]
    return {"status": "unknown", "source": {"soil": "unknown", "crop": "unknown", "model": "unknown"},
            "lastUpdateTime": None,
            "atmosphere": {"ambientTemperature": None, "relativeHumidity": None, "precipitation": None},
            "soil": {"soilMoisture": None, "soilTemperature": None, "soilEC": None, "soilOrganicCarbon": None, "nitrogenLevel": None,
                     "phosphorusLevel": None, "potassiumLevel": None, "aluminiumLevel": None, "soilTextureClass": None},
            "soilPH": None,
            "crop": {"ndvi": None, "evi": None, "cloudCover": None, "growthStage": stages[0] if not planting_date else stages[1],
                     "daysAfterPlanting": None, "accumulatedGDD": None},
            "agronomy": {"variety": variety, "plantingDate": planting_date, "areaHa": area_ha, "substorTuberFreshYield": None,
                         "substorLeafAreaIndex": None, "simcastBlightRisk": "none", "simcastSprayRecommended": False},
            "series": {}, "insight": "No readings ingested yet."}


@logged_tool
def register_farm(name: str, region: str, crop: str, lat: float, lon: float, agro_zone_id: str | None = None,
                  plots: list[dict] | None = None, office_id: str | None = None, notes: str = "", run_id: str | None = None) -> dict:
    get_profile(crop)  # raises for unknown crops
    if not agro_zone_id:
        z = db.one("SELECT agro_zone_id FROM agro_zones ORDER BY ((lat-?)*(lat-?)+(lon-?)*(lon-?)) LIMIT 1", (lat, lat, lon, lon))
        agro_zone_id = z["agro_zone_id"] if z else "UNZONED"
    if not office_id:
        o = db.one("SELECT office_id FROM offices LIMIT 1")
        office_id = o["office_id"] if o else None
    farm_id = db.next_id("F", "farm", 3)
    now = now_iso()
    total = sum(float(p.get("areaHa") or 0) for p in (plots or []))
    with db.tx() as conn:
        conn.execute("INSERT INTO farms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (farm_id, name, region, crop, agro_zone_id, lat, lon, None, total or None, settings().today.isoformat(),
                      office_id, notes, now))
        for i, p in enumerate(plots or []):
            pid = p.get("plotId") or f"{farm_id}-P{i + 1}"
            hid = p.get("householdId") or db.next_id("H", "household", 3)
            contact = p.get("contactMethod", "sms")
            if contact not in CONTACT_METHODS:
                raise ValueError(f"contactMethod must be one of {sorted(CONTACT_METHODS)}")
            state = _default_state(crop, p.get("variety"), p.get("plantingDate"), p.get("areaHa"))
            state["zoneId"] = pid
            conn.execute("INSERT INTO plots VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                         (pid, farm_id, p.get("displayName") or pid, db.j(p.get("grid") or [i % 3, i // 3]), hid,
                          p.get("householdName") or "Household " + hid, contact, agro_zone_id, db.j(p.get("lastVisit")), db.j(state), now))
    return get_farm_twin.__wrapped_tool__(farm_id)  # type: ignore[attr-defined]


@logged_tool
def ingest_plot_readings(farm_id: str, readings: list[dict], source: str = "ingested", run_id: str | None = None) -> dict:
    """Merge new twin values into plots. Each reading: {"plotId", + any of status, lastUpdateTime, atmosphere{},
    soil{}, soilPH, crop{}, agronomy{}, series{}, insight}. Missing keys keep their previous values."""
    _farm_row(farm_id)
    updated = []
    with db.tx() as conn:
        for r in readings:
            pid = r.get("plotId")
            p = conn.execute("SELECT * FROM plots WHERE plot_id=? AND farm_id=?", (pid, farm_id)).fetchone()
            if not p:
                raise KeyError(f"plot '{pid}' is not on farm '{farm_id}'")
            state = db.uj(p["state_json"], {})
            for grp in ("atmosphere", "soil", "crop", "agronomy", "series"):
                if isinstance(r.get(grp), dict):
                    state[grp] = {**(state.get(grp) or {}), **r[grp]}
            for k in ("status", "soilPH", "insight"):
                if k in r:
                    state[k] = r[k]
            state["lastUpdateTime"] = r.get("lastUpdateTime") or now_iso()
            state["source"] = {**(state.get("source") or {}), **{k: source for k in ("soil", "crop", "model")}, **(r.get("source") or {})}
            if state.get("status") in (None, "unknown"):
                state["status"] = "nominal"
            conn.execute("UPDATE plots SET state_json=?, updated_at=? WHERE plot_id=?", (db.j(state), now_iso(), pid))
            updated.append(pid)
    return {"farmId": farm_id, "updatedPlots": updated, "source": source}


@logged_tool
def ingest_weather(farm_id: str, past_days: int = 7, forecast_days: int = 7, run_id: str | None = None) -> dict:
    f = _farm_row(farm_id)
    if not settings().live_weather:
        return {"ok": True, "skipped": True, "farmId": farm_id, "reason": "AGRITWIN_LIVE_WEATHER=0; using the seeded rainfall cache"}
    out = get_adapter("open-meteo").run(farm_id=farm_id, lat=f["lat"], lon=f["lon"], agro_zone_id=f["agro_zone_id"],
                                        past_days=past_days, forecast_days=forecast_days)
    return {"farmId": farm_id, **out}


@logged_tool
def draft_advisory(plot_id: str, action: str, message: str, reasoning: str, citations: list[dict],
                   findings: list[dict] | None = None, drafter: dict | None = None, run_id: str | None = None) -> dict:
    """Create a DRAFT advisory. Refuses drafts that are unsourced, over SMS length, or that contradict the rule
    engine's block on stale data. Nothing is sent: an officer must call record_officer_decision."""
    if action not in ACTIONS:
        raise ValueError(f"action must be one of {sorted(ACTIONS)}")
    if not citations:
        raise ValueError("an advisory without citations is not allowed (every number must trace to a record)")
    if len(message) > SMS_LIMIT:
        raise ValueError(f"message is {len(message)} chars; limit is {SMS_LIMIT} (one SMS-friendly advisory)")
    p = _plot_row(plot_id)
    rules, _, profile = _rules_for(plot_id)
    if rules.get("blocked") and action != "check_sensor":
        raise ValueError(f"rule engine blocked agronomic advice for {plot_id}: {rules['blocked']['detail']}. Only 'check_sensor' is allowed.")
    unsourced = validate_draft(message, citations, findings or rules["findings"], profile)
    if unsourced:
        raise ValueError(f"unsourced numbers in message: {unsourced}. Every figure must come from a citation or a cited rule.")
    advisory_id = db.next_id("ADV", "advisory")
    now = now_iso()
    with db.tx() as conn:
        conn.execute("INSERT INTO advisories VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (advisory_id, plot_id, p["farm_id"], p["household_id"], action, message, reasoning, db.j(citations),
                      db.j(findings or rules["findings"]), "draft", now, run_id, db.j(drafter or {"kind": "unknown"}), None))
    return get_advisory.__wrapped_tool__(advisory_id)  # type: ignore[attr-defined]


@logged_tool
def schedule_follow_up(plot_id: str, date: str, note: str, created_by: str = "agent", run_id: str | None = None) -> dict:
    p = _plot_row(plot_id)
    datetime.fromisoformat(date)  # validate
    fid = db.next_id("FU", "followup")
    now = now_iso()
    with db.tx() as conn:
        conn.execute("INSERT INTO followups VALUES (?,?,?,?,?,?,?)", (fid, plot_id, p["farm_id"], date, note, created_by, now))
    return {"followupId": fid, "plotId": plot_id, "farmId": p["farm_id"], "date": date, "note": note, "createdBy": created_by, "createdAt": now}


@logged_tool
def flag_plot(plot_id: str, reason: str, severity: str = "warning", created_by: str = "agent", run_id: str | None = None) -> dict:
    if severity not in ("info", "warning", "critical"):
        raise ValueError("severity must be info|warning|critical")
    p = _plot_row(plot_id)
    fid = db.next_id("FLG", "flag")
    now = now_iso()
    with db.tx() as conn:
        conn.execute("INSERT INTO flags VALUES (?,?,?,?,?,?,?,0)", (fid, plot_id, p["farm_id"], reason, severity, created_by, now))
    return {"flagId": fid, "plotId": plot_id, "farmId": p["farm_id"], "reason": reason, "severity": severity, "createdBy": created_by, "createdAt": now}


# ---------------------------------------------------------------- the gate
@logged_tool
def record_officer_decision(advisory_id: str, officer_name: str, decision: str, reason: str | None = None,
                            run_id: str | None = None) -> dict:
    """Approve or reject a draft. Requires a named officer from the office roster. Approve = the advisory is
    marked approved and a SIMULATED dispatch (SMS/USSD/visit per the household's contact method) is logged;
    no real message is sent by this software. Reject requires a reason and sends nothing."""
    if decision not in ("approve", "reject"):
        raise ValueError("decision must be 'approve' or 'reject'")
    roster = {o["name"] for o in get_office.__wrapped_tool__()["officers"]}  # type: ignore[attr-defined]
    if not officer_name or officer_name not in roster:
        raise PermissionError(f"'{officer_name}' is not a registered officer of this office; roster: {sorted(roster)}")
    if decision == "reject" and not (reason or "").strip():
        raise ValueError("a rejection needs a reason (it is logged for the audit trail)")
    a = db.one("SELECT * FROM advisories WHERE advisory_id=?", (advisory_id,))
    if not a:
        raise KeyError(f"unknown advisory '{advisory_id}'")
    if a["status"] != "draft":
        raise ValueError(f"advisory {advisory_id} is already {a['status']}")
    plot = _plot_row(a["plot_id"])
    now = now_iso()
    dispatch = None
    if decision == "approve":
        dispatch = {"simulated": True, "channel": plot["contact_method"], "to": a["household_id"], "sentAt": now,
                    "text": a["message"], "note": "Simulated dispatch: this software never sends messages to farmers."}
    dec = {"officerName": officer_name, "decision": decision, "reason": reason, "decidedAt": now, "dispatch": dispatch}
    with db.tx() as conn:
        conn.execute("UPDATE advisories SET status=?, decision_json=? WHERE advisory_id=?",
                     ("approved" if decision == "approve" else "rejected", db.j(dec), advisory_id))
    return get_advisory.__wrapped_tool__(advisory_id)  # type: ignore[attr-defined]


READ_TOOLS = [list_farms, get_office, get_farm_twin, get_plot, get_climate_signals, get_pest_alerts, check_advisory_rules,
              list_advisories, get_advisory, get_audit_log, list_crop_profiles, get_crop_profile, list_followups, list_flags]
ACT_TOOLS = [register_farm, ingest_plot_readings, ingest_weather, draft_advisory, schedule_follow_up, flag_plot]
GATE_TOOLS = [record_officer_decision]
