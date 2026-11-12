import datetime
import json
import os
import re
import shutil
import statistics
import subprocess
import threading
import time
from pathlib import Path

import ardia_side
import browseruse_side
import grading
import opencode_side
import registry
import servers
import summary
from procs import read_json, sh, write_json
from scheduler import LANE_PORT_STRIDE, Scheduler


ASIDE_DRIVER = Path(os.environ.get("BENCH_ASIDE_DRIVER", Path.home() / "ardia-scratch/aside-bench/bin/aside_run.mjs"))
ASIDE_GRACE_S = 180
DEFAULT_MAX_LANES = 6
EPHEMERAL_PORTS_FROM = 49152


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
    timed_out = raw.get("status") == "timeout"
    passed, reset_by_agent = grading.grade(check, timed_out, sent_at_ms=grading.epoch_ms(raw.get("sent_at")))
    return {
        "run_id": run_id, "side": "aside", "contender": contender["id"], "task": task_id,
        "started_at": raw.get("started_at"), "model": raw.get("model_used") or contender.get("model"),
        "effort": raw.get("effort_used") or contender.get("effort"),
        "wall_s": raw.get("duration_s") if raw.get("duration_s") is not None else raw.get("wall_s"),
        "timed_out": timed_out, "status": raw.get("status"), "error": raw.get("error"),
        "pass": passed, "reset_by_agent": reset_by_agent,
        "time_to_correct_s": raw.get("time_to_correct_s"),
        "commands": raw.get("steps"),
        "tokens": {"total": tokens.get("totalTokens"), **{k: v for k, v in tokens.items() if k != "totalTokens"}}
        if tokens else None,
        "matched": check.get("matched"), "total": check.get("total"), "port_offset": 0,
        "method": check.get("method"), "invariants": check.get("invariants"), "check": check,
        "screenshot_timeouts": raw.get("screenshot_timeouts"),
        "frontmost_during_run": ((raw.get("frontmost_episodes") or {}).get("during_run")
                                 if isinstance(raw.get("frontmost_episodes"), dict) else raw.get("frontmost_episodes")),
        "memory_state": raw.get("memory_state"),
        "raw_record": raw.get("_path"),
        **({"harness_error": f"{raw.get('harness_reason') or 'aside driver'}: {raw.get('error')}"}
           if raw.get("harness_error") or (raw.get("status") == "error" and not raw.get("sent_at")) else {}),
        **({"harness_error": f"memory contaminated: {raw.get('error')}"} if raw.get("status") == "memory_contaminated" else {}),
    }




RATE_LIMIT = re.compile(r"rate[ _-]?limit|overloaded|too many requests|usage limit|\b429\b|\b529\b", re.I)
TICK_S = 2.0
SAMPLE_S = 3.0
STALL_S = 900.0


def run_aside(item, results_dir, on_start=None):
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
    if on_start:
        on_start()
    with open(log_path, "wb") as lf:
        proc = subprocess.run(cmd, stdout=lf, stderr=subprocess.STDOUT, timeout=task["deadline_s"] + ASIDE_GRACE_S)
    raw_path = raw_dir / f"aside-{item['run_id']}.json"
    raw = read_json(raw_path)
    if raw is None:
        raise RuntimeError(f"Aside driver exited {proc.returncode} without {raw_path}; see {log_path}")
    raw["_path"] = str(raw_path)
    record = normalize_aside(raw, item["task"], c, item["run_id"])
    record["driver_exit"] = proc.returncode
    return record


def restore_aside_memory():
    try:
        r = subprocess.run(["node", str(ASIDE_DRIVER), "--restore-memory"], capture_output=True, text=True, timeout=180)
        ardia_side.log(f"aside --restore-memory exited {r.returncode}")
    except Exception as e:
        ardia_side.log(f"aside --restore-memory failed: {e}")


def memory_used_pct():
    out = sh(["vm_stat"], timeout=10).stdout
    page = int(re.search(r"page size of (\d+) bytes", out).group(1))

    def pages(label):
        m = re.search(rf"{label}:\s+(\d+)\.", out)
        return int(m.group(1)) if m else 0

    used = pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor")
    total = int(sh(["sysctl", "-n", "hw.memsize"], timeout=10).stdout.strip())
    return round(used * page * 100 / total, 1)


