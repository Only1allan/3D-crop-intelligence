# Extending AgriTwin for your own agricultural use case

AgriTwin is an MCP server first and a demo second. The three extension points are files you add, not code you fork.

## 1. A new crop or region: add a profile

Copy `agritwin/rules/profiles/potato.yaml` to `my_profiles/sorghum.yaml`, change `crop`, `stages`,
`drought_sensitive_stages`, thresholds, the `pests` → stages map and the message templates, and point the server at
it:

```bash
AGRITWIN_PROFILE_DIRS=/path/to/my_profiles agritwin-mcp
```

`list_crop_profiles` and the `agritwin://profiles/{crop}` resource show it immediately; `register_farm(crop="sorghum")`
starts using it. Every finding the engine emits cites `profile.thresholds.<name>` with the file path, so an officer
can see which rule book produced a number. Planting windows per zone live in `fixtures/farm_demo.json → agroZones`
(or whatever you seed into the `agro_zones` table).

## 2. A new data source: add an ingestion adapter

Implement `agritwin/ingest/base.py::Adapter` (`name`, `description`, `run(**kwargs) -> dict`) and register it in
`agritwin/ingest/registry.py`. `ingest_weather` is the worked example (`openmeteo.py`): fetch → normalise → write rows
→ return a summary that the audit log keeps. For sensor or lab data you may not need an adapter at all:
`ingest_plot_readings` accepts the twin state shape directly (the same keys the v0 OpenUSD schema used), so a cron
job, an IoT bridge or a cooperative's CSV importer can call it over MCP or REST.

## 3. A new rule: add it to the engine

Rules are short Python blocks in `agritwin/rules/engine.py::evaluate`, each ending in `add(rule_id, action,
severity, reasoning, citations)`. Keep the contract: every number in `reasoning` must appear in a citation, and the
`cite()` helper does that for plot fields, rainfall aggregates and thresholds. `tests/test_rules.py` shows how to pin
a rule's behaviour.

## Using the server from another agent

```bash
agritwin-mcp                      # stdio, for Claude Desktop / Goose / any MCP client
agritwin-mcp --transport http     # streamable HTTP on http://127.0.0.1:8765/mcp
```

Claude Desktop config:

```json
{ "mcpServers": { "agritwin": { "command": "/path/to/version1/.venv/bin/agritwin-mcp" } } }
```

Tool annotations tell a client what is safe: read tools are `readOnlyHint`, acts are not destructive and reach
nobody, and `record_officer_decision` is `destructiveHint` + "human only" — wire it to a UI, never to a model.

## What stays fixed

* `draft_advisory` refuses unsourced numbers, stale plots and over-length messages. Don't loosen it; add citations.
* Nothing in this repository sends a message. If you integrate an SMS gateway, put it *behind* an approved decision
  and keep the `simulated: false` flag in the dispatch record so the audit trail says what really happened.
