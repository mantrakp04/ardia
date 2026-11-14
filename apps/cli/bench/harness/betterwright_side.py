import datetime
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import ardia_side
import grading
import opencode_side
import registry
import servers
from procs import front_pid, http, kill_group, spawn_agent, proc_info, read_json, read_jsonl, sh, terminate, write_json

ROOT = Path(os.environ.get("BENCH_BETTERWRIGHT_HOME", Path.home() / "ardia-scratch/betterwright"))
DEFAULTS = {
    "bin": str(ROOT / "bun/bin"),
    "chromium_root": str(ROOT / "chromium"),
    "reach_line": "Use `betterwright run --session {session}` to reach this browser.",
}
STRIPPED_ENV_PREFIXES = ("BETTERWRIGHT_", "BU_", "BH_", "BROWSER_USE_", "BROWSER_HARNESS_", "OPENCODE_")
SKILL_DIRS = {"claude": ".claude/skills/browser", "codex": ".agents/skills/browser"}
HEADED_FLAGS = ("--headed", "--headed-invisible")
SHIM = """#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    {flags}) echo '{{"ok":false,"error":"this browser runs headless here; drop '"$arg"'"}}'; exit 1;;
  esac
done
exec "{real}" "$@"
"""
DAEMON_PID = re.compile(r"daemon pid (\d+)")
FAILED_CALL = re.compile(r'"ok"\s*:\s*false')


def log(msg):
    ardia_side.log(f"betterwright: {msg}")


def options(overrides=None):
    opts = dict(DEFAULTS)
    opts.update({k: v for k, v in (overrides or {}).items() if v is not None})
    opts["lane"] = opts.get("lane") or "lane0"
    opts["session"] = opts.get("session") or opts["lane"]
    return opts


def lane_dir(opts):
    return ROOT / "lanes" / opts["lane"]


def state_path(opts):
    return registry.STATE_DIR / f"betterwright-{opts['lane']}.json"


def real_binary(opts):
    target = Path(opts["bin"]) / "betterwright"
    if not target.exists() or not (Path(opts["bin"]) / "bun").exists():
        raise SystemExit(f"no bun and betterwright in {opts['bin']}; install Bun 1.4+ there and run: "
                         f"BUN_INSTALL={Path(opts['bin']).parent} bun install -g betterwright")
    return target


def shim_dir(opts):
    path = lane_dir(opts) / "bin"
    path.mkdir(parents=True, exist_ok=True)
    shim = path / "betterwright"
    shim.write_text(SHIM.format(flags="|".join(HEADED_FLAGS), real=real_binary(opts)))
    shim.chmod(0o755)
    return path


def harness_env(opts):
    return {
        "BETTERWRIGHT_HOME": str(lane_dir(opts) / "home"),
        "BETTERWRIGHT_CHROMIUM_ROOT": str(Path(opts["chromium_root"]).expanduser()),
    }


def agent_env(opts, extra=None):
    env = ardia_side.agent_env({"cli": "installed"}, extra)
    env = {k: v for k, v in env.items() if not k.startswith(STRIPPED_ENV_PREFIXES)}
    keep = [p for p in env["PATH"].split(":") if p and Path(p) not in (ardia_side.DEV_BIN, ardia_side.INSTALLED_ARDIA.parent)]
    env["PATH"] = ":".join([str(lane_dir(opts) / "bin"), opts["bin"]] + keep)
    env.update(harness_env(opts))
    return env


def agent_binary(name):
    path = shutil.which(name, path=ardia_side.agent_env({"cli": "installed"})["PATH"])
    if not path:
        raise SystemExit(f"{name} is not on PATH")
    return path


def cli(opts, *args, timeout=90):
    return sh([str(real_binary(opts)), *args], timeout=timeout, env=agent_env(opts), cwd=lane_dir(opts))


def record_of(pid):
    info = proc_info(pid)
    return dict(info, pid=pid) if info else None


def daemon_record(opts):
    m = DAEMON_PID.search(cli(opts, "sessions", timeout=30).stdout)
    return record_of(int(m.group(1))) if m else None


