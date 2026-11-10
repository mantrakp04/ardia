import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from ardia_cli import __version__

LOGS_URL = "https://ardia.dev/otel/v1/logs"
INGEST_KEY_HEADER = "X-Ardia-Key"
CLI_INGEST_KEY = "ak_cli_67adb8ebc49841125eda860e"
TEST_URL_ENV = "ARDIA_TELEMETRY_URL"
EVENTS_SCOPE = "ardia.analytics"
SERVICE_NAME = "ardia-cli"
LIB = "ardia-cli"
CONSENT_FILE = "telemetry.json"
FOLDER = "Telemetry"
SPOOL = "cli-queue.jsonl"
SPOOL_LOCK = "cli-queue.lock"
FLUSH_LOCK = "cli-flush.lock"
FLUSH_CLAIM_LOCK = "cli-flush-claim.lock"
FLUSH_STATE = "cli-flush.json"
MAX_CONSENT_BYTES = 64 * 1024
LOCAL_FOLDER = "local"
LOCAL_PREFIX = "cli-"
LOCAL_LOCK = "cli-local.lock"
LOCAL_DAYS = 7
LOCAL_ONLY_ID = "local"
MAX_LOCAL_BYTES = 4 * 1024 * 1024
MAX_SPOOL_BYTES = 256 * 1024
COUNT_CHECK_BYTES = 64 * 1024
MAX_EVENTS = 500
MAX_LINE_BYTES = 32 * 1024
MAX_EXCEPTIONS = 10
MAX_FLAGS = 20
BATCH_SIZE = 100
MAX_BODY_BYTES = 500_000
FLUSH_INTERVAL_S = 60
FIRST_BACKOFF_S = 30
MAX_BACKOFF_S = 30 * 60
SEND_TIMEOUT_S = 5
SEND_BUDGET_S = 12
FLUSH_DEADLINE_S = 30
LOCK_ATTEMPTS = 5
LOCK_RETRY_S = 0.002
TEST_ENDPOINT_FLAGS = frozenset({"--port", "--ws", "--cdp"})
TEST_ENDPOINT_ENV = ("ARDIA_WS", "ARDIA_PORT", "ARDIA_CDP_URL", "AGENT_BROWSER_CDP")
INSTALL_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
LOOPBACK_URL = re.compile(r"^http://(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}/[\x21-\x7e]{0,200}$")
COMMAND_NAME = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
ERROR_CODE = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
OFF_VALUES = frozenset({"0", "false", "off", "no"})
CTL_KERN = 1
KERN_PROC = 14
KERN_PROC_PID = 1
KINFO_PROC_SIZE = 1024


@dataclass(frozen=True)
class Target:
    root: Path
    url: str
    environment: str


@dataclass
class Call:
    argv: list
    started: float = field(default_factory=time.monotonic)
    command: str = "none"
    subcommand: str | None = None
    allowed_flags: frozenset = frozenset()
    started_at: float = field(default_factory=time.time)
    browse_argv: list | None = None
    error_code: str | None = None
    metrics: dict = field(default_factory=dict)


_call: Call | None = None
_reported: set = set()


def is_dev_build() -> bool:
    return ".dev" in __version__ or __version__.startswith("0.0.0")


def opted_out(env) -> bool:
    do_not_track = (env.get("DO_NOT_TRACK") or "").strip().lower()
    if do_not_track not in ("", "0", "false"):
        return True
    return (env.get("ARDIA_TELEMETRY") or "").strip().lower() in OFF_VALUES


def logs_url(env) -> str | None:
    override = env.get(TEST_URL_ENV)
    if override:
        return override if LOOPBACK_URL.match(override) else None
    return None if is_dev_build() else LOGS_URL


def environment_for(root: Path) -> str:
    from ardia_cli.endpoint import INSTALLED_DATA_DIR

    if is_dev_build():
        return "dev"
    try:
        installed = os.path.realpath(INSTALLED_DATA_DIR) == os.path.realpath(root)
    except (OSError, ValueError):
        installed = False
    return "production" if installed else "test"


