"""CLI: run one advisory for a plot with every tool call printed, pause at the gate, let a named officer decide.

    agritwin-agent --plot B2                    # interactive: asks for the officer's name and decision
    agritwin-agent --plot B2 --officer "Amina Wekesa" --decide approve
    agritwin-agent --plot B2 --provider template  # no LLM, deterministic drafter
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import json
import sys

from .. import db
from ..config import settings
from . import bus
from .service import decide, ensure_local_mcp, start_advisory_run


def _print_event(ev: dict) -> None:
    e, d = ev["event"], ev["data"]
    ts = ev["ts"][11:19]
    if e == "status":
        print(f"[{ts}] ── {d['node']}: {d['text']}")
    elif e == "tool_call":
        print(f"[{ts}]   → {d['server']}.{d['tool']}({json.dumps(d['input'])[:140]})")
    elif e == "tool_result":
        print(f"[{ts}]   ← {d['tool']} {'ok' if d['ok'] else 'FAILED'} {d['durationMs']} ms · {d.get('summary', '')[:160]}")
    elif e == "llm":
        print(f"[{ts}]   ✦ model: {d['provider']} {d.get('model') or ''} open-weights={d['openWeights']} attempt={d.get('attempt')}")
    elif e == "draft":
        print(f"[{ts}] ── DRAFT {d['advisoryId']} · action={d['action']} · drafter={d['drafter'].get('kind')}\n"
              f"      message: {d['message']}\n      reasoning: {d['reasoning'][:400]}\n      citations: "
              + "; ".join(f"{c['field']}={c['value']}{c['unit']}" for c in d["citations"]))
    elif e == "awaiting_officer":
        print(f"[{ts}] ■ GATE: {d['text']}")
    elif e == "decision":
        dec = d.get("decision") or {}
        print(f"[{ts}] ── DECISION by {dec.get('officerName')}: {dec.get('decision')} {('— ' + dec['reason']) if dec.get('reason') else ''}")
        if dec.get("dispatch"):
            print(f"      simulated dispatch via {dec['dispatch']['channel']} to {dec['dispatch']['to']}: {dec['dispatch']['text']}")
    elif e == "error":
        print(f"[{ts}]   ! {d['text']}" + (" (recovered)" if d.get("recoverable") else ""))
    elif e == "done":
        print(f"[{ts}] ── done: {d}")


async def _main(args: argparse.Namespace) -> int:
    db.connect()
    if not db.one("SELECT 1 FROM farms LIMIT 1"):
        from ..ingest.fixture import seed
        print("empty store; seeding fixtures ->", seed())
    url = ensure_local_mcp()
    print(f"AgriTwin MCP at {url} · today {settings().today} · provider {args.provider or settings().model_provider}")
    run_id = "run-" + __import__("uuid").uuid4().hex[:10]
    bus.create(run_id, "advisory", args.plot, run_id)
    replay, q = bus.subscribe(run_id)
    task = asyncio.create_task(start_advisory_run(args.plot, args.provider, run_id))

    async def pump(stop_at: tuple[str, ...]) -> None:
        while True:
            ev = await q.get()
            _print_event(ev)
            if ev["event"] in stop_at:
                return

    await pump(("awaiting_officer", "done"))
    run = await task
    if run["status"] == "awaiting_officer":
        adv_id = next(e["data"]["advisoryId"] for e in run["events"] if e["event"] == "awaiting_officer")
        officer, decision, reason = args.officer, args.decide, args.reason
        if not officer or not decision:
            print("\nOfficer gate. Roster:", ", ".join(o["name"] for o in __import__("agritwin.mcp_server.tools", fromlist=["x"]).get_office.__wrapped_tool__()["officers"]))
            officer = officer or input("Officer name: ").strip()
            decision = decision or input("approve / reject: ").strip().lower()
            if decision == "reject" and not reason:
                reason = input("Reason: ").strip()
        try:
            await decide(adv_id, officer, decision, reason)
        except Exception as e:  # noqa: BLE001
            print("gate refused:", e)
            return 2
        await pump(("done",))
    bus.unsubscribe(run_id, q)
    return 0


def main() -> None:
    logging.basicConfig(level=logging.WARNING)
    ap = argparse.ArgumentParser(description="Run the AgriTwin advisory agent for one plot")
    ap.add_argument("--plot", required=True)
    ap.add_argument("--provider", choices=["auto", "ollama", "openrouter", "anthropic", "template"], default=None)
    ap.add_argument("--officer")
    ap.add_argument("--decide", choices=["approve", "reject"])
    ap.add_argument("--reason")
    args = ap.parse_args()
    sys.exit(asyncio.run(_main(args)))


if __name__ == "__main__":
    main()
