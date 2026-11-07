import datetime
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import registry
import servers
from procs import (front_pid, http, kill_group, listener_pids, proc_info, read_json, read_jsonl, same_process, sh,
                   terminate, wait_until, write_json)

HOME = registry.HOME
DATA = HOME / "data-ardia"
INSTANCE = registry.STATE_DIR / "ardia-instance.json"
WORK = HOME / "work"
CODEX_FAKE_HOME = HOME / "codex-home"
DEV_BIN = HOME / "devbin"
CLI_ROOT = HOME / "cli"
INSTALLED_ARDIA = Path.home() / ".local/bin/ardia"
DEFAULTS = {
    "app": str(HOME / "app/Ardia.app"),
    "port": 9371,
    "cli": "dev",
    "ardia_test": "cdpTabsVisible",
    "humanize": False,
    "keep_notes": False,
}
MODELS = {"claude": ("claude-opus-5-5", "high"), "codex": ("gpt-6.1-sol", "high")}
STRIPPED_ENV_PREFIXES = ("CLAUDECODE", "CLAUDE_CODE_", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_AGENT_SDK", "AI_AGENT",
                         "T3CODE_", "ARDIA_", "AGENT_BROWSER_", "CODEX_")
KEPT_ENV = {"CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX"}
SHELL_TOOLS = {"Bash", "command_execution"}


def log(msg):
    print(f"[bench] {msg}", file=sys.stderr, flush=True)


def options(overrides=None):
    opts = dict(DEFAULTS)
    opts.update({k: v for k, v in (overrides or {}).items() if v is not None})
    opts["port"] = int(opts["port"])
    return opts


def lane_paths(opts):
    lane = opts.get("lane")
    if not lane:
        return DATA, INSTANCE, CODEX_FAKE_HOME
    return (HOME / f"data-ardia-{lane}", registry.STATE_DIR / f"ardia-instance-{lane}.json",
            HOME / f"codex-home-{lane}")


def ardia_bin(opts):
    return str(DEV_BIN / "ardia") if opts["cli"] == "dev" else str(INSTALLED_ARDIA)


def agent_env(opts, extra=None):
    env = {k: v for k, v in os.environ.items() if k in KEPT_ENV or not k.startswith(STRIPPED_ENV_PREFIXES)}
    path = env.get("PATH", "")
    local_bin = str(INSTALLED_ARDIA.parent)
    if local_bin not in path.split(":"):
        path = f"{local_bin}:{path}"
    if opts["cli"] == "dev":
        path = f"{DEV_BIN}:{path}"
    env["PATH"] = path
    env.update(extra or {})
    return env


def freeze_cli(src):
    src = Path(src).resolve()
    git = sh(["git", "-C", str(src), "rev-parse", "--short", "HEAD"]).stdout.strip()
    dirty = bool(sh(["git", "-C", str(src), "status", "--porcelain", "--", "."]).stdout.strip())
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = CLI_ROOT / f"{stamp}-{git or 'nogit'}"
    shutil.copytree(src, dest / "src", ignore=shutil.ignore_patterns("__pycache__", "tests", "bench", ".pytest_cache"))
    sh(["uv", "venv", "--quiet", "--python", "3.13", str(dest / "venv")], timeout=120).check_returncode()
    sh(["uv", "pip", "install", "--quiet", "--python", str(dest / "venv/bin/python"), str(dest / "src")],
       timeout=300).check_returncode()
    DEV_BIN.mkdir(parents=True, exist_ok=True)
    link = DEV_BIN / "ardia"
    link.unlink(missing_ok=True)
    link.symlink_to(dest / "venv/bin/ardia")
    version = sh([str(link), "--version"]).stdout.strip()
    info = {"path": str(dest), "git": git, "dirty": dirty, "version": version,
            "frozen_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds")}
    write_json(CLI_ROOT / "current.json", info)
    return info


def cli_info(opts):
    if opts["cli"] == "dev":
        info = read_json(CLI_ROOT / "current.json")
        if not info or not (DEV_BIN / "ardia").exists():
            raise SystemExit("no frozen dev CLI; run: bench.py freeze-cli")
        return dict(info, kind="dev")
    return {"kind": "installed", "version": sh([str(INSTALLED_ARDIA), "--version"]).stdout.strip()}


def app_path(opts):
    real = Path(opts["app"]).expanduser().resolve()
    if str(real).startswith("/Applications/"):
        raise SystemExit("refusing an installed app; copy a build into the bench home and pass --app")
    if not (real / "Contents/MacOS/Ardia").exists():
        raise SystemExit(f"no Ardia app at {real}")
    return real


