import asyncio
import json
import os
import socket
import stat
import struct
from pathlib import Path

from ardia_cli import endpoint

SOCKET_FILE = "ArdiaControl.sock"
SUN_PATH_MAX = 103
MAX_LINE = 1024 * 1024
PROTOCOL = 1
CONNECT_TIMEOUT = 5.0
CALL_TIMEOUT = 30.0
EVENT_QUEUE_CAP = 1000
EVENTS = (
    "window.opened",
    "window.closed",
    "window.focused",
    "tab.opened",
    "tab.closed",
    "tab.activated",
    "tab.navigated",
    "settings.changed",
)
SOL_LOCAL = 0
LOCAL_PEERCRED = 0x001
XUCRED_SIZE = 76


class Unreachable(Exception):
    sent = False


class MethodError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def unreachable(detail: str | None = None) -> Unreachable:
    return Unreachable(f"{endpoint.NOT_REACHABLE} ({detail})" if detail else endpoint.NOT_REACHABLE)


def socket_path(data_dir: str | None = None) -> Path:
    return endpoint.data_root(data_dir) / SOCKET_FILE


def check_socket(path: Path) -> None:
    size = len(os.fsencode(str(path)))
    if size > SUN_PATH_MAX:
        raise Unreachable(f"the control socket path is {size} bytes, over the {SUN_PATH_MAX} a Unix socket allows: {path}; use a shorter data dir")
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        raise unreachable() from None
    except NotADirectoryError:
        raise unreachable() from None
    except OSError as error:
        raise unreachable(f"{path.name}: {error.strerror}") from None
    if not stat.S_ISSOCK(info.st_mode):
        raise unreachable(f"{path.name} isn't a socket")
    if info.st_uid != os.getuid():
        raise unreachable(f"{path.name} belongs to another user")


def check_events(names) -> list[str]:
    from ardia_cli.schema_check import did_you_mean

    names = list(names)
    for name in names:
        if name != "*" and name not in EVENTS:
            raise ValueError(f"unknown event {name}{did_you_mean(name, EVENTS)}; events: {', '.join(EVENTS)}")
    return names


def peer_uid(sock: socket.socket) -> int | None:
    try:
        raw = sock.getsockopt(SOL_LOCAL, LOCAL_PEERCRED, XUCRED_SIZE)
    except OSError:
        return None
    if len(raw) < 8:
        return None
    _, uid = struct.unpack_from("=II", raw)
    return uid


