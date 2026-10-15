# FarmVerse Crop Intelligence

**An extension office's farms as digital twins. An agent drafts cited, climate-smart advisories then an officer approves every one before anything reaches a household/farmer.**

Built for the *Agentic advisory for local agricultural offices* track, theme **Climate-smart advisory**.

## 1. Problem statement

Extension officers already have the signals — a rainfall update, a 6 a.m. pest alert in a WhatsApp group, a lab
sheet from last month's visit — and a few hundred plots to apply them to. Cross-checking all of it by hand takes
about fifteen minutes per household cluster, and the advice is often stale by the time it goes out. Also, a
hand-typed advisory carries no trace of which number it was based on, so nobody can verify it afterwards.

This bites hardest in the African context: extreme officer-to-farmer ratios, rain-fed plots where a mistimed
spray, irrigation, or planting call destroys a season's yield, patchy probes and connectivity, and SMS/USSD as the
delivery channel.

## 2. Solution overview

FarmVerse gives the office a digital twin per farm (plots, households, soil and crop readings, zone rainfall, pest
bulletins) and an agent that does the cross-checking. For a plot it gathers the twin state, the rainfall history
and forecast, and the active alerts, runs them through a versioned crop-calendar rule engine, and drafts and advisory to the officer. Every number in the draft is cited
back to the reading, the forecast, or the rule it came from.

The draft lands in the officer's queue. A named officer approves (a simulated SMS/USSD/visit
dispatch is logged) or rejects with a reason; nothing reaches a household otherwise. If a probe is offline or the
farm has no rainfall signal, the agent flags the plot instead of guessing.

```
signals in ──► AgriTwin MCP server (ingest · rules · draft · gate) ──► LangGraph agent ──► officer approves ──► simulated SMS/USSD/visit
```

## 3. Target users

* **Ward-level extension officers** (modelled on Ol Kalou ward, Nyandarua, Kenya — two named officers, a cluster
  of six potato households): they clear a weekly queue of cited drafts instead of cross-checking every plot by hand.
* **Smallholder households**: they receive timely, officer-approved *plant / spray / irrigate / hold* advice on
  their existing channel (SMS, USSD, or a visit note).
* **County agricultural offices / ministries**: they get an extensible, on-prem-capable platform — a new crop is
  a YAML profile, a new data source is an MCP adapter, and household records never have to leave the country.

## 4. Architecture

One FastAPI process serves the MCP server (streamable HTTP at `/mcp/`), the REST bridge the browser uses
(`/api/*`), and the built console (`web/dist`) at `/`. The REST handlers call the same audit-logged tool
functions the MCP server exposes; the agent always goes through MCP over HTTP (loopback) so its calls are real
MCP calls.

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

A full Mermaid version for uploads and slides lives at [docs/architecture.mmd](docs/architecture.mmd). See
[ARCHITECTURE.md](ARCHITECTURE.md) for the one-page rationale.

## 5. Setup / installation