def lane_overrides(plan, contender, lane, port_offset=0):
    keys = ("app", "port", "cli", "ardia_test", "humanize", "keep_notes", "model", "effort")
    o = {k: contender.get(k, plan.get(k)) for k in keys}
    o["port_offset"] = port_offset
    base_app = Path(o.get("app") or ardia_side.DEFAULTS["app"]).expanduser()
    o["port"] = int(o.get("port") or ardia_side.DEFAULTS["port"]) + lane.index
    if lane.index:
        o["lane"] = f"lane{lane.index}"
        o["app"] = str(lane_app(base_app, lane.index))
    return o


def lane_app(base_app, index):
    dest = registry.HOME / f"app-lane{index}" / "Ardia.app"
    src_plist, dest_plist = base_app / "Contents/Info.plist", dest / "Contents/Info.plist"
    stale = not dest_plist.exists() or dest_plist.read_bytes() != src_plist.read_bytes()
    if stale:
        shutil.rmtree(dest, ignore_errors=True)
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ditto", str(base_app), str(dest)], check=True, timeout=600)
    return dest


def rate_limit_reason(rec):
    if rec.get("pass"):
        return None
    texts = [str(rec.get("harness_error") or ""), str(rec.get("error") or ""), str(rec.get("status") or "")]
    if rec.get("side") in ("ardia", "opencode", "browseruse"):
        failed_cli = rec.get("cli_is_error") or rec.get("errors") or rec.get("exit_code") not in (0, None) or not rec.get("tokens")
        if not failed_cli:
            return None
        texts += [str(rec.get("final_message") or "")] + [str(e) for e in rec.get("errors") or []]
        try:
            texts.append(Path(rec["stderr_file"]).read_text(errors="replace")[-4000:])
        except (KeyError, OSError):
            pass
    m = next((RATE_LIMIT.search(t) for t in texts if RATE_LIMIT.search(t)), None)
    return m.group(0) if m else None


def opencode_overrides(plan, contender, lane, port_offset=0):
    keys = ("model", "effort", "browse_entry", "extension", "chrome", "cdp_port", "relay_port", "reach_line")
    return dict({k: contender.get(k) for k in keys}, lane=f"lane{lane.index}", lane_index=lane.index,
                port_offset=port_offset)


def browseruse_overrides(plan, contender, lane, port_offset=0):
    keys = ("model", "effort", "venv", "chrome", "cdp_port", "reach_line")
    return dict({k: contender.get(k) for k in keys}, lane=f"lane{lane.index}", lane_index=lane.index,
                port_offset=port_offset)


def run_item(item, lane, results_dir, plan, on_start):
    c, offset = item["contender"], item.get("port_offset", 0)
    if c["kind"] == "aside":
        return run_aside(item, results_dir, on_start)
    if c["kind"] == "opencode":
        return opencode_side.run(item["task"], c["agent"], item["run_id"], results_dir,
                                 opencode_overrides(plan, c, lane, offset), contender=c["id"], on_agent_start=on_start)
    if c["kind"] == "browseruse":
        return browseruse_side.run(item["task"], c["agent"], item["run_id"], results_dir,
                                   browseruse_overrides(plan, c, lane, offset), contender=c["id"],
                                   on_agent_start=on_start)
    return ardia_side.run(item["task"], c["agent"], item["run_id"], results_dir, lane_overrides(plan, c, lane, offset),
                          contender=c["id"], on_agent_start=on_start)


def pending_items(plan, results_dir):
    out = []
    for it in schedule(plan):
        done = read_json(results_dir / "runs" / f"{it['run_id']}.json")
        if not done or done.get("harness_error"):
            out.append(it)
    return out


def make_scheduler(plan, results_dir, max_lanes, pinned_tasks=()):
    return Scheduler(pending_items(plan, results_dir), max_lanes=max_lanes, lead=int(plan.get("max_round_lead", 1)),
                     pace_slack=float(plan.get("pace_slack", 0.15)), pinned_tasks=set(pinned_tasks))


