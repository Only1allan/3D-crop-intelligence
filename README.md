# Crop Intelligence · Advisory Desk

**An extension office's farms as digital twins. An agent that drafts cited, climate-smart advisories. A named
officer who approves every one before anything reaches a household.**

Built for the *Agentic advisory for local agricultural offices* track, theme **Climate-smart advisory**. The
office served is a ward-level extension desk (modelled on Ol Kalou ward, Nyandarua, Kenya) and the job is the
weekly one: turn rainfall, pest and plot signals into *plant / spray / irrigate / hold* advice per household,
without the officer cross-checking every plot by hand.

```
signals in ──► AgriTwin MCP server (ingest · rules · draft · gate) ──► LangGraph agent ──► officer approves ──► simulated SMS/USSD/visit
```

## Run it (one command)

Needs **[uv](https://docs.astral.sh/uv/)** and **Node ≥ 20**. Nothing else is required: with no model configured the
agent still runs end to end on the deterministic template drafter (clearly labelled), and rainfall is pulled live
from Open-Meteo (no key).

```bash
git clone <this repo> && cd version1
./run.sh                    # installs, seeds the demo twin, builds the console, serves http://127.0.0.1:8000
```

Then open **http://127.0.0.1:8000**, go to the twin, click plot **B2**, open the *Advisory* tab and press
*Draft advisory*. Approve it as *Amina Wekesa* on the gate. Try **B3** (offline probe → refused) and **A3** (blight
weather → spray; reject with a reason).

To use an open-weights model for drafting (recommended — this is the required open-weights run):

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

Other entry points:

```bash
make test                                   # 23 tests: rule engine, tool contracts, MCP over an in-memory session, LLM draft loop (fake model)
make evals                                  # 12 end-to-end tasks → EVALS.md
.venv/bin/agritwin-agent --plot B2          # the agent in a terminal, tool calls printed, officer prompt at the gate
.venv/bin/agritwin-mcp                      # the MCP server alone (stdio) for Claude Desktop / Goose / your agent
```

## What it does

For one plot the agent (`agritwin/agent/graph.py`):

1. **gathers** the plot's twin state, the farm's rainfall history + forecast and the zone's pest alerts through our
   MCP server, plus a second forecast opinion from a **borrowed** Open-Meteo MCP server (IBM's
   `chuk-mcp-open-meteo`); each call is retried once, and a farm with no rainfall triggers an ingestion attempt;
2. **cross-checks** them with a deterministic, versioned crop-profile rule engine (`check_advisory_rules`) — the
   only source of numbers; every finding carries `field → value → source → observedAt` citations;
3. **drafts** one SMS-length advisory with an open-weights model, which must file it through `draft_advisory`;
   the server rejects unsourced numbers, the model corrects itself, and if it keeps failing the template drafter
   files it instead (labelled);
4. **stops** at a LangGraph `interrupt()` until a **named officer** approves or rejects from the console;
5. **finalises**: approve → a *simulated* dispatch on the household's channel is logged and a follow-up scheduled;
   reject → the reason is logged, nothing is sent. Stale or missing data → the plot is flagged, no advisory exists.

Every tool call, from the agent or the officer, is in the audit log (table + `data/audit.jsonl`) with inputs,
outputs, timestamps and actor, and streams live into the console.

## Repository map

| Path | What |
|---|---|
| `agritwin/mcp_server/` | **Our MCP server**: `tools.py` (21 audit-logged tools), `server.py` (FastMCP: tools, resources, prompt, annotations) |
| `agritwin/rules/` | Rule engine, crop profiles (`profiles/potato.yaml`, `maize.yaml`), citation guard, template drafter |
| `agritwin/ingest/` | Ingestion adapters: fixture seeding, **Open-Meteo** (the external API lives inside the server) |
| `agritwin/agent/` | LangGraph graph, MCP client (our server over HTTP + borrowed over stdio), model switch, officer chat, CLI |
| `agritwin/api/` | FastAPI bridge: REST + SSE for the console, mounts the MCP server at `/mcp/`, serves `web/dist` |
| `web/` | The console: React + Three.js farm twin (from our v0 work), Advisory tab, `/desk` queue + audit timeline |
| `evals/` | `tasks.yaml` (12 tasks) and the runner that writes EVALS.md |
| `tests/` | pytest suite |
| `docs/API_CONTRACT.md`, `docs/EXTENDING.md` | Console ↔ backend contract; how to add crops, data sources, rules |
| `ARCHITECTURE.md`, `EVALS.md`, `SUBMISSION.md`, `DEMO_SCRIPT.md` | Submission documents |

## Honest about the data

* **Plot values are synthetic**, on the real `farmSensor`/`farmZone` schema shape our v0 twin used (soil chemistry,
  moisture, NDVI, growth stage, 7-day series). Six plots, six households, one ward office with two officers.
* **Rainfall is live** from Open-Meteo for the farm's coordinates (`ingest_weather`). When the demo date is pinned
  (`AGRITWIN_TODAY`, used by the evals) a CHIRPS-shaped seeded cache is used instead so results are reproducible.
* **Pest bulletins are synthetic**, shaped like a county plant-health alert.
* **Dispatch is simulated.** This software never sends a message to a farmer; the decision record says so.
* The agronomic thresholds are rules of thumb for highland potato (and a maize profile to prove the engine is
  crop-agnostic). They are versioned and cited, and they are not a substitute for a local agronomist's calendar.

## What is unfinished

* No real SMS/USSD gateway, no inbound replies from households.
* One seeded farm. Registering more farms works (`POST /api/farms`, `register_farm`), but their plots have no
  readings until something calls `ingest_plot_readings`.
* The borrowed forecast is used as a second opinion in the officer reasoning only; the rule engine uses our
  ingested signal. Disagreement is reported, not resolved.
* The officer chat (Ask tab) is a read-mostly ReAct agent; without a model it answers the common desk questions
  from the rule engine.
* The open-weights run was done locally (Qwen3-4B via Ollama, CPU) for one full task and is recorded in EVALS.md;
  the full 12-task sweep on an LLM provider was not run on our GPU-less laptop (`make evals --provider ollama|openrouter`
  does it on better hardware or with a key).
* Frontier-model comparison in the evals requires an Anthropic key and was not run in this submission.

## Configuration

Copy `.env.example` to `.env`. Everything is optional. Key switches: `AGRITWIN_MODEL_PROVIDER`
(auto | ollama | openrouter | anthropic | template), `OLLAMA_MODEL`, `OPENROUTER_API_KEY`, `AGRITWIN_LIVE_WEATHER`,
`AGRITWIN_TODAY` (pin the demo date), `AGRITWIN_PROFILE_DIRS` (your own crop profiles).

## Licence

MIT. Built during the submission period on top of our own earlier farm-twin front end (the 3D scene, panels and
design system); everything agentic — the MCP server, rule engine, agent, gate, audit, evals — is new.