def target(data_dir: str | None, test_endpoint: bool, env) -> Target | None:
    if test_endpoint or opted_out(env) or any(env.get(name) for name in TEST_ENDPOINT_ENV):
        return None
    url = logs_url(env)
    if url is None:
        return None
    from ardia_cli.endpoint import data_root

    root = Path(os.path.abspath(data_root(data_dir)))
    return Target(root, url, environment_for(root))


def shareable(env) -> bool:
    return not opted_out(env) and logs_url(env) is not None and not any(env.get(name) for name in TEST_ENDPOINT_ENV)


def leading_tokens(argv: list) -> list:
    tokens = []
    for token in argv:
        if token == "--":
            break
        tokens.append(token)
    return tokens


def data_dir_arg(tokens: list) -> str | None:
    data_dir = None
    for index, token in enumerate(tokens):
        if token == "--data-dir" and index + 1 < len(tokens):
            data_dir = tokens[index + 1]
        elif token.startswith("--data-dir="):
            data_dir = token.split("=", 1)[1]
    return data_dir or None


def names_test_endpoint(tokens: list) -> bool:
    return bool({token.split("=", 1)[0] for token in tokens if token.startswith("--")} & TEST_ENDPOINT_FLAGS)


def cli_target(argv: list, env) -> Target | None:
    tokens = leading_tokens(argv)
    return target(data_dir_arg(tokens), names_test_endpoint(tokens), env)


def read_consent(root: Path) -> dict | None:
    import stat

    try:
        fd = os.open(root / CONSENT_FILE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    except (OSError, ValueError):
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_size > MAX_CONSENT_BYTES:
            return None
        raw = os.read(fd, MAX_CONSENT_BYTES + 1)
    except OSError:
        return None
    finally:
        os.close(fd)
    try:
        doc = json.loads(raw)
    except ValueError:
        return None
    return doc if isinstance(doc, dict) else None


def epoch_seconds(value) -> float | None:
    from datetime import datetime

    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value / 1000 if value > 1e11 else float(value)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def valid_id(value) -> str | None:
    return value.lower() if isinstance(value, str) and INSTALL_ID.match(value.lower()) else None


def sharing_id(doc: dict | None, now: float | None = None) -> str | None:
    if not doc or doc.get("sharing") is not True:
        return None
    until = epoch_seconds(doc.get("sharingUntil")) if doc.get("sharingUntil") is not None else None
    if until is not None and until <= (time.time() if now is None else now):
        return None
    return valid_id(doc.get("installId"))


def consent(root: Path) -> str | None:
    return sharing_id(read_consent(root))


_process_session: str | None = None


def session_id(doc: dict | None) -> str:
    global _process_session
    if doc and doc.get("sessionOpen") is True:
        app_session = valid_id(doc.get("sessionId"))
        if app_session:
            return app_session
    if _process_session is None:
        _process_session = uuid7()
    return _process_session


def watch_report(doc: dict | None) -> str | None:
    report = doc.get("watchReport") if doc else None
    return report if isinstance(report, str) and re.fullmatch(r"FB-[A-Z0-9]{2,16}", report) else None


def common_properties(doc: dict | None) -> dict:
    properties = {"$session_id": session_id(doc)}
    report = watch_report(doc) if sharing_id(doc) else None
    if report:
        properties["watch_report"] = report
    return properties


def uuid7() -> str:
    ms = int(time.time() * 1000) & ((1 << 48) - 1)
    rand = int.from_bytes(os.urandom(10), "big")
    value = (ms << 80) | (0x7 << 76) | (((rand >> 62) & 0xFFF) << 64) | (0b10 << 62) | (rand & ((1 << 62) - 1))
    text = f"{value:032x}"
    return f"{text[:8]}-{text[8:12]}-{text[12:16]}-{text[16:20]}-{text[20:]}"


def iso_now() -> str:
    now = time.time()
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)) + f".{int(now * 1000) % 1000:03d}Z"


def event(name: str, distinct_id: str, properties: dict) -> dict:
    return {"uuid": uuid7(), "event": name, "distinct_id": distinct_id, "timestamp": iso_now(), "properties": properties}


