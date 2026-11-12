import re

QUEUE_WAIT = 30.0
COMMAND_LIMIT = 120.0
LIMIT_MARGIN = 30.0
SCRIPT_DEFAULT = 90.0
DEFAULT_TIMEOUT_MS = 25000
LONG_COMMANDS = {"batch": 600.0, "read": 600.0, "record": 600.0}


def seconds_of(text: str | None) -> float | None:
    if not text:
        return None
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(ms|s|m)?", text.strip())
    if not match:
        return None
    number, unit = float(match.group(1)), match.group(2) or "ms"
    return number * {"ms": 0.001, "s": 1, "m": 60}[unit]


def command_limit(name: str, argv: list[str], timeout: float) -> float:
    given = None
    if "--timeout" in argv and argv.index("--timeout") + 1 < len(argv):
        given = seconds_of(argv[argv.index("--timeout") + 1])
    if name == "wait":
        plain = next((seconds_of(arg) for arg in argv if re.fullmatch(r"\d+(\.\d+)?", arg)), None)
        return max(COMMAND_LIMIT, (given or plain or timeout) + LIMIT_MARGIN)
    if name == "script":
        return (given or SCRIPT_DEFAULT) + LIMIT_MARGIN
    return max(LONG_COMMANDS.get(name, COMMAND_LIMIT), (given or 0) + LIMIT_MARGIN)


def answer_deadline(payload: dict) -> float:
    argv = payload.get("argv") or [""]
    options = payload.get("options") or {}
    timeout = float(options.get("timeout_ms") or DEFAULT_TIMEOUT_MS) / 1000
    return QUEUE_WAIT + command_limit(str(argv[0]), [str(arg) for arg in argv[1:]], timeout) + LIMIT_MARGIN
