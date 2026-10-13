# Demo video script (< 3 minutes, one unedited run, tool calls on screen)

Record the screen at 1080p. Terminal on the left (`./run.sh` already running), browser on the right at
`http://127.0.0.1:8000`. No slides. Keep the audit timeline visible when the agent runs.

| t | On screen | Say |
|---|---|---|
| 0:00 | Landing page, scroll one screen | "This is Advisory Desk: an extension office's farms as digital twins, an agent that drafts cited climate-smart advisories, and an officer who approves every one. Nothing goes to a farmer without a name on it." |
| 0:20 | `/twin` — farm switcher, click plot **B2 South Slope** | "One demo cluster, six households. B2 is dry: 13.2% soil moisture during tuber initiation. Last season the answer was 'irrigate now'." |
| 0:35 | Advisory tab → **Draft advisory** | "Watch the tool calls: get_plot, get_climate_signals, get_pest_alerts on our AgriTwin MCP server, then a second forecast opinion from IBM's Open-Meteo MCP server…" |
| 0:55 | Trace shows `check_advisory_rules` → draft card | "…the rule engine says HOLD, not irrigate — 21.5 mm is forecast in three days — and the model phrases it. Every number has a citation: field, value, source, timestamp." |
| 1:15 | Decision form: pick officer, **Approve** | "The run is paused at a LangGraph interrupt. I'm Amina, the ward officer. Approve — and the dispatch is simulated and says so. A follow-up is scheduled." |
| 1:35 | Click plot **B3 Seedbed West** → Draft advisory | "B3's probe has been offline for three days. The agent refuses to draft on stale readings and flags the plot instead. That's the failure we want." |
| 1:55 | Click **A3 East Valley** → Draft → **Reject** with reason | "Blight weather on A3: 92% humidity, 14 mm of rain. Spray window. I visited yesterday and the farmer sprayed — reject, with a reason. Nothing is sent, the reason is logged." |
| 2:20 | `/desk` — Audit timeline | "Every call: timestamp, actor — agent or human — inputs, outputs. The model is open-weights; here it ran Gemma 4 on OpenRouter; on-prem it's Qwen via Ollama." |
| 2:40 | Terminal: `make evals` output or EVALS.md table | "Twelve scripted tasks, run-to-run variation measured, one failure left in on purpose. Repo, MIT, one command." |
| 2:55 | Landing "what is real" section | "Plot values are synthetic on a real schema; rainfall is live; dispatch is simulated. Thank you." |

Fallback if the network is down: run `AGRITWIN_LIVE_WEATHER=0 ./run.sh` (seeded rainfall cache) and
`AGRITWIN_MODEL_PROVIDER=template` — the console labels both.