def chrome_record(opts):
    profile = f"--user-data-dir={lane_dir(opts) / 'home' / 'browser'}"
    for line in sh(["ps", "-axo", "pid=,command="]).stdout.splitlines():
        pid, _, command = line.strip().partition(" ")
        if profile in command and "--type=" not in command and pid.isdigit():
            return record_of(int(pid))
    return None


def stop_lane(opts):
    opts = options(opts)
    state = read_json(state_path(opts)) or {}
    stopped = []
    if (lane_dir(opts) / "home").exists():
        try:
            cli(opts, "close", "--all", timeout=30)
        except (subprocess.TimeoutExpired, SystemExit):
            pass
    for name in ("daemon", "chrome"):
        rec = state.get(name)
        if rec and terminate(rec, grace=5):
            stopped.append(f"{name} {rec['pid']}")
    state_path(opts).unlink(missing_ok=True)
    return stopped


def stop_all():
    stopped = []
    for p in sorted(registry.STATE_DIR.glob("betterwright-*.json")):
        stopped += stop_lane({"lane": p.stem.removeprefix("betterwright-")})
    return stopped


def prepare(opts, task):
    stale = stop_lane(opts)
    if stale:
        log(f"{opts['lane']}: stopped leftovers {stale}")
    home = lane_dir(opts)
    if home.exists():
        shutil.rmtree(home)
    (home / "home").mkdir(parents=True)
    shim_dir(opts)
    t0 = time.monotonic()
    snippet = f"await page.goto({json.dumps(task['start_url'])}); return {{url: page.url(), title: await page.title(), open: pages.length}}"
    r = cli(opts, "run", "--session", opts["session"], "--no-auto-ui", "-c", snippet)
    state = {"daemon": daemon_record(opts), "chrome": chrome_record(opts)}
    write_json(state_path(opts), state)
    try:
        opened = json.loads(r.stdout)
    except ValueError:
        raise RuntimeError(f"betterwright run printed no JSON: {r.stderr.strip() or r.stdout.strip()}")
    result = opened.get("result") or {}
    if not opened.get("ok") or result.get("url") != task["start_url"] or result.get("open") != 1:
        raise RuntimeError(f"start page not open: {json.dumps(opened)[:600]}")
    if opened.get("warnings") or not state["daemon"] or not state["chrome"]:
        raise RuntimeError(f"no persistent session: {json.dumps(opened)[:600]}")
    state["setup_s"] = round(time.monotonic() - t0, 2)
    write_json(state_path(opts), state)
    log(f"{opts['lane']}: daemon pid {state['daemon']['pid']}, BetterChromium pid {state['chrome']['pid']}, "
        f"ready in {state['setup_s']} s")
    return state, {"tab": result}


