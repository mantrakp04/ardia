import datetime
import statistics
from pathlib import Path

import registry
from procs import read_json


def median(values):
    values = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
    return round(statistics.median(values), 3) if values else None


def tokens_total(rec):
    t = rec.get("tokens")
    return t.get("total") if isinstance(t, dict) else None


def cell(runs):
    passed = [r for r in runs if r.get("pass")]
    valid = [r for r in runs if not r.get("harness_error")]
    return {
        "runs": len(valid),
        "passes": len(passed),
        "pass_rate": round(len(passed) / len(valid), 3) if valid else None,
        "median_time_s": median(r.get("wall_s") for r in valid),
        "median_time_s_passing": median(r.get("wall_s") for r in passed),
        "median_time_to_correct_s": median(r.get("time_to_correct_s") for r in passed),
        "median_tokens": median(tokens_total(r) for r in valid),
        "median_commands": median(r.get("commands") for r in valid),
        "harness_errors": len(runs) - len(valid),
        "frontmost_during_run": [r.get("frontmost_during_run") for r in valid if "frontmost_during_run" in r] or None,
        "screenshot_timeouts": [r.get("screenshot_timeouts") for r in valid if "screenshot_timeouts" in r] or None,
        "run_ids": [r["run_id"] for r in runs],
    }


def build(results_dir):
    results_dir = Path(results_dir)
    plan = read_json(results_dir / "plan.json", {})
    runs = [r for r in (read_json(p) for p in sorted((results_dir / "runs").glob("*.json"))) if r]
    task_meta = {t["id"]: t for t in registry.load()}
    plan_contenders = plan.get("contenders") or []
    contender_ids = [c["id"] for c in plan_contenders] or sorted({r["contender"] for r in runs})
    task_ids = [t for t in registry.task_ids(plan.get("tasks", "all"))] if plan else sorted({r["task"] for r in runs})
    by = {}
    for r in runs:
        by.setdefault((r["task"], r["contender"]), []).append(r)
    cells = [dict(task=t, contender=c, **cell(by[(t, c)])) for t in task_ids for c in contender_ids if (t, c) in by]
    overall = []
    for c in contender_ids:
        mine = [r for r in runs if r["contender"] == c]
        if not mine:
            continue
        per_task = [x for x in cells if x["contender"] == c]
        overall.append(dict(contender=c, tasks=len(per_task),
                            tasks_all_passed=sum(1 for x in per_task if x["runs"] and x["passes"] == x["runs"]),
                            **{k: v for k, v in cell(mine).items() if k != "run_ids"}))
    return {
        "schema": 1,
        "generated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "plan": plan.get("name"),
        "repeats": plan.get("repeats"),
        "tasks": [{"id": t, "title": task_meta.get(t, {}).get("title", t),
                   "deadline_s": task_meta.get(t, {}).get("deadline_s")} for t in task_ids],
        "contenders": [{"id": c.get("id"), "label": c.get("label", c.get("id")), "side": c.get("kind"),
                        "agent": c.get("agent"), "model": c.get("model"), "effort": c.get("effort")}
                       for c in plan_contenders] or [{"id": c} for c in contender_ids],
        "cells": cells,
        "overall": overall,
        "metrics": {
            "pass_rate": "passing runs / runs (harness errors excluded)",
            "median_time_s": "median wall time of the agent, all runs",
            "median_time_to_correct_s": "median seconds from agent start to the checker's completed_at_ms, passing runs",
            "median_tokens": "median total tokens (input incl. cached + output)",
            "median_commands": "median shell commands (Ardia side) or agent steps (Aside)",
        },
    }
