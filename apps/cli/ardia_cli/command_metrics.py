import math
import time
from contextvars import ContextVar

MAX_MS = 3_600_000
MAX_COUNT = 100_000_000
DURATIONS = frozenset({
    "total_ms", "startup_ms", "daemon_start_ms", "connect_ms", "attach_ms", "snapshot_build_ms", "action_ms", "eval_ms",
    "settle_ms", "cdp_ms_total",
})
COUNTS = frozenset({"cdp_calls", "snapshot_nodes", "snapshot_chars", "output_chars", "network_writes_count", "batch_steps"})
FLAGS = frozenset({"daemon_spawned", "reconnected_after_idle", "output_truncated", "humanize", "unsettled"})
MAIN_PHASE = {"snapshot": "snapshot_build_ms", "eval": "eval_ms"}
OUTPUT_MARKERS = ("\n[output capped at ", "\n[truncated ")

current: ContextVar = ContextVar("ardia_command_metrics", default=None)
last_request_shareable = False


class Metrics:
    def __init__(self, name: str, humanize, shareable: bool):
        self.name = name
        self.shareable = shareable
        self.started = time.perf_counter()
        self.values: dict = {"humanize": bool(humanize), "cdp_calls": 0, "cdp_ms_total": 0.0}
        self.error_code: str | None = None

    def add_ms(self, key: str, started: float) -> None:
        self.values[key] = self.values.get(key, 0.0) + (time.perf_counter() - started) * 1000


def clock() -> float:
    return time.perf_counter()


def begin(request: dict) -> None:
    global last_request_shareable
    argv = request.get("argv") or [""]
    options = request.get("options") or {}
    last_request_shareable = request.get("telemetry") is True
    metrics = Metrics(str(argv[0]), options.get("humanize"), last_request_shareable)
    request["metrics"] = metrics
    current.set(metrics)


def reporting_allowed() -> bool:
    metrics = current.get()
    return metrics.shareable if metrics is not None else last_request_shareable


def spent(key: str, started: float) -> None:
    metrics = current.get()
    if metrics is not None:
        metrics.add_ms(key, started)


def flag(key: str, value: bool) -> None:
    metrics = current.get()
    if metrics is not None:
        metrics.values[key] = bool(value)


def cdp_call(started: float) -> None:
    metrics = current.get()
    if metrics is not None:
        metrics.values["cdp_calls"] += 1
        metrics.add_ms("cdp_ms_total", started)


def rendered(name: str, result, error, out: str) -> None:
    metrics = current.get()
    if metrics is None:
        return
    if error is not None and getattr(error, "code", None):
        metrics.error_code = error.code
    metrics.values["output_truncated"] = any(marker in out for marker in OUTPUT_MARKERS)
    data = getattr(result, "data", None)
    if isinstance(data, dict):
        tree = data.get("snapshot") if name == "snapshot" else None
        if isinstance(tree, str):
            metrics.values["snapshot_nodes"] = tree.count("\n") + 1 if tree else 0
            metrics.values["snapshot_chars"] = len(tree)
        report = data.get("changes")
        if isinstance(report, dict) and isinstance(report.get("network"), list):
            metrics.values["network_writes_count"] = len(report["network"])
            metrics.values["unsettled"] = bool(report.get("unsettled"))
    batch = getattr(result, "batch", None)
    if isinstance(batch, list):
        metrics.values["batch_steps"] = len(batch)


def answer_fields(request: dict) -> dict:
    metrics = request.get("metrics")
    if not isinstance(metrics, Metrics):
        return {}
    total = (time.perf_counter() - metrics.started) * 1000
    inner = sum(metrics.values.get(key, 0) for key in ("connect_ms", "attach_ms", "settle_ms"))
    metrics.values[MAIN_PHASE.get(metrics.name, "action_ms")] = max(0.0, total - inner)
    fields = {"metrics": clean(metrics.values)}
    if metrics.error_code:
        fields["code"] = metrics.error_code
    return fields


def clean(values) -> dict:
    out: dict = {}
    if not isinstance(values, dict):
        return out
    for key, value in values.items():
        if key in FLAGS and isinstance(value, bool):
            out[key] = value
        elif key in DURATIONS | COUNTS and isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            ceiling = MAX_MS if key in DURATIONS else MAX_COUNT
            out[key] = int(min(max(round(value), 0), ceiling))
    return out
