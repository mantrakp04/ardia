import ctypes
import os
import plistlib
import struct
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import PurePosixPath

FALLBACK = "ardia"
MAX_NAME = 40
MAX_APP_PATH = 1024
MAX_DEPTH = 64
PROC_PIDT_SHORTBSDINFO = 13
SHORTBSDINFO_SIZE = 64
PATH_MAX = 4096
CTL_KERN = 1
KERN_ARGMAX = 8
KERN_PROCARGS2 = 49
MAX_ARGS_READ = 256 * 1024
AGENTS = {
    "claude": "Claude Code",
    "codex": "Codex",
    "cursor-agent": "Cursor Agent",
    "gemini": "Gemini CLI",
    "opencode": "OpenCode",
    "aider": "Aider",
    "amp": "Amp",
    "goose": "Goose",
    "crush": "Crush",
    "droid": "Droid",
    "qwen": "Qwen Code",
    "copilot": "Copilot CLI",
    "kiro-cli": "Kiro",
    "cline": "Cline",
}
INTERPRETERS = ("node", "bun", "deno", "python", "ruby")
SCRIPT_SUFFIXES = (".js", ".mjs", ".cjs", ".ts", ".py", ".rb")


@dataclass(frozen=True)
class Process:
    pid: int
    ppid: int
    path: str
    argv: tuple[str, ...] = ()


@dataclass(frozen=True)
class Caller:
    name: str
    app: str | None = None

    def wire(self) -> dict:
        return {"name": self.name, **({"app": self.app} if self.app else {})}


def clean_name(text) -> str | None:
    if not isinstance(text, str):
        return None
    kept = "".join(" " if char.isspace() or unicodedata.category(char).startswith("Z") else char for char in text if char.isspace() or not unicodedata.category(char).startswith("C"))
    name = " ".join(kept.split())[:MAX_NAME].strip()
    return name or None


def command_name(word: str) -> str:
    base = PurePosixPath(word).name.lower()
    for suffix in SCRIPT_SUFFIXES:
        if base.endswith(suffix):
            return base[: -len(suffix)]
    return base


def is_interpreter(word: str) -> bool:
    base = command_name(word)
    return any(base == name or (base.startswith(name) and base[len(name) :].replace(".", "").isdigit()) for name in INTERPRETERS)


def agent_of(process: Process) -> str | None:
    words = [process.argv[0]] if process.argv else []
    words.append(process.path)
    if any(is_interpreter(word) for word in words):
        words.extend(arg for arg in process.argv[1:2] if not arg.startswith("-"))
    for word in words:
        name = AGENTS.get(command_name(word))
        if name:
            return name
    return None


def outer_bundle(path: str) -> str | None:
    parts = PurePosixPath(path).parts
    for index, part in enumerate(parts[:-1]):
        if part.endswith(".app") and len(part) > 4 and parts[index + 1 : index + 2] == ("Contents",):
            return str(PurePosixPath(*parts[: index + 1]))
    return None


def bundle_name(bundle: str) -> str | None:
    try:
        with open(os.path.join(bundle, "Contents", "Info.plist"), "rb") as handle:
            info = plistlib.loads(handle.read(1024 * 1024))
    except Exception:
        info = {}
    if not isinstance(info, dict):
        info = {}
    for key in ("CFBundleDisplayName", "CFBundleName"):
        name = clean_name(info.get(key))
        if name:
            return name
    return clean_name(PurePosixPath(bundle).name[: -len(".app")])


def from_chain(chain, read_bundle_name=bundle_name) -> Caller:
    chain = list(chain)
    for process in chain:
        agent = agent_of(process)
        if agent:
            return Caller(agent)
    for process in chain:
        bundle = outer_bundle(process.path)
        if bundle:
            name = read_bundle_name(bundle)
            if name:
                return Caller(name, bundle if len(bundle) <= MAX_APP_PATH else None)
    return Caller(FALLBACK)


