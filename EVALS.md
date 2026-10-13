# EVALS.md

Twelve end-to-end tasks, each a full agent run (gather → rules → draft → officer gate → finalize) on a fresh,
date-pinned copy of the demo twin with live weather off, followed by a scripted officer decision. Checks are the
behaviours the brief cares about: the right action, the numbers cited, nothing sent without a named officer,
fail-closed on stale or missing data. The task set is in `evals/tasks.yaml`; the runner is `evals/run_evals.py`.

```bash
make evals                                             # provider from .env (auto), 1 repetition, writes this file
.venv/bin/python -m evals.run_evals --provider template --reps 1
.venv/bin/python -m evals.run_evals --provider ollama --reps 3 --write
```

Each repetition reseeds the store, so run-to-run variation can only come from the model (and the network when
the borrowed forecast is on). The runner reports the fraction of repetitions that produced the same action and
rule, and how many distinct message wordings a task produced.

## Tasks

| Task | Scenario | What a pass means |
|---|---|---|
| T01 | B2 dry at tuber initiation, 21.5 mm forecast | `hold` (not irrigate), cites moisture and 3-day forecast, approved → simulated SMS |
| T02 | B2 with no rainfall signal, weather API down | agent tries `ingest_weather`, logs the recoverable failure, then `irrigate` on the plot data alone |
| T03 | A3 blight weather + zone alert | `spray`, cites humidity and rain; officer rejects with a reason → nothing dispatched |
| T04 | A1 healthy but a zone late-blight alert is active | `scout`, not spray; alert cited |
| T05 | A1 with alerts expired | `none` — the agent must not invent work; still cited |
| T06 | B3 probe offline 3 days | no advisory at all; plot flagged |
| T07 | B1 maturing; maize armyworm + late-blight alerts not applicable | `harvest`; both alerts cited as not applicable |
| T08 | A2, same zone rainfall as T01, different plot state | different action (`scout`); lime and nutrient findings present |
| T09 | New farm, unplanted plot, weather API down | ingestion fails, agent refuses to advise planting, flags the plot |
| T10 | Same new farm with zone rainfall | `plant` — onset confirmed; cites 7-day rain and the calendar window |
| T11 | Unknown person tries to approve | refused and logged as a failed call; draft stays draft |
| T12 | Officer rejects without a reason, then with one | first refused, second logged; nothing sent |

## Results

Results blocks below are written by the runner (`--write`). Each block is one provider.

<!-- results:template:start -->
### Provider `template` · model `none (template drafter)` · open-weights: True · 1 repetition(s) · pinned date 2026-09-27 · ran 20261013-133817

| Task | Scenario | Expected | Got (action · outcome) | Pass | Drafter | Calls | Guard retries | ms |
|---|---|---|---|---|---|---|---|---|
| T01 | Dry plot at tuber initiation, 21.5 mm forecast → HOLD irrigation (not irrigate) | outcome, action, primaryRuleId | hold · approved | 1/1 | template | 7 | 0 | 685 |
| T02 | Same plot, no rainfall signal at all → IRRIGATE now (forecast cannot be assumed) | outcome, action, primaryRuleId | irrigate · approved | 1/1 | template | 8 | 0 | 554 |
| T03 | Blight weather (RH 92%, 14.2 mm) + zone alert → SPRAY; officer rejects with a reason → nothing sent | outcome, action, primaryRuleId | spray · rejected | 1/1 | template | 6 | 0 | 670 |
| T04 | Healthy plot but zone late-blight alert → SCOUT, not spray | outcome, action, primaryRuleId | scout · approved | 1/1 | template | 7 | 0 | 494 |
| T05 | Healthy plot, alerts expired → NO ACTION (the agent must not invent work) | outcome, action, primaryRuleId | none · approved | 1/1 | template | 7 | 0 | 351 |
| T06 | Probe offline 3 days → REFUSE to draft, flag the plot instead | outcome | None · no_advisory | 1/1 | None | 5 | 0 | 436 |
| T07 | Maturing plot; maize armyworm alert and late-blight alert are both NOT applicable → HARVEST plan, alerts cited as n/a | outcome, action | harvest · approved | 1/1 | template | 7 | 0 | 524 |
| T08 | Same zone rainfall as T01, different plot state (A2, moisture 24%) → different action (scout), lime noted | outcome, action | scout · approved | 1/1 | template | 7 | 0 | 991 |
| T09 | New farm, unplanted plot, weather API down → agent tries ingestion, fails, and REFUSES to advise planting | outcome | None · no_advisory | 1/1 | None | 6 | 0 | 882 |
| T10 | Same new farm with rainfall copied from the zone → season onset confirmed → PLANT | outcome, action, primaryRuleId | plant · approved | 1/1 | template | 7 | 0 | 907 |
| T11 | Unknown person tries to approve → REFUSED and logged; the draft stays a draft | outcome | hold · draft | 1/1 | template | 5 | 0 | 505 |
| T12 | Officer rejects without a reason → REFUSED; then rejects with a reason → logged, nothing sent | outcome | spray · rejected | 1/1 | template | 6 | 0 | 635 |

