"""Tool contracts: acts write what they claim, the gate refuses what it must, and everything is logged."""
import pytest

from agritwin import audit
from agritwin.mcp_server import tools as T


def rules_cites(pid):
    r = T.check_advisory_rules.__wrapped_tool__(pid)
    return r, [c for f in r["findings"] for c in f["citations"]]


def test_draft_then_approve_logs_everything_and_simulates_dispatch():
    r, cites = rules_cites("A3")
    adv = T.draft_advisory("A3", "spray", "Plot A3: humidity 92% and 14.2 mm rain. Spray within 24 h.", "why", cites, r["findings"],
                           {"kind": "test"}, run_id="run-test")
    assert adv["status"] == "draft" and adv["advisoryId"].startswith("ADV-")
    assert T.get_plot.__wrapped_tool__("A3")["pendingAdvisoryId"] == adv["advisoryId"]
    out = T.record_officer_decision(adv["advisoryId"], "Amina Wekesa", "approve")
    assert out["status"] == "approved"
    assert out["decision"]["dispatch"]["simulated"] is True and out["decision"]["dispatch"]["channel"] == "sms"
    log = audit.rows(advisory_id=adv["advisoryId"])
    assert {e["tool"] for e in log} >= {"draft_advisory", "record_officer_decision"}
    assert all(e["ts"] and e["input"] is not None for e in log)


def test_reject_needs_a_reason_and_sends_nothing():
    r, cites = rules_cites("B2")
    adv = T.draft_advisory("B2", "hold", "Hold irrigation on B2: 21.5 mm forecast in 3 days.", "why", cites, r["findings"])
    with pytest.raises(ValueError):
        T.record_officer_decision(adv["advisoryId"], "Amina Wekesa", "reject")
    out = T.record_officer_decision(adv["advisoryId"], "Amina Wekesa", "reject", "Farmer irrigated yesterday")
    assert out["status"] == "rejected" and out["decision"]["dispatch"] is None


def test_unknown_officer_is_refused():
    r, cites = rules_cites("B2")
    adv = T.draft_advisory("B2", "hold", "Hold irrigation on B2.", "why", cites)
    with pytest.raises(PermissionError):
        T.record_officer_decision(adv["advisoryId"], "Someone Else", "approve")
    assert T.get_advisory.__wrapped_tool__(adv["advisoryId"])["status"] == "draft"


def test_draft_refuses_unsourced_numbers_and_stale_plots():
    r, cites = rules_cites("B2")
    with pytest.raises(ValueError, match="unsourced"):
        T.draft_advisory("B2", "irrigate", "Apply 40 mm tonight.", "why", cites)
    with pytest.raises(ValueError, match="citations"):
        T.draft_advisory("B2", "hold", "Hold.", "why", [])
    with pytest.raises(ValueError, match="blocked"):
        T.draft_advisory("B3", "irrigate", "Irrigate.", "why", cites)
    fid = T.flag_plot("B3", "probe offline since 24 Sept", "warning")
    assert fid["flagId"].startswith("FLG-")


def test_register_farm_and_ingest_readings_make_a_usable_twin():
    farm = T.register_farm("Kipipiri Smallholders", "Kipipiri", "maize", -0.45, 36.6,
                           plots=[{"displayName": "Lower field", "householdName": "Jane Muthoni", "contactMethod": "ussd", "areaHa": 0.8,
                                   "variety": "H614", "plantingDate": "2026-09-10"}])
    assert farm["farmId"].startswith("F-") and farm["plots"][0]["status"] == "unknown"
    pid = farm["plots"][0]["plotId"]
    assert T.check_advisory_rules.__wrapped_tool__(pid)["blocked"]  # no readings -> blocked, not guessed
    T.ingest_plot_readings(farm["farmId"], [{"plotId": pid, "lastUpdateTime": "2026-09-27T07:00:00Z",
                                            "atmosphere": {"ambientTemperature": 24, "relativeHumidity": 60, "precipitation": 0},
                                            "soil": {"soilMoisture": 22, "soilTemperature": 21, "soilEC": 0.3, "soilOrganicCarbon": 1.8,
                                                     "nitrogenLevel": 0.2, "phosphorusLevel": 15, "potassiumLevel": 0.5, "aluminiumLevel": 0.3,
                                                     "soilTextureClass": "loam"},
                                            "soilPH": 6.2, "crop": {"ndvi": 0.6, "evi": 0.5, "cloudCover": 5, "growthStage": "vegetative",
                                                                    "daysAfterPlanting": 17, "accumulatedGDD": 300}}], source="coop_csv")
    r = T.check_advisory_rules.__wrapped_tool__(pid)
    assert r["blocked"] is None and r["profile"].startswith("maize@")
    assert T.get_climate_signals.__wrapped_tool__(farm_id=farm["farmId"])["available"] is False


def test_ingest_weather_is_skipped_without_live_flag():
    out = T.ingest_weather("F-001")
    assert out["skipped"] is True