class Executor:
    def __init__(self, plan, results_dir, max_lanes, pinned_tasks=()):
        self.plan, self.results_dir = plan, Path(results_dir)
        self.lock = threading.Lock()
        self.sched = make_scheduler(plan, self.results_dir, max_lanes, pinned_tasks)
        self.intervals = {}
        self.threads = []
        self.lanes_used = {}
        self.stop_sampling = threading.Event()
        self.session = datetime.datetime.now().astimezone().isoformat(timespec="seconds")

    def sample_loop(self):
        path = self.results_dir / "memory.jsonl"
        while not self.stop_sampling.is_set():
            try:
                used = memory_used_pct()
                with self.lock:
                    running = sorted(self.sched.running)
                with open(path, "a") as f:
                    f.write(json.dumps({"t": round(time.time(), 1), "session": self.session, "used_pct": used,
                                        "active": len(running), "running": running}) + "\n")
            except Exception as e:
                ardia_side.log(f"memory sample failed: {e}")
            self.stop_sampling.wait(SAMPLE_S)

    def worker(self, item, lane, mode, used, lanes_active):
        run_id = item["run_id"]
        started = []

        def on_start():
            with self.lock:
                if not started:
                    started.append(True)
                    self.sched.started(time.time(), mode)

        t0 = time.time()
        with self.lock:
            self.intervals[run_id] = (t0, None)
        try:
            rec = run_item(item, lane, self.results_dir, self.plan, on_start)
        except BaseException as e:
            rec = {"run_id": run_id, "contender": item["contender"]["id"], "task": item["task"],
                   "side": item["contender"]["kind"], "pass": False, "method": None, "invariants": None,
                   "harness_error": f"{type(e).__name__}: {e}"}
        on_start()
        reason = rate_limit_reason(rec)
        if reason:
            rec["harness_error"] = f"rate_limited: {reason}"
        t1 = time.time()
        with self.lock:
            self.intervals[run_id] = (t0, t1)
            concurrent = sorted(rid for rid, (a, b) in self.intervals.items()
                                if rid != run_id and a < t1 and (b is None or b > t0))
            self.sched.finish(run_id, t1, "retry" if rec.get("harness_error") else "done", rate_limited=bool(reason))
            rec.update({"lane": lane.id, "port_offset": item.get("port_offset", 0), "admitted": mode,
                        "lanes_active": lanes_active,
                        "memory_used_pct_at_start": used, "concurrent_runs": concurrent,
                        "run_started_epoch": round(t0, 3), "run_ended_epoch": round(t1, 3)})
            write_json(self.results_dir / "runs" / f"{run_id}.json", rec)
            with open(self.results_dir / "progress.jsonl", "a") as f:
                f.write(json.dumps({"run_id": run_id, "lane": lane.id, "port_offset": item.get("port_offset", 0),
                                    "pass": rec.get("pass"),
                                    "harness_error": rec.get("harness_error"), "lanes_active": lanes_active,
                                    "memory_used_pct_at_start": used, "elapsed_s": round(t1 - t0, 1)}) + "\n")
            write_json(self.results_dir / "summary.json", summary.build(self.results_dir))
        ardia_side.log(f"{run_id} on {lane.id}: pass={rec.get('pass')} {rec.get('harness_error') or ''}")

    def quit_lane(self, lane):
        if lane.id in self.lanes_used:
            ardia_side.quit_instance(self.lanes_used.pop(lane.id))

    def run(self):
        sampler = threading.Thread(target=self.sample_loop, daemon=True)
        sampler.start()
        last_activity = time.time()
        try:
            while True:
                with self.lock:
                    if self.sched.done():
                        break
                    quits = self.sched.idle_lanes_to_quit(time.time())
                    for lane in quits:
                        self.sched.drop_lane(lane)
                for lane in quits:
                    ardia_side.log(f"quitting idle lane {lane.id}")
                    self.quit_lane(lane)
                used = memory_used_pct()
                with self.lock:
                    starts = self.sched.decide(time.time(), used)
                    for item, lane, mode in starts:
                        if lane.kind == "ardia" and item["contender"]["kind"] == "ardia":
                            self.lanes_used[lane.id] = lane_overrides(self.plan, item["contender"], lane)
                        active = len(self.sched.running)
                        ardia_side.log(f"start {item['run_id']} on {lane.id} +{item['port_offset']} "
                                       f"({mode}, {active} active, {used}% used)")
                        t = threading.Thread(target=self.worker, args=(item, lane, mode, used, active), daemon=True)
                        self.threads.append(t)
                        t.start()
                    if starts or self.sched.running:
                        last_activity = time.time()
                if time.time() - last_activity > STALL_S:
                    ardia_side.log(f"nothing could start for {STALL_S:.0f} s (memory {used}%); stopping, resume later")
                    break
                time.sleep(TICK_S)
            for t in self.threads:
                t.join()
        finally:
            self.stop_sampling.set()
            if any(c["kind"] == "aside" for c in self.plan["contenders"]):
                restore_aside_memory()
            if any(c["kind"] == "opencode" for c in self.plan["contenders"]):
                opencode_side.stop_all()
            if any(c["kind"] == "browseruse" for c in self.plan["contenders"]):
                browseruse_side.stop_all()
            if self.plan.get("stop_after", True):
                for lane_id in list(self.lanes_used):
                    ardia_side.quit_instance(self.lanes_used.pop(lane_id))
                ardia_side.quit_instance()
                servers.stop()
            write_json(self.results_dir / "summary.json", summary.build(self.results_dir))


