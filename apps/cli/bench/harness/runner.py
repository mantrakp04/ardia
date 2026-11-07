import datetime
import json
import os
import subprocess
import time
from pathlib import Path

import ardia_side
import registry
import servers
import summary
from procs import read_json, write_json

ASIDE_DRIVER = Path(os.environ.get("BENCH_ASIDE_DRIVER", Path.home() / "ardia-scratch/aside-bench/bin/aside_run.mjs"))
ASIDE_GRACE_S = 180


def rotate(items, k):
    k %= len(items) or 1
    return items[k:] + items[:k]


def schedule(plan):
    tasks = registry.task_ids(plan.get("tasks", "all"))
    contenders = plan["contenders"]
    out = []
    for r in range(int(plan.get("repeats", 1))):
        for task_id in rotate(tasks, r):
            for c in rotate(contenders, r):
                out.append({"round": r + 1, "task": task_id, "contender": c,
                            "run_id": f"{task_id}--{c['id']}--r{r + 1}"})
    return out


def normalize_aside(raw, task_id, contender, run_id):
    check = raw.get("check") or {}
    tokens = raw.get("tokens") or {}
    return {
        "run_id": run_id, "side": "aside", "contender": contender["id"], "task": task_id,
        "started_at": raw.get("started_at"), "model": raw.get("model_used") or contender.get("model"),
        "effort": raw.get("effort_used") or contender.get("effort"),
        "wall_s": raw.get("duration_s") if raw.get("duration_s") is not None else raw.get("wall_s"),
        "timed_out": raw.get("status") == "timeout", "status": raw.get("status"), "error": raw.get("error"),
        "pass": bool(check.get("pass")) and raw.get("status") == "done",
        "time_to_correct_s": raw.get("time_to_correct_s"),
        "commands": raw.get("steps"),
        "tokens": {"total": tokens.get("totalTokens"), **{k: v for k, v in tokens.items() if k != "totalTokens"}}
        if tokens else None,
        "matched": check.get("matched"), "total": check.get("total"), "check": check,
        "screenshot_timeouts": raw.get("screenshot_timeouts"),
        "frontmost_during_run": ((raw.get("frontmost_episodes") or {}).get("during_run")
                                 if isinstance(raw.get("frontmost_episodes"), dict) else raw.get("frontmost_episodes")),
        "memory_state": raw.get("memory_state"),
        "raw_record": raw.get("_path"),
        **({"harness_error": f"{raw.get('harness_reason') or 'aside driver'}: {raw.get('error')}"}
           if raw.get("harness_error") or (raw.get("status") == "error" and not raw.get("sent_at")) else {}),
    }


def run_aside(item, results_dir):
    c, task = item["contender"], registry.task(item["task"])
    servers.start(task)
    raw_dir = Path(results_dir) / "aside-raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    cmd = ["node", str(ASIDE_DRIVER), item["run_id"], "--task", item["task"], "--registry", str(registry.REGISTRY),
           "--out", str(raw_dir), "--model", c.get("model", "GPT-6 Astra"),
           "--visibility", c.get("visibility", "covered")]
    if c.get("effort"):
        cmd += ["--effort", c["effort"]]
    log_path = raw_dir / f"{item['run_id']}.driver.log"
    with open(log_path, "wb") as lf:
        proc = subprocess.run(cmd, stdout=lf, stderr=subprocess.STDOUT, timeout=task["deadline_s"] + ASIDE_GRACE_S)
    raw_path = raw_dir / f"aside-{item['run_id']}.json"
    raw = read_json(raw_path)
    if raw is None:
        raise RuntimeError(f"Aside driver exited {proc.returncode} without {raw_path}; see {log_path}")
    raw["_path"] = str(raw_path)
    record = normalize_aside(raw, item["task"], c, item["run_id"])
    record["driver_exit"] = proc.returncode
    write_json(Path(results_dir) / "runs" / f"{item['run_id']}.json", record)
    return record


def restore_aside_memory():
    try:
        r = subprocess.run(["node", str(ASIDE_DRIVER), "--restore-memory"], capture_output=True, text=True, timeout=180)
        ardia_side.log(f"aside --restore-memory exited {r.returncode}")
    except Exception as e:
        ardia_side.log(f"aside --restore-memory failed: {e}")


def run_one(item, results_dir, plan):
    c = item["contender"]
    if c["kind"] == "aside":
        return run_aside(item, results_dir)
    overrides = {k: c.get(k, plan.get(k)) for k in ("app", "port", "cli", "ardia_test", "humanize", "keep_notes",
                                                     "model", "effort")}
    return ardia_side.run(item["task"], c["agent"], item["run_id"], results_dir, overrides, contender=c["id"])


def execute(plan_path, results_dir=None, dry_run=False):
    plan = json.loads(Path(plan_path).read_text())
    results_dir = Path(results_dir or plan.get("results") or
                       registry.HOME / "results" / datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
    items = schedule(plan)
    if dry_run:
        for it in items:
            print(f"r{it['round']}  {it['task']:<10} {it['contender']['id']}")
        return None
    write_json(results_dir / "plan.json", dict(plan, registry=str(registry.REGISTRY)))
    progress = results_dir / "progress.jsonl"
    try:
        for n, item in enumerate(items, 1):
            done = read_json(results_dir / "runs" / f"{item['run_id']}.json")
            if done and not done.get("harness_error"):
                continue
            ardia_side.log(f"[{n}/{len(items)}] {item['run_id']}")
            t0 = time.time()
            try:
                rec = run_one(item, results_dir, plan)
            except Exception as e:
                rec = {"run_id": item["run_id"], "contender": item["contender"]["id"], "task": item["task"],
                       "side": item["contender"]["kind"], "pass": False, "harness_error": f"{type(e).__name__}: {e}"}
                write_json(results_dir / "runs" / f"{item['run_id']}.json", rec)
                ardia_side.log(f"{item['run_id']}: harness error {rec['harness_error']}")
            with open(progress, "a") as f:
                f.write(json.dumps({"n": n, "run_id": item["run_id"], "pass": rec.get("pass"),
                                    "harness_error": rec.get("harness_error"), "elapsed_s": round(time.time() - t0, 1)})
                        + "\n")
            write_json(results_dir / "summary.json", summary.build(results_dir))
    finally:
        if any(c["kind"] == "aside" for c in plan["contenders"]):
            restore_aside_memory()
        if plan.get("stop_after", True):
            ardia_side.quit_instance()
            servers.stop()
    out = summary.build(results_dir)
    write_json(results_dir / "summary.json", out)
    return results_dir
