import json
import os
from pathlib import Path

BENCH_DIR = Path(__file__).resolve().parent.parent
REGISTRY = Path(os.environ.get("BENCH_REGISTRY", BENCH_DIR / "tasks.json"))
HOME = Path(os.environ.get("BENCH_HOME", Path.home() / "ardia-scratch/bench-proper"))
STATE_DIR = HOME / "state"


def load():
    return json.loads(REGISTRY.read_text())["tasks"]


def task(task_id):
    for t in load():
        if t["id"] == task_id:
            return t
    raise SystemExit(f"no task {task_id!r} in {REGISTRY}; known: {', '.join(t['id'] for t in load())}")


def task_ids(selection):
    ids = [t["id"] for t in load()]
    if selection in (None, "all", ["all"]):
        return ids
    for s in selection:
        task(s)
    return list(selection)
