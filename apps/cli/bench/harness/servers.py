import os
import subprocess
import threading
import time
from pathlib import Path

import registry
from procs import kill_group, listener_pids, proc_info, read_json, same_process, sh, terminate, write_json

STATE = registry.STATE_DIR / "servers.json"
LOGS = registry.HOME / "logs"
LOCK = threading.RLock()


class OffsetUnsupported(RuntimeError):
    pass


def key_of(task):
    offset = task.get("port_offset") or 0
    return f"{task['id']}@{offset}" if offset else task["id"]


def task_of_key(key):
    return key.split("@", 1)[0]


def recorded():
    return read_json(STATE, {})


def running(task):
    rec = recorded().get(key_of(task))
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
                "port_offset": task.get("port_offset") or 0, "foreign": True}
    return None


def cwd_of(pid):
    out = sh(["lsof", "-a", "-d", "cwd", "-Fn", "-p", str(pid)]).stdout
    return next((line[1:] for line in out.splitlines() if line.startswith("n")), None)


def start(task):
    with LOCK:
        return start_locked(task)


def start_locked(task):
    if running(task):
        return recorded()[key_of(task)]
    foreign = same_task_server(task)
    if foreign:
        return foreign
    offset = task.get("port_offset") or 0
    for port in task["server"]["ports"]:
        busy = listener_pids(port)
        if busy:
            raise SystemExit(f"{key_of(task)}: port {port} is used by pid {busy}, not by a server this harness started")
    LOGS.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, BENCH_PORT_OFFSET=str(offset))
    with open(LOGS / f"server-{key_of(task)}.log", "ab") as log:
        proc = subprocess.Popen(task["server"]["command"], cwd=registry.BENCH_DIR, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=log, start_new_session=True, env=env)
    base_ports = [p - offset for p in task["server"]["ports"]]

    def ready():
        mine = {p for p in task["server"]["ports"] if proc.pid in listener_pids(p)}
        if offset and not mine and any(proc.pid in listener_pids(p) for p in base_ports):
            raise OffsetUnsupported(f"{task['id']}: server bound its base ports {base_ports}, not +{offset}; "
                                    f"it has to bind through benchhttp.serve_forever")
        return len(mine) == len(task["server"]["ports"])

    try:
        wait_for_ports(ready, f"{key_of(task)} server", proc)
    except BaseException:
        kill_group(proc, grace=3)
        raise
    info = proc_info(proc.pid)
    rec = {"pid": proc.pid, "lstart": info["lstart"], "command": info["command"], "ports": task["server"]["ports"],
           "port_offset": offset, "started_at": time.time()}
    state = recorded()
    state[key_of(task)] = rec
    write_json(STATE, state)
    return rec


def wait_for_ports(ready, what, proc, seconds=20):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if proc.poll() is not None:
            raise RuntimeError(f"{what}: pid {proc.pid} exited {proc.returncode}")
        if ready():
            return
        time.sleep(0.2)
    raise RuntimeError(f"{what}: not listening within {seconds} s")


def supports_offset(task_id, offset):
    try:
        start(registry.task(task_id, offset))
        return True, None
    except (OffsetUnsupported, RuntimeError) as e:
        return False, str(e)


def stop(task_ids=None):
    with LOCK:
        return stop_locked(task_ids)


def stop_locked(task_ids):
    state = recorded()
    stopped = []
    for key in list(state):
        if task_ids and task_of_key(key) not in task_ids:
            continue
        if terminate(state[key], grace=5):
            stopped.append(key)
        del state[key]
    write_json(STATE, state)
    return stopped
