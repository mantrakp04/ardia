import datetime
import json
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

import ardia_side
import registry
import servers
from procs import (front_pid, http, kill_group, listener_pids, proc_info, read_json, read_jsonl, same_process, sh,
                   terminate, wait_until, write_json)

ROOT = Path(os.environ.get("BENCH_OPENCODE_HOME", Path.home() / "ardia-scratch/opencode-browse"))
CDP_HELPER = Path(__file__).resolve().parent / "opencode_cdp.mjs"
EXTENSION_ID = "mfnicocicmmlkpjnaffgihfjhdgjkdjg"
DEFAULTS = {
    "browse_entry": str(ROOT / "npm/node_modules/@opencode/browse/dist/cli.mjs"),
    "extension": str(ROOT / "ext/store-0.0.10"),
    "chrome": None,
    "cdp_port": 9571,
    "relay_port": 19990,
    "window_size": "1440,900",
    "reach_line": "Use the `browse` MCP tools to reach this browser.",
}
BROWSE_TOOL = re.compile(r"^mcp__browse__(.+)$")
STRIPPED_ENV_PREFIXES = ("OPENCODE_",)
FRONT_SAMPLE_S = 1.0


def log(msg):
    ardia_side.log(f"opencode: {msg}")


def options(overrides=None):
    opts = dict(DEFAULTS)
    opts.update({k: v for k, v in (overrides or {}).items() if v is not None})
    index = int(opts.get("lane_index") or 0)
    opts["cdp_port"] = int(opts["cdp_port"]) + index
    opts["relay_port"] = int(opts["relay_port"]) + index
    opts["lane"] = opts.get("lane") or "lane0"
    return opts


def chrome_binary(opts):
    if opts.get("chrome"):
        path = Path(opts["chrome"]).expanduser()
    else:
        found = sorted((ROOT / "browsers/chrome").glob(
            "*/chrome-mac-*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"))
        if not found:
            raise SystemExit(f"no Chrome for Testing under {ROOT / 'browsers'}; run: npx @puppeteer/browsers install "
                             f"chrome@stable --path {ROOT / 'browsers'}")
        path = found[-1]
    real = path.resolve()
    if not str(real).startswith(str(ROOT.resolve())):
        raise SystemExit(f"refusing a browser outside {ROOT}: {real}")
    return real


def lane_dir(opts):
    return ROOT / "lanes" / opts["lane"]


def state_path(opts):
    return registry.STATE_DIR / f"opencode-{opts['lane']}.json"


def browse_env(home):
    return {
        "OPENCODE_BROWSER_HOME": str(home / "browse"),
        "OPENCODE_BROWSER_AUTO_UPDATE": "off",
        "OPENCODE_BROWSER_UPDATE_CHECK": "0",
        "OPENCODE_BROWSER_AUTOSTART": "false",
        "XDG_CONFIG_HOME": str(home / "xdg/config"),
        "XDG_DATA_HOME": str(home / "xdg/data"),
        "XDG_STATE_HOME": str(home / "xdg/state"),
        "XDG_CACHE_HOME": str(home / "xdg/cache"),
    }


def relay_env(opts, home):
    env = {k: os.environ[k] for k in ("PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG") if k in os.environ}
    env.update(browse_env(home))
    env["OPENCODE_BROWSER_PORT"] = str(opts["relay_port"])
    return env


def mcp_env(opts, home):
    return dict(browse_env(home), OPENCODE_BROWSER_PORT=str(opts["relay_port"]))


def node_bin():
    path = shutil.which("node")
    if not path:
        raise SystemExit("node is not on PATH")
    return str(Path(path).resolve())


def record_of(proc):
    info = proc_info(proc.pid)
    if not info:
        raise RuntimeError(f"pid {proc.pid} exited right after starting")
    return {"pid": proc.pid, "lstart": info["lstart"], "command": info["command"]}


def stop_lane(opts):
    state = read_json(state_path(opts)) or {}
    stopped = []
    for name in ("relay", "chrome"):
        rec = state.get(name)
        if rec and same_process(rec) and terminate(rec, grace=10):
            stopped.append(f"{name} {rec['pid']}")
    state_path(opts).unlink(missing_ok=True)
    return stopped


def stop_all():
    stopped = []
    for p in sorted(registry.STATE_DIR.glob("opencode-*.json")):
        stopped += stop_lane({"lane": p.stem.removeprefix("opencode-")})
    return stopped


