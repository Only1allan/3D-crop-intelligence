"""Deterministic drafter: turns a rule-engine result into an SMS-length message without any LLM.

Used (a) as the fallback when no model is reachable, (b) as the baseline the LLM draft is compared
against in EVALS.md, and (c) as the seed text the LLM is asked to improve on, so even a weak model
cannot drift away from the cited numbers."""
from __future__ import annotations

from typing import Any

RULE_TO_TEMPLATE = {
    "blight.spray_window": "spray",
    "blight.hold_spray_for_rain": "hold_spray",
    "irrigation.hold_for_forecast_rain": "hold_irrigation",
    "irrigation.waterlogged": "hold_waterlogged",
    "irrigation.dry_at_sensitive_stage": "irrigate",
    "irrigation.dry": "irrigate",
    "planting.onset_confirmed": "plant",
    "planting.await_onset": "hold_plant",
    "planting.no_rainfall_signal": "hold_plant",
    "planting.outside_window": "hold_plant",
    "harvest.plan": "harvest",
    "soil.acidic": "lime",
    "soil.nutrients_low": "fertilise",
    "data.stale_readings": "check_sensor",
    "in_range": "none",
    "season.harvested": "none",
}
SMS_LIMIT = 320


class _Safe(dict):
    def __missing__(self, key: str) -> str:
        return "?"


def _flat(plot: dict) -> dict[str, Any]:
    out: dict[str, Any] = {"plot": f"plot {plot.get('plotId') or plot.get('zoneId')} ({plot.get('displayName', '')})".strip()}
    for grp in ("atmosphere", "soil", "crop", "agronomy"):
        for k, v in (plot.get(grp) or {}).items():
            out[k] = v
    out["soilPH"] = plot.get("soilPH")
    out["lastUpdateTime"] = plot.get("lastUpdateTime")
    return out


def render(rules: dict, plot: dict, profile: dict) -> dict:
    """Return {"message", "reasoning", "templateKey"} for the primary finding."""
    rule = rules["primaryRuleId"].split(".", 1)[1] if "." in rules["primaryRuleId"] else rules["primaryRuleId"]
    key = RULE_TO_TEMPLATE.get(rule)
    if key is None:
        key = "scout" if rules["primaryAction"] == "scout" else rules["primaryAction"]
    tmpl = (profile.get("messages") or {}).get(key) or (profile.get("messages") or {}).get("scout") or "{plot}: {reason}"
    ctx = _Safe({**_flat(plot), **(rules.get("context") or {}), **(profile.get("thresholds") or {})})
    primary = next((f for f in rules["findings"] if f["ruleId"] == rules["primaryRuleId"]), rules["findings"][0])
    ctx["reason"] = primary["reasoning"]
    if rule == "planting.outside_window":
        msg = f"{ctx['plot']}: today is outside the zone's planting windows. Hold planting."
    else:
        msg = tmpl.format_map(ctx)
    if len(msg) > SMS_LIMIT:
        msg = msg[: SMS_LIMIT - 1].rsplit(" ", 1)[0] + "…"
    others = [f for f in rules["findings"] if f is not primary and f["action"] != "none"]
    reasoning = primary["reasoning"]
    if others:
        reasoning += " Also noted: " + " ".join(f"[{f['ruleId']}] {f['reasoning']}" for f in others)
    return {"message": msg, "reasoning": reasoning, "templateKey": key}
