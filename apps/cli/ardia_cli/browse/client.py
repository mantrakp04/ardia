import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from ardia_cli.browse import paths
from ardia_cli.browse.errors import BrowseError, OutcomeUnknown, Unreachable

START_TIMEOUT = 15.0
MAX_RESPONSE = 256 * 1024 * 1024


def endpoint_key(ws: str | None, port: int | None, root: Path) -> tuple[str, str]:
    from urllib.parse import urlsplit

    url = ws or (None if port is not None else os.environ.get("ARDIA_CDP_URL"))
    if url:
        parts = urlsplit(url)
        return f"ws:{parts.scheme}://{parts.netloc}{parts.path}", f"{parts.netloc}{parts.path}"
    if port is not None:
        return f"port:{port}", f"--port {port}"
    return f"token:{root}", "Ardia"


def connect(dir_fd: int, name: str) -> socket.socket | None:
    try:
        owned = paths.socket_is_ours(name, dir_fd)
    except paths.PathError as error:
        raise BrowseError(f"Refusing the session socket: {error}") from None
    if owned is None:
        return None
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        with paths.inside(dir_fd):
            sock.connect(name)
    except (ConnectionRefusedError, FileNotFoundError):
        sock.close()
        return None
    if paths.peer_uid(sock) != os.getuid():
        sock.close()
        raise BrowseError("The session socket isn't served by your user; refusing it")
    return sock


def spawn(dir_fd: int, key: str, config: dict) -> subprocess.Popen:
    package_parent = str(Path(__file__).resolve().parent.parent.parent)
    log_fd = paths.open_private_file(f"{key}.log", dir_fd, os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
    code = f"import sys; sys.path.insert(0, {package_parent!r}); from ardia_cli.browse import daemon; daemon.main()"
    try:
        process = subprocess.Popen(
            [sys.executable, "-I", "-c", code],
            stdin=subprocess.PIPE, stdout=log_fd, stderr=log_fd, start_new_session=True, close_fds=True, cwd="/",
        )
    finally:
        os.close(log_fd)
    process.stdin.write(json.dumps(config).encode())
    process.stdin.close()
    return process


def log_tail(dir_fd: int, key: str) -> str:
    try:
        fd = paths.open_private_file(f"{key}.log", dir_fd, os.O_RDONLY)
    except (FileNotFoundError, paths.PathError):
        return ""
    with os.fdopen(fd, "rb") as handle:
        data = handle.read()[-2000:]
    return data.decode(errors="replace").strip()


def ensure_daemon(dir_fd: int, key: str, config: dict) -> socket.socket:
    sock = connect(dir_fd, f"{key}.sock")
    if sock is not None:
        return sock
    from ardia_cli import telemetry

    process = spawn(dir_fd, key, config)
    spawned = time.monotonic()
    deadline = spawned + START_TIMEOUT
    while time.monotonic() < deadline:
        sock = connect(dir_fd, f"{key}.sock")
        if sock is not None:
            telemetry.note_daemon_start(spawned)
            return sock
        if process.poll() is not None:
            sock = connect(dir_fd, f"{key}.sock")
            if sock is not None:
                telemetry.note_daemon_start(spawned)
                return sock
            if not paths.lock_held(f"{key}.lock", dir_fd):
                raise Unreachable(f"the ardia browse daemon exited before it listened: {log_tail(dir_fd, key) or 'no output'}")
        time.sleep(0.03)
    raise Unreachable("the ardia browse daemon didn't start in 15 s")


def command_of(payload: dict) -> tuple[str, bool]:
    from ardia_cli.browse.commands import ALIASES, MUTATING

    argv = payload.get("argv") or [""]
    name = ALIASES.get(argv[0], argv[0])
    return name, name in MUTATING


def gone(payload: dict) -> BrowseError:
    name, mutating = command_of(payload)
    if mutating:
        return OutcomeUnknown(f"`{name}`", "the ardia browse daemon went away after it took the command (see the session log)")
    return Unreachable("the ardia browse daemon closed the connection without answering (it may have exited; see the session log)")


def stalled(payload: dict, seconds: float) -> BrowseError:
    from ardia_cli import telemetry

    telemetry.note_count("daemon_answer_timed_out", True)
    name, mutating = command_of(payload)
    why = f"the ardia browse daemon didn't answer in {seconds:g} s (see the session log)"
    if mutating:
        return OutcomeUnknown(f"`{name}`", why)
    return Unreachable(why)


def request(sock: socket.socket, payload: dict) -> dict:
    from ardia_cli.browse.limits import answer_deadline

    seconds = answer_deadline(payload)
    deadline = time.monotonic() + seconds
    with sock:
        sock.settimeout(seconds)
        try:
            sock.sendall((json.dumps(payload, ensure_ascii=False) + "\n").encode())
        except TimeoutError:
            raise Unreachable(f"the ardia browse daemon didn't take the command in {seconds:g} s (see the session log)") from None
        chunks = []
        size = 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise stalled(payload, seconds)
            sock.settimeout(remaining)
            try:
                chunk = sock.recv(1 << 20)
            except ConnectionResetError:
                raise gone(payload) from None
            except TimeoutError:
                raise stalled(payload, seconds) from None
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > MAX_RESPONSE:
                raise BrowseError("The daemon's answer was too large")
            if chunk.endswith(b"\n"):
                break
    raw = b"".join(chunks)
    if not raw.endswith(b"\n"):
        raise gone(payload)
    return json.loads(raw)


def live_sessions(dir_fd: int) -> list[dict]:
    rows = []
    for entry in sorted(os.listdir(dir_fd)):
        if not entry.endswith(".json") or entry.startswith("."):
            continue
        key = entry[:-5]
        if not paths.lock_held(f"{key}.lock", dir_fd):
            continue
        meta = paths.read_private_json(entry, dir_fd)
        if meta:
            rows.append({**meta, "key": key})
    return rows
