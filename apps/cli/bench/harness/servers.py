import subprocess
import threading
import time
from pathlib import Path

import registry
from procs import listener_pids, proc_info, read_json, same_process, sh, terminate, wait_until, write_json

STATE = registry.STATE_DIR / "servers.json"
LOGS = registry.HOME / "logs"
LOCK = threading.RLock()


def recorded():
    return read_json(STATE, {})


def running(task):
    rec = recorded().get(task["id"])
    return bool(rec) and same_process(rec) and all(rec["pid"] in listener_pids(p) for p in task["server"]["ports"])


def same_task_server(task):
    script = task["server"]["command"][-1]
    pids = {tuple(listener_pids(p)) for p in task["server"]["ports"]}
    if len(pids) != 1 or len(next(iter(pids))) != 1:
        return None
    pid = next(iter(pids))[0]
    info = proc_info(pid)
    if info and info["command"].endswith(script) and Path(cwd_of(pid) or "/") == registry.BENCH_DIR:
        return {"pid": pid, "lstart": info["lstart"], "command": info["command"], "ports": task["server"]["ports"],
                "foreign": True}
    return None


def cwd_of(pid):
    out = sh(["lsof", "-a", "-d", "cwd", "-Fn", "-p", str(pid)]).stdout
    return next((line[1:] for line in out.splitlines() if line.startswith("n")), None)


def start(task):
    with LOCK:
        return start_locked(task)


def start_locked(task):
    if running(task):
        return recorded()[task["id"]]
    foreign = same_task_server(task)
    if foreign:
        return foreign
    for port in task["server"]["ports"]:
        busy = listener_pids(port)
        if busy:
            raise SystemExit(f"{task['id']}: port {port} is used by pid {busy}, not by a server this harness started")
    LOGS.mkdir(parents=True, exist_ok=True)
    log = open(LOGS / f"server-{task['id']}.log", "ab")
    proc = subprocess.Popen(task["server"]["command"], cwd=registry.BENCH_DIR, stdin=subprocess.DEVNULL,
                            stdout=log, stderr=log, start_new_session=True)
    wait_until(lambda: all(proc.pid in listener_pids(p) for p in task["server"]["ports"]), 20,
               f"{task['id']} server", pid=proc.pid, step=0.2)
    info = proc_info(proc.pid)
    rec = {"pid": proc.pid, "lstart": info["lstart"], "command": info["command"], "ports": task["server"]["ports"],
           "started_at": time.time()}
    state = recorded()
    state[task["id"]] = rec
    write_json(STATE, state)
    return rec


def stop(task_ids=None):
    with LOCK:
        return stop_locked(task_ids)


def stop_locked(task_ids):
    state = recorded()
    stopped = []
    for tid in list(state):
        if task_ids and tid not in task_ids:
            continue
        if terminate(state[tid], grace=5):
            stopped.append(tid)
        del state[tid]
    write_json(STATE, state)
    return stopped
