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


URL = re.compile(r"\b([a-zA-Z][a-zA-Z0-9+.-]{1,15}://)([^\s/?#<>\"'`@]*@)?([^\s/?#<>\"'`]*)([^\s?#<>\"'`]*)([?#][^\s<>\"'`]*)?")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
PRIVATE_KEY_BLOCK = re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|\Z)")
KNOWN_SECRET = re.compile(
    r"(?<![A-Za-z0-9_-])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{10,}"
    r"|[pr]k_(?:live|test)_[A-Za-z0-9]{10,}|xox[abposre]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{30,}"
    r"|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|hf_[A-Za-z0-9]{30,}"
    r"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})"
)
QUOTED_VALUE = (
    r'r?"""[\s\S]*?(?:"""|\Z)|r?\'\'\'[\s\S]*?(?:\'\'\'|\Z)|\\"(?:[^\\]|\\(?!"))*(?:\\"|\Z)'
    r'|"(?:[^"\\]|\\[\s\S]?)*(?:"|\Z)|\'(?:[^\'\\]|\\[\s\S]?)*(?:\'|\Z)|`[^`]*(?:`|\Z)'
)
AUTH_SCHEME = r"(?:bearer|basic|token|negotiate|ntlm|hoba|mutual|aws4-hmac-sha256)"
DIGEST = re.compile(r"(?i)\bdigest(\s+)(?:[a-z][a-z0-9-]*\s*=\s*(?:" + QUOTED_VALUE + r"|[^,\s]+)(?:\s*,\s*)?)+")
HEADER = re.compile(
    r"(?i)(?<![A-Za-z0-9-])((?:proxy-)?authorization|(?:set-)?cookie|x-[a-z0-9-]*(?:token|key|secret|auth|session|password)[a-z0-9-]*"
    r"|api-key|private-token)([\"'`]?\s*:[ \t]*)((?:" + AUTH_SCHEME + r"[ \t]+)?(?:" + QUOTED_VALUE + r"|(?:[^\r\n'\"`]|\"[^\"\r\n]*\")+))"
)
CREDENTIAL = r"(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-]|[A-Za-z]{20})[A-Za-z0-9._~+/=-]+"
SCHEME_VALUE = re.compile(r"(?i)(?<![A-Za-z0-9])(bearer|basic)([ \t]+)(" + QUOTED_VALUE + r"|" + CREDENTIAL + r")")
SECRET_KEY = (
    r"[A-Za-z0-9_.-]*(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key"
    r"|credentials?|session[_-]?(?:id|key|token|secret)|sessionid|auth[_-]?(?:token|key|code)|cookie|signature|otp)[A-Za-z0-9_-]*"
)
KEY_VALUE = re.compile(
    r"(?i)(?<![A-Za-z0-9_.-])(\\?[\"'`]?" + SECRET_KEY + r"\\?[\"'`]?\]?)(\s*(?:=>|:=|=|:)\s*)((?:" + AUTH_SCHEME + r"\s+)?(?:"
    + QUOTED_VALUE + r"|[^\s,;&'\"`<>(){}\[\]]+))"
)
SECRET_FLAG = re.compile(r"(?i)(?<![A-Za-z0-9_-])(--?" + SECRET_KEY + r")([ \t]+)(" + QUOTED_VALUE + r"|[^\s'\"`]+)")
USER_FLAG = re.compile(r"(?<!\S)(-u|--user|--proxy-user)([ \t]+|=)(" + QUOTED_VALUE + r"|[^\s'\"`]+)")
COOKIE_PAIR = re.compile(
    r"(?i)(?<![A-Za-z0-9_.-])((?:session|sess|sid|connect\.sid|phpsessid|jsessionid|asp\.net_sessionid|csrftoken|xsrf-token"
    r"|_[a-z0-9_]*session[a-z0-9_]*))(=)([^\s;,&'\"`]+)"
)
REDACTED = "<redacted>"
PLACEHOLDER = re.compile(r"<(?:redacted|secret|email|number|user)>")
LONG_TOKEN = re.compile(r"(?<![A-Za-z0-9_+/=-])(?=[A-Za-z0-9_+/=-]*\d)(?=[A-Za-z0-9_+/=-]*[A-Za-z])[A-Za-z0-9_+/=-]{32,}(?![A-Za-z0-9_+/=-])")
CARD_NUMBER = re.compile(r"(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])")
HOME_PATH = re.compile(r"(/Users/|/home/)(?!<user>)[^/\s'\"`]+")
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
SCRUB_WINDOW = 4


def scrub_url(match: re.Match) -> str:
    scheme, _, host, path, rest = match.groups()
    return f"{scheme}{host}{path}{'?' + REDACTED if rest else ''}"


def luhn_valid(digits: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(digits)):
        value = int(char) * (2 if index % 2 else 1)
        total += value - 9 if value > 9 else value
    return total % 10 == 0


def scrub_card(match: re.Match) -> str:
    digits = re.sub(r"\D", "", match.group(0))
    return "<number>" if luhn_valid(digits) else match.group(0)


def keep_name(match: re.Match) -> str:
    return f"{match.group(1)}{match.group(2)}{REDACTED}"


def whole_words(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = max(cut.rfind(" "), cut.rfind("\n"), cut.rfind("\t"))
    return cut[:space] if space > 0 else ""


def scrub(text: str) -> str:
    text = CONTROL.sub(" ", text)
    text = PRIVATE_KEY_BLOCK.sub(REDACTED, text)
    text = DIGEST.sub(lambda match: f"Digest{match.group(1)}{REDACTED}", text)
    text = HEADER.sub(keep_name, text)
    text = URL.sub(scrub_url, text)
    text = KEY_VALUE.sub(keep_name, text)
    text = SECRET_FLAG.sub(keep_name, text)
    text = USER_FLAG.sub(keep_name, text)
    text = COOKIE_PAIR.sub(keep_name, text)
    text = SCHEME_VALUE.sub(lambda match: match.group(0) if PLACEHOLDER.fullmatch(match.group(3)) else keep_name(match), text)
    text = KNOWN_SECRET.sub("<secret>", text)
    text = EMAIL.sub("<email>", text)
    text = LONG_TOKEN.sub("<secret>", text)
    text = CARD_NUMBER.sub(scrub_card, text)
    return HOME_PATH.sub(lambda match: f"{match.group(1)}<user>", text).strip()


def only_placeholders(text: str) -> bool:
    return not re.search(r"[^\W_]", PLACEHOLDER.sub(" ", text))


def free_text(text: str, limit: int) -> tuple[str, bool]:
    clipped = len(text) > limit * SCRUB_WINDOW
    text = scrub(whole_words(text, limit * SCRUB_WINDOW))
    return (whole_words(text, limit).rstrip() or text[:limit], True) if len(text) > limit else (text, clipped)
