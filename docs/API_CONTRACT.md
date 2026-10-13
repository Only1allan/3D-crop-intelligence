# REST + SSE contract between the web console and the AgriTwin backend

The browser never talks to the database and never calls an LLM. Everything
goes through the FastAPI bridge in `agritwin/api/app.py`, which invokes the
same MCP tool functions the agent uses (every call is audit-logged the same
way). Base path: `/api`. In dev, Vite proxies `/api` → `http://localhost:8000`.

All timestamps are ISO-8601 UTC strings. IDs are strings.

## Health

`GET /api/health` →
```json
{ "ok": true,
  "model": { "provider": "openrouter|ollama|anthropic|template", "model": "google/gemma-4-26b-a4b-it:free", "openWeights": true },
  "mcp": { "server": "agritwin", "tools": 14 },
  "borrowedMcp": { "name": "chuk-mcp-open-meteo", "ok": true },
  "today": "2026-09-27" }
```

## Office & officers

`GET /api/office` →
```json
{ "officeId": "OFF-001", "name": "Ol Kalou Ward Agricultural Extension Office", "country": "Kenya",
  "officers": [ { "name": "Amina Wekesa", "role": "Ward Extension Officer" }, { "name": "Joseph Kariuki", "role": "Agricultural Officer" } ] }
```

## Farms (one digital twin per farm; the office can hold many)

`GET /api/farms` → array of
```json
{ "farmId": "F-001", "name": "Nyandarua Demo Cluster", "region": "Kenyan highlands (synthetic demo cluster)",
  "crop": "potato", "agroZoneId": "KE-HL-UPPER", "lat": -0.39, "lon": 36.87, "elevationM": 2300,
  "totalHa": 9.6, "today": "2026-09-27", "plotCount": 6, "pendingAdvisories": 2, "notes": "..." }
```

`GET /api/farms/{farmId}` → the farm object above plus `"plots": [Plot, ...]`.

`POST /api/farms` (register a new twin — the multi-farm pitch)
```json
{ "name": "...", "region": "...", "crop": "potato|maize", "lat": -0.5, "lon": 36.9, "agroZoneId": "KE-HL-UPPER",
  "plots": [ { "plotId": "C1", "displayName": "...", "householdName": "...", "contactMethod": "sms|ussd|visit", "areaHa": 1.2, "variety": "Shangi", "plantingDate": "2026-09-20" } ] }
```
→ the created farm (plots get a default twin state marked `"source": {"soil":"unknown", ...}` and status `unknown` until readings are ingested).