def helper(opts, *args, timeout=60):
    r = sh([node_bin(), str(CDP_HELPER), args[0], str(opts["cdp_port"]), *map(str, args[1:])], timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"opencode_cdp {args[0]}: {r.stderr.strip() or r.stdout.strip()}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def browse(opts, home, *args, timeout=30):
    return sh([node_bin(), opts["browse_entry"], *args], timeout=timeout, env=relay_env(opts, home))


def browse_status(opts, home):
    r = browse(opts, home, "status", "--json")
    return json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}


def launch_chrome(opts, home, logs):
    chrome = chrome_binary(opts)
    profile = home / "profile"
    args = [str(chrome), "--headless=new", f"--user-data-dir={profile}", f"--remote-debugging-port={opts['cdp_port']}",
            f"--load-extension={opts['extension']}", f"--disable-extensions-except={opts['extension']}",
            "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check",
            "--use-mock-keychain", "--password-store=basic", f"--window-size={opts['window_size']}", "about:blank"]
    proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=logs, stderr=logs, start_new_session=True)
    rec = record_of(proc)
    wait_until(lambda: proc.pid in listener_pids(opts["cdp_port"]), 30, "Chrome DevTools port", pid=proc.pid)
    version = wait_until(lambda: http("GET", f"http://127.0.0.1:{opts['cdp_port']}/json/version"), 20,
                         "Chrome /json/version", pid=proc.pid)
    return dict(rec, browser=version.get("Browser"), user_agent=version.get("User-Agent"), args=args)


def start_relay(opts, home, logs):
    proc = subprocess.Popen([node_bin(), opts["browse_entry"], "serve"], cwd=home, env=relay_env(opts, home),
                            stdin=subprocess.DEVNULL, stdout=logs, stderr=logs, start_new_session=True)
    rec = record_of(proc)
    wait_until(lambda: proc.pid in listener_pids(opts["relay_port"]), 30, "browse relay port", pid=proc.pid)
    return rec


def pair(opts, home):
    proc = subprocess.Popen([node_bin(), opts["browse_entry"], "pair", "--wait-seconds", "60"], cwd=home,
                            env=relay_env(opts, home), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, start_new_session=True)
    lines = []
    try:
        code = None
        end = time.monotonic() + 30
        while code is None and time.monotonic() < end:
            line = proc.stdout.readline()
            if not line:
                break
            lines.append(line.rstrip())
            m = re.search(r"Pairing code:\s*([0-9A-Z]{4}-[0-9A-Z]{4})", line)
            code = m.group(1) if m else None
        if not code:
            raise RuntimeError(f"browse pair printed no code: {lines}")
        helper(opts, "pair", EXTENSION_ID, opts["relay_port"], code)
        out, _ = proc.communicate(timeout=60)
        lines += out.splitlines()
        if proc.returncode != 0:
            raise RuntimeError(f"browse pair exited {proc.returncode}: {lines}")
        return lines
    finally:
        if proc.poll() is None:
            kill_group(proc, grace=2)


def lent_target(opts, home, url):
    status = browse_status(opts, home)
    ext = status.get("extension") or {}
    targets = [t for t in ext.get("targets") or [] if t.get("owner") == "user" and t.get("url") == url]
    return (status, targets[0]) if ext.get("connected") and len(ext.get("targets") or []) == 1 and targets else None


def prepare(opts, task, home):
    stale = stop_lane(opts)
    if stale:
        log(f"{opts['lane']}: stopped leftovers {stale}")
    for port in (opts["cdp_port"], opts["relay_port"]):
        busy = listener_pids(port)
        if busy:
            raise SystemExit(f"port {port} is used by pid {busy}, not by this harness")
    if home.exists():
        shutil.rmtree(home)
    (home / "browse").mkdir(parents=True)
    for d in ("config", "data", "state", "cache"):
        (home / "xdg" / d).mkdir(parents=True)
    t0 = time.monotonic()
    state = {}
    with open(home / "chrome.log", "ab") as chrome_log, open(home / "relay.log", "ab") as relay_log:
        state["chrome"] = launch_chrome(opts, home, chrome_log)
        write_json(state_path(opts), state)
        state["relay"] = start_relay(opts, home, relay_log)
        write_json(state_path(opts), state)
    pair_lines = pair(opts, home)
    opened = helper(opts, "open", task["start_url"])
    helper(opts, "lend", EXTENSION_ID, task["start_url"])
    status, target = wait_until(lambda: lent_target(opts, home, task["start_url"]), 20,
                                f"lent tab on {task['start_url']}")
    state["setup_s"] = round(time.monotonic() - t0, 2)
    write_json(state_path(opts), state)
    log(f"{opts['lane']}: Chrome pid {state['chrome']['pid']}, relay pid {state['relay']['pid']}, "
        f"tab lent in {state['setup_s']} s")
    return state, {"pairing": pair_lines, "tab": opened, "lent": target,
                   "relay_version": (status.get("relay") or {}).get("version"),
                   "extension_version": (status.get("extension") or {}).get("version")}


