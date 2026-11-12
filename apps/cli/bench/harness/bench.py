#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ardia_side
import browseruse_side
import opencode_side
import registry
import runner
import servers
import summary
from procs import write_json

HELP = f"""Browser-agent bench: Claude Code and Codex driving Ardia through `ardia browse`, against Aside's agent.

Commands:
  tasks                         list the registry ({registry.REGISTRY})
  freeze-cli [--src DIR]        snapshot apps/cli into a venv the runs use (BENCH_HOME/cli, linked from devbin/ardia)
  servers start|stop [TASK...]  start or stop task servers (all tasks when none named); start --port-offset N binds
                                each port + N (stop stops every offset)
  run TASK claude|codex RUN_ID  one cold run against the hidden Ardia instance, record in --results/runs/RUN_ID.json;
                                --port-offset N runs against the task's copy on its ports + N;
                                --side opencode drives a fresh headless Chrome for Testing through OpenCode Browse's MCP;
                                --side browseruse drives one through Browser Use's `browser-use` CLI and skill
  plan PLAN.json [--max-lanes N] [--dry-run]
                                run tasks x contenders x repeats in parallel lanes gated on memory (--max-lanes, else
                                the plan's max_lanes, else 6; 1 is serial); lane k gets its own task servers on
                                ports + 1000(k+1); --dry-run checks the ports and prints the simulated timeline
  summarize RESULTS_DIR         rewrite RESULTS_DIR/summary.json from its run records
  stop                          quit the hidden Ardia instance, OpenCode Browse and Browser Use lanes and every task server this harness
                                started

Scratch lives in BENCH_HOME (default ~/ardia-scratch/bench-proper): app/Ardia.app (a copy of a build, never run in
place), data-ardia, work, state, logs, results."""


def main():
    ap = argparse.ArgumentParser(prog="bench.py", description=HELP, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("tasks")
    fz = sub.add_parser("freeze-cli")
    fz.add_argument("--src", default=str(registry.BENCH_DIR.parent))
    sv = sub.add_parser("servers")
    sv.add_argument("action", choices=["start", "stop"])
    sv.add_argument("task_ids", nargs="*")
    sv.add_argument("--port-offset", type=int, default=0)
    rn = sub.add_parser("run")
    rn.add_argument("task")
    rn.add_argument("agent", choices=["claude", "codex"])
    rn.add_argument("run_id")
    rn.add_argument("--results", default=str(registry.HOME / "results/adhoc"))
    rn.add_argument("--app")
    rn.add_argument("--port", type=int)
    rn.add_argument("--cli", choices=["dev", "installed"])
    rn.add_argument("--ardia-test")
    rn.add_argument("--model")
    rn.add_argument("--effort")
    rn.add_argument("--deadline-s", type=int)
    rn.add_argument("--humanize", action="store_true", default=None)
    rn.add_argument("--keep-notes", action="store_true", default=None)
    rn.add_argument("--side", choices=["ardia", "opencode", "browseruse"], default="ardia")
    rn.add_argument("--port-offset", type=int)
    pl = sub.add_parser("plan")
    pl.add_argument("plan")
    pl.add_argument("--results")
    pl.add_argument("--dry-run", action="store_true")
    pl.add_argument("--max-lanes", type=int)
    sm = sub.add_parser("summarize")
    sm.add_argument("results")
    sub.add_parser("stop")
    a = ap.parse_args()

    if a.cmd == "tasks":
        for t in registry.load():
            print(f"{t['id']:<10} ports {','.join(map(str, t['server']['ports'])):<16} {t['deadline_s']:>4}s  {t['title']}")
    elif a.cmd == "freeze-cli":
        print(json.dumps(ardia_side.freeze_cli(a.src), indent=2))
    elif a.cmd == "servers":
        ids = registry.task_ids(a.task_ids or "all")
        if a.action == "start":
            for tid in ids:
                rec = servers.start(registry.task(tid, a.port_offset))
                print(f"{tid}: pid {rec['pid']} ports {rec['ports']}")
        else:
            print(f"stopped: {servers.stop(ids) or 'none'}")
    elif a.cmd == "run":
        overrides = {"app": a.app, "port": a.port, "cli": a.cli, "ardia_test": a.ardia_test, "model": a.model,
                     "effort": a.effort, "deadline_s": a.deadline_s, "humanize": a.humanize, "keep_notes": a.keep_notes,
                     "port_offset": a.port_offset}
        browser_overrides = {"model": a.model, "effort": a.effort, "deadline_s": a.deadline_s,
                             "port_offset": a.port_offset}
        if a.side == "opencode":
            rec = opencode_side.run(a.task, a.agent, a.run_id, a.results, browser_overrides)
        elif a.side == "browseruse":
            rec = browseruse_side.run(a.task, a.agent, a.run_id, a.results, browser_overrides)
        else:
            rec = ardia_side.run(a.task, a.agent, a.run_id, a.results, overrides)
        print(json.dumps({k: rec[k] for k in ("run_id", "task", "pass", "wall_s", "time_to_correct_s", "commands",
                                              "timed_out", "matched", "total")}
                         | {"tokens": (rec["tokens"] or {}).get("total")}))
    elif a.cmd == "plan":
        out = runner.execute(a.plan, a.results, a.dry_run, a.max_lanes)
        if out:
            print(out / "summary.json")
    elif a.cmd == "summarize":
        write_json(Path(a.results) / "summary.json", summary.build(a.results))
        print(Path(a.results) / "summary.json")
    elif a.cmd == "stop":
        ardia_side.quit_instance()
        print(f"opencode stopped: {opencode_side.stop_all() or 'none'}")
        print(f"browseruse stopped: {browseruse_side.stop_all() or 'none'}")
        print(f"servers stopped: {servers.stop() or 'none'}")


if __name__ == "__main__":
    main()
