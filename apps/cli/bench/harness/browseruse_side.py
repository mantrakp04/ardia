import datetime
import os
import shutil
import subprocess
import time
from pathlib import Path

import ardia_side
import opencode_side
import grading
import registry
import servers
from procs import front_pid, http, kill_group, kill_on_failure, listener_pids, proc_info, read_json, read_jsonl, sh, terminate, write_json

ROOT = Path(os.environ.get("BENCH_BROWSERUSE_HOME", Path.home() / "ardia-scratch/browser-use"))
DEFAULTS = {
    "venv": str(ROOT / "venv"),
    "chrome": None,
    "cdp_port": 9671,
    "window_size": "1440,900",
    "reach_line": "Use the `browser-use` command to reach this browser.",
}
STRIPPED_ENV_PREFIXES = ("BU_", "BH_", "BROWSER_USE_", "BROWSER_HARNESS_", "OPENCODE_")
SKILL_DIRS = {"claude": ".claude/skills/browser-use", "codex": ".agents/skills/browser-use"}


def log(msg):
    ardia_side.log(f"browseruse: {msg}")


def options(overrides=None):
    opts = dict(DEFAULTS)
    opts.update({k: v for k, v in (overrides or {}).items() if v is not None})
    index = int(opts.get("lane_index") or 0)
    opts["cdp_port"] = int(opts["cdp_port"]) + index
    opts["lane"] = opts.get("lane") or "lane0"
    return opts


def chrome_binary(opts):
    if opts.get("chrome"):
        return Path(opts["chrome"]).expanduser().resolve()
    return opencode_side.chrome_binary({})


def lane_dir(opts):
    return ROOT / "lanes" / opts["lane"]


def state_path(opts):
    return registry.STATE_DIR / f"browseruse-{opts['lane']}.json"


def bin_dir(opts):
    path = ROOT / "bin"
    path.mkdir(parents=True, exist_ok=True)
    link = path / "browser-use"
    target = Path(opts["venv"]) / "bin/browser-use"
    if not target.exists():
        raise SystemExit(f"no browser-use at {target}; run: uv venv -p 3.12 {opts['venv']} && "
                         f"VIRTUAL_ENV={opts['venv']} uv pip install 'browser-use==1.0.0'")
    if not link.is_symlink() or link.resolve() != target.resolve():
        link.unlink(missing_ok=True)
        link.symlink_to(target)
    return path


def harness_env(opts, home):
    return {
        "BU_CDP_URL": f"http://127.0.0.1:{opts['cdp_port']}",
        "BU_NAME": opts["lane"],
        "BH_HOME": str(home / "bh"),
        "BH_TELEMETRY": "0",
        "ANONYMIZED_TELEMETRY": "false",
    }


def agent_env(opts, home, extra=None):
    env = ardia_side.agent_env({"cli": "installed"}, extra)
    env = {k: v for k, v in env.items() if not k.startswith(STRIPPED_ENV_PREFIXES)}
    keep = [p for p in env["PATH"].split(":") if p and Path(p) not in (ardia_side.DEV_BIN, ardia_side.INSTALLED_ARDIA.parent)]
    env["PATH"] = ":".join([str(bin_dir(opts))] + keep)
    env.update(harness_env(opts, home))
    return env


def agent_binary(name):
    path = shutil.which(name, path=ardia_side.agent_env({"cli": "installed"})["PATH"])
    if not path:
        raise SystemExit(f"{name} is not on PATH")
    return path


def daemon_record(home, lane):
    pid_file = home / "bh/runtime" / f"bu-{lane}.pid"
    try:
        pid = int(pid_file.read_text().strip())
    except (OSError, ValueError):
        return None
    info = proc_info(pid)
    if not info or "browser_harness" not in info["command"]:
        return None
    return dict(info, pid=pid)


def stop_lane(opts):
    state = read_json(state_path(opts)) or {}
    stopped = []
    daemon = daemon_record(lane_dir(opts), opts["lane"])
    if daemon and terminate(daemon, grace=5):
        stopped.append(f"daemon {daemon['pid']}")
    rec = state.get("chrome")
    if rec and terminate(rec, grace=10):
        stopped.append(f"chrome {rec['pid']}")
    state_path(opts).unlink(missing_ok=True)
    return stopped


