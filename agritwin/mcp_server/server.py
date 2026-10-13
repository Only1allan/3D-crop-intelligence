"""AgriTwin MCP server.

Run it standalone for any MCP client (Claude Desktop, Goose, your own agent):

    agritwin-mcp                     # stdio
    agritwin-mcp --transport http    # streamable HTTP on :8765/mcp

Or mount it inside the API (`agritwin.api.app`) where it is served at /mcp next to the officer console.

Tool surface (a stranger should be able to reuse these without reading our agent):
  read  : list_farms, get_office, get_farm_twin, get_plot, get_climate_signals, get_pest_alerts,
          check_advisory_rules, list_advisories, get_advisory, get_audit_log, list_crop_profiles,
          get_crop_profile, list_followups, list_flags
  act   : register_farm, ingest_plot_readings, ingest_weather, draft_advisory, schedule_follow_up, flag_plot
  gate  : record_officer_decision   (named officer only; the one place a dispatch can be marked)
"""
from __future__ import annotations

import argparse
import json
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from .. import __version__
from ..rules import get_profile, list_profiles
from . import tools as T

INSTRUCTIONS = """AgriTwin is the data gateway for an agricultural extension office. Each farm the office serves has a
digital twin (plots, households, soil/crop readings, zone rainfall and pest alerts). Use the read tools to gather
evidence, `check_advisory_rules` to get the deterministic, cited recommendation, and `draft_advisory` to file a draft
for a named officer. Never claim a message was sent: only an officer, through `record_officer_decision`, can approve a
draft, and even then dispatch is simulated. Every figure you write must come from a citation returned by a tool."""

READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
ACT = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)
EXTERNAL = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=True)
GATE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False, openWorldHint=False,
                       title="Officer gate (human only)")


