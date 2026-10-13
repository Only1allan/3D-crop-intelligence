"""The rule engine is the only source of numbers; these tests pin its behaviour on the demo fixture."""
from datetime import date

from agritwin.mcp_server import tools as T
from agritwin.rules import evaluate, get_profile, validate_draft
from agritwin.rules.templates import render

TODAY = date(2026, 9, 27)


def rules(plot_id):
    return T.check_advisory_rules.__wrapped_tool__(plot_id)


def test_south_slope_holds_irrigation_when_rain_is_forecast():
    r = rules("B2")
    assert r["primaryAction"] == "hold"
    assert r["primaryRuleId"] == "potato.irrigation.hold_for_forecast_rain"
    fields = {c["field"] for f in r["findings"] for c in f["citations"]}
    assert {"soil.soilMoisture", "rainfall.forecast3Mm", "crop.growthStage"} <= fields


def test_south_slope_irrigates_without_a_forecast():
    plot = T.get_plot.__wrapped_tool__("B2")
    r = evaluate(plot, get_profile("potato"), None, [], TODAY)
    assert r["primaryAction"] == "irrigate"
    assert r["primaryRuleId"] == "potato.irrigation.dry_at_sensitive_stage"


def test_east_valley_is_a_spray_window():
    r = rules("A3")
    assert r["primaryAction"] == "spray"
    assert r["primaryRuleId"] == "potato.blight.spray_window"
    spray = next(f for f in r["findings"] if f["ruleId"] == "potato.blight.spray_window")
    assert any(c["field"] == "atmosphere.relativeHumidity" and c["value"] == 92 for c in spray["citations"])
    # zone alert is cited on the spray finding, not raised as a second finding
    assert any(c["field"].startswith("pestAlert.") for c in spray["citations"])


def test_spray_is_held_when_heavy_rain_is_forecast_tomorrow():
    plot = T.get_plot.__wrapped_tool__("A3")
    sig = {"days": [{"date": "2026-09-26", "mm": 14.2}], "forecast": [{"date": "2026-09-27", "mm": 18.0}], "source": "test"}
    r = evaluate(plot, get_profile("potato"), sig, [], TODAY)
    assert r["primaryAction"] == "hold"
    assert r["primaryRuleId"] == "potato.blight.hold_spray_for_rain"


def test_offline_probe_blocks_everything():
    r = rules("B3")
    assert r["blocked"]["reason"] == "stale_readings"
    assert r["primaryAction"] == "check_sensor"
    assert len(r["findings"]) == 1


def test_maize_alert_is_not_applicable_to_potato():
    r = rules("A1")
    na = [f for f in r["findings"] if f["ruleId"].startswith("potato.pest.fall_armyworm.not_applicable")]
    assert len(na) == 1 and na[0]["action"] == "none" and "different crop" in na[0]["reasoning"]


def test_zone_alert_alone_means_scout_not_spray():
    r = rules("A1")  # healthy plot, humidity 68%, zone late-blight alert active
    assert r["primaryAction"] == "scout"
    assert r["primaryRuleId"] == "potato.blight.zone_alert_scout"


def test_healthy_plot_without_alerts_is_in_range():
    plot = T.get_plot.__wrapped_tool__("A1")
    r = evaluate(plot, get_profile("potato"), T.get_climate_signals.__wrapped_tool__("A1")["rainfall"], [], TODAY)
    assert r["primaryAction"] == "none"


def test_river_flats_plans_harvest():
    r = rules("B1")
    assert r["primaryAction"] == "harvest"


def test_hillside_lime_and_nutrients_are_found():
    r = rules("A2")
    ids = {f["ruleId"] for f in r["findings"]}
    assert {"potato.soil.acidic", "potato.soil.nutrients_low"} <= ids


def test_unplanted_plot_waits_for_onset_and_window():
    plot = T.get_plot.__wrapped_tool__("B2")
    plot["crop"]["growthStage"] = "unplanted"
    seasons = [{"name": "Short rains", "plantStart": "09-15", "plantEnd": "10-31"}]
    strong = {"days": [{"date": "2026-09-26", "mm": 25}], "forecast": [{"date": "2026-09-27", "mm": 20}], "source": "t"}
    weak = {"days": [{"date": "2026-09-26", "mm": 3}], "forecast": [{"date": "2026-09-27", "mm": 2}], "source": "t"}
    assert evaluate(plot, get_profile("potato"), strong, [], TODAY, seasons)["primaryAction"] == "plant"
    assert evaluate(plot, get_profile("potato"), weak, [], TODAY, seasons)["primaryAction"] == "hold"
    assert evaluate(plot, get_profile("potato"), None, [], TODAY, seasons)["primaryRuleId"] == "potato.planting.no_rainfall_signal"
    plot["lastUpdateTime"] = "2026-12-01T06:00:00Z"  # fresh reading on the later date
    assert evaluate(plot, get_profile("potato"), strong, [], date(2026, 12, 1), seasons)["primaryRuleId"] == "potato.planting.outside_window"


def test_every_finding_with_an_action_has_citations():
    for pid in ("A1", "A2", "A3", "B1", "B2"):
        for f in rules(pid)["findings"]:
            if f["action"] != "none":
                assert f["citations"], f


def test_template_renders_sms_length_with_cited_numbers():
    for pid in ("A1", "A2", "A3", "B1", "B2", "B3"):
        r = rules(pid)
        plot = T.get_plot.__wrapped_tool__(pid)
        out = render(r, plot, get_profile("potato"))
        assert 0 < len(out["message"]) <= 320
        cites = [c for f in r["findings"] for c in f["citations"]]
        assert validate_draft(out["message"], cites, r["findings"], get_profile("potato")) == [], (pid, out["message"])


def test_validate_draft_catches_invented_numbers():
    r = rules("B2")
    cites = [c for f in r["findings"] for c in f["citations"]]
    assert validate_draft("Moisture is 13.2% VWC; irrigate 45 mm tonight", cites, r["findings"], get_profile("potato")) == ["45"]


def test_known_gap_guard_accepts_swapped_fields():
    """Documented, unfixed: the guard checks numbers, not meaning. 21.5 is the 3-day forecast, not last week's
    rain, yet this message passes because both figures are cited. See EVALS.md, 'A failure we did not fix'."""
    r = rules("B2")
    cites = [c for f in r["findings"] for c in f["citations"]]
    swapped = "B2: 21.5 mm fell last week, so hold irrigation."
    assert validate_draft(swapped, cites, r["findings"], get_profile("potato")) == []  # wrongly accepted
