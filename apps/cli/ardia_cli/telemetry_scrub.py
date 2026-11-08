import os
import re
import sys

FIXED_MESSAGES = frozenset({
    "division by zero", "integer division or modulo by zero", "float division by zero", "integer modulo by zero",
    "list index out of range", "tuple index out of range", "string index out of range", "list assignment index out of range",
    "pop from empty list", "pop from an empty set", "pop from an empty deque", "deque index out of range",
    "dictionary changed size during iteration", "Set changed size during iteration", "dictionary keys changed during iteration",
    "deque mutated during iteration", "maximum recursion depth exceeded", "maximum recursion depth exceeded while calling a Python object",
    "maximum recursion depth exceeded in comparison", "Event loop is closed", "This event loop is already running",
    "Cannot run the event loop while another loop is running", "no running event loop", "no current event loop",
    "cannot reuse already awaited coroutine", "coroutine ignored GeneratorExit", "generator already executing",
    "generator raised StopIteration", "coroutine raised StopIteration", "async generator raised StopIteration",
    "I/O operation on closed file.", "I/O operation on closed file", "read of closed file", "write to closed file",
    "can't start new thread", "substring not found", "empty separator", "empty range for randrange()",
    "cannot unpack non-iterable NoneType object", "'NoneType' object is not subscriptable", "'NoneType' object is not iterable",
    "'NoneType' object is not callable", "unhashable type: 'dict'", "unhashable type: 'list'",
})
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,60}$")
MODULE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]{0,120}$")
FUNCTION = re.compile(r"^[A-Za-z0-9_<>.]{1,100}$")
OUR_PACKAGE = "ardia_cli"
BUNDLED_PACKAGES = frozenset({
    "aiofiles", "aiohappyeyeballs", "aiohttp", "aiosignal", "annotated_types", "attr", "attrs", "frozenlist", "idna",
    "multidict", "propcache", "pydantic", "pydantic_core", "pydoll", "typing_extensions", "typing_inspection", "websockets",
    "yarl",
})
OTHER = "<other>"
MAX_FRAMES = 50


def exception_type(error: BaseException) -> str:
    name = type(error).__name__
    return name if IDENTIFIER.match(name) else "Error"


def exception_value(error: BaseException) -> str:
    if type(error).__module__ != "builtins":
        return exception_type(error)
    if isinstance(error, OSError) and isinstance(error.errno, int) and 0 < error.errno < 1000:
        return f"[Errno {error.errno}] {os.strerror(error.errno)}"
    try:
        message = str(error)
    except Exception:
        return exception_type(error)
    return message if message in FIXED_MESSAGES else exception_type(error)


def module_label(name) -> str:
    if not isinstance(name, str) or not MODULE.match(name):
        return OTHER
    top = name.split(".", 1)[0]
    if top == OUR_PACKAGE or top in BUNDLED_PACKAGES or top in getattr(sys, "stdlib_module_names", ()):
        return name
    return OTHER


def frames(error: BaseException, limit: int = MAX_FRAMES) -> list[dict]:
    out = []
    trace = error.__traceback__
    while trace is not None:
        frame = trace.tb_frame
        module = module_label(frame.f_globals.get("__name__"))
        code = frame.f_code
        function = getattr(code, "co_qualname", code.co_name)
        if module == OTHER or not FUNCTION.match(function):
            function = OTHER
        out.append({
            "platform": "custom",
            "lang": "python",
            "function": function,
            "module": module,
            "filename": module,
            "lineno": trace.tb_lineno if module != OTHER else None,
            "colno": None,
            "resolved": module != OTHER,
            "in_app": module.split(".", 1)[0] == OUR_PACKAGE,
        })
        trace = trace.tb_next
    return out[-limit:]


def exception_properties(error: BaseException, mechanism: str, fatal: bool) -> dict:
    kind = exception_type(error)
    value = exception_value(error)
    return {
        "$exception_level": "fatal" if fatal else "error",
        "source": mechanism,
        "$exception_types": [kind],
        "$exception_values": [value],
        "$exception_list": [{
            "type": kind,
            "value": value,
            "mechanism": {"type": mechanism, "handled": False, "synthetic": False},
            "stacktrace": {"type": "raw", "frames": frames(error)},
        }],
    }


def exception_key(properties: dict) -> str:
    entry = properties["$exception_list"][0]
    last = entry["stacktrace"]["frames"][-1:] or [{}]
    return f"{entry['type']}|{entry['value']}|{last[0].get('module', '')}|{last[0].get('function', '')}"


URL = re.compile(r"\b([a-zA-Z][a-zA-Z0-9+.-]{1,15}://)([^\s/?#<>\"'`]*@)?([^\s/?#<>\"'`]*)([^\s?#<>\"'`]*)([?#][^\s<>\"'`]*)?")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
KNOWN_SECRET = re.compile(
    r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[abposr]-[A-Za-z0-9-]{10,}"
    r"|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})"
)
SENSITIVE_KEYWORD = re.compile(
    r"(?i)password|passwd|pwd|secret|token|api[ _-]?key|apikey|authorization|bearer|basic|digest|cookie|session|credential"
    r"|private[ _-]?key|auth"
)
REDACTED = "<redacted>"
LONG_TOKEN = re.compile(r"(?<![A-Za-z0-9_+/=-])(?=[A-Za-z0-9_+/=-]*\d)(?=[A-Za-z0-9_+/=-]*[A-Za-z])[A-Za-z0-9_+/=-]{32,}(?![A-Za-z0-9_+/=-])")
CARD_NUMBER = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")
HOME_PATH = re.compile(r"(/Users/|/home/)[^/\s]+")
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
SCRUB_WINDOW = 2


def scrub_url(match: re.Match) -> str:
    scheme, _, host, path, rest = match.groups()
    return f"{scheme}{host}{path}{'?<redacted>' if rest else ''}"


def whole_words(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = max(cut.rfind(" "), cut.rfind("\n"), cut.rfind("\t"))
    return cut[:space] if space > 0 else ""


def redact_from_keyword(text: str) -> str:
    found = SENSITIVE_KEYWORD.search(text)
    return text if found is None else text[:found.start()] + REDACTED


def free_text(text: str, limit: int) -> tuple[str, bool]:
    clipped = len(text) > limit * SCRUB_WINDOW
    text = whole_words(CONTROL.sub(" ", text), limit * SCRUB_WINDOW)
    text = redact_from_keyword(text)
    text = URL.sub(scrub_url, text)
    text = KNOWN_SECRET.sub("<secret>", text)
    text = EMAIL.sub("<email>", text)
    text = LONG_TOKEN.sub("<secret>", text)
    text = CARD_NUMBER.sub("<number>", text)
    text = HOME_PATH.sub(lambda match: f"{match.group(1)}<user>", text).strip()
    return (whole_words(text, limit).rstrip() or text[:limit], True) if len(text) > limit else (text, clipped)