Needs **[uv](https://docs.astral.sh/uv/)** and **Node ≥ 20**. Nothing else is required: with no model configured
the agent still runs end to end on the deterministic template drafter (clearly labelled), and rainfall is pulled
live from Open-Meteo (no key).

```bash
git clone <this repo> && cd version1
uv venv .venv               # create the project virtualenv (run.sh reuses it if present)
source .venv/bin/activate   # start the virtualenv
```

`./run.sh` then installs the Python package, seeds the demo twin, builds the console, and serves it — see
[Usage](#6-usage-instructions) for the actual run commands.

Manual install without `run.sh`:

```bash
uv venv .venv
source .venv/bin/activate
uv pip install --python .venv/bin/python -e ".[dev]"
cd web && npm install && npm run build
.venv/bin/python scripts/seed.py
```

Copy `.env.example` to `.env` to configure the model backend and server. Everything is optional. Key switches:
`AGRITWIN_MODEL_PROVIDER` (auto | ollama | openrouter | anthropic | template), `OLLAMA_MODEL`,
`OPENROUTER_API_KEY`, `AGRITWIN_LIVE_WEATHER`, `AGRITWIN_TODAY` (pin the demo date),
`AGRITWIN_PROFILE_DIRS` (your own crop profiles).

### Deploy on AWS (Lightsail Container Service)

One container serves the console, `/api` and `/mcp` (see `Dockerfile`). Needs `docker`, `aws` CLI v2 with
credentials, and an OpenRouter key (free tier — set `AGRITWIN_MODEL_PROVIDER` differently in
`scripts/deploy-lightsail.sh` if you want the template drafter instead).

```bash
export OPENROUTER_API_KEY=sk-or-...      # free key from openrouter.ai/keys
export AWS_REGION=us-east-1              # any Lightsail region (deep-link below)
./scripts/deploy-lightsail.sh            # builds, pushes, deploys, waits, prints the https URL
```

Notes: single node (`scale 1`) is required — run state, the SSE bus and the officer gate live in memory, and
the gates are passed by `MemorySaver`; the disk is ephemeral (the twin re-seeds on boot) and the service bills
~$10/mo (Micro) until `aws lightsail delete-container-service --service-name agritwin` is run. Health check:
`GET /api/health`.

## 6. Usage instructions

### How to run (one command)

```bash
./run.sh                    # installs, seeds the demo twin, builds the console, serves http://127.0.0.1:8000
```

Then open **http://127.0.0.1:8000**, go to the twin, click plot **B2**, open the *Advisory* tab and press
*Draft advisory*. Approve it as *Amina Wekesa* on the gate. Try **B3** (offline probe → refused) and **A3**
(blight weather → spray; reject with a reason).

### Drafting with an open-weights model (recommended — the required open-weights run)

```bash
# on-prem: Ollama, household data never leaves the machine
ollama pull qwen3:8b            # or qwen3:4b on a CPU-only laptop
./run.sh                        # auto-detects Ollama

# or hosted open-weights (Gemma 4 / Nemotron 3 on OpenRouter's free tier)
echo 'OPENROUTER_API_KEY=sk-or-...' >> .env && ./run.sh
```

`auto` picks Ollama if it is up (any pulled chat model counts; `OLLAMA_MODEL` is only a preference), then
OpenRouter if a key is set, then the template drafter. The health chip in the console and the `drafter` field on
every advisory say which one actually ran. A note on speed: the drafting prompt is ≈1.2k tokens plus the tool
schema; on a GPU a draft takes seconds, on a busy 4-core CPU laptop Qwen3-4B needs several minutes per plot, so
for interactive demos use a GPU, a hosted open-weights endpoint, or the template drafter.

### Other entry points

```bash
make test                                   # 23 tests: rule engine, tool contracts, MCP over an in-memory session, LLM draft loop (fake model)
make evals                                  # 12 end-to-end tasks → EVALS.md
.venv/bin/agritwin-agent --plot B2          # the agent in a terminal, tool calls printed, officer prompt at the gate
.venv/bin/agritwin-mcp                      # the MCP server alone (stdio) for Claude Desktop / Goose / your agent
```

The demo video follows [DEMO_SCRIPT.md](DEMO_SCRIPT.md): one unedited run (B2 irrigate/hold → approve, B3 stale
probe → refused, A3 blight → reject), the `/desk` audit timeline, and the `make evals` table.

## 7. Technology stack

| Layer | Choice |
|---|---|
| Agent / orchestration | Python, LangGraph (+ `langgraph-checkpoint-sqlite`), `langchain-*` |
| MCP | FastMCP (`mcp>=1.10,<2`), `langchain-mcp-adapters` |
| API / server | FastAPI, Uvicorn, `sse-starlette`, Pydantic, `httpx` |
| LLMs | Ollama (Qwen3) on-prem · OpenRouter (Gemma 4 / Nemotron 3) · Anthropic (frontier comparison) · deterministic template drafter |
| Data | SQLite twin store, JSONL audit log, Open-Meteo (free weather API, no key), borrowed `chuk-mcp-open-meteo` (IBM, PyPI) |
| Console | Vite + React + React Three Fiber, SSE event stream |
| Tests / evals | pytest, `ruff`, scripted eval runner (`evals/run_evals.py`, 12 tasks) |

## 8. Agent architecture

For one plot the agent (`agritwin/agent/graph.py`) runs a fixed LangGraph plan with autonomy inside the steps:

1. **gathers** the plot's twin state, the farm's rainfall history + forecast and the zone's pest alerts through
   our MCP server, plus a second forecast opinion from the **borrowed** Open-Meteo MCP server; each call is
   retried once, and a farm with no rainfall triggers an ingestion attempt;
2. **cross-checks** them with the deterministic, versioned crop-profile rule engine (`check_advisory_rules`) —
   the only source of numbers; every finding carries `field → value → source → observedAt` citations;
3. **drafts** one SMS-length advisory with an open-weights model, which must file it through `draft_advisory`;
   the server rejects unsourced numbers, the model corrects itself, and if it keeps failing the template drafter
   files it instead (labelled);
4. **stops** at a LangGraph `interrupt()` until a **named officer** approves or rejects from the console;
5. **finalises**: approve → a *simulated* dispatch on the household's channel is logged and a follow-up
   scheduled; reject → the reason is logged, nothing is sent. Stale or missing data → the plot is flagged, no
   advisory exists.

Two drafting modes share the same `file_draft → draft_advisory` path: hosted models use native tool calls; small
local models (Qwen3-4B class) tend to narrate instead of calling tools, so for them the draft step asks for one
JSON object under a schema (Ollama structured output) and the graph files it — same guard, same retries, same
audit trail. The officer chat (Ask tab) is a read-mostly ReAct agent over the same tools.

Every tool call, from the agent or the officer, is in the audit log (table + `data/audit.jsonl`) with inputs,
outputs, timestamps and actor, and streams live into the console.

## 9. MCP implementation

The agent never touches the database directly — every read and every state change goes through Model Context
Protocol tools:

* The agent talks to our AgriTwin server over **streamable HTTP on loopback** (real MCP, real sessions, visible
  in the audit log as actor `agent` with the run id), and to the borrowed weather server over **stdio**.
* The console's REST calls hit the **same tool functions** as actor `human:<officer>` / `api`, so officer
  actions and agent actions share one audited code path.
* Tools are plain audit-logged Python functions; the FastMCP server wraps them with annotations (the gate tool
  carries a destructive hint and is human-only).
* The same server mounts at `/mcp/` beside `/api/*` in the single FastAPI process, and stdio mode
  (`agritwin-mcp`) lets any MCP client (Claude Desktop, Goose, your own agent) mount and reuse the tools without
  our agent — see [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md) and [docs/EXTENDING.md](docs/EXTENDING.md).

## 10. MCP tools / servers

| Server | Built / borrowed | Role |
|---|---|---|
| **AgriTwin** (`agritwin/mcp_server`) — 21 tools, 4 resources, 1 prompt | **Built** | The processing layer and only gateway to the twin store: ingestion (`register_farm`, `ingest_plot_readings`, `ingest_weather` — the Open-Meteo HTTP call lives *inside* this server as an adapter), evidence reads, the rule engine (`check_advisory_rules`), actions (`draft_advisory`, `flag_plot`, `schedule_follow_up`) and the gate (`record_officer_decision`, human only) |
| **chuk-mcp-open-meteo** (IBM, PyPI) | **Borrowed** | Second-opinion 3-day forecast over stdio during `gather`; cited in the officer reasoning as agreement/disagreement, never as a number in the household message |

Key tools: `get_plot`, `get_climate_signals`, `get_pest_alerts`, `check_advisory_rules` (deterministic),
`draft_advisory` (numeric citation guard), `flag_plot`, `schedule_follow_up`, `record_officer_decision` (gated).
Full reference: [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md).

## 11. Human-in-the-loop workflow

1. The agent drafts per plot and writes each draft to the officer's queue — it contacts no one.
2. The officer opens the plot in the twin (same evidence the agent saw), reads the drafted advisory with its
   citation list (`field → value → source → observedAt`), and the run trace.
3. The officer **approves** (names themselves; a labelled *simulated* SMS/USSD/visit dispatch is logged and a
   follow-up scheduled) or **rejects** (a reason is required; it is logged; nothing is sent).
4. Technically the gate is a LangGraph `interrupt()`: the run is checkpointed and nothing downstream can execute
   until a human response resumes it — `record_officer_decision` is structurally unreachable by the LLM
   unattended.

## 12. Limitations

* **Plot values are synthetic**, on the real `farmSensor`/`farmZone` schema shape (soil chemistry, moisture,
  NDVI, growth stage, 7-day series). Six plots, six households, one ward office with two officers.
* **Rainfall is live** from Open-Meteo for the farm's coordinates; when the demo date is pinned
  (`AGRITWIN_TODAY`, used by the evals) a CHIRPS-shaped seeded cache is used instead so results are reproducible.
* **Pest bulletins are synthetic**, shaped like a county plant-health alert.
* **Dispatch is simulated.** This software never sends a message to a farmer; the decision record says so.
* The agronomic thresholds are rules of thumb for highland potato (plus a maize profile proving the engine is
  crop-agnostic). They are versioned and cited, and they are not a substitute for a local agronomist's calendar.
* One seeded farm — registering more works, but new plots have no readings until something ingests them. The
  borrowed forecast informs officer reasoning only; rule-engine disagreements are reported, not resolved. The
  full 12-task LLM sweep and the frontier-model comparison were not run on our GPU-less laptop (see EVALS.md).

## 13. Future improvements

* **Real dispatch**: Africa's Talking SMS/USSD behind the same officer gate; the approval record becomes the send
  receipt. Inbound household replies as a new ingestion adapter.
* **Live plot ingestion**: county soil-lab results and low-cost probes as AgriTwin data adapters, replacing the
  synthetic plot values.
* **More crop profiles**: maize and beans rule profiles on the same MCP server; officers pick the profile per farm.
* **In-country inference**: Ollama on a ministry server with the same open-weights model; the twin never leaves
  the country.

## 14. Other

Repository map:

| Path | What |
|---|---|
| `agritwin/mcp_server/` | **Our MCP server**: `tools.py` (21 audit-logged tools), `server.py` (FastMCP: tools, resources, prompt, annotations) |
| `agritwin/rules/` | Rule engine, crop profiles (`profiles/potato.yaml`, `maize.yaml`), citation guard, template drafter |
| `agritwin/ingest/` | Ingestion adapters: fixture seeding, **Open-Meteo** (the external API lives inside the server) |
| `agritwin/agent/` | LangGraph graph, MCP client (our server over HTTP + borrowed over stdio), model switch, officer chat, CLI |
| `agritwin/api/` | FastAPI bridge: REST + SSE for the console, mounts the MCP server at `/mcp/`, serves `web/dist` |
| `web/` | The console: React + Three.js farm twin, Advisory tab, `/desk` queue + audit timeline |
| `evals/` | `tasks.yaml` (12 tasks) and the runner that writes EVALS.md |
| `tests/` | pytest suite (23 tests) |
| `docs/API_CONTRACT.md`, `docs/EXTENDING.md`, `docs/MCP_TOOLS.md`, `docs/architecture.mmd` | Console ↔ backend contract; how to add crops, data sources, rules; tool reference; architecture diagram |

Licence: MIT — see [LICENSE](LICENSE) (© 2026 FarmVerse contributors). Built during the submission period on top of our own earlier farm-twin front end (the 3D scene, panels and design system); everything agentic — the MCP server, rule engine, agent, gate, audit, evals — is new.
