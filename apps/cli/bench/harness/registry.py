import copy
import importlib.util
import json
import os
from pathlib import Path

BENCH_DIR = Path(__file__).resolve().parent.parent
REGISTRY = Path(os.environ.get("BENCH_REGISTRY", BENCH_DIR / "tasks.json"))
HOME = Path(os.environ.get("BENCH_HOME", Path.home() / "ardia-scratch/bench-proper"))
STATE_DIR = HOME / "state"


def load_benchhttp():
    spec = importlib.util.spec_from_file_location("bench_task_http", BENCH_DIR / "tasks/benchhttp.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


benchhttp = load_benchhttp()


def load():
    return json.loads(REGISTRY.read_text())["tasks"]


def task(task_id, port_offset=0):
    for t in load():
        if t["id"] == task_id:
            return at_offset(t, port_offset)
    raise SystemExit(f"no task {task_id!r} in {REGISTRY}; known: {', '.join(t['id'] for t in load())}")


def at_offset(task, port_offset):
    out = copy.deepcopy(task)
    out["port_offset"] = port_offset
    if not port_offset:
        return out
    base_ports = task["server"]["ports"]

    def move(value):
        return benchhttp.rewrite_ports(value, base_ports, port_offset)

    out["server"]["ports"] = [p + port_offset for p in base_ports]
    out["start_url"] = move(task["start_url"])
    out["extra_urls"] = [move(u) for u in task.get("extra_urls", [])]
    out["prompt"] = move(task["prompt"])
    for key in ("reset", "check"):
        out[key]["url"] = move(task[key]["url"])
    return out


def task_ids(selection):
    ids = [t["id"] for t in load()]
    if selection in (None, "all", ["all"]):
        return ids
    if isinstance(selection, str):
        selection = [selection]
    missing = [s for s in selection if s not in ids]
    if missing:
        raise SystemExit(f"tasks not in {REGISTRY}: {', '.join(missing)}; known: {', '.join(ids)}")
    return list(selection)
