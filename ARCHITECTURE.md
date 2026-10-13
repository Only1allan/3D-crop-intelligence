# ARCHITECTURE.md — Crop Intelligence · Advisory Desk (AgriTwin)

One page on the agent's shape, which MCP servers we built versus borrowed, and why.

## The shape

```
                 officer console (React + Three.js twin, /desk queue, audit timeline)
                                   │ REST + SSE  (docs/API_CONTRACT.md)
                                   ▼
┌──────────────────────── one FastAPI process ───────────────────────────────┐
│  /api/*  thin bridge ──► tool functions ◄── /mcp/  AgriTwin MCP server      │
│  (human actor)          (audit-logged)        (agent actor, streamable HTTP) │
│                               │                         ▲                   │
│                          SQLite twin store              │ MCP over loopback │
│                     (farms, plots, signals, alerts,     │                   │
│                      advisories, decisions, audit)      │                   │
│                                                         │                   │
│  LangGraph agent  gather ─► cross_check ─► draft ─► await_officer ─► finalize│
│                     │             │          │        interrupt()           │
│                     │             │          └─ LLM (Ollama/OpenRouter) +    │
│                     │             │             file_draft → draft_advisory  │
│                     │             └─ check_advisory_rules (deterministic)    │
│                     └─ get_plot / get_climate_signals / get_pest_alerts      │
│                        + get_weather_forecast on the BORROWED server ───────┼──► chuk-mcp-open-meteo (stdio)
└─────────────────────────────────────────────────────────────────────────────┘
```

**Agent shape.** A fixed LangGraph plan with autonomy inside the steps. `gather` calls three read tools and a
borrowed second-opinion forecast, retrying each once and — if the farm has no rainfall signal — invoking
`ingest_weather` itself before giving up. `cross_check` runs the deterministic crop-profile rule engine, which is
the *only* source of numbers. `draft` hands the model an evidence pack (findings + citations) and a single tool,
`file_draft`, that wraps the MCP `draft_advisory` call; the server rejects any number that is not backed by a
citation, the rejection is fed back, and the model corrects itself (self-check and recovery, visible in the trace).
If the model keeps failing, or there is no model, the deterministic template drafter files the draft and the
advisory is labelled `template`. `await_officer` is a LangGraph `interrupt()`: the run is checkpointed and nothing
downstream can execute until a human resumes it. `finalize` records the outcome and schedules the follow-up.
Missing or stale data routes to `missing_data`: the plot is flagged, no advisory exists — fail closed.

**Why a rule engine under an LLM.** The brief says an unsourced planting recommendation is worse than none. We
made that structural: thresholds live in versioned YAML crop profiles (`agritwin/rules/profiles/*.yaml`), every
finding carries `field → value → source → observedAt` citations, and `draft_advisory` runs a numeric guard over
the message. The model's job is planning, phrasing and judgement about *which* findings matter — not measuring.

## MCP servers

| Server | Built / borrowed | Role | Why |
|---|---|---|---|
| **AgriTwin** (`agritwin/mcp_server`) — 21 tools, 4 resources, 1 prompt | **Built** | The processing layer and the only gateway to the twin store: ingestion (`register_farm`, `ingest_plot_readings`, `ingest_weather` — the Open-Meteo HTTP call lives *inside* this server as an adapter), evidence reads, the rule engine (`check_advisory_rules`), actions (`draft_advisory`, `flag_plot`, `schedule_follow_up`) and the gate (`record_officer_decision`, annotated `destructiveHint`, human only). Tools are plain audit-logged Python functions, so the REST bridge and the agent share one code path. | Purpose-built for an extension office's workflow; a stranger can mount it in Claude Desktop/Goose and reuse the tools without our agent. Extensible by dropping in crop-profile YAML or an ingestion adapter (docs/EXTENDING.md). |
| **chuk-mcp-open-meteo** (IBM, PyPI) | **Borrowed** | Second-opinion 3-day forecast the agent fetches over stdio during `gather`; cited in the officer reasoning as agreement/disagreement, never as a number in the household message. | It already wraps Open-Meteo's forecast, history and geocoding with validated schemas and no API key; rebuilding that teaches a judge nothing about our agent, and a second independent source makes "the forecast changed the decision" defensible. |

Transport: the agent talks to AgriTwin over **streamable HTTP on loopback** (real MCP, real sessions, visible in the
audit log as actor `agent` with the run id), and to the borrowed server over **stdio**. The console's REST calls hit
the same tool functions as actor `human:<officer>` / `api`.

## Models

Two drafting modes share the same `file_draft → draft_advisory` path: hosted models use **native tool calls**;
small local models (Qwen3-4B class on Ollama) tend to narrate instead of calling tools, so for them the draft
step asks for **one JSON object under a schema** (Ollama structured output) and the graph files it — same guard,
same retries, same audit trail. `AGRITWIN_DRAFT_MODE=json|tools` overrides the auto choice.

`auto` picks a local open-weights model via **Ollama** (default `qwen3:8b`; `qwen3:4b` on CPU laptops) — the
on-prem path, because household and plot records should not leave the office — else an open-weights model on
OpenRouter (Gemma 4 / Nemotron 3, free tier), else Anthropic for a frontier comparison, else no model (template
drafter). The provider and model are recorded on every advisory (`drafter`) and shown in the console.

## Data and honesty

Plot values are synthetic on the real farmSensor/farmZone schema shape (carried over from the v0 twin). Zone
rainfall is **live** from Open-Meteo for the farm's coordinates (a CHIRPS-shaped seeded cache is used when the
demo date is pinned, e.g. in the evals). Pest bulletins are synthetic. Dispatch is **simulated** and labelled so
everywhere; this software never sends anything to a farmer.

## Costs

A full advisory run is 7–9 tool calls. With Gemma 4 26B on OpenRouter's free tier the drafting step is one to
three model calls (~2–4k input tokens each) — $0.00 on the free tier, ≈ $0.002–0.005 at list prices for a
comparable hosted open-weights model; the template path costs nothing. Timings are in EVALS.md.
