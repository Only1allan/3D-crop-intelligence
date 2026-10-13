# PLAN.md — Pivoting "Omniverse Crop Intelligence" (v0) into the Climate-Smart Advisory Agent (v1)

Status: planning document, not yet code. Source of truth for scope —
update it as decisions change.

---

## 1. The pivot, stated plainly

v0 is a 3D farm twin where a **farmer** clicks a plot and chats with an
AI advisor that answers from that plot's data.

v1 is the same plot-level intelligence, but the audience flips: it's an
**extension officer** managing many households' plots, and the agent
doesn't chat back-and-forth with anyone — it proactively drafts a sourced
advisory per plot and puts it in the officer's queue. The officer
approves or rejects. Nothing reaches a household either way without that
click.

That's the obvious, correct pivot, and it means most of v0 ports
directly:

| Carries over almost unchanged | Why |
|---|---|
| `web/src/data/zones.js` — the plot record shape (soil, weather, crop signals, agronomy, 7-day series) | A household's plot *is* a zone. Add `householdId`, `contactMethod`, `officerNotes`. Nothing else in the shape changes. |
| `web/src/lib/offline.js` — the moisture/pH/blight/NDVI threshold logic | This *is* the plant/spray/hold rule engine the brief wants. It already returns reasoned, number-backed text. |
| `web/src/lib/rag.js` — `zoneCard()`, `retrieve()`, citation-style formatting | This already turns a plot record into a sourced text chunk. It becomes the "gather evidence" step almost line-for-line. |
| The 3D twin, `Plot.jsx`, `ZonePanel.jsx`, `Sparkline.jsx`, `PhGauge.jsx` | Officer still wants to click a plot and see its numbers. Keep it — just reframe the copy from "ask your farm" to "review the agent's evidence." |
| `web/src/lib/llm.js` — the OpenRouter model-fallback chat call | Becomes the LLM call *inside* the agent loop, now fed tool results instead of a stuffed system prompt. |

| Genuinely new — not a port, mandatory regardless of audience | Why it can't be ported from v0 |
|---|---|
| An actual MCP server | v0 has zero MCP servers. The browser calls OpenRouter directly (`lib/llm.js`). This is the track's first eligibility line. |
| A borrowed MCP server | Doesn't exist in v0 at all. |
| Real tool-calling orchestration (LangGraph etc.) | v0 makes one model call with context pasted into the prompt — no planning, no tool calls, no recovery. The brief explicitly disqualifies exactly this pattern ("a chatbot wrapper with no autonomous tool use"). Changing the audience doesn't change this fact. |
| The approval gate + audit log | v0 has no human-in-the-loop step and no log at all — it answers immediately. This is the brief's one non-negotiable rule, and it has to be built regardless of who's on the other end of the chat. |

So the plan is: **port the data and logic, build the thin agent/MCP
layer underneath it that v0 never had, flip the UI's job from
answering questions to presenting drafts for approval.**

---

## 2. Product framing

**Who it's for:** a two-to-three-person local agricultural extension
office covering several agroclimatic zones and many smallholder
households growing maize or potato.

**The loop, per plot:**
1. Agent pulls the plot record (ported `zones.js` shape) and the zone's
   rainfall/forecast (via the borrowed weather MCP) and active pest
   alerts.
2. Agent runs those through the rule engine (ported `offline.js` logic)
   to get a candidate action — **plant / spray / hold / no action** —
   with the exact numbers behind it.
3. Agent drafts a short, plain-language advisory from that output,
   citing every number back to its source (ported `rag.js` citation
   style).
4. **Stops.** Writes the draft to the officer's queue. Contacts no one.
5. Officer opens the plot (same 3D/`ZonePanel` view as v0, repurposed),
   reads the drafted advisory and its citations, and **Approves**
   (names themselves, logs a simulated SMS/USSD dispatch) or **Rejects**
   (logs a reason, nothing sent).

**UI change in one sentence:** `ChatPanel.jsx` (farmer asks, AI answers)
becomes `AdvisoryPanel.jsx` (agent already answered, officer approves).
The free-text question box goes away; an Approve/Reject control and a
citation list take its place. The tool-call log streams underneath it —
that log is also the demo footage.

**Working name:** keep "Crop Intelligence" lineage, subtitle it for the
new audience, e.g. *Crop Intelligence — Advisory Desk*. Not load-bearing.

**Data assumption (stated honestly in the README, as v0 already did):**
same Kenyan-highlands maize/potato synthetic fixture, now carrying a
`householdId` per plot and an officer-visible feed of pest alerts and
rainfall per zone.

---

## 3. Scope for 5 days

**In scope:**
- Our MCP server, 6 tools, one of which acts (§5).
- One borrowed MCP server for weather (§5.4).
- One agent graph (LangGraph) doing real multi-tool calls, with a hard
  interrupt before the one irreversible step.
- One open-weights model run end-to-end (Ollama); one frontier-model
  comparison run for `EVALS.md` only.
- The ported web app with `ChatPanel` → `AdvisoryPanel`, plus a queue
  view and an audit-log view.