`POST /api/farms/{farmId}/ingest/weather` → runs the `ingest_weather` MCP tool (Open-Meteo archive + forecast for the farm's coordinates). Returns `{ "ok": true, "days": 8, "forecastDays": 7, "source": "open-meteo archive+forecast", "fetchedAt": "..." }` or `{ "ok": false, "error": "..." }`.

## Plots

A **Plot** is exactly the v0 zone shape plus household fields:
```json
{ "plotId": "B2", "zoneId": "B2", "farmId": "F-001", "displayName": "South Slope", "grid": [1, 1],
  "status": "nominal|warning|critical|offline|unknown",
  "source": { "soil": "agrifusion_assessment", "crop": "farmwise_snapshot", "model": "synthetic" },
  "lastUpdateTime": "2026-09-27T08:41:00Z",
  "atmosphere": { "ambientTemperature": 23.6, "relativeHumidity": 49, "precipitation": 0 },
  "soil": { "soilMoisture": 13.2, "soilTemperature": 23.1, "soilEC": 0.66, "soilOrganicCarbon": 1.3, "nitrogenLevel": 0.16, "phosphorusLevel": 15, "potassiumLevel": 0.47, "aluminiumLevel": 0.6, "soilTextureClass": "sandy_loam" },
  "soilPH": 6.3,
  "crop": { "ndvi": 0.55, "evi": 0.45, "cloudCover": 3, "growthStage": "tuber_initiation", "daysAfterPlanting": 41, "accumulatedGDD": 610 },
  "agronomy": { "variety": "Asante", "plantingDate": "2026-08-17", "areaHa": 1.5, "substorTuberFreshYield": 17.4, "substorLeafAreaIndex": 2.1, "simcastBlightRisk": "none", "simcastSprayRecommended": false },
  "series": { "soilMoisture": [21, 19.4, 17.9, 16.5, 15.2, 14.1, 13.2], "soilPH": [...], "ndvi": [...], "accumulatedGDD": [...] },
  "insight": "Dry spell: ...",
  "householdId": "H-005", "householdName": "Mary Wairimu", "contactMethod": "sms",
  "lastVisit": { "date": "2026-09-20", "note": "...", "officer": "Amina Wekesa" },
  "agroZoneId": "KE-HL-UPPER",
  "pendingAdvisoryId": "ADV-0003", "latestAdvisoryStatus": "draft|approved|rejected|null",
  "flags": [ { "flagId": "FLG-1", "reason": "...", "severity": "warning", "createdAt": "..." } ] }
```

`GET /api/plots/{plotId}` → Plot plus:
```json
{ "signals": { "rainfall": { "last7Mm": 31.2, "days": [ { "date": "2026-09-21", "mm": 3.4 } ], "forecast": [ { "date": "2026-09-28", "mm": 6.1, "probability": 70 } ],
                             "source": "open-meteo archive (ERA5) + forecast", "fetchedAt": "...", "stale": false } | null },
  "alerts": [ { "alertId": "PA-2026-41-01", "pest": "late_blight", "crop": "potato", "severity": "high", "issuedAt": "...", "source": "...", "stages": ["tuber_initiation","tuber_bulking"], "summary": "..." } ],
  "followups": [ { "followupId": "FU-1", "date": "2026-10-02", "note": "...", "createdBy": "agent|officer", "createdAt": "..." } ] }
```

`GET /api/plots/{plotId}/rules` → the deterministic rule engine's view (no LLM):
```json
{ "plotId": "B2", "primaryAction": "irrigate", "blocked": null,
  "findings": [ { "ruleId": "potato.irrigation.dry_at_initiation", "action": "irrigate", "severity": "warning",
                  "reasoning": "Soil moisture 13.2% VWC is below the 18% floor during tuber initiation ...",
                  "citations": [ { "field": "soil.soilMoisture", "value": 13.2, "unit": "% VWC", "source": "plot B2 twin state (synthetic, farmSensor:soilMoisture)", "observedAt": "2026-09-27T08:41:00Z" } ] } ],
  "profile": "potato@1" }
```
`blocked` is non-null when the engine refuses (e.g. `{ "reason": "stale_readings", "detail": "probe offline since ..." }`); then `primaryAction` is `"check_sensor"` and no advisory may be drafted.

## Advisories (what the agent drafts; what the officer decides)

`GET /api/advisories?status=draft&farmId=F-001` → array of
```json
{ "advisoryId": "ADV-0003", "plotId": "B2", "farmId": "F-001", "householdId": "H-005", "householdName": "Mary Wairimu",
  "contactMethod": "sms", "action": "irrigate|spray|plant|hold|harvest|lime|fertilise|scout|check_sensor|none",
  "message": "Plain-language advisory text (≤ 320 chars, SMS-friendly)",
  "reasoning": "Why, for the officer (longer)",
  "citations": [ { "field": "...", "value": 13.2, "unit": "...", "source": "...", "observedAt": "..." } ],
  "findings": [ ...rule findings... ],
  "status": "draft|approved|rejected", "createdAt": "...", "runId": "run-...",
  "drafter": { "kind": "llm|template", "provider": "openrouter", "model": "google/gemma-4-26b-a4b-it:free", "openWeights": true },
  "decision": null | { "officerName": "Amina Wekesa", "decision": "approve|reject", "reason": "...", "decidedAt": "...",
                       "dispatch": null | { "simulated": true, "channel": "sms", "to": "H-005", "sentAt": "...", "text": "..." } } }
```

`GET /api/advisories/{advisoryId}` → one advisory.

`POST /api/advisories/{advisoryId}/decision`
```json
{ "officerName": "Amina Wekesa", "decision": "approve", "reason": "optional for approve, required for reject" }
```
→ the updated advisory. 400 if the officer is not in the office roster, if the advisory is not in `draft`, or if `reject` has no reason. This is the only route that can ever mark something as sent, and the "send" is simulated and labelled as such.

## Agent runs (advisory drafting and officer chat share one event stream)

`POST /api/agent/run` `{ "plotId": "B2" }` → `{ "runId": "run-20260927-ab12", "plotId": "B2" }`

`POST /api/chat` `{ "message": "Which plots need me this week?", "plotId": "B2" | null, "farmId": "F-001", "threadId": "optional" }` → `{ "runId": "run-...", "threadId": "thr-..." }`

`GET /api/agent/runs/{runId}/events` → **Server-Sent Events**. Each event: `event: <type>` and `data: <json>`.
Types:
- `status` `{ "node": "gather|cross_check|draft|await_officer|finalize|missing_data", "text": "..." }`
- `tool_call` `{ "id": "tc-1", "server": "agritwin|open-meteo", "tool": "get_plot", "input": {...}, "ts": "..." }`
- `tool_result` `{ "id": "tc-1", "tool": "get_plot", "ok": true, "durationMs": 12, "summary": "...", "output": {...truncated...} }`
- `token` `{ "text": "partial model output" }` (chat only; drafting emits the final draft instead)
- `llm` `{ "provider": "...", "model": "...", "openWeights": true, "attempt": 1 }`
- `draft` `{ ...Advisory... }` (status `draft`)
- `awaiting_officer` `{ "advisoryId": "ADV-0003" }` — the run is paused at the gate; the stream stays open until a decision is posted or 10 minutes pass
- `decision` `{ ...Advisory with decision... }`
- `message` `{ "text": "final chat answer", "sources": [...] }` (chat only)
- `error` `{ "text": "...", "recoverable": false }`
- `done` `{ "runId": "...", "costUsd": 0.0, "tokens": { "in": 0, "out": 0 }, "durationMs": 0 }`

`GET /api/agent/runs/{runId}` → `{ "runId", "kind": "advisory|chat", "plotId", "status": "running|awaiting_officer|done|error", "events": [...] }` (replay for page refresh).

## Audit log

`GET /api/audit?plotId=B2&advisoryId=&runId=&limit=100` → array (newest first) of
```json
{ "id": 123, "ts": "...", "tool": "draft_advisory", "actor": "agent|human:Amina Wekesa|api", "runId": "run-...",
  "input": {...}, "output": {...truncated...}, "ok": true, "durationMs": 9, "plotId": "B2", "advisoryId": "ADV-0003" }
```

`GET /api/followups?farmId=` → array of follow-ups (see plot payload).
`GET /api/flags?farmId=` → array of flags.

## Errors

Non-2xx responses carry `{ "detail": "human-readable message" }`.