def spool_line(record: dict) -> bytes | None:
    line = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    exceptions = record["properties"].get("$exception_list") or [{}]
    stacktrace = exceptions[0].get("stacktrace") or {}
    while len(line) > MAX_LINE_BYTES and stacktrace.get("frames"):
        stacktrace["frames"] = stacktrace["frames"][len(stacktrace["frames"]) // 2 + 1:]
        line = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    return line if len(line) <= MAX_LINE_BYTES else None


def exception_record(error: BaseException, mechanism: str, fatal: bool, distinct_id: str, environment: str) -> dict | None:
    from ardia_cli import telemetry_scrub

    properties = telemetry_scrub.exception_properties(error, mechanism, fatal)
    key = telemetry_scrub.exception_key(properties)
    if key in _reported or len(_reported) >= MAX_EXCEPTIONS:
        return None
    _reported.add(key)
    properties.update({"error_code": None, "cli_version": __version__, "$environment": environment})
    return event("$exception", distinct_id, properties)


def flag_names(argv: list, allowed: frozenset) -> str:
    names = sorted({token.split("=", 1)[0] for token in leading_tokens(argv) if token.startswith("-")} & allowed)
    return ",".join(names[:MAX_FLAGS])


def browse_flags_allowed(name: str) -> frozenset:
    from ardia_cli.browse import cli as browse_cli, help as browse_help

    usage = browse_help.COMMANDS.get(name, "")
    local = set(re.findall(r"(?<![\w-])(--?[a-z][a-z0-9-]*)", usage))
    return frozenset(browse_cli.VALUE_FLAGS | browse_cli.BOOL_FLAGS | local)


def browse_command(argv: list) -> tuple[str, frozenset]:
    from ardia_cli.browse import cli as browse_cli
    from ardia_cli.browse.errors import BrowseError

    try:
        _, rest = browse_cli.split_globals(argv)
    except BrowseError:
        return "other", browse_flags_allowed("")
    name = rest[0] if rest else "help"
    name = {"--help": "help", "-h": "help", "--version": "version", "-V": "version"}.get(name, name)
    if not COMMAND_NAME.match(name):
        return "other", browse_flags_allowed("")
    return name, browse_flags_allowed(name)


def linux_process_started_at(proc: str = "/proc") -> float | None:
    try:
        with open(f"{proc}/self/stat", "rb") as handle:
            ticks = int(handle.read(4096).rsplit(b")", 1)[1].split()[19])
        age = time.clock_gettime(time.CLOCK_BOOTTIME) - ticks / os.sysconf("SC_CLK_TCK")
    except (OSError, IndexError, ValueError, AttributeError):
        return None
    return time.time() - age if age >= 0 else None


def process_started_at() -> float | None:
    if sys.platform.startswith("linux"):
        return linux_process_started_at()
    import ctypes
    import struct

    try:
        libc = ctypes.CDLL(None, use_errno=True)
        mib = (ctypes.c_int * 4)(CTL_KERN, KERN_PROC, KERN_PROC_PID, os.getpid())
        buffer = ctypes.create_string_buffer(KINFO_PROC_SIZE)
        size = ctypes.c_size_t(KINFO_PROC_SIZE)
        if libc.sysctl(mib, 4, buffer, ctypes.byref(size), None, 0) != 0 or size.value < 16:
            return None
        seconds, micros = struct.unpack_from("<qi", buffer.raw, 0)
    except (OSError, AttributeError, struct.error):
        return None
    return seconds + micros / 1e6 if seconds > 0 else None


def timings(call: Call) -> dict:
    from ardia_cli import command_metrics

    elapsed = (time.monotonic() - call.started) * 1000
    values = dict(call.metrics)
    started = process_started_at()
    startup = (call.started_at - started) * 1000 if started else None
    if startup is not None and 0 <= startup <= command_metrics.MAX_MS:
        values["startup_ms"] = startup
        values["total_ms"] = startup + elapsed
    else:
        values["total_ms"] = elapsed
    return command_metrics.clean(values)


def command_record(call: Call, status: int, crashed: bool, distinct_id: str, environment: str) -> dict:
    subcommand, allowed = call.subcommand, call.allowed_flags
    if call.browse_argv is not None:
        name, allowed = browse_command(call.browse_argv)
        subcommand = name if call.command == "browse" else None
    error_code = "unhandled_exception" if crashed else call.error_code
    return event("cli_command", distinct_id, {
        "command": call.command,
        "subcommand": subcommand,
        "exit_code": status,
        "error_code": error_code if error_code and ERROR_CODE.match(error_code) else None,
        "flags": flag_names(call.argv, allowed),
        **timings(call),
        "cli_version": __version__,
        "$environment": environment,
    })


def note_command(command: str, subcommand: str | None = None, allowed_flags=frozenset()) -> None:
    if _call is not None:
        _call.command = command
        _call.subcommand = subcommand
        _call.allowed_flags = frozenset(allowed_flags)


def note_browse(argv: list, command: str = "browse") -> None:
    if _call is not None:
        _call.command = command
        _call.browse_argv = list(argv)


def note_count(key: str, value) -> None:
    from ardia_cli import command_metrics

    if _call is not None:
        _call.metrics.update(command_metrics.clean({key: value}))


def note_error_code(code) -> None:
    if _call is not None and isinstance(code, str) and code:
        _call.error_code = code


def note_answer(answer) -> None:
    from ardia_cli import command_metrics

    if _call is None or not isinstance(answer, dict):
        return
    note_error_code(answer.get("code"))
    _call.metrics.update(command_metrics.clean(answer.get("metrics")))
    _call.metrics["output_chars"] = sum(len(answer.get(key) or "") for key in ("out", "err") if isinstance(answer.get(key) or "", str))


def note_daemon_start(started: float) -> None:
    if _call is not None:
        _call.metrics["daemon_spawned"] = True
        _call.metrics["daemon_start_ms"] = (time.monotonic() - started) * 1000


def exit_status(code) -> int:
    if code is None:
        return 0
    return code if isinstance(code, int) else 1


def track(argv: list, run) -> int:
    global _call
    _call = Call(list(argv))
    try:
        status = run()
    except SystemExit as stop:
        finish(exit_status(stop.code))
        raise
    except KeyboardInterrupt:
        finish(130)
        raise
    except BaseException as error:
        finish(1, error)
        raise
    finish(exit_status(status))
    return status


def finish(status: int, error: BaseException | None = None) -> None:
    call = _call
    if call is None:
        return
    try:
        from ardia_cli import usage

        usage.record(call, status, os.environ)
    except Exception:
        pass
    try:
        where = cli_target(call.argv, os.environ)
        if where is None:
            return
        doc = read_consent(where.root)
        install_id = sharing_id(doc)
        records = []
        if error is not None:
            crash = exception_record(error, "cli_unhandled", True, install_id or LOCAL_ONLY_ID, where.environment)
            if crash:
                records.append(crash)
        records.append(command_record(call, status, error is not None, install_id or LOCAL_ONLY_ID, where.environment))
        for record in records:
            record["properties"].update(common_properties(doc))
        keep_local_copy(where.root, records, install_id is not None)
        if install_id is None:
            discard_spool(where.root)
            return
        dir_fd = append(where.root, records)
        if dir_fd is not None:
            try:
                start_flush(dir_fd, where)
            finally:
                os.close(dir_fd)
    except Exception:
        pass


def finish_before_exec() -> None:
    global _call
    finish(0)
    _call = None


def report_exception(error: BaseException, mechanism: str, config: dict, fatal: bool = False) -> None:
    from ardia_cli import command_metrics

    try:
        if not command_metrics.reporting_allowed():
            return
        where = target(config.get("data_root"), bool(config.get("ws") or config.get("port")), os.environ)
        if where is None:
            return
        doc = read_consent(where.root)
        install_id = sharing_id(doc)
        record = exception_record(error, mechanism, fatal, install_id or LOCAL_ONLY_ID, where.environment)
        if record is None:
            return
        record["properties"].update(common_properties(doc))
        keep_local_copy(where.root, [record], install_id is not None)
        if install_id is not None:
            dir_fd = append(where.root, [record])
            if dir_fd is not None:
                os.close(dir_fd)
    except Exception:
        pass


def open_folder(root: Path, create: bool = True) -> int:
    from ardia_cli.browse import paths

    return paths.open_private(root, FOLDER, create=create)


def take_lock(name: str, dir_fd: int) -> int | None:
    from ardia_cli.browse import paths

    return paths.take_lock(name, dir_fd)


def spool_lock(dir_fd: int) -> int | None:
    for attempt in range(LOCK_ATTEMPTS):
        fd = take_lock(SPOOL_LOCK, dir_fd)
        if fd is not None:
            return fd
        if attempt + 1 < LOCK_ATTEMPTS:
            time.sleep(LOCK_RETRY_S)
    return None


def read_lines(dir_fd: int) -> list[bytes]:
    from ardia_cli.browse import paths

    try:
        fd = paths.open_private_file(SPOOL, dir_fd, os.O_RDONLY)
    except FileNotFoundError:
        return []
    try:
        raw = os.read(fd, MAX_SPOOL_BYTES * 2)
    finally:
        os.close(fd)
    return [line + b"\n" for line in raw.split(b"\n") if line.strip()]


def newest(lines: list[bytes]) -> list[bytes]:
    kept: list[bytes] = []
    size = 0
    for line in reversed(lines):
        if len(kept) >= MAX_EVENTS or size + len(line) > MAX_SPOOL_BYTES:
            break
        kept.append(line)
        size += len(line)
    kept.reverse()
    return kept


def write_lines(dir_fd: int, lines: list[bytes]) -> None:
    from ardia_cli.browse import paths

    if not lines:
        paths.unlink_quietly(SPOOL, dir_fd)
        return
    temp = f".{SPOOL}.{os.getpid()}.tmp"
    fd = paths.open_private_file(temp, dir_fd, os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
    try:
        os.write(fd, b"".join(lines))
    finally:
        os.close(fd)
    os.rename(temp, SPOOL, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)


def append(root: Path, records: list[dict]) -> int | None:
    from ardia_cli.browse import paths

    data = [line for line in map(spool_line, records) if line]
    dir_fd = open_folder(root)
    try:
        lock = spool_lock(dir_fd)
        if lock is None:
            os.close(dir_fd)
            return None
        try:
            try:
                size = os.stat(SPOOL, dir_fd=dir_fd, follow_symlinks=False).st_size
            except FileNotFoundError:
                size = 0
            if size + sum(map(len, data)) <= COUNT_CHECK_BYTES:
                fd = paths.open_private_file(SPOOL, dir_fd, os.O_WRONLY | os.O_CREAT | os.O_APPEND)
                try:
                    os.write(fd, b"".join(data))
                finally:
                    os.close(fd)
            else:
                write_lines(dir_fd, newest(read_lines(dir_fd) + data))
        finally:
            os.close(lock)
    except BaseException:
        os.close(dir_fd)
        raise
    return dir_fd


def open_local_folder(root: Path) -> int:
    import stat

    from ardia_cli.browse import paths

    dir_fd = open_folder(root)
    try:
        try:
            os.mkdir(LOCAL_FOLDER, 0o700, dir_fd=dir_fd)
        except FileExistsError:
            pass
        local = os.open(LOCAL_FOLDER, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dir_fd)
    finally:
        os.close(dir_fd)
    info = os.fstat(local)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o022:
        os.close(local)
        raise paths.PathError(f"{LOCAL_FOLDER} isn't a private folder of yours")
    return local


def local_name(now: float) -> str:
    return f"{LOCAL_PREFIX}{time.strftime('%Y-%m-%d', time.gmtime(now))}.jsonl"


def local_files(dir_fd: int) -> list[tuple[str, int]]:
    found = []
    for name in os.listdir(dir_fd):
        if re.fullmatch(LOCAL_PREFIX + r"\d{4}-\d{2}-\d{2}\.jsonl", name):
            try:
                found.append((name, os.stat(name, dir_fd=dir_fd, follow_symlinks=False).st_size))
            except FileNotFoundError:
                continue
    return sorted(found)


def drop_oldest_lines(dir_fd: int, name: str, size: int, excess: int) -> int:
    from ardia_cli.browse import paths

    fd = paths.open_private_file(name, dir_fd, os.O_RDONLY)
    try:
        raw = os.read(fd, size)
    finally:
        os.close(fd)
    cut = raw.find(b"\n", max(0, excess - 1))
    rest = raw[cut + 1:] if cut >= 0 else b""
    if not rest:
        paths.unlink_quietly(name, dir_fd)
        return size
    temp = f".{name}.{os.getpid()}.tmp"
    fd = paths.open_private_file(temp, dir_fd, os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
    try:
        os.write(fd, rest)
    finally:
        os.close(fd)
    os.rename(temp, name, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
    return size - len(rest)


def prune_local(dir_fd: int, now: float) -> None:
    from ardia_cli.browse import paths

    oldest_kept = local_name(now - (LOCAL_DAYS - 1) * 86400)
    files = []
    for name, size in local_files(dir_fd):
        if name < oldest_kept:
            paths.unlink_quietly(name, dir_fd)
        else:
            files.append((name, size))
    excess = sum(size for _, size in files) - MAX_LOCAL_BYTES
    for name, size in files:
        if excess <= 0:
            break
        excess -= drop_oldest_lines(dir_fd, name, size, excess)


def local_line(record: dict, sent: bool) -> bytes:
    return (json.dumps({**record, "sent": sent}, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def keep_local_copy(root: Path, records: list[dict], sent: bool, now: float | None = None) -> bool:
    from ardia_cli.browse import paths

    now = time.time() if now is None else now
    data = b"".join(local_line(record, sent) for record in records)
    if not data or len(data) > MAX_LOCAL_BYTES:
        return False
    try:
        dir_fd = open_local_folder(root)
    except (OSError, paths.PathError):
        return False
    try:
        lock = None
        for attempt in range(LOCK_ATTEMPTS):
            lock = take_lock(LOCAL_LOCK, dir_fd)
            if lock is not None or attempt + 1 == LOCK_ATTEMPTS:
                break
            time.sleep(LOCK_RETRY_S)
        if lock is None:
            return False
        try:
            fd = paths.open_private_file(local_name(now), dir_fd, os.O_WRONLY | os.O_CREAT | os.O_APPEND)
            try:
                os.write(fd, data)
            finally:
                os.close(fd)
            prune_local(dir_fd, now)
            return True
        finally:
            os.close(lock)
    except (OSError, paths.PathError):
        return False
    finally:
        os.close(dir_fd)


def discard_spool(root: Path) -> None:
    try:
        os.stat(root / FOLDER / SPOOL, follow_symlinks=False)
    except (OSError, ValueError):
        return
    dir_fd = open_folder(root, create=False)
    try:
        from ardia_cli.browse import paths

        lock = spool_lock(dir_fd)
        if lock is None:
            return
        try:
            paths.unlink_quietly(SPOOL, dir_fd)
        finally:
            os.close(lock)
    finally:
        os.close(dir_fd)


def read_state(dir_fd: int) -> dict:
    from ardia_cli.browse import paths

    try:
        state = paths.read_private_json(FLUSH_STATE, dir_fd, {})
    except (OSError, paths.PathError):
        return {}
    return state if isinstance(state, dict) else {}


def write_state(dir_fd: int, failures: int, next_at: float) -> None:
    from ardia_cli.browse import paths

    paths.write_private_json(FLUSH_STATE, dir_fd, {"failures": failures, "next_at": next_at})


def number(value, default: float = 0) -> float:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else default


def start_flush(dir_fd: int, where: Target, urgent: bool = False) -> None:
    claim = take_lock(FLUSH_CLAIM_LOCK, dir_fd)
    if claim is None:
        return
    try:
        state = read_state(dir_fd)
        now = time.time()
        backing_off = number(state.get("failures")) > 0
        if number(state.get("next_at")) > now and (backing_off or not urgent):
            return
        write_state(dir_fd, int(number(state.get("failures"))), now + FLUSH_INTERVAL_S)
    finally:
        os.close(claim)
    spawn_flusher(where)


def spawn_flusher(where: Target) -> None:
    import subprocess

    package_parent = str(Path(__file__).resolve().parent.parent)
    code = f"import sys; sys.path.insert(0, {package_parent!r}); from ardia_cli import telemetry; telemetry.flush_main()"
    process = subprocess.Popen(
        [sys.executable, "-I", "-c", code],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True, cwd="/",
    )
    process.stdin.write(json.dumps({"data_root": str(where.root), "url": where.url, "environment": where.environment}).encode())
    process.stdin.close()


def flush_main() -> None:
    import signal

    signal.alarm(FLUSH_DEADLINE_S)
    try:
        config = json.loads(sys.stdin.read(64 * 1024) or "{}")
        sys.stdin.close()
        url = config.get("url")
        if url == LOGS_URL or (isinstance(url, str) and LOOPBACK_URL.match(url)):
            flush(Path(config["data_root"]), url, config.get("environment") or "production")
    except Exception:
        pass
    os._exit(0)


def valid_record(record, install_id: str) -> bool:
    return (
        isinstance(record, dict) and record.get("distinct_id") == install_id and isinstance(record.get("uuid"), str)
        and isinstance(record.get("event"), str) and isinstance(record.get("timestamp"), str) and isinstance(record.get("properties"), dict)
    )


def parse_lines(lines: list[bytes], install_id: str) -> list[dict]:
    records = []
    for line in lines:
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if valid_record(record, install_id):
            records.append(record)
    return records[-MAX_EVENTS:]


def flush(root: Path, url: str, environment: str) -> str:
    from ardia_cli.browse import paths

    dir_fd = open_folder(root, create=False)
    try:
        flusher = take_lock(FLUSH_LOCK, dir_fd)
        if flusher is None:
            return "busy"
        try:
            install_id = consent(root)
            lock = spool_lock(dir_fd)
            if lock is None:
                return "busy"
            try:
                if install_id is None:
                    paths.unlink_quietly(SPOOL, dir_fd)
                    paths.unlink_quietly(FLUSH_STATE, dir_fd)
                    return "off"
                pending = parse_lines(read_lines(dir_fd), install_id)
            finally:
                os.close(lock)
            sent: set = set()
            result = send_all(pending, url, environment, sent, lambda: consent(root) == install_id)
            current = consent(root)
            lock = spool_lock(dir_fd)
            if lock is None:
                return result
            try:
                if current is None:
                    paths.unlink_quietly(SPOOL, dir_fd)
                    paths.unlink_quietly(FLUSH_STATE, dir_fd)
                    return "off"
                keep = [line for line in read_lines(dir_fd) if keep_line(line, current, sent)]
                write_lines(dir_fd, newest(keep))
            finally:
                os.close(lock)
            failures = int(number(read_state(dir_fd).get("failures"))) + 1 if result == "failed" else 0
            delay = min(MAX_BACKOFF_S, FIRST_BACKOFF_S * 2 ** (failures - 1)) if failures else FLUSH_INTERVAL_S
            write_state(dir_fd, failures, time.time() + delay)
            return result
        finally:
            os.close(flusher)
    finally:
        os.close(dir_fd)


def keep_line(line: bytes, install_id: str, sent: set) -> bool:
    try:
        record = json.loads(line)
    except ValueError:
        return False
    return valid_record(record, install_id) and record["uuid"] not in sent


def outcome(status: int, count: int) -> str:
    if 200 <= status < 300:
        return "sent"
    if status == 400:
        return "drop"
    if status == 413:
        return "split" if count > 1 else "drop"
    return "retry"


def send_all(pending: list[dict], url: str, environment: str, sent: set, still_consented) -> str:
    started = time.monotonic()
    names = browse_names()
    size = BATCH_SIZE
    index = 0
    while index < len(pending):
        batch = pending[index:index + size]
        body = logs_request(resource(environment), [event_record(record, names) for record in batch])
        if len(body) > MAX_BODY_BYTES and len(batch) > 1:
            size = (len(batch) + 1) // 2
            continue
        if time.monotonic() - started > SEND_BUDGET_S:
            return "failed"
        if not still_consented():
            return "revoked"
        result = outcome(post(url, body), len(batch))
        if result == "retry":
            return "failed"
        if result == "split":
            size = (len(batch) + 1) // 2
            continue
        sent.update(record["uuid"] for record in batch)
        index += len(batch)
    return "done"


def post(url: str, body: bytes) -> int:
    import urllib.error
    import urllib.request

    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", INGEST_KEY_HEADER: CLI_INGEST_KEY}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=SEND_TIMEOUT_S) as response:
            return response.status
    except urllib.error.HTTPError as error:
        with error:
            return error.code
    except Exception:
        return 0


def browse_names() -> tuple[dict, frozenset]:
    try:
        from ardia_cli.browse import daemon, help as browse_help

        daemon.load_commands()
        from ardia_cli.browse.commands import ALIASES, COMMANDS, SKIPPED

        return dict(ALIASES), frozenset(set(COMMANDS) | set(SKIPPED) | set(browse_help.COMMANDS) | {"auth", "help", "version"})
    except Exception:
        return {}, frozenset()


def system() -> dict:
    import platform

    linux = sys.platform.startswith("linux")
    return {
        "os": "Linux" if linux else "macOS",
        "os_type": "linux" if linux else "darwin",
        "os_version": platform.mac_ver()[0] or platform.release(),
        "arch": platform.machine(),
        "python": platform.python_version(),
    }


_system: dict | None = None


def system_info() -> dict:
    global _system
    if _system is None:
        _system = system()
    return _system


def context() -> dict:
    info = system_info()
    return {
        "$lib": LIB,
        "$lib_version": "1",
        "$os": info["os"],
        "$os_version": info["os_version"],
        "arch": info["arch"],
        "python_version": info["python"],
        "$process_person_profile": False,
        "$geoip_disable": True,
    }


def resource(environment: str) -> dict:
    info = system_info()
    return {
        "service.name": SERVICE_NAME,
        "service.version": __version__,
        "deployment.environment": "production" if environment == "production" else "development",
        "os.type": info["os_type"],
        "os.version": info["os_version"],
        "host.arch": info["arch"],
    }


def mapped_properties(record: dict, names: tuple[dict, frozenset]) -> dict:
    properties = dict(record["properties"])
    if record["event"] == "cli_command" and properties.get("command") == "browse":
        aliases, known = names
        name = aliases.get(properties.get("subcommand"), properties.get("subcommand"))
        properties["subcommand"] = name if name in known else "other"
    return properties


def otlp_value(value):
    if isinstance(value, bool):
        return {"boolValue": value}
    if isinstance(value, int):
        return {"intValue": str(value)} if abs(value) <= 2 ** 53 - 1 else {"doubleValue": float(value)}
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return {"intValue": str(int(value))} if value.is_integer() and abs(value) <= 2 ** 53 - 1 else {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, (dict, list)):
        return {"stringValue": json.dumps(value, ensure_ascii=False, separators=(",", ":"))}
    return None


def otlp_attributes(values: dict) -> list:
    out = []
    for key, raw in values.items():
        value = otlp_value(raw)
        if value is not None:
            out.append({"key": key, "value": value})
    return out


def event_record(record: dict, names: tuple[dict, frozenset]) -> dict:
    from datetime import datetime

    try:
        ms = int(datetime.fromisoformat(record["timestamp"].replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        ms = int(time.time() * 1000)
    properties = {**context(), **mapped_properties(record, names)}
    return {
        "timeUnixNano": f"{ms}000000",
        "severityNumber": 9,
        "severityText": "INFO",
        "body": {"stringValue": record["event"]},
        "attributes": otlp_attributes({"event": record["event"], "uuid": record["uuid"], "distinct_id": record["distinct_id"], **properties}),
    }


def logs_request(resource_attributes: dict, records: list) -> bytes:
    body = {
        "resourceLogs": [{
            "resource": {"attributes": otlp_attributes(resource_attributes)},
            "scopeLogs": [{"scope": {"name": EVENTS_SCOPE}, "logRecords": records}],
        }],
    }
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