def stop_all():
    stopped = []
    for p in sorted(registry.STATE_DIR.glob("browseruse-*.json")):
        stopped += stop_lane({"lane": p.stem.removeprefix("browseruse-")})
    return stopped


def launch_chrome(opts, home, logs):
    chrome = chrome_binary(opts)
    args = [str(chrome), "--headless=new", f"--user-data-dir={home / 'profile'}",
            f"--remote-debugging-port={opts['cdp_port']}", "--no-first-run", "--no-default-browser-check",
            "--use-mock-keychain", "--password-store=basic", f"--window-size={opts['window_size']}", "about:blank"]
    proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=logs, stderr=logs, start_new_session=True)
    version = kill_on_failure(proc, lambda: opencode_side.chrome_ready(proc, opts))
    return dict(opencode_side.record_of(proc), browser=version.get("Browser"), user_agent=version.get("User-Agent"), args=args)


def versions(opts):
    r = sh([str(Path(opts["venv"]) / "bin/browser-use"), "--version"], timeout=30)
    return (r.stdout or r.stderr).strip()


def prepare(opts, task, home):
    stale = stop_lane(opts)
    if stale:
        log(f"{opts['lane']}: stopped leftovers {stale}")
    busy = listener_pids(opts["cdp_port"])
    if busy:
        raise SystemExit(f"port {opts['cdp_port']} is used by pid {busy}, not by this harness")
    if home.exists():
        shutil.rmtree(home)
    (home / "bh").mkdir(parents=True)
    t0 = time.monotonic()
    state = {}
    with open(home / "chrome.log", "ab") as chrome_log:
        state["chrome"] = launch_chrome(opts, home, chrome_log)
    write_json(state_path(opts), state)
    opened = opencode_side.helper(opts, "open", task["start_url"])
    state["setup_s"] = round(time.monotonic() - t0, 2)
    write_json(state_path(opts), state)
    log(f"{opts['lane']}: Chrome pid {state['chrome']['pid']} on CDP {opts['cdp_port']}, ready in {state['setup_s']} s")
    return state, {"tab": opened}


def install_skill(opts, home, agent, workdir):
    dest = workdir / SKILL_DIRS[agent]
    r = sh([str(bin_dir(opts) / "browser-use"), "skill", "install", "--path", str(dest)], cwd=workdir,
           env=agent_env(opts, home), timeout=60)
    if r.returncode != 0 or not (dest / "SKILL.md").exists():
        raise RuntimeError(f"browser-use skill install failed: {r.stderr.strip() or r.stdout.strip()}")
    return str(dest / "SKILL.md")


def split_shell(shell):
    bu = [c for c in shell if c and "browser-use" in c]
    return bu, [c for c in shell if not (c and "browser-use" in c)]


