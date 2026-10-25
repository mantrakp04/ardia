import errno
import json
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

from ardia_cli import identity
from ardia_cli.redact import add_secret

NOT_REACHABLE = (
    f"{identity.PRODUCT} isn't running, or \"Let the {identity.COMMAND} command control {identity.PRODUCT}\" is off in Settings."
)
CONTROL_FILE = "ArdiaControl.json"
_BROWSER_PATH = re.compile(r"^/devtools/browser/[0-9A-Za-z-]{1,128}$")
_TOKEN = re.compile(r"^[\x21-\x7e]{16,1024}$")
_MAX_CONTROL_FILE = 64 * 1024


class EndpointError(Exception):
    pass


@dataclass(frozen=True)
class Endpoint:
    ws: str
    source: str
    explicit: bool
    active: str | None = None


def resolve(ws: str | None = None, port: int | None = None, data_dir: str | None = None) -> Endpoint:
    if ws:
        return _from_ws(ws, "--ws")
    if port is not None:
        return _from_port(port)
    env_ws = os.environ.get("ARDIA_CDP_URL")
    if env_ws:
        return _from_ws(env_ws, "ARDIA_CDP_URL")
    return from_control_file(data_root(data_dir) / "Chromium" / CONTROL_FILE)


def data_root(data_dir: str | None = None) -> Path:
    root = data_dir or os.environ.get("ARDIA_DATA_DIR")
    return Path(root).expanduser() if root else installed_data_dir()


def installed_data_dir() -> Path:
    return Path.home() / "Library" / "Application Support" / identity.BUNDLE_ID


def explicit_data_root(data_dir: str | None = None) -> Path | None:
    root = data_dir or os.environ.get("ARDIA_DATA_DIR")
    return Path(root).expanduser() if root else None


def require_control(root: Path) -> Endpoint:
    return from_control_file(root / "Chromium" / CONTROL_FILE)


def _from_ws(url: str, source: str) -> Endpoint:
    parts = urlsplit(url)
    if parts.scheme not in ("ws", "wss") or not parts.netloc or not parts.path.startswith("/devtools/browser/"):
        raise EndpointError(f"{source} must be a ws://host:port/devtools/browser/<id> URL")
    for token in parse_qs(parts.query).get("token", []):
        add_secret(token)
    return Endpoint(url, source, True)


def _from_port(port: int) -> Endpoint:
    import urllib.request

    if not 0 < port < 65536:
        raise EndpointError(f"--port must be between 1 and 65535, not {port}")
    try:
        direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with direct.open(f"http://127.0.0.1:{port}/json/version", timeout=3) as response:
            info = json.loads(response.read(_MAX_CONTROL_FILE))
    except Exception as error:
        raise EndpointError(f"no DevTools server answers on 127.0.0.1:{port} ({_reason(error)})") from None
    ws = info.get("webSocketDebuggerUrl") if isinstance(info, dict) else None
    if not isinstance(ws, str):
        raise EndpointError(f"127.0.0.1:{port}/json/version has no webSocketDebuggerUrl")
    return _from_ws(ws, f"--port {port}")


def _reason(error: Exception) -> str:
    reason = getattr(error, "reason", None)
    return str(reason or error) or type(error).__name__


def from_control_file(path: Path) -> Endpoint:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        raise EndpointError(NOT_REACHABLE) from None
    except OSError as error:
        reason = "is a symbolic link" if error.errno == errno.ELOOP else error.strerror
        raise EndpointError(f"{NOT_REACHABLE} ({path.name} {reason})") from None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise EndpointError(f"{NOT_REACHABLE} ({path.name} isn't a regular file)")
        if info.st_uid != os.getuid():
            raise EndpointError(f"{NOT_REACHABLE} ({path.name} belongs to another user)")
        if stat.S_IMODE(info.st_mode) != 0o600:
            raise EndpointError(f"{NOT_REACHABLE} ({path.name} must be mode 0600)")
        raw = os.read(fd, _MAX_CONTROL_FILE + 1)
    finally:
        os.close(fd)
    try:
        control = json.loads(raw)
    except ValueError:
        raise EndpointError(f"{NOT_REACHABLE} ({path.name} isn't valid JSON)") from None
    if not isinstance(control, dict):
        raise EndpointError(f"{NOT_REACHABLE} ({path.name} isn't valid)")
    port = control.get("port")
    browser = control.get("browser")
    token = control.get("token")
    pid = control.get("pid")
    if not (isinstance(port, int) and 0 < port < 65536):
        raise EndpointError(f"{NOT_REACHABLE} ({path.name} has no valid port)")
    if not (isinstance(browser, str) and _BROWSER_PATH.match(browser)):
        raise EndpointError(f"{NOT_REACHABLE} ({path.name} has no valid browser path)")
    if not (isinstance(token, str) and _TOKEN.match(token)):
        raise EndpointError(f"{NOT_REACHABLE} ({path.name} has no valid token)")
    add_secret(token)
    if not (isinstance(pid, int) and pid > 1 and _alive(pid)):
        raise EndpointError(NOT_REACHABLE)
    query = f"token={quote(token, safe='')}"
    return Endpoint(
        f"ws://127.0.0.1:{port}{browser}?{query}",
        str(path),
        False,
        f"http://127.0.0.1:{port}/ardia/active?{query}",
    )


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return False
    return True