def install_skill(opts, agent, workdir):
    dest = workdir / SKILL_DIRS[agent] / "SKILL.md"
    r = cli(opts, "skill", "--claude", timeout=60)
    if r.returncode != 0 or not r.stdout.startswith("---"):
        raise RuntimeError(f"betterwright skill failed: {r.stderr.strip() or r.stdout.strip()}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(r.stdout)
    return str(dest)


def shell_outputs_claude(events):
    commands, outputs = {}, {}
    for e in events:
        if e.get("parent_tool_use_id"):
            continue
        content = e.get("message", {}).get("content")
        for block in content if isinstance(content, list) else []:
            if block.get("type") == "tool_use" and block.get("name") in ardia_side.SHELL_TOOLS:
                commands[block.get("id")] = (block.get("input") or {}).get("command")
            elif block.get("type") == "tool_result":
                body = block.get("content")
                outputs[block.get("tool_use_id")] = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
    return [(command, outputs.get(key) or "") for key, command in commands.items()]


def shell_outputs_codex(events):
    items = [e.get("item", {}) for e in events if e.get("type") == "item.completed"]
    return [(i.get("command"), i.get("aggregated_output") or "") for i in items if i.get("type") == "command_execution"]


def failed_calls(pairs):
    return sum(len(FAILED_CALL.findall(out.replace("\\", ""))) for command, out in pairs if command and "betterwright" in command)


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
    try:
        baseline = ardia_side.reset_task(task)
        state, setup = prepare(opts, task)
        workdir = ardia_side.WORK / run_id
        if workdir.exists():
            shutil.rmtree(workdir)
        workdir.mkdir(parents=True)
        skill = install_skill(opts, agent, workdir)
        reach = (opts.get("reach_line") or "").format(session=opts["session"])
        prompt = f"{task['prompt']}\n\n{reach}" if reach else task["prompt"]
        if agent == "codex":
            codex_home = home / "codex-home"
            codex_home.mkdir(parents=True, exist_ok=True)
            env = agent_env(opts, {"HOME": str(codex_home), "CODEX_HOME": str(Path.home() / ".codex")})
            cmd = ardia_side.codex_command(model, effort, workdir, prompt)
        else:
            env = agent_env(opts)
            cmd = ardia_side.claude_command(model, effort, prompt)
        cmd = [agent_binary(cmd[0])] + cmd[1:]
        front_before = front_pid()
        started_at = datetime.datetime.now().astimezone()
        log(f"{run_id}: {agent} on {task_id} ({opts['lane']}, session {opts['session']})")
        with open(events, "wb") as fo, open(stderr, "wb") as fe, opencode_side.FrontSampler(state["chrome"]["pid"]) as front:
            if on_agent_start:
                on_agent_start()
            start_epoch = time.time()
            t0 = time.monotonic()
            proc = spawn_agent(cmd, cwd=workdir, env=env, stdin=subprocess.DEVNULL, stdout=fo, stderr=fe)
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
        sessions = cli(opts, "sessions", timeout=30).stdout.strip()
    finally:
        stopped = stop_lane(opts)
    passed, reset_by_agent = grading.grade(check, timed_out, baseline_reset_at_ms=baseline.get("reset_at_ms"))
    completed = check.get("completed_at_ms")
    lines = read_jsonl(events)
    parsed = (ardia_side.parse_claude if agent == "claude" else ardia_side.parse_codex)(lines)
    _, shell, other = (opencode_side.browse_calls_claude if agent == "claude" else opencode_side.browse_calls_codex)(lines)
    bw_calls = [c for c in shell if c and "betterwright" in c]
    pairs = (shell_outputs_claude if agent == "claude" else shell_outputs_codex)(lines)
    record = {
        "run_id": run_id, "side": "betterwright", "contender": contender or f"bw-{agent}", "agent": agent,
        "task": task_id, "started_at": started_at.isoformat(timespec="milliseconds"),
        "model": model, "effort": effort, "lane": opts["lane"], "port_offset": task["port_offset"],
        "wall_s": round(wall, 3), "timed_out": timed_out, "deadline_s": deadline, "exit_code": code,
        "pass": passed, "reset_by_agent": reset_by_agent,
        "time_to_correct_s": round(completed / 1000 - start_epoch, 3) if passed and completed else None,
        "commands": len(shell), "betterwright_calls": len(bw_calls), "shell_commands": len(shell) - len(bw_calls),
        "failed_betterwright_calls": failed_calls(pairs),
        "headed_refused": sum(1 for _, out in pairs if "this browser runs headless here" in out),
        "shell": shell, "other_tools": other,
        "matched": check.get("matched"), "total": check.get("total"), "extra": check.get("extra"),
        "method": check.get("method"), "invariants": check.get("invariants"),
        "check": check, "check_details": check.get("details"), **parsed,
        "agent_saw": opencode_side.tools_seen_claude(lines) if agent == "claude" else None,
        "prompt": prompt, "command": cmd, "workdir": str(workdir), "skill": skill,
        "instance": {"chrome": state["chrome"], "daemon": state["daemon"], "session": opts["session"],
                     "setup_s": state.get("setup_s"), "home": str(home), "betterwright": cli(opts, "--version").stdout.strip(),
                     "sessions_after": sessions, **setup},
        "focus": {"front_pid_before": front_before, "front_pid_after": front_after,
                  "ours_in_front": state["chrome"]["pid"] in (front_before, front_after),
                  "front_samples": front.samples},
        "frontmost_during_run": front.ours,
        "stopped_after": stopped, "events_file": str(events), "stderr_file": str(stderr),
    }
    write_json(out_json, record)
    log(f"{run_id}: pass={passed} wall={record['wall_s']} s tokens={(record['tokens'] or {}).get('total')} "
        f"commands={record['commands']} (betterwright {len(bw_calls)}) -> {out_json}")
    return record