def devtools(opts, method, path, timeout=10):
    req = urllib.request.Request(f"http://127.0.0.1:{opts['port']}{path}", method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    try:
        return json.loads(body)
    except ValueError:
        return body.decode(errors="replace")


def pages(opts):
    return [t for t in devtools(opts, "GET", "/json/list") if t.get("type") == "page"]


def instance_matches(opts, state):
    return (bool(state) and same_process(state) and state["port"] == opts["port"]
            and state["app"] == str(app_path(opts)) and state.get("ardia_test") == opts["ardia_test"]
            and state["pid"] in listener_pids(opts["port"]))


def launch(opts):
    data, instance, _ = lane_paths(opts)
    app = app_path(opts)
    busy = listener_pids(opts["port"])
    if busy:
        raise SystemExit(f"port {opts['port']} is used by pid {busy}; run bench.py stop or pick --port")
    if data.exists():
        shutil.rmtree(data)
    data.mkdir(parents=True)
    (data / "onboarding.json").write_text(json.dumps({"version": 1, "completedAt": 1}))
    logfile = data / "app.out.log"
    t0 = time.monotonic()
    env_args = ["--env", "ARDIA_BACKGROUND=1", "--env", f"ARDIA_DATA_DIR={data}",
                "--env", f"ARDIA_REMOTE_DEBUGGING_PORT={opts['port']}"]
    if opts["ardia_test"]:
        env_args += ["--env", f"ARDIA_TEST={opts['ardia_test']}"]
    subprocess.run(["open", "-g", "-n", *env_args, "--stdout", str(logfile), "--stderr", str(logfile), str(app)],
                   check=True, timeout=30)
    exe = str(app / "Contents/MacOS/Ardia")

    def owned_listener():
        for pid in listener_pids(opts["port"]):
            info = proc_info(pid)
            if info and info["command"].startswith(exe):
                return pid, info
        return None

    pid, info = wait_until(owned_listener, 90, "Ardia DevTools port")
    state = {"pid": pid, "lstart": info["lstart"], "command": info["command"], "port": opts["port"],
             "app": str(app), "ardia_test": opts["ardia_test"], "data": str(data)}
    write_json(instance, state)
    wait_until(lambda: "Browser" in devtools(opts, "GET", "/json/version"), 60, "DevTools /json/version", pid=pid)
    state["launch_s"] = round(time.monotonic() - t0, 2)
    write_json(instance, state)
    log(f"launched Ardia pid {pid} on port {opts['port']} in {state['launch_s']} s")
    return state, False


def ensure_instance(opts):
    _, instance, _ = lane_paths(opts)
    state = read_json(instance)
    if instance_matches(opts, state):
        return state, True
    if state and same_process(state):
        quit_instance(opts)
    instance.unlink(missing_ok=True)
    return launch(opts)


def browse_daemons(data):
    found = []
    for f in (data / "Browse").glob("*.json") if (data / "Browse").is_dir() else []:
        try:
            pid = int(json.loads(f.read_text()).get("pid"))
        except (OSError, ValueError, TypeError, AttributeError):
            continue
        info = proc_info(pid)
        if info and ("ardia_cli" in info["command"] or "python" in info["command"]):
            found.append(pid)
    return found


def stop_browse_daemons(data):
    pids = browse_daemons(data)
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    end = time.monotonic() + 5
    while time.monotonic() < end and any(proc_info(p) for p in pids):
        time.sleep(0.2)
    for pid in pids:
        if proc_info(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    return pids


def prepare_tab(opts, task):
    extras = task.get("extra_urls", []) if task.get("preopen_extra") else []
    seen = []

    def ready():
        current = pages(opts)
        seen[:] = [[t.get("url"), t.get("title")] for t in current]
        starts = [t for t in current if t.get("url") == task["start_url"] and t.get("title")]
        return seen if len(current) == 1 + len(extras) and starts else None

    for attempt in range(3):
        old = pages(opts)
        for url in extras:
            devtools(opts, "PUT", "/json/new?" + urllib.parse.quote(url, safe=":/?&=#"))
        tab = devtools(opts, "PUT", "/json/new?" + urllib.parse.quote(task["start_url"], safe=":/?&=#"))
        devtools(opts, "GET", f"/json/activate/{tab['id']}")
        for t in old:
            try:
                devtools(opts, "GET", f"/json/close/{t['id']}")
            except Exception:
                pass
        try:
            return wait_until(ready, 10, f"one tab on {task['start_url']}")
        except RuntimeError:
            log(f"tab prep attempt {attempt + 1} saw {seen}")
    raise RuntimeError(f"tab on {task['start_url']}: not ready after 3 attempts, last {seen}")


def reset_task(task):
    http(task["reset"]["method"], task["reset"]["url"])
    baseline = http(task["check"]["method"], task["check"]["url"])
    if baseline.get("pass"):
        raise RuntimeError(f"{task['id']}: check passes right after reset")
    return baseline


def reach_line(opts):
    return f"Use the `ardia` command with `--port {opts['port']}` to reach this Ardia instance."


def claude_command(model, effort, prompt):
    return ["claude", "-p", "--model", model, "--effort", effort, "--output-format", "stream-json", "--verbose",
            "--dangerously-skip-permissions", "--setting-sources", "project", "--strict-mcp-config",
            "--no-session-persistence", prompt]


def codex_command(model, effort, workdir, prompt):
    return ["codex", "exec", "--json", "-m", model, "-c", f'model_reasoning_effort="{effort}"',
            "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check",
            "--dangerously-bypass-approvals-and-sandbox",
            "--disable", "plugins", "--disable", "apps", "--disable", "browser_use",
            "--disable", "browser_use_external", "--disable", "computer_use", "--disable", "in_app_browser",
            "--disable", "memories", "-C", str(workdir), prompt]


def parse_claude(lines):
    tools, turns, final, result, init = [], 0, None, None, None
    for e in lines:
        kind = e.get("type")
        if kind == "system" and e.get("subtype") == "init":
            init = {"skills": e.get("skills"), "mcp_servers": e.get("mcp_servers"), "model": e.get("model")}
        elif kind == "assistant" and not e.get("parent_tool_use_id"):
            turns += 1
            for block in e.get("message", {}).get("content", []):
                if block.get("type") == "tool_use":
                    inp = block.get("input", {})
                    tools.append({"name": block.get("name"),
                                  "input": (inp.get("command") or inp.get("skill") or json.dumps(inp))[:400]})
                elif block.get("type") == "text":
                    final = block.get("text")
        elif kind == "result":
            result = e
    tokens = cost = None
    if result:
        mu = result.get("modelUsage") or {}
        fresh = sum(m.get("inputTokens", 0) for m in mu.values())
        created = sum(m.get("cacheCreationInputTokens", 0) for m in mu.values())
        read = sum(m.get("cacheReadInputTokens", 0) for m in mu.values())
        out = sum(m.get("outputTokens", 0) for m in mu.values())
        tokens = {"input": fresh + created + read, "cached_input": read, "cache_write_input": created,
                  "uncached_input": fresh, "output": out, "total": fresh + created + read + out,
                  "raw_usage": result.get("usage"), "model_usage": mu}
        cost = result.get("total_cost_usd")
        final = result.get("result", final)
    return {"tokens": tokens, "cost_usd": cost, "tool_calls": len(tools), "tools": tools,
            "turns": result.get("num_turns") if result else turns, "final_message": final,
            "cli_duration_ms": result.get("duration_ms") if result else None,
            "cli_duration_api_ms": result.get("duration_api_ms") if result else None,
            "cli_result_subtype": result.get("subtype") if result else None,
            "cli_is_error": result.get("is_error") if result else None, "init": init}


def parse_codex(lines):
    tools, final, usage, turns, errors = [], None, {}, 0, []
    for e in lines:
        kind = e.get("type")
        if kind == "turn.completed":
            turns += 1
            for k, v in (e.get("usage") or {}).items():
                if isinstance(v, (int, float)):
                    usage[k] = usage.get(k, 0) + v
        elif kind == "item.completed":
            item = e.get("item", {})
            t = item.get("type")
            if t == "agent_message":
                final = item.get("text")
            elif t == "error":
                errors.append(item.get("message", "")[:400])
            elif t not in ("reasoning", "todo_list"):
                tools.append({"name": t, "input": (item.get("command") or item.get("tool") or json.dumps(
                    {k: v for k, v in item.items() if k != "aggregated_output"}))[:400], "exit_code": item.get("exit_code")})
        elif kind in ("turn.failed", "error"):
            errors.append(json.dumps(e)[:400])
    inp, out = usage.get("input_tokens", 0), usage.get("output_tokens", 0)
    tokens = {"input": inp, "cached_input": usage.get("cached_input_tokens", 0), "output": out,
              "reasoning_output": usage.get("reasoning_output_tokens", 0), "total": inp + out,
              "raw_usage": usage} if usage else None
    return {"tokens": tokens, "cost_usd": None, "tool_calls": len(tools), "tools": tools, "turns": turns,
            "final_message": final, "errors": errors}


def notes_snapshot(data):
    notes = data / "Notes"
    return {f.name: f.read_text(errors="replace") for f in sorted(notes.glob("*.md"))} if notes.is_dir() else {}


def run(task_id, agent, run_id, results_dir, overrides=None, contender=None, on_agent_start=None):
    if agent not in MODELS:
        raise SystemExit("agent must be claude or codex")
    opts = options(overrides)
    data, _, codex_home = lane_paths(opts)
    task = registry.task(task_id)
    model, effort = opts.get("model") or MODELS[agent][0], opts.get("effort") or MODELS[agent][1]
    deadline = int(opts.get("deadline_s") or task["deadline_s"])
    results_dir = Path(results_dir)
    runs_dir = results_dir / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    out_json = runs_dir / f"{run_id}.json"
    events = runs_dir / f"{run_id}.events.jsonl"
    stderr = runs_dir / f"{run_id}.stderr.log"
    cli = cli_info(opts)
    servers.start(task)
    state, reused = ensure_instance(opts)
    stop_browse_daemons(data)
    if not opts["keep_notes"]:
        shutil.rmtree(data / "Notes", ignore_errors=True)
    baseline = reset_task(task)
    tab = prepare_tab(opts, task)
    workdir = WORK / run_id
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True)
    target = "claude-code" if agent == "claude" else "codex"
    sh([ardia_bin(opts), "skills", "install", "--target", target, "--project"], cwd=workdir,
       env=agent_env(opts)).check_returncode()
    prompt = f"{task['prompt']}\n\n{reach_line(opts)}"
    extra = {"ARDIA_DATA_DIR": str(data)}
    if opts["humanize"]:
        extra["AGENT_BROWSER_HUMANIZE"] = "1"
    if agent == "codex":
        codex_home.mkdir(parents=True, exist_ok=True)
        extra.update({"HOME": str(codex_home), "CODEX_HOME": str(Path.home() / ".codex")})
        cmd = codex_command(model, effort, workdir, prompt)
    else:
        cmd = claude_command(model, effort, prompt)
    env = agent_env(opts, extra)
    front_before = front_pid()
    started_at = datetime.datetime.now().astimezone()
    log(f"{run_id}: {agent} on {task_id} (Ardia pid {state['pid']}, {'reused' if reused else 'launched'})")
    with open(events, "wb") as fo, open(stderr, "wb") as fe:
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
    daemons = stop_browse_daemons(data)
    try:
        check = http(task["check"]["method"], task["check"]["url"])
    except Exception as e:
        check = {"pass": False, "error": str(e)}
    reset_by_agent = check.get("reset_at_ms") is not None and check.get("reset_at_ms") != baseline.get("reset_at_ms")
    passed = bool(check.get("pass")) and not reset_by_agent
    completed = check.get("completed_at_ms")
    parsed = (parse_claude if agent == "claude" else parse_codex)(read_jsonl(events))
    record = {
        "run_id": run_id, "side": "ardia", "contender": contender or f"ardia-{agent}", "agent": agent,
        "task": task_id, "started_at": started_at.isoformat(timespec="milliseconds"),
        "model": model, "effort": effort, "cli": cli, "humanize": opts["humanize"], "notes_kept": opts["keep_notes"],
        "notes_after": notes_snapshot(data), "lane": opts.get("lane"),
        "wall_s": round(wall, 3), "timed_out": timed_out, "deadline_s": deadline, "exit_code": code,
        "pass": passed, "reset_by_agent": reset_by_agent,
        "time_to_correct_s": round(completed / 1000 - start_epoch, 3) if passed and completed else None,
        "commands": sum(1 for t in parsed["tools"] if t["name"] in SHELL_TOOLS),
        "matched": check.get("matched"), "total": check.get("total"), "extra": check.get("extra"),
        "check": check, "check_details": check.get("details"), **parsed,
        "prompt": prompt, "command": cmd, "workdir": str(workdir),
        "instance": {"pid": state["pid"], "port": opts["port"], "app": state["app"], "ardia_test": opts["ardia_test"],
                     "reused": reused, "launch_s": state.get("launch_s"), "tab_before_run": tab},
        "focus": {"front_pid_before": front_before, "front_pid_after": front_after,
                  "ours_in_front": state["pid"] in (front_before, front_after)},
        "browse_daemons_stopped": daemons, "events_file": str(events), "stderr_file": str(stderr),
    }
    write_json(out_json, record)
    log(f"{run_id}: pass={passed} wall={record['wall_s']} s tokens={(record['tokens'] or {}).get('total')} "
        f"commands={record['commands']} -> {out_json}")
    return record


def quit_instance(opts=None):
    data, instance, _ = lane_paths(opts or {})
    state = read_json(instance)
    stopped = stop_browse_daemons(data) if data.exists() else []
    if not state:
        log("no recorded Ardia instance")
    elif not same_process(state):
        log(f"recorded Ardia pid {state['pid']} is gone or not ours; nothing to quit")
    else:
        log(f"Ardia pid {state['pid']} {'quit' if terminate(state) else 'still running'}")
    instance.unlink(missing_ok=True)
    if stopped:
        log(f"stopped ardia browse daemons {stopped}")