def run(task_id, agent, run_id, results_dir, overrides=None, contender=None, on_agent_start=None):
    if agent not in ardia_side.MODELS:
        raise SystemExit("agent must be claude or codex")
    opts = options(overrides)
    task = registry.task(task_id, int(opts.get("port_offset") or 0))
    model = opts.get("model") or ardia_side.MODELS[agent][0]
    effort = opts.get("effort") or ardia_side.MODELS[agent][1]
    deadline = int(opts.get("deadline_s") or task["deadline_s"])
    results_dir = Path(results_dir)
    runs_dir = results_dir / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    out_json = runs_dir / f"{run_id}.json"
    events = runs_dir / f"{run_id}.events.jsonl"
    stderr = runs_dir / f"{run_id}.stderr.log"
    home = lane_dir(opts)
    servers.start(task)
    daemon = None
    try:
        baseline = ardia_side.reset_task(task)
        state, setup = prepare(opts, task, home)
        workdir = ardia_side.WORK / run_id
        if workdir.exists():
            shutil.rmtree(workdir)
        workdir.mkdir(parents=True)
        skill = install_skill(opts, home, agent, workdir)
        prompt = f"{task['prompt']}\n\n{opts['reach_line']}" if opts.get("reach_line") else task["prompt"]
        if agent == "codex":
            codex_home = home / "codex-home"
            codex_home.mkdir(parents=True, exist_ok=True)
            env = agent_env(opts, home, {"HOME": str(codex_home), "CODEX_HOME": str(Path.home() / ".codex")})
            cmd = ardia_side.codex_command(model, effort, workdir, prompt)
        else:
            env = agent_env(opts, home)
            cmd = ardia_side.claude_command(model, effort, prompt)
        cmd = [agent_binary(cmd[0])] + cmd[1:]
        front_before = front_pid()
        started_at = datetime.datetime.now().astimezone()
        log(f"{run_id}: {agent} on {task_id} ({opts['lane']}, CDP {opts['cdp_port']})")
        with open(events, "wb") as fo, open(stderr, "wb") as fe, opencode_side.FrontSampler(state["chrome"]["pid"]) as front:
            if on_agent_start:
                on_agent_start()
            start_epoch = time.time()
            t0 = time.monotonic()
            proc = subprocess.Popen(cmd, cwd=workdir, env=env, stdin=subprocess.DEVNULL, stdout=fo, stderr=fe,
                                    start_new_session=True)
            timed_out = False
            try:
                code = proc.wait(timeout=deadline)
            except subprocess.TimeoutExpired:
                timed_out = True
                kill_group(proc)
                code = proc.returncode
            wall = time.monotonic() - t0
        front_after = front_pid()
        kill_group(proc, grace=2)
        try:
            check = http(task["check"]["method"], task["check"]["url"])
        except Exception as e:
            check = {"pass": False, "error": str(e)}
        daemon = daemon_record(home, opts["lane"])
    finally:
        stopped = stop_lane(opts)
    passed, reset_by_agent = grading.grade(check, timed_out, baseline_reset_at_ms=baseline.get("reset_at_ms"))
    completed = check.get("completed_at_ms")
    lines = read_jsonl(events)
    parsed = (ardia_side.parse_claude if agent == "claude" else ardia_side.parse_codex)(lines)
    _, shell, other = (opencode_side.browse_calls_claude if agent == "claude" else opencode_side.browse_calls_codex)(lines)
    bu_calls, other_shell = split_shell(shell)
    record = {
        "run_id": run_id, "side": "browseruse", "contender": contender or f"browseruse-{agent}", "agent": agent,
        "task": task_id, "started_at": started_at.isoformat(timespec="milliseconds"),
        "model": model, "effort": effort, "lane": opts["lane"], "port_offset": task["port_offset"],
        "wall_s": round(wall, 3), "timed_out": timed_out, "deadline_s": deadline, "exit_code": code,
        "pass": passed, "reset_by_agent": reset_by_agent,
        "time_to_correct_s": round(completed / 1000 - start_epoch, 3) if passed and completed else None,
        "commands": len(shell), "browser_use_calls": len(bu_calls), "shell_commands": len(other_shell),
        "shell": shell, "other_tools": other,
        "matched": check.get("matched"), "total": check.get("total"), "extra": check.get("extra"),
        "method": check.get("method"), "invariants": check.get("invariants"),
        "check": check, "check_details": check.get("details"), **parsed,
        "agent_saw": opencode_side.tools_seen_claude(lines) if agent == "claude" else None,
        "prompt": prompt, "command": cmd, "workdir": str(workdir), "skill": skill,
        "instance": {"chrome": {k: state["chrome"][k] for k in ("pid", "browser", "user_agent", "args")},
                     "cdp_port": opts["cdp_port"], "setup_s": state.get("setup_s"), "home": str(home),
                     "browser_use": versions(opts), "daemon": daemon, **setup},
        "focus": {"front_pid_before": front_before, "front_pid_after": front_after,
                  "ours_in_front": state["chrome"]["pid"] in (front_before, front_after),
                  "front_samples": front.samples},
        "frontmost_during_run": front.ours,
        "stopped_after": stopped, "events_file": str(events), "stderr_file": str(stderr),
    }
    write_json(out_json, record)
    log(f"{run_id}: pass={passed} wall={record['wall_s']} s tokens={(record['tokens'] or {}).get('total')} "
        f"commands={record['commands']} (browser-use {len(bu_calls)}) -> {out_json}")
    return record
