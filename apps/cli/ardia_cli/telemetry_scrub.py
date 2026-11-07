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