class Connection:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self._reader = reader
        self._writer = writer
        self._next_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._events: asyncio.Queue = asyncio.Queue()
        self._lost: str | None = None
        self.event_cap = EVENT_QUEUE_CAP
        self._dropped = 0
        self._task = asyncio.ensure_future(self._read())
        self.info: dict = {}

    @property
    def closed(self) -> bool:
        return self._lost is not None

    async def _read(self):
        reason = "Ardia closed the connection"
        try:
            while True:
                try:
                    line = await self._reader.readuntil(b"\n")
                except asyncio.IncompleteReadError:
                    break
                except asyncio.LimitOverrunError:
                    reason = "Ardia sent a line longer than 1 MB"
                    break
                if len(line) > MAX_LINE + 1:
                    reason = "Ardia sent a line longer than 1 MB"
                    break
                try:
                    message = json.loads(line)
                except ValueError:
                    reason = "Ardia sent a line that isn't JSON"
                    break
                if not isinstance(message, dict):
                    continue
                ident = message.get("id")
                if isinstance(ident, int) and not isinstance(ident, bool) and ident in self._pending:
                    future = self._pending.pop(ident)
                    if not future.done():
                        future.set_result(message)
                elif isinstance(message.get("event"), str):
                    if self._events.qsize() >= self.event_cap:
                        self._events.get_nowait()
                        self._dropped += 1
                    self._events.put_nowait((message, line.decode("utf-8", "replace").rstrip("\n")))
        except (ConnectionError, OSError) as error:
            reason = f"the connection broke ({error.strerror or error})"
        except asyncio.CancelledError:
            reason = "closed"
        self._lost = reason
        for future in self._pending.values():
            if not future.done():
                future.set_exception(unreachable(reason))
        self._pending.clear()
        self._events.put_nowait(None)
        self._writer.close()

    async def call(self, method: str, params: dict | None = None, timeout: float | None = CALL_TIMEOUT):
        if self._lost:
            raise unreachable(self._lost)
        self._next_id += 1
        ident = self._next_id
        request = {"id": ident, "method": method}
        if params is not None:
            request["params"] = params
        line = json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        if len(line) > MAX_LINE:
            raise MethodError("bad_request", "the request is longer than 1 MB")
        future = asyncio.get_running_loop().create_future()
        self._pending[ident] = future
        try:
            self._writer.write(line)
            await self._writer.drain()
        except (ConnectionError, OSError) as error:
            self._pending.pop(ident, None)
            lost = unreachable(f"the connection broke ({error.strerror or error})")
            lost.sent = True
            raise lost from None
        try:
            reply = await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError:
            self._pending.pop(ident, None)
            error = unreachable(f"Ardia didn't answer {method} in {timeout:g} s")
            error.sent = True
            raise error from None
        except Unreachable as error:
            error.sent = True
            raise
        if "error" in reply:
            error = reply["error"] if isinstance(reply["error"], dict) else {}
            raise MethodError(str(error.get("code") or "failed"), str(error.get("message") or "failed"))
        return reply.get("result")

    async def subscribe(self, names) -> None:
        await self.call("subscribe", {"events": list(names)})

    async def next_line(self, timeout: float | None = None) -> tuple[dict, str]:
        if self._lost and self._events.empty():
            raise unreachable(self._lost)
        item = await asyncio.wait_for(self._events.get(), timeout)
        if item is None:
            self._events.put_nowait(None)
            raise unreachable(self._lost)
        return item

    def take_dropped(self) -> int:
        dropped, self._dropped = self._dropped, 0
        return dropped

    async def next_event(self, timeout: float | None = None) -> dict:
        event, _ = await self.next_line(timeout)
        return event

    async def close(self) -> None:
        if not self._task.done():
            self._task.cancel()
        try:
            await self._task
        except BaseException:
            pass
        try:
            self._writer.close()
            await asyncio.wait_for(self._writer.wait_closed(), 1)
        except Exception:
            pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.close()


async def connect(path: Path, timeout: float = CONNECT_TIMEOUT) -> Connection:
    check_socket(path)
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.setblocking(False)
        await _connect_socket(sock, path, timeout)
        uid = peer_uid(sock)
        if uid != os.getuid():
            reason = "couldn't check who serves it" if uid is None else "is served by another user"
            raise unreachable(f"{path.name} {reason}")
        reader, writer = await asyncio.open_unix_connection(sock=sock, limit=MAX_LINE + 2)
    except BaseException:
        sock.close()
        raise
    connection = Connection(reader, writer)
    try:
        info = await connection.call("hello", timeout=timeout)
        if not isinstance(info, dict) or info.get("app") != "Ardia":
            raise unreachable(f"something other than Ardia answers on {path.name}")
    except MethodError as error:
        await connection.close()
        raise unreachable(f"hello failed: {error.message}") from None
    except BaseException as error:
        await connection.close()
        if isinstance(error, Unreachable):
            error.sent = False
        raise
    connection.info = info
    return connection


async def _connect_socket(sock: socket.socket, path: Path, timeout: float) -> None:
    loop = asyncio.get_running_loop()
    try:
        await asyncio.wait_for(loop.sock_connect(sock, str(path)), timeout)
    except asyncio.TimeoutError:
        raise unreachable(f"{path.name} didn't accept in {timeout:g} s") from None
    except (FileNotFoundError, ConnectionRefusedError):
        raise unreachable() from None
    except OSError as error:
        raise unreachable(f"{path.name}: {error.strerror or error}") from None


async def open_control(data_root: Path | None) -> Connection:
    if data_root is None:
        raise Unreachable("the control socket needs --data-dir or $ARDIA_DATA_DIR when --port, --ws or $ARDIA_CDP_URL picks the browser")
    return await connect(Path(data_root) / SOCKET_FILE)