- 8–10 scripted eval tasks against the fixed fixture.

**Cut entirely (single theme — climate-smart advisory):** price/market
theme, credit/input theme, traceability theme, real SMS/USSD delivery
(simulated + logged + labelled as simulated instead), real satellite
NDVI ingestion (synthetic on the real shape, same as v0), multi-officer
auth.

---

## 4. Data model (extends `zones.js`, doesn't replace it)

```js
// Same shape as v0's ZONES entries, plus:
{
  zoneId, displayName, grid, status, source, lastUpdateTime,
  atmosphere, soil, soilPH, crop, agronomy, series, insight,  // unchanged from v0

  householdId: 'H-014',            // new
  householdName: 'Wanjiru family', // new
  contactMethod: 'sms',            // new — sms | ussd | visit
}

Advisory {               // new — created by draft_advisory
  advisoryId, householdId, zoneId, action,      // plant | spray | hold | none
  reasoning,                                     // plain text, from the rule engine's output
  citations: [{ field, value, source, fetchedAt }],
  status: 'draft' | 'approved' | 'rejected',
  createdAt
}

Decision {               // new — created by log_officer_decision
  advisoryId, officerName, decision, reason, decidedAt,
  dispatch: { simulated: true, channel, sentAt } | null
}
```

`PestAlert` and `RainfallSignal` are new small records (zone-keyed),
fed by the weather MCP and a synthetic regional pest feed shaped like a
real bulletin.

---

## 5. MCP server — tool-by-tool (ports v0 logic into tools)

Built with the MCP TypeScript SDK, so `offline.js`'s and `rag.js`'s
functions can be imported into tool handlers nearly as-is instead of
being rewritten in another language.

| # | Tool | Type | Ports from v0 |
|---|---|---|---|
| 1 | `get_household_plot(household_id)` | read | `zones.js` lookup |
| 2 | `get_pest_alerts(zone_id)` | read | new (small synthetic feed) |
| 3 | `check_advisory_rules(zone_id, rainfall_signal)` | read | **`offline.js`'s threshold functions**, refactored to return `{action, reasoning, citations}` instead of a chat string |
| 4 | `list_pending_advisories(officer_id)` | read | new |
| 5 | `draft_advisory(...)` | **act** | new — formats the rule engine's output using `rag.js`'s citation style, writes an `Advisory` row |
| 6 | `log_officer_decision(...)` | **act, gated** | new — the human-in-the-loop checkpoint; only reachable after the agent graph's `interrupt()` resumes with a real officer response |

### 5.4 Borrowed MCP server — weather

An existing Open-Meteo MCP server (community implementations on GitHub,
e.g. `BouazizOmar/open-meteo-mcp`, `gbrigandi/mcp-server-openmeteo`; pick
whichever has the cleanest forecast + historical surface once tested
against our zone list on day 2). **Why borrow:** it already handles
geocoding, units, and forecast/historical endpoints with no API key —
rebuilding that teaches the judges nothing about our agent and burns
hours better spent on the rule engine.

---

## 6. Orchestration

LangGraph, one graph per plot:

```
gather_signals (get_household_plot, get_pest_alerts, weather MCP)
      ↓
cross_check (check_advisory_rules — the ported rule engine)
      ↓
draft (LLM phrases the draft from the rule engine's output; calls draft_advisory)
      ↓
await_officer — interrupt(); graph pauses until Command(resume=...) carries
                the officer's real decision from the console
      ↓
finalize (log_officer_decision; on approve, logs simulated dispatch)
```

Mixed-language MCP (TS server, Python/LangGraph agent) is itself a small
proof point worth stating plainly in `ARCHITECTURE.md`: this is the
exact thing MCP is for — "you write a small server, any agent can call
its tools," regardless of language.

Recovery: a failed signal call retries once, then routes to a
`missing_data` terminal — **no advisory is produced** rather than one
with a guessed number. This is what keeps the "unsourced recommendation
is worse than none" rule true in code, not just in intent.

---

## 7. Model

- **Primary (required):** a small Qwen 3.x instruct model (8B class) via
  **Ollama** — current tool-calling leaderboards put Qwen's small
  instruct tier near the top of open-weights options, and it's realistic
  to run on hackathon hardware. Framed honestly as the right call
  because household/plot data shouldn't leave the country, not as a
  performance claim.
- **Frontier comparison (optional):** same fixed task set, once, against
  a frontier model, written up as a gap — not hidden — in `EVALS.md`.
- Model choice sits behind one config value.

---

## 8. Logging & the gate (the part v0 never had)

Every tool call — read or act — appends one line to an append-only JSONL
log before returning: timestamp, tool, input, output, actor. The
console's audit view renders this as a readable per-plot timeline, and
*that view scrolling during a real run* is the demo video.

`log_officer_decision` is never callable by the LLM unattended — the
graph's `interrupt()` makes it structurally unreachable until a human
response resumes the run. Reject logs the reason and stops; nothing
downstream fires.

---

## 9. UI changes (what actually moves in the React app)