def build_server(*, include_gate: bool = True, **settings: Any) -> FastMCP:
    mcp = FastMCP("agritwin", instructions=INSTRUCTIONS, **settings)

    # ------------------------------------------------------------ read tools
    @mcp.tool(annotations=READ)
    def list_farms() -> dict:
        """List every farm digital twin registered with this extension office (id, crop, zone, plot count, pending drafts)."""
        return T.list_farms()

    @mcp.tool(annotations=READ)
    def get_office() -> dict:
        """The extension office and its roster of named officers (the only people who may approve a draft)."""
        return T.get_office()

    @mcp.tool(annotations=READ)
    def get_farm_twin(farm_id: str) -> dict:
        """A farm's twin: the farm record plus every plot's current state, household and pending-advisory flag."""
        return T.get_farm_twin(farm_id)

    @mcp.tool(annotations=READ)
    def get_plot(plot_id: str, run_id: str | None = None) -> dict:
        """Full twin state for one plot: soil chemistry, moisture, weather at the plot, crop stage and canopy indices,
        7-day series, agronomy, household contact method, last officer visit, open flags and follow-ups.
        `run_id` is optional and only used to correlate the audit log with an agent run."""
        return T.get_plot(plot_id, run_id)

    @mcp.tool(annotations=READ)
    def get_climate_signals(plot_id: str | None = None, farm_id: str | None = None, days: int = 7, run_id: str | None = None) -> dict:
        """Zone rainfall for a plot's farm: observed daily mm for the last `days`, a 7-day forecast, the source label and
        when it was fetched. Returns available=false (with a reason) when nothing has been ingested — then do not guess."""
        return T.get_climate_signals(plot_id, farm_id, days, run_id)

    @mcp.tool(annotations=READ)
    def get_pest_alerts(agro_zone_id: str | None = None, plot_id: str | None = None, crop: str | None = None,
                        include_expired: bool = False, run_id: str | None = None) -> dict:
        """Active pest/disease alerts for an agroclimatic zone (or the zone of a plot), with the crop stages they apply to."""
        return T.get_pest_alerts(agro_zone_id, plot_id, crop, include_expired, run_id)

    @mcp.tool(annotations=READ)
    def check_advisory_rules(plot_id: str, run_id: str | None = None) -> dict:
        """Run the deterministic crop-profile rule engine on a plot against the zone's rainfall and alerts. Returns the
        primary action (plant/spray/irrigate/hold/harvest/lime/fertilise/scout/check_sensor/none), every finding with its
        rule id, reasoning and citations, and `blocked` when readings are stale. This is the only source of numbers for
        a draft: quote its citations, never invent a figure."""
        return T.check_advisory_rules(plot_id, run_id)

    @mcp.tool(annotations=READ)
    def list_advisories(farm_id: str | None = None, status: str | None = None, plot_id: str | None = None, limit: int = 50) -> dict:
        """Advisories by farm/plot/status (draft, approved, rejected), newest first."""
        return T.list_advisories(farm_id, status, plot_id, limit)

    @mcp.tool(annotations=READ)
    def get_advisory(advisory_id: str) -> dict:
        """One advisory with its citations, findings, drafter and (if decided) the officer's decision and simulated dispatch."""
        return T.get_advisory(advisory_id)

    @mcp.tool(annotations=READ)
    def get_audit_log(plot_id: str | None = None, advisory_id: str | None = None, run_id: str | None = None, limit: int = 50) -> dict:
        """The tool-call audit trail (timestamp, tool, actor, inputs, outputs) filtered by plot, advisory or run."""
        return T.get_audit_log(plot_id, advisory_id, run_id, limit)

    @mcp.tool(annotations=READ)
    def list_crop_profiles() -> dict:
        """Crop profiles the rule engine knows (bundled: potato, maize; add YAML files to extend)."""
        return T.list_crop_profiles()

    @mcp.tool(annotations=READ)
    def get_crop_profile(crop: str) -> dict:
        """A crop profile: stages, thresholds, pest stage maps and message templates."""
        return T.get_crop_profile(crop)

    @mcp.tool(annotations=READ)
    def list_followups(farm_id: str | None = None) -> dict:
        """Scheduled follow-up visits."""
        return T.list_followups(farm_id)

    @mcp.tool(annotations=READ)
    def list_flags(farm_id: str | None = None, include_resolved: bool = False) -> dict:
        """Plots flagged for officer attention."""
        return T.list_flags(farm_id, include_resolved)

    # ------------------------------------------------------------ act tools
    @mcp.tool(annotations=ACT)
    def register_farm(name: str, region: str, crop: str, lat: float, lon: float, agro_zone_id: str | None = None,
                      plots: list[dict] | None = None, notes: str = "", run_id: str | None = None) -> dict:
        """Create a new farm digital twin for this office (multi-farm). `plots` items: {plotId?, displayName?, householdName?,
        contactMethod: sms|ussd|visit, areaHa?, variety?, plantingDate?}. Plots start with no readings (status unknown)
        until `ingest_plot_readings` is called."""
        return T.register_farm(name, region, crop, lat, lon, agro_zone_id, plots, None, notes, run_id)

    @mcp.tool(annotations=ACT)
    def ingest_plot_readings(farm_id: str, readings: list[dict], source: str = "ingested", run_id: str | None = None) -> dict:
        """Merge new readings into a farm's plot twins. Each reading: {plotId, status?, lastUpdateTime?, atmosphere?{},
        soil?{}, soilPH?, crop?{}, agronomy?{}, series?{}, insight?}. This is how sensors, lab sheets or a cooperative's CSV
        enter the twin; missing keys keep their previous values."""
        return T.ingest_plot_readings(farm_id, readings, source, run_id)

    @mcp.tool(annotations=EXTERNAL)
    def ingest_weather(farm_id: str, past_days: int = 7, forecast_days: int = 7, run_id: str | None = None) -> dict:
        """Pull analysed + forecast daily rainfall for the farm's coordinates from Open-Meteo (keyless) into the twin.
        Skipped (cache kept) when AGRITWIN_LIVE_WEATHER=0 or when the demo date is pinned."""
        return T.ingest_weather(farm_id, past_days, forecast_days, run_id)

    @mcp.tool(annotations=ACT)
    def draft_advisory(plot_id: str, action: str, message: str, reasoning: str, citations: list[dict],
                       findings: list[dict] | None = None, drafter: dict | None = None, run_id: str | None = None) -> dict:
        """File a DRAFT advisory for an officer to review. `message` is the SMS-length text for the household (≤320 chars);
        `reasoning` is for the officer; `citations` must be the citation objects returned by check_advisory_rules. The tool
        refuses unsourced numbers, drafts on stale readings, and over-length messages. Nothing is sent."""
        return T.draft_advisory(plot_id, action, message, reasoning, citations, findings, drafter, run_id)

    @mcp.tool(annotations=ACT)
    def schedule_follow_up(plot_id: str, date: str, note: str, created_by: str = "agent", run_id: str | None = None) -> dict:
        """Put a follow-up visit/check on the officer's list for a plot (ISO date)."""
        return T.schedule_follow_up(plot_id, date, note, created_by, run_id)

    @mcp.tool(annotations=ACT)
    def flag_plot(plot_id: str, reason: str, severity: str = "warning", created_by: str = "agent", run_id: str | None = None) -> dict:
        """Flag a plot for officer attention (e.g. stale probe, conflicting signals) without drafting advice."""
        return T.flag_plot(plot_id, reason, severity, created_by, run_id)

    # ------------------------------------------------------------ the gate
    if include_gate:
        @mcp.tool(annotations=GATE)
        def record_officer_decision(advisory_id: str, officer_name: str, decision: str, reason: str | None = None,
                                    run_id: str | None = None) -> dict:
            """HUMAN ONLY. Approve or reject a draft as a named officer on the office roster. Approve logs a SIMULATED dispatch
            on the household's channel; reject needs a reason and sends nothing. Agents must not call this on their own
            initiative — the console calls it with the officer's identity."""
            return T.record_officer_decision(advisory_id, officer_name, decision, reason, run_id)

    # ------------------------------------------------------------ resources & prompts
    @mcp.resource("agritwin://office", mime_type="application/json")
    def office_resource() -> str:
        return json.dumps(T.get_office.__wrapped_tool__())  # type: ignore[attr-defined]

    @mcp.resource("agritwin://farms", mime_type="application/json")
    def farms_resource() -> str:
        return json.dumps(T.list_farms.__wrapped_tool__())  # type: ignore[attr-defined]

    @mcp.resource("agritwin://plots/{plot_id}", mime_type="application/json")
    def plot_resource(plot_id: str) -> str:
        return json.dumps(T.get_plot.__wrapped_tool__(plot_id))  # type: ignore[attr-defined]

    @mcp.resource("agritwin://profiles/{crop}", mime_type="application/json")
    def profile_resource(crop: str) -> str:
        p = dict(get_profile(crop)); p.pop("_file", None)
        return json.dumps(p)

    @mcp.prompt()
    def advisory_brief(plot_id: str) -> str:
        """Instructions for drafting one officer-gated advisory for a plot."""
        return (f"Draft a climate-smart advisory for plot {plot_id}. Steps: get_plot, get_climate_signals, get_pest_alerts, "
                "then check_advisory_rules. Write one SMS-length message (≤320 chars) in plain language for the household and a "
                "short reasoning for the officer. Use only numbers that appear in the rule engine's citations and pass those "
                "citation objects to draft_advisory. If the engine returns blocked, do not draft agronomic advice; flag_plot instead. "
                "Never say the message was sent: an officer decides.")

    return mcp


mcp = build_server()


def main() -> None:
    ap = argparse.ArgumentParser(description="AgriTwin MCP server")
    ap.add_argument("--transport", choices=["stdio", "http"], default="stdio")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    if args.transport == "stdio":
        mcp.run(transport="stdio")
    else:
        server = build_server(host=args.host, port=args.port)
        print(f"AgriTwin MCP v{__version__}: streamable HTTP on http://{args.host}:{args.port}/mcp  "
              f"({len(list_profiles())} crop profiles)")
        server.run(transport="streamable-http")


if __name__ == "__main__":
    main()