def nominal_durations(plan, results_dir):
    out = {}
    for p in (results_dir / "runs").glob("*.json") if (results_dir / "runs").is_dir() else []:
        r = read_json(p) or {}
        if r.get("wall_s") and not r.get("harness_error"):
            out.setdefault((r["task"], r["contender"]), []).append(r["wall_s"])
    return {k: statistics.median(v) for k, v in out.items()}


def simulate(plan, results_dir, max_lanes, base_used=None):
    sched = make_scheduler(plan, results_dir, max_lanes)
    items = list(sched.pending)
    known = nominal_durations(plan, results_dir)
    base = memory_used_pct() if base_used is None else base_used
    t, finishing, launching, lines, peak = 0.0, {}, {}, [], 0

    def used_now():
        ardia = sum(1 for ln in sched.lanes if ln.kind == "ardia" and (ln.launched or ln.busy))
        aside = any(ln.kind == "aside" for ln in sched.lanes)
        return round(base + 2.5 * ardia + 4.0 * aside + 1.0 * len(sched.running), 1)

    while not sched.done() and t < 7 * 24 * 3600:
        for rid in [r for r, at in launching.items() if at <= t]:
            sched.started(t, "grow")
            del launching[rid]
        for rid in [r for r, at in finishing.items() if at <= t]:
            sched.finish(rid, t)
            del finishing[rid]
        for lane in sched.idle_lanes_to_quit(t):
            sched.drop_lane(lane)
            lines.append(f"{fmt(t)}  quit    {lane.id}")
        used = used_now()
        for item, lane, mode in sched.decide(t, used):
            c = item["contender"]
            dur = known.get((item["task"], c["id"])) or (200.0 if c["kind"] == "aside" else 100.0)
            setup = 20.0 if mode == "grow" else 0.0
            if mode == "grow":
                launching[item["run_id"]] = t + setup
            finishing[item["run_id"]] = t + setup + dur
            peak = max(peak, len(sched.running))
            lines.append(f"{fmt(t)}  start   {lane.id:<20} +{item['port_offset']:<6} {item['run_id']:<38} {mode:<6} "
                         f"active {len(sched.running)}  mem~{used_now()}%")
        t += TICK_S
    lines.append(f"{len(items)} runs, simulated wall {fmt(t)}, peak {peak} lanes, serial sum "
                 f"{fmt(sum(known.get((i['task'], i['contender']['id'])) or (200.0 if i['contender']['kind'] == 'aside' else 100.0) for i in items))}"
                 f" (memory modeled from {base}%: +2.5 per Ardia instance, +4 for Aside, +1 per running agent)")
    return lines


