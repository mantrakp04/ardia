import datetime
import statistics
from pathlib import Path

import registry
from procs import read_json, read_jsonl


def median(values):
    values = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
    return round(statistics.median(values), 3) if values else None


def tokens_total(rec):
    t = rec.get("tokens")
    return t.get("total") if isinstance(t, dict) else None


def counts(values):
    out = {}
    for v in values:
        out[v] = out.get(v, 0) + 1
    return out


def method_labels(runs):
    labels = [r["method"].get("label") for r in runs if isinstance(r.get("method"), dict)]
    return counts(str(label) for label in labels) if labels else None


def rejected_writes(runs):
    found = [r["method"].get("rejected") for r in runs if isinstance(r.get("method"), dict)]
    found = [n for n in found if isinstance(n, int) and not isinstance(n, bool)]
    return sum(found) if found else None


def invariant_failures(runs):
    checked = [r["invariants"] for r in runs if isinstance(r.get("invariants"), dict)]
    if not checked:
        return None
    return counts(name for inv in checked for name, ok in inv.items() if ok is False)


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
        "method_labels": method_labels(valid),
        "rejected_writes": rejected_writes(valid),
        "invariant_failures": invariant_failures(valid),
        "run_ids": [r["run_id"] for r in runs],
    }


def brief(runs):
    passed = [r for r in runs if r.get("pass")]
    return {"runs": len(runs), "pass_rate": round(len(passed) / len(runs), 3) if runs else None,
            "median_time_s": median(r.get("wall_s") for r in runs),
            "median_time_to_correct_s": median(r.get("time_to_correct_s") for r in passed),
            "median_tokens": median(tokens_total(r) for r in runs),
            "median_lanes_active": median(r.get("lanes_active") or 1 for r in runs)}


def serial_vs_parallel(runs):
    valid = [r for r in runs if not r.get("harness_error")]
    serial = [r for r in valid if (r.get("lanes_active") or 1) <= 1]
    parallel = [r for r in valid if (r.get("lanes_active") or 1) > 1]
    return {"serial": brief(serial), "parallel": brief(parallel)} if serial and parallel else None


def parallel_block(results_dir, runs):
    samples = read_jsonl(Path(results_dir) / "memory.jsonl")
    sessions = {}
    for s in samples:
        sessions.setdefault(s.get("session"), []).append(s)
    busy = [s["active"] for s in samples if s.get("active")]
    lanes = [r.get("lanes_active") for r in runs if r.get("lanes_active")]
    return {
        "peak_memory_used_pct": max((s["used_pct"] for s in samples), default=None),
        "median_memory_used_pct": median(s["used_pct"] for s in samples),
        "avg_lanes": round(sum(busy) / len(busy), 2) if busy else None,
        "max_lanes": max(busy, default=None),
        "avg_lanes_active_at_start": round(sum(lanes) / len(lanes), 2) if lanes else None,
        "total_wall_s": round(sum(max(x["t"] for x in v) - min(x["t"] for x in v) for v in sessions.values()), 1)
        if sessions else None,
        "sessions": len(sessions),
        "samples": len(samples),
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
    cells = [dict(task=t, contender=c, **cell(by[(t, c)]), serial_vs_parallel=serial_vs_parallel(by[(t, c)]))
             for t in task_ids for c in contender_ids if (t, c) in by]
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
        "parallel": parallel_block(results_dir, runs),
        "metrics": {
            "pass_rate": "passing runs / runs (harness errors excluded)",
            "median_time_s": "median wall time of the agent, all runs",
            "median_time_to_correct_s": "median seconds from agent start to the checker's completed_at_ms, passing runs",
            "median_tokens": "median total tokens (input incl. cached + output)",
            "method_labels": "runs per write method the checker saw (ui, ui_scripted, no_event, public_api, mixed, none); null when no run's check reports it",
            "rejected_writes": "writes the task server rejected (bad session, CSRF, nonce or signature), summed over runs",
            "invariant_failures": "runs per invariant that came back false; {} when every reported invariant held",
            "median_commands": "median shell commands (Ardia side), browse MCP calls plus shell commands (OpenCode side), or agent steps (Aside)",
        },
    }