def mcp_server(opts, home):
    return {"command": node_bin(), "args": [opts["browse_entry"], "mcp"], "env": mcp_env(opts, home)}


def claude_command(model, effort, prompt, mcp_config):
    cmd = ardia_side.claude_command(model, effort, prompt)
    return cmd[:2] + ["--mcp-config", str(mcp_config)] + cmd[2:]


def toml_string(value):
    return json.dumps(value)


def codex_command(model, effort, workdir, prompt, server):
    cmd = ardia_side.codex_command(model, effort, workdir, prompt)
    env = ", ".join(f"{k} = {toml_string(v)}" for k, v in server["env"].items())
    flags = ["-c", f"mcp_servers.browse.command={toml_string(server['command'])}",
             "-c", f"mcp_servers.browse.args={json.dumps(server['args'])}",
             "-c", f"mcp_servers.browse.env={{ {env} }}"]
    return cmd[:-1] + flags + [prompt]


def agent_env(extra):
    env = ardia_side.agent_env({"cli": "installed"}, extra)
    env = {k: v for k, v in env.items() if not k.startswith(STRIPPED_ENV_PREFIXES)}
    env["PATH"] = ":".join(p for p in env["PATH"].split(":") if p and Path(p) != ardia_side.DEV_BIN)
    return env


def browse_calls_claude(events):
    calls, shell, other = [], [], []
    for e in events:
        if e.get("type") != "assistant" or e.get("parent_tool_use_id"):
            continue
        for block in e.get("message", {}).get("content", []):
            if block.get("type") != "tool_use":
                continue
            m = BROWSE_TOOL.match(block.get("name") or "")
            inp = block.get("input") or {}
            if m:
                calls.append({"tool": m.group(1), "arguments": inp})
            elif block.get("name") in ardia_side.SHELL_TOOLS:
                shell.append(inp.get("command"))
            else:
                other.append(block.get("name"))
    return calls, shell, other


def browse_calls_codex(events):
    calls, shell, other = [], [], []
    for e in events:
        if e.get("type") != "item.completed":
            continue
        item = e.get("item", {})
        kind = item.get("type")
        if kind == "mcp_tool_call" and item.get("server") == "browse":
            calls.append({"tool": item.get("tool"), "arguments": item.get("arguments"), "status": item.get("status"),
                          "error": item.get("error")})
        elif kind == "command_execution":
            shell.append(item.get("command"))
        elif kind not in ("reasoning", "todo_list", "agent_message", "error"):
            other.append(kind if kind != "mcp_tool_call" else f"{item.get('server')}.{item.get('tool')}")
    return calls, shell, other


def tools_seen_claude(events):
    for e in events:
        if e.get("type") == "system" and e.get("subtype") == "init":
            return {"tools": e.get("tools"), "mcp_servers": e.get("mcp_servers"), "skills": e.get("skills"),
                    "slash_commands": e.get("slash_commands")}
    return None


class FrontSampler:
    def __init__(self, pid):
        self.pid, self.samples, self.ours = pid, 0, 0
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.loop, daemon=True)

    def loop(self):
        while not self.stop.is_set():
            try:
                self.samples += 1
                self.ours += int(front_pid() == self.pid)
            except Exception:
                pass
            self.stop.wait(FRONT_SAMPLE_S)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.stop.set()
        self.thread.join(timeout=5)


