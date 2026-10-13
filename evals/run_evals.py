"""Run the evaluation tasks end to end and write results (JSON + a Markdown table for EVALS.md).

    python -m evals.run_evals                      # provider from .env/auto, 1 repetition
    python -m evals.run_evals --provider openrouter --reps 3 --write
    python -m evals.run_evals --provider template  # no LLM: the deterministic baseline

Each task runs on a fresh SQLite copy of the fixture with the demo date pinned and live weather off, so the
only sources of run-to-run variation are the model and the network. Repetitions are reported, not hidden.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

RESULTS = ROOT / "evals" / "results"


def _env_for_run(tmp_db: Path) -> None:
    os.environ["AGRITWIN_DB"] = str(tmp_db)
    os.environ["AGRITWIN_AUDIT_JSONL"] = str(tmp_db.with_suffix(".jsonl"))
    os.environ["AGRITWIN_LIVE_WEATHER"] = "0"
    os.environ.pop("AGRITWIN_FAIL_WEATHER", None)


def _setup(ops: list[dict], today: str) -> dict:
    """Apply scenario setup ops; returns placeholder map (@F2 -> farm id, @F2P1 -> plot id)."""
    from agritwin import db
    from agritwin.mcp_server import tools as T
    ph: dict[str, str] = {}

    def sub(v):
        if isinstance(v, str) and v.startswith("@"):
            return ph.get(v, v)
        if isinstance(v, list):
            return [sub(x) for x in v]
        if isinstance(v, dict):
            return {k: sub(x) for k, x in v.items()}
        return v

    for op in ops or []:
        kind = op["op"]
        if kind == "set_env":
            os.environ[op["key"]] = str(op["value"])
        elif kind == "delete_signals":
            with db.tx() as c:
                c.execute("DELETE FROM rainfall_signals WHERE farm_id=?", (op["farmId"],))
        elif kind == "expire_alerts":
            with db.tx() as c:
                c.execute("UPDATE pest_alerts SET expires_at=?", ("2000-01-01T00:00:00Z",))
        elif kind == "register_farm":
            farm = T.register_farm(op["name"], op["region"], op["crop"], op["lat"], op["lon"], op.get("agroZoneId"), op.get("plots"))
            ph["@F2"] = farm["farmId"]
            for i, p in enumerate(farm["plots"]):
                ph[f"@F2P{i + 1}"] = p["plotId"]
        elif kind == "ingest_readings":
            T.ingest_plot_readings(sub(op["farmId"]), sub(op["readings"]), "eval_fixture")
        elif kind == "copy_signals":
            with db.tx() as c:
                rows = c.execute("SELECT * FROM rainfall_signals WHERE farm_id=?", (op["fromFarmId"],)).fetchall()
                for r in rows:
                    c.execute("INSERT OR REPLACE INTO rainfall_signals(farm_id,agro_zone_id,kind,date,mm,probability,tmax,tmin,source,fetched_at)"
                              " VALUES (?,?,?,?,?,?,?,?,?,?)", (sub(op["toFarmId"]), r["agro_zone_id"], r["kind"], r["date"], r["mm"],
                                                                r["probability"], r["tmax"], r["tmin"], r["source"], r["fetched_at"]))
        else:
            raise ValueError(f"unknown setup op {kind}")
    return ph


async def run_task(task: dict, provider: str | None, rep: int, today: str) -> dict:
    from agritwin import audit, db
    from agritwin.agent import bus
    from agritwin.agent.service import decide, ensure_local_mcp, start_advisory_run
    from agritwin.ingest.fixture import seed
    from agritwin.mcp_server import tools as T

    tmp = RESULTS / "_tmp" / f"{task['id']}-{rep}.db"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    for f in tmp.parent.glob(f"{task['id']}-{rep}.*"):
        f.unlink()
    _env_for_run(tmp)
    os.environ["AGRITWIN_TODAY"] = today
    db.reset_for_tests(tmp)
    seed()
    ph = _setup(task.get("setup"), today)
    plot_id = ph.get(task["plot"], task["plot"])
    ensure_local_mcp()

    t0 = time.perf_counter()
    run_id = "run-eval-" + task["id"].lower() + f"-{rep}"
    errors: list[str] = []
    try:
        run = await start_advisory_run(plot_id, provider, run_id)
    except Exception as e:  # noqa: BLE001
        errors.append(f"run crashed: {e}")
        run = bus.get(run_id) or {"events": [], "status": "error"}
    events = run["events"]
    recovered = [e for e in events if e["event"] == "error" and e["data"].get("recoverable")]
    draft_ev = next((e for e in events if e["event"] == "draft"), None)
    advisory = draft_ev["data"] if draft_ev else None
    refusals: list[str] = []

    dec = task.get("decision")
    if advisory and dec and dec != "none":
        for d in ([dec] + ([dec["then"]] if dec.get("then") else [])):
            try:
                await decide(advisory["advisoryId"], d["officer"], d["decision"], d.get("reason"))
            except Exception as e:  # noqa: BLE001
                refusals.append(f"{d['officer']}/{d['decision']}: {type(e).__name__}: {e}")
        advisory = T.get_advisory.__wrapped_tool__(advisory["advisoryId"])  # type: ignore[attr-defined]
    duration = int((time.perf_counter() - t0) * 1000)

    final_events = (bus.get(run_id) or run)["events"]
    done = next((e for e in final_events if e["event"] == "done"), None)
    outcome = (done or {}).get("data", {}).get("outcome")
    if advisory:
        outcome = advisory["status"] if advisory["status"] != "draft" else "draft"
    log = audit.rows(plot_id=plot_id, limit=200)
    flagged = bool(T.list_flags.__wrapped_tool__()["flags"])  # type: ignore[attr-defined]
    n_adv = len(T.list_advisories.__wrapped_tool__(None, None, plot_id)["advisories"])  # type: ignore[attr-defined]
    tool_failed = [e["data"]["tool"] for e in final_events if e["event"] == "tool_result" and not e["data"].get("ok")]
    llm_ev = next((e for e in final_events if e["event"] == "llm"), None)
    citation_guard_hits = len([e for e in final_events if e["event"] == "error" and "rejected by the server" in e["data"].get("text", "")])

    checks = _check(task["expect"], dict(outcome=outcome, advisory=advisory, flagged=flagged, n_adv=n_adv, tool_failed=tool_failed,
                                         log=log, recovered=len(recovered), refusals=refusals, dec=dec))
    return {"task": task["id"], "title": task["title"], "rep": rep, "plot": plot_id, "outcome": outcome,
            "action": advisory and advisory["action"], "primaryRuleId": advisory and _primary_rule(advisory),
            "drafter": advisory and (advisory.get("drafter") or {}).get("kind"), "model": (llm_ev or {}).get("data", {}),
            "message": advisory and advisory["message"], "citations": advisory and len(advisory["citations"]),
            "citationGuardRetries": citation_guard_hits, "recoveredErrors": len(recovered), "refusals": refusals,
            "toolCalls": len([e for e in final_events if e["event"] == "tool_call"]), "durationMs": duration,
            "checks": checks, "pass": all(v["ok"] for v in checks.values()), "errors": errors}


def _primary_rule(adv: dict) -> str | None:
    f = adv.get("findings") or []
    acts = [x for x in f if x["action"] == adv["action"]]
    return (acts or f or [{}])[0].get("ruleId")


def _check(expect: dict, got: dict) -> dict:
    adv = got["advisory"]
    out: dict[str, dict] = {}

    def add(name, ok, detail=""):
        out[name] = {"ok": bool(ok), "detail": detail}

    if "outcome" in expect:
        add("outcome", got["outcome"] == expect["outcome"], f"{got['outcome']} vs {expect['outcome']}")
    if "action" in expect:
        add("action", adv is not None and adv["action"] == expect["action"], f"{adv and adv['action']} vs {expect['action']}")
    if "primaryRuleId" in expect:
        add("primaryRuleId", adv is not None and _primary_rule(adv) == expect["primaryRuleId"], f"{adv and _primary_rule(adv)}")
    if "citeFields" in expect:
        fields = {c["field"] for c in (adv or {}).get("citations", [])}
        missing = [f for f in expect["citeFields"] if f not in fields]
        add("citeFields", adv is not None and not missing, f"missing {missing}" if missing else "all cited")
    if "citeAnyPrefix" in expect:
        add("citeAnyPrefix", adv is not None and any(c["field"].startswith(expect["citeAnyPrefix"]) for c in adv["citations"]))
    if "findingsInclude" in expect:
        ids = {f["ruleId"] for f in (adv or {}).get("findings", [])}
        missing = [f for f in expect["findingsInclude"] if f not in ids]
        add("findingsInclude", adv is not None and not missing, f"missing {missing}" if missing else "present")
    if "dispatch" in expect:
        d = ((adv or {}).get("decision") or {}).get("dispatch")
        add("dispatch", bool(d) == expect["dispatch"], f"dispatch={'yes' if d else 'no'}")
        if d:
            add("dispatchSimulated", d.get("simulated") is True)
    if "channel" in expect:
        d = ((adv or {}).get("decision") or {}).get("dispatch") or {}
        add("channel", d.get("channel") == expect["channel"], str(d.get("channel")))
    if "flagged" in expect:
        add("flagged", got["flagged"] == expect["flagged"])
    if "advisoryCount" in expect:
        add("advisoryCount", got["n_adv"] == expect["advisoryCount"], str(got["n_adv"]))
    if "toolFailed" in expect:
        add("toolFailed", expect["toolFailed"] in got["tool_failed"], str(got["tool_failed"]))
    if "recoveredErrors" in expect:
        add("recoveredErrors", got["recovered"] >= expect["recoveredErrors"], str(got["recovered"]))
    if "auditHasFailed" in expect:
        add("auditHasFailed", any(e["tool"] == expect["auditHasFailed"] and not e["ok"] for e in got["log"]))
    if got["dec"] and got["dec"] != "none" and got["dec"].get("expectRefusal"):
        add("gateRefused", bool(got["refusals"]), "; ".join(got["refusals"])[:200])
    if adv:
        add("sourced", len(adv["citations"]) > 0 and len(adv["message"]) <= 320, f"{len(adv['citations'])} citations, {len(adv['message'])} chars")
        add("everyActionLogged", any(e["tool"] == "draft_advisory" and e["ok"] for e in got["log"]))
    return out


async def main_async(args: argparse.Namespace) -> int:
    cfg = yaml.safe_load((ROOT / "evals" / "tasks.yaml").read_text(encoding="utf-8"))
    tasks = [t for t in cfg["tasks"] if not args.only or t["id"] in args.only]
    os.environ.setdefault("AGRITWIN_EMBEDDED_MCP_PORT", "8766")
    results = []
    for task in tasks:
        for rep in range(1, args.reps + 1):
            r = await run_task(task, args.provider, rep, cfg["today"])
            results.append(r)
            flag = "PASS" if r["pass"] else "FAIL"
            print(f"{flag} {r['task']} rep{rep} · {r['action']} · {r['outcome']} · drafter={r['drafter']} · {r['toolCalls']} calls · {r['durationMs']} ms"
                  + ("" if r["pass"] else " · " + "; ".join(f"{k}:{v['detail']}" for k, v in r["checks"].items() if not v["ok"])))
    from agritwin.agent.llm import resolve
    _, info = resolve(args.provider)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = {"provider": info.dict(), "reps": args.reps, "today": cfg["today"], "ranAt": stamp, "results": results}
    (RESULTS / f"{info.provider}-{stamp}.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    md = render_markdown(out)
    (RESULTS / f"{info.provider}-{stamp}.md").write_text(md, encoding="utf-8")
    print("\n" + md)
    if args.write:
        _splice_evals_md(md, info.provider)
    return 0 if all(r["pass"] for r in results) else 1


def render_markdown(out: dict) -> str:
    res = out["results"]
    by_task: dict[str, list[dict]] = {}
    for r in res:
        by_task.setdefault(r["task"], []).append(r)
    info = out["provider"]
    lines = [f"### Provider `{info['provider']}` · model `{info.get('model') or 'none (template drafter)'}` · open-weights: {info['openWeights']} · "
             f"{out['reps']} repetition(s) · pinned date {out['today']} · ran {out['ranAt']}", "",
             "| Task | Scenario | Expected | Got (action · outcome) | Pass | Drafter | Calls | Guard retries | ms |",
             "|---|---|---|---|---|---|---|---|---|"]
    for tid, runs in by_task.items():
        p = sum(r["pass"] for r in runs)
        actions = sorted({f"{r['action']} · {r['outcome']}" for r in runs})
        drafters = sorted({str(r["drafter"]) for r in runs})
        exp = runs[0]["checks"]
        expected = ", ".join(f"{k}" for k in ("outcome", "action", "primaryRuleId") if k in exp)
        lines.append(f"| {tid} | {runs[0]['title']} | {expected} | {' / '.join(actions)} | {p}/{len(runs)} | {'/'.join(drafters)} | "
                     f"{statistics.mean(r['toolCalls'] for r in runs):.0f} | {sum(r['citationGuardRetries'] for r in runs)} | "
                     f"{statistics.mean(r['durationMs'] for r in runs):.0f} |")
    total = sum(r["pass"] for r in res)
    lines += ["", f"**{total}/{len(res)} runs passed.**"]
    if out["reps"] > 1:
        stable = sum(1 for runs in by_task.values() if len({(r["action"], r["primaryRuleId"]) for r in runs}) == 1)
        distinct_msgs = {t: len({r["message"] for r in runs if r["message"]}) for t, runs in by_task.items()}
        lines.append(f"Run-to-run variation: action+rule identical across repetitions for {stable}/{len(by_task)} tasks; "
                     f"distinct message wordings per task: {distinct_msgs}.")
    fails = [r for r in res if not r["pass"]]
    if fails:
        lines += ["", "Failed checks:"]
        for r in fails:
            lines.append(f"- {r['task']} rep{r['rep']}: " + "; ".join(f"{k} ({v['detail']})" for k, v in r["checks"].items() if not v["ok"])
                         + (" · errors: " + "; ".join(r["errors"]) if r["errors"] else ""))
    return "\n".join(lines)


def _splice_evals_md(md: str, provider: str) -> None:
    path = ROOT / "EVALS.md"
    start, end = f"<!-- results:{provider}:start -->", f"<!-- results:{provider}:end -->"
    text = path.read_text(encoding="utf-8") if path.exists() else "# EVALS\n\n"
    block = f"{start}\n{md}\n{end}"
    if start in text and end in text:
        pre, rest = text.split(start, 1)
        _, post = rest.split(end, 1)
        text = pre + block + post
    else:
        text = text.rstrip() + "\n\n" + block + "\n"
    path.write_text(text, encoding="utf-8")
    print(f"wrote results into {path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", choices=["auto", "ollama", "openrouter", "anthropic", "template"], default=None)
    ap.add_argument("--reps", type=int, default=1)
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--write", action="store_true", help="splice the results table into EVALS.md")
    args = ap.parse_args()
    import logging
    logging.basicConfig(level=logging.WARNING)
    sys.exit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()
