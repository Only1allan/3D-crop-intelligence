# Submission — Crop Intelligence · Advisory Desk

**Theme:** Climate-smart advisory.
**Office and workflow served:** a ward-level agricultural extension office (modelled as the Ol Kalou ward desk in
Nyandarua, Kenya — two named officers, a cluster of six potato households) and its weekly task of turning rainfall,
pest and plot signals into household-level plant / spray / irrigate / hold advice.

## Description (~300 words)

Extension officers already have the signals — a rainfall update, a 6 a.m. pest alert in a WhatsApp group, a lab
sheet from last month's visit — and a few hundred plots to apply them to. Cross-checking all of it by hand takes
about fifteen minutes per household cluster, and the advice is often stale by the time it goes out.

Advisory Desk gives the office a digital twin per farm (plots, households, soil and crop readings, zone rainfall,
pest bulletins) and an agent that does the cross-checking: for a plot it gathers the twin state, the rainfall
history and forecast and the active alerts, runs them through a versioned crop-calendar rule engine, and drafts
one SMS-length advisory in plain language — *hold irrigation, 21.5 mm is forecast in three days*; *late-blight
weather, spray within 24 hours*; *season onset confirmed, plant this week*. Every number in the draft is cited back
to the reading, the forecast or the rule it came from, and the server refuses drafts that are not.

Then it stops. The draft lands in the officer's queue. A named officer approves (a simulated SMS/USSD/visit
dispatch is logged) or rejects with a reason; nothing reaches a household otherwise. If a probe is offline or the
farm has no rainfall signal, the agent flags the plot instead of guessing.

Under the hood: our own MCP server, **AgriTwin**, is the processing layer and the only gateway to the data —
ingestion (including the Open-Meteo weather call), the rule engine, drafting and the officer gate are all tools a
stranger can reuse from any MCP client, and new crops are a YAML file away. A LangGraph agent plans, calls the
tools over MCP, recovers from failures and self-corrects when the citation guard rejects a draft. An IBM
Open-Meteo MCP server provides a second forecast opinion. Drafting runs on open-weights models (Qwen via Ollama
on-prem, or Gemma 4 / Nemotron 3 on OpenRouter), because household records should not leave the country.

The console keeps the 3D plot twin from our earlier work, now pointed at the officer: click a plot, see the
evidence, read the draft, decide — and watch every tool call in the audit timeline.

## Links

* Repository: (public URL after push) — MIT licence, `./run.sh` runs everything.
* Demo video: (YouTube/Vimeo URL) — one unedited run, see DEMO_SCRIPT.md.
* ARCHITECTURE.md, EVALS.md in the repository root.