def run(task_id, agent, run_id, results_dir, overrides=None, contender=None, on_agent_start=None):
    if agent not in ardia_side.MODELS:
        raise SystemExit("agent must be claude or codex")
    opts = options(overrides)
    task = registry.task(task_id)
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
        state, setup = prepare(opts, task, home)
        workdir = ardia_side.WORK / run_id
        if workdir.exists():
            shutil.rmtree(workdir)
        workdir.mkdir(parents=True)
        server = mcp_server(opts, home)
        prompt = f"{task['prompt']}\n\n{opts['reach_line']}" if opts.get("reach_line") else task["prompt"]
        if agent == "codex":
            codex_home = home / "codex-home"
            codex_home.mkdir(parents=True, exist_ok=True)
            env = agent_env({"HOME": str(codex_home), "CODEX_HOME": str(Path.home() / ".codex")})
            cmd = codex_command(model, effort, workdir, prompt, server)
            mcp_config = None
        else:
            mcp_config = home / "mcp.json"
            write_json(mcp_config, {"mcpServers": {"browse": {"type": "stdio", **server}}})
            env = agent_env({})
            cmd = claude_command(model, effort, prompt, mcp_config)
        front_before = front_pid()
        started_at = datetime.datetime.now().astimezone()
        log(f"{run_id}: {agent} on {task_id} ({opts['lane']}, CDP {opts['cdp_port']}, relay {opts['relay_port']})")
        with open(events, "wb") as fo, open(stderr, "wb") as fe, FrontSampler(state["chrome"]["pid"]) as front:
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
        try:
            status_after = browse_status(opts, home)
        except Exception as e:
            status_after = {"error": str(e)}
    finally:
        stopped = stop_lane(opts)
    reset_by_agent = check.get("reset_at_ms") is not None and check.get("reset_at_ms") != baseline.get("reset_at_ms")
    passed = bool(check.get("pass")) and not reset_by_agent
    completed = check.get("completed_at_ms")
    lines = read_jsonl(events)
    parsed = (ardia_side.parse_claude if agent == "claude" else ardia_side.parse_codex)(lines)
    calls, shell, other = (browse_calls_claude if agent == "claude" else browse_calls_codex)(lines)
    by_tool = {}
    for c in calls:
        by_tool[c["tool"]] = by_tool.get(c["tool"], 0) + 1
    record = {
        "run_id": run_id, "side": "opencode", "contender": contender or f"opencode-{agent}", "agent": agent,
        "task": task_id, "started_at": started_at.isoformat(timespec="milliseconds"),
        "model": model, "effort": effort, "lane": opts["lane"],
        "wall_s": round(wall, 3), "timed_out": timed_out, "deadline_s": deadline, "exit_code": code,
        "pass": passed, "reset_by_agent": reset_by_agent,
        "time_to_correct_s": round(completed / 1000 - start_epoch, 3) if passed and completed else None,
        "commands": len(calls) + len(shell), "mcp_calls": len(calls), "shell_commands": len(shell),
        "browse_calls_by_tool": by_tool, "browse_calls": calls, "shell": shell, "other_tools": other,
        "matched": check.get("matched"), "total": check.get("total"), "extra": check.get("extra"),
        "check": check, "check_details": check.get("details"), **parsed,
        "agent_saw": tools_seen_claude(lines) if agent == "claude" else None,
        "prompt": prompt, "command": cmd, "workdir": str(workdir), "mcp_server": server,
        "mcp_config": str(mcp_config) if mcp_config else None,
        "instance": {"chrome": {k: state["chrome"][k] for k in ("pid", "browser", "user_agent", "args")},
                     "relay_pid": state["relay"]["pid"], "cdp_port": opts["cdp_port"],
                     "relay_port": opts["relay_port"], "setup_s": state.get("setup_s"), "home": str(home),
                     "browse_entry": opts["browse_entry"], "extension": opts["extension"], **setup},
        "browse_status_after": {"targets": (status_after.get("extension") or {}).get("targets"),
                                "sessions": status_after.get("sessions"), "error": status_after.get("error")},
        "focus": {"front_pid_before": front_before, "front_pid_after": front_after,
                  "ours_in_front": state["chrome"]["pid"] in (front_before, front_after),
                  "front_samples": front.samples},
        "frontmost_during_run": front.ours,
        "stopped_after": stopped, "events_file": str(events), "stderr_file": str(stderr),
    }
    write_json(out_json, record)
    log(f"{run_id}: pass={passed} wall={record['wall_s']} s tokens={(record['tokens'] or {}).get('total')} "
        f"commands={record['commands']} (browse {len(calls)}, shell {len(shell)}) -> {out_json}")
    return record
