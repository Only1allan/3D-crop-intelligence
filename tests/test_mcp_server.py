"""The server speaks real MCP: list tools, call them, read resources — over an in-memory session."""
import json

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from agritwin.mcp_server.server import build_server


@pytest.mark.asyncio
async def test_tools_resources_and_a_full_draft_over_mcp():
    server = build_server()
    async with create_connected_server_and_client_session(server._mcp_server) as client:
        tools = (await client.list_tools()).tools
        names = {t.name for t in tools}
        assert {"get_plot", "check_advisory_rules", "draft_advisory", "record_officer_decision", "ingest_weather"} <= names
        assert len(names) >= 20
        gate = next(t for t in tools if t.name == "record_officer_decision")
        assert gate.annotations.destructiveHint is True
        assert next(t for t in tools if t.name == "get_plot").annotations.readOnlyHint is True

        rules = json.loads((await client.call_tool("check_advisory_rules", {"plot_id": "B2", "run_id": "run-mcp"})).content[0].text)
        assert rules["primaryAction"] == "hold"
        cites = [c for f in rules["findings"] for c in f["citations"]]
        adv = json.loads((await client.call_tool("draft_advisory", {
            "plot_id": "B2", "action": "hold", "message": "Hold irrigation on B2: 21.5 mm of rain is forecast in the next 3 days.",
            "reasoning": "r", "citations": cites, "findings": rules["findings"], "run_id": "run-mcp"})).content[0].text)
        assert adv["status"] == "draft"

        res = await client.read_resource("agritwin://plots/B2")
        assert json.loads(res.contents[0].text)["pendingAdvisoryId"] == adv["advisoryId"]
        log = json.loads((await client.call_tool("get_audit_log", {"run_id": "run-mcp"})).content[0].text)["entries"]
        assert {e["tool"] for e in log} >= {"check_advisory_rules", "draft_advisory"}