def fmt(seconds):
    s = int(seconds)
    return f"+{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def reserved_ports(plan, max_lanes):
    bases = [("Ardia DevTools", int(plan.get("port") or ardia_side.DEFAULTS["port"]))]
    for c in plan["contenders"]:
        if c["kind"] == "ardia" and c.get("port"):
            bases.append(("Ardia DevTools", int(c["port"])))
        if c["kind"] == "opencode":
            bases += [("OpenCode CDP", int(c.get("cdp_port") or opencode_side.DEFAULTS["cdp_port"])),
                      ("OpenCode relay", int(c.get("relay_port") or opencode_side.DEFAULTS["relay_port"]))]
        if c["kind"] == "browseruse":
            bases.append(("Browser Use CDP", int(c.get("cdp_port") or browseruse_side.DEFAULTS["cdp_port"])))
    return {base + k: f"{name} lane {k}" for name, base in bases for k in range(max_lanes)}


def port_plan(plan, max_lanes):
    task_ids = registry.task_ids(plan.get("tasks", "all"))
    offsets = [0] + [LANE_PORT_STRIDE * (k + 1) for k in range(max_lanes)]
    reserved = reserved_ports(plan, max_lanes)
    owners = dict(reserved)
    clashes = []
    for tid in task_ids:
        for offset in offsets:
            for port in registry.task(tid, offset)["server"]["ports"]:
                label = f"{tid}+{offset}"
                if port in owners:
                    clashes.append(f"{port} ({label} and {owners[port]})")
                elif port >= EPHEMERAL_PORTS_FROM:
                    clashes.append(f"{port} ({label} is in the ephemeral range)")
                owners[port] = label
    if clashes:
        raise SystemExit(f"port offsets collide with {max_lanes} lanes: {', '.join(clashes)}")
    task_ports = [p for tid in task_ids for p in registry.task(tid)["server"]["ports"]]
    return (f"ports: Aside +0, lane k +{LANE_PORT_STRIDE}(k+1); task ports {min(task_ports)}-{max(task_ports)} up to "
            f"+{offsets[-1]}, clear of the {len(reserved)} harness ports")


def resolve_max_lanes(plan, max_lanes):
    return int(max_lanes or plan.get("max_lanes") or DEFAULT_MAX_LANES)


def pin_offsetless_tasks(plan):
    if not any(c["kind"] != "aside" for c in plan["contenders"]):
        return []
    pinned = []
    for tid in registry.task_ids(plan.get("tasks", "all")):
        ok, why = servers.supports_offset(tid, LANE_PORT_STRIDE)
        if not ok:
            ardia_side.log(f"{tid}: its server ignores BENCH_PORT_OFFSET, so its runs share the +0 server one at a "
                           f"time ({why})")
            pinned.append(tid)
    return pinned


def execute(plan_path, results_dir=None, dry_run=False, max_lanes=None):
    plan = json.loads(Path(plan_path).read_text())
    max_lanes = resolve_max_lanes(plan, max_lanes)
    results_dir = Path(results_dir or plan.get("results") or
                       registry.HOME / "results" / datetime.datetime.now().strftime("%Y%m%d-%H%M%S")).expanduser()
    ports_line = port_plan(plan, max_lanes)
    if dry_run:
        print(f"{plan.get('name')}: up to {max_lanes} lanes; {ports_line}")
        for line in simulate(plan, results_dir, max_lanes):
            print(line)
        return None
    ardia_side.log(ports_line)
    write_json(results_dir / "plan.json", dict(plan, registry=str(registry.REGISTRY), max_lanes=max_lanes))
    pinned = pin_offsetless_tasks(plan)
    if any(c["kind"] == "aside" for c in plan["contenders"]) or pinned:
        for tid in registry.task_ids(plan.get("tasks", "all")):
            servers.start(registry.task(tid))
    Executor(plan, results_dir, max_lanes, pinned).run()
    return results_dir