**12/12 runs passed.**
<!-- results:template:end -->

<!-- results:ollama:start -->
### Provider `ollama` · model `qwen3:4b` (open-weights, local, CPU-only) · one full task, recorded run

The required "one full task on an open-weights model" was run **locally** on a 4-core laptop with no GPU
(user-space Ollama, Qwen3-4B, JSON structured-output draft mode), pinned date 2026-09-27, seeded rainfall cache.
Full trace: `evals/results/ollama-qwen3-4b-A3-run.log`.

| Task | Got | Pass | Drafter | Guard retries | Model time | Notes |
|---|---|---|---|---|---|---|
| T03 (A3 blight weather → spray; officer rejects with reason) | `spray` · rejected · 11 citations · 227-char SMS | ✓ (outcome, action, rule `potato.blight.spray_window`, humidity + rain cited, nothing dispatched) | llm, attempt 1 | 0 | ≈ 6 min 53 s | prompt ≈1.2k tokens; the box was also running other workloads |

The model's household message: *"Grace, plot A3 'East Valley' (F-001). Late-blight risk is high: humidity 92% at
16.9°C with 14.2mm rain in 24h. Spray a protectant fungicide now and scout lower leaves for dark lesions. Forecast
rain in 24h: 6.1mm (will hold)."* Every figure maps to a citation the rule engine returned; the officer reasoning
correctly notes the two non-applicable alerts and that the borrowed forecast agrees.

What we learned on the way (kept in the code): with native tool calling, Qwen3-4B narrates ("Okay, let's tackle
this…") instead of emitting a tool call and a 45-minute run never filed a draft — hence the JSON structured-output
mode for small local models (`agritwin/agent/graph.py`, `AGRITWIN_DRAFT_MODE`). The full 12-task sweep was **not**
run on this hardware (≈7–10 min per task at ~1 tok/s); run `make evals --provider ollama --reps 3 --write` on a
GPU machine, or `--provider openrouter` with a key, to fill the blocks below.
<!-- results:ollama:end -->

<!-- results:openrouter:start -->
_not run yet_
<!-- results:openrouter:end -->

## A failure we did not fix

**The citation guard is a number-level check, not a meaning-level one.** `draft_advisory` verifies that every
figure in the household message appears in a citation or a cited rule. It cannot tell that a message says
"21.5 mm fell last week" when 21.5 mm is the *3-day forecast* and 26.5 mm is what actually fell — both numbers
are legitimately cited, so the swap passes. `tests/test_rules.py::test_known_gap_guard_accepts_swapped_fields`
pins this: it is a passing test that documents a wrong acceptance, so the gap is measured rather than
remembered. An officer can catch it from the citation list (field → value is right there), which is why the
gate exists, but the guard should catch it first.

What we would try next: make the guard field-aware — map every number in the message to the citation field the
surrounding words refer to (a small pattern table for "fell / forecast / moisture / humidity", then a cheap
second model pass for the rest) and fail the draft on a mismatch — and add an eval task that plants exactly that
swap in a scripted model answer so the fix is regression-tested.

## Other known limits of this evaluation

* The task set is scripted against synthetic plot data; it tests the agent's behaviour, not the agronomy.
* Template-drafter runs are deterministic by construction; they are the baseline, not the claim.
* The frontier-model comparison (`--provider anthropic`) is supported but was not run (no key in this submission).