- `twin/ChatPanel.jsx` → `twin/AdvisoryPanel.jsx`: free-text question box
  removed; shows the drafted action, reasoning, and citation list with
  Approve (officer name field + confirm) / Reject (reason field) below
  it.
- New `twin/QueueView.jsx`: list of plots with a pending draft, across
  households — the officer's actual day-to-day screen.
- New `twin/AuditView.jsx`: the JSONL log rendered per plot.
- `Landing.jsx` copy changes from farmer-facing ("ask your farm anything")
  to officer-facing ("one queue, every plot, sourced"). Everything else
  in `landing/` stays.
- `Plot.jsx`, `ZonePanel.jsx`, `Sparkline.jsx`, `PhGauge.jsx`, 3D scene:
  unchanged in function, reused as the evidence view behind each queue
  item.

---

## 10. Repository layout

```
version1/
  README.md / LICENSE (MIT) / ARCHITECTURE.md / EVALS.md / SUBMISSION.md
  mcp_server/            # TypeScript, MCP SDK — tools in §5, importing
    tools/                 ported offline.js / rag.js logic directly
    rules/
    store.ts
    log.ts
  weather_mcp/           # vendored + attributed
  agent/                 # Python, LangGraph graph from §6
    graph.py
    models.py            # Ollama + frontier switch
  web/                   # ported from version0/.../web, pruned of the
    src/twin/AdvisoryPanel.jsx   # chat UI; AdvisoryPanel/QueueView/AuditView added
    src/twin/QueueView.jsx
    src/twin/AuditView.jsx
    src/data/zones.js    # extended with householdId etc.
  fixtures/
  evals/
  tests/
```

---

## 11. Build plan (7-day schedule)

- **Day 1:** Fork `web/` and `zones.js`/`offline.js`/`rag.js` into
  `version1`, extend the fixture with `householdId`/pest alerts, confirm
  the rule-engine port still passes the same scenarios v0 relied on.
- **Days 2–3:** MCP server (6 tools wrapping the ported logic), pick +
  vendor the weather MCP, LangGraph graph end-to-end against a stub LLM.
  "Paper prototype" milestone: one full run, terminal output only.
- **Days 4–5:** Swap in the real open-weights model via Ollama. Build
  `AdvisoryPanel`/`QueueView`/`AuditView`, wire `interrupt()` →
  `Command(resume=...)` to the UI's Approve/Reject. "Stress test"
  milestone: a mentor/officer picks a household live.
- **Day 6:** `ARCHITECTURE.md`, `EVALS.md` (all 8+ tasks run for real,
  one left honestly broken), demo video as one real run, README.
- **Day 7:** Submit.

---

## 12. Evaluation sketch (`EVALS.md`)

Same scenarios v0's threshold logic already covers, now run through the
agent end-to-end and checked for the *drafted advisory*, not a chat
answer:

1. Plant-window match → correct "plant," cited.
2. Dry spell at tuber initiation → "hold/irrigate" (v0's South-Slope
   case).
3. High humidity + falling NDVI → "spray," blight-cited.
4. Healthy plot → "no action" (agent must say so, not invent work).
5. Missing/stale rainfall → refuses to recommend, says why.
6. Pest alert active but not applicable to this plot's crop/stage →
   cited as not-applicable, not silently dropped.
7. Officer rejects a correct-looking draft → reason logged, nothing
   dispatched.
8. Same rainfall signal, two households, different planting dates →
   different actions (proves it's not just echoing zone-level data).
9. Weather MCP timeout → retries once, fails closed to `missing_data`.
10. (Stretch) Open-weights vs frontier on one ambiguous case — documented
    gap, not hidden.

Plus one honestly unfixed failure with a concrete next step, as required.

---

## 13. Judging-criteria map

| Criterion (pts) | Covered by |
|---|---|
| Agentic depth & MCP craft (30) | Real multi-tool LangGraph plan + retry/recovery; mixed-language MCP (TS tools, Python agent) as a genuine demonstration of the protocol's point. |
| Open-source rigour (20) | MCP SDK + LangGraph + Ollama, MIT licence, one-command README, honest about what's simulated/synthetic. |
| Fit to farming cycle (20) | Officer queue modelled directly on the brief's own "15 minutes by hand" description; mentor stress-test milestone. |
| Evaluation & reliability (15) | Fixed fixture, 10 scripted tasks incl. missing-data and rejection paths, one disclosed failure. |
| Defensibility (10) | Rule engine (ported, unit-tested) is the only source of numbers; every advisory carries field→value→source citations. |
| Demo (5) | The audit-log view scrolling during a real run *is* the footage. |

---

## 14. Open questions

- **Team roles** — who owns the MCP server/tools vs the agent graph vs
  the UI port, so Days 2–3 run in parallel.
- **Weather MCP pick** — shortlist in §5.4; decide day 2 after testing
  both against the zone list.
- **Exact submission dates** — brief says "Opens TBC, closes TBC"; update
  §11 once announced.

---

*`version0/` stays as-is, untouched. `version1/` forks forward from it
rather than starting from a blank schema.*