class LibProc:
    def __init__(self):
        self.lib = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        self.libc = ctypes.CDLL(None, use_errno=True)
        self.info = ctypes.create_string_buffer(SHORTBSDINFO_SIZE)
        self.path_buffer = ctypes.create_string_buffer(PATH_MAX)
        self.args_size = self.arg_max()
        self.args = ctypes.create_string_buffer(self.args_size)

    def arg_max(self) -> int:
        value = ctypes.c_int(0)
        size = ctypes.c_size_t(ctypes.sizeof(value))
        mib = (ctypes.c_int * 2)(CTL_KERN, KERN_ARGMAX)
        if self.libc.sysctl(mib, 2, ctypes.byref(value), ctypes.byref(size), None, ctypes.c_size_t(0)) != 0 or value.value <= 0:
            return MAX_ARGS_READ
        return min(value.value, MAX_ARGS_READ)

    def parent(self, pid: int) -> int | None:
        if self.lib.proc_pidinfo(pid, PROC_PIDT_SHORTBSDINFO, ctypes.c_uint64(0), self.info, SHORTBSDINFO_SIZE) != SHORTBSDINFO_SIZE:
            return None
        return struct.unpack_from("=I", self.info.raw, 4)[0]

    def path(self, pid: int) -> str:
        size = self.lib.proc_pidpath(pid, self.path_buffer, PATH_MAX)
        return os.fsdecode(self.path_buffer.raw[:size]) if size > 0 else ""

    def argv(self, pid: int) -> tuple[str, ...]:
        mib = (ctypes.c_int * 3)(CTL_KERN, KERN_PROCARGS2, pid)
        size = ctypes.c_size_t(self.args_size)
        if self.libc.sysctl(mib, 3, self.args, ctypes.byref(size), None, ctypes.c_size_t(0)) != 0 or size.value < 4:
            return ()
        raw = self.args.raw[: size.value]
        argc = struct.unpack_from("=i", raw, 0)[0]
        rest = raw[4:]
        end = rest.find(b"\0")
        if end < 0:
            return ()
        rest = rest[end:].lstrip(b"\0")
        words = rest.split(b"\0")[: max(0, min(argc, 2))]
        return tuple(os.fsdecode(word) for word in words)

    def process(self, pid: int) -> Process | None:
        ppid = self.parent(pid)
        if ppid is None:
            return None
        return Process(pid, ppid, self.path(pid), self.argv(pid))


class ProcFs:
    def __init__(self, root: str = "/proc"):
        self.root = root

    def parent(self, pid: int) -> int | None:
        try:
            with open(f"{self.root}/{pid}/stat", "rb") as handle:
                fields = handle.read(4096).rsplit(b")", 1)[1].split()
            return int(fields[1])
        except (OSError, IndexError, ValueError):
            return None

    def path(self, pid: int) -> str:
        try:
            return os.readlink(f"{self.root}/{pid}/exe").removesuffix(" (deleted)")
        except OSError:
            return ""

    def argv(self, pid: int) -> tuple[str, ...]:
        try:
            with open(f"{self.root}/{pid}/cmdline", "rb") as handle:
                raw = handle.read(MAX_ARGS_READ)
        except OSError:
            return ()
        return tuple(os.fsdecode(word) for word in raw.split(b"\0")[:2] if word)

    def process(self, pid: int) -> Process | None:
        ppid = self.parent(pid)
        if ppid is None:
            return None
        return Process(pid, ppid, self.path(pid), self.argv(pid))


def default_reader():
    return ProcFs() if sys.platform.startswith("linux") else LibProc()


def ancestry(start: int, reader=None) -> list[Process]:
    reader = reader or default_reader()
    chain = []
    seen = set()
    pid = start
    while pid > 1 and pid not in seen and len(chain) < MAX_DEPTH:
        seen.add(pid)
        process = reader.process(pid)
        if process is None:
            break
        chain.append(process)
        pid = process.ppid
    return chain


_current: Caller | None = None


def current() -> Caller:
    global _current
    if _current is None:
        try:
            _current = from_chain(ancestry(os.getppid()))
        except Exception:
            _current = Caller(FALLBACK)
    return _current


def parse(raw) -> Caller | None:
    if not isinstance(raw, dict):
        return None
    name = clean_name(raw.get("name"))
    if not name:
        return None
    app = raw.get("app")
    usable = isinstance(app, str) and len(app) <= MAX_APP_PATH and app.startswith("/") and ".." not in PurePosixPath(app).parts
    return Caller(name, app if usable and outer_bundle(app + "/Contents/MacOS") == app else None)
