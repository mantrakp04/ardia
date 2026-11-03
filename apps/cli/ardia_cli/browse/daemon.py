import asyncio
import json
import logging
import os
import signal
import sys
import time
from pathlib import Path

from ardia_cli.browse import paths
from ardia_cli.browse.errors import BrowseError, ConnectionLost, Unreachable, Usage

CONNECTED_IDLE = 30.0
DEFAULT_DAEMON_IDLE = 3600.0
MAX_REQUEST = 16 * 1024 * 1024
MAX_RESPONSE = 256 * 1024 * 1024
SETTLE_TIMEOUT = 5.0
WATCH_INTERVAL = 2.0
EXIT_GRACE = 3.0
log = logging.getLogger("ardia_cli.browse")


def unreachable_message(endpoint, error) -> str:
    from ardia_cli.endpoint import NOT_REACHABLE
    from ardia_cli.redact import redact

    if endpoint.explicit:
        detail = str(error) or type(error).__name__
        return redact(f"can't connect to {endpoint.source} ({detail})")
    return NOT_REACHABLE


def load_commands():
    from ardia_cli.browse import audit, capture, commands, media, react

    return commands, (audit, capture, media, react)


async def run_one(ctx, argv):
    from ardia_cli.browse.commands import ALIASES, Ctx

    if not argv:
        return None, BrowseError("No command given")
    name = ALIASES.get(argv[0], argv[0])
    sub = Ctx(ctx.state, dict(ctx.options), ctx.cwd, ctx.env, ctx.stdin, name)
    try:
        result = await dispatch(sub, name, argv[1:])
    except BrowseError as error:
        return None, error
    return result, None


async def dispatch(ctx, name, argv):
    from ardia_cli.browse import vault
    from ardia_cli.browse.commands import COMMANDS, SKIPPED

    if name == "auth":
        if argv[:1] != ["login"]:
            raise Usage("auth save|list|show|delete run without the daemon")
        return await vault.login(ctx, argv[1:])
    if name in SKIPPED:
        raise BrowseError(f"`{name}` isn't part of ardia browse: {SKIPPED[name]}", code="unsupported")
    handler = COMMANDS.get(name)
    if handler is None:
        raise Usage(f"Unknown command: {name}. Run `ardia browse --help`")
    return await handler(ctx, argv)


def sanitize(value):
    from ardia_cli.redact import redact

    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {sanitize(key) if isinstance(key, str) else key: sanitize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize(item) for item in value]
    return value


def render(options: dict, result=None, error: BrowseError | None = None, name: str = "") -> tuple[int, str, str]:
    from ardia_cli.redact import redact

    code, out, err = _render(options, result, error, name)
    return code, redact(out), redact(err)


def _render(options: dict, result=None, error: BrowseError | None = None, name: str = "") -> tuple[int, str, str]:
    from ardia_cli.browse.commands import MUTATING, boundary

    as_json = options.get("json")
    if error is not None:
        message = error.message
        if isinstance(error, ConnectionLost) and name in MUTATING:
            message += f"; the outcome of `{name}` is unknown, so it wasn't retried"
        if as_json:
            payload = {"success": False, "data": error.data, "error": message}
            if error.code:
                payload["code"] = error.code
            return error.exit_code, json.dumps(sanitize(payload), ensure_ascii=False, separators=(",", ":")) + "\n", ""
        return error.exit_code, "", f"✗ {message}\n"
    batch = getattr(result, "batch", None)
    code = 1 if getattr(result, "failed", False) else 0
    if as_json:
        if batch is not None:
            return code, json.dumps(sanitize(batch), ensure_ascii=False, separators=(",", ":")) + "\n", ""
        return code, json.dumps(sanitize({"success": True, "data": result.data, "error": None}), ensure_ascii=False, separators=(",", ":")) + "\n", ""
    text = result.text
    if text is None:
        return code, "", ""
    if result.page_content:
        limit = options.get("max_output")
        if limit and len(text) > int(limit):
            text = text[: int(limit)] + f"\n[truncated {len(text) - int(limit)} characters]"
        if options.get("content_boundaries"):
            text = boundary(text)
    return code, text + "\n", ""


class Daemon:
    def __init__(self, config: dict):
        from ardia_cli import endpoint as endpoints
        from ardia_cli.browse.state import State

        self.config = config
        self.root = Path(config["data_root"])
        self.dir_fd = paths.browse_dir(self.root)
        self.key = config["key"]
        self.sock = f"{self.key}.sock"
        self.lock_fd = paths.take_lock(f"{self.key}.lock", self.dir_fd)
        config["browse_fd"] = self.dir_fd

        def resolve():
            try:
                return endpoints.resolve(ws=config.get("ws"), port=config.get("port"), data_dir=config.get("data_dir"))
            except endpoints.EndpointError as error:
                raise Unreachable(str(error)) from None

        self.state = State(config, resolve)
        self.lock = asyncio.Lock()
        self.state.extras["command_lock"] = self.lock
        self.pending = 0
        self.last = time.monotonic()
        self.stop = asyncio.Event()
        self.stopping = False
        self.active: set = set()
        self.sock_id = None
        self.idle_limit = float(config.get("idle_timeout_ms") or DEFAULT_DAEMON_IDLE * 1000) / 1000

    def leases(self) -> set[str]:
        active = set(self.state.leases) - {"console", "network"}
        pages = [page for page in self.state.pages.values() if page.session_id]
        if any(page.runtime_on for page in pages):
            active.add("console")
        if any(page.network_on for page in pages):
            active.add("network")
        if "init" in active and not any(page.init_scripts for page in pages):
            active.discard("init")
        return active

    def holding(self) -> bool:
        return any(page.input.holding for page in self.state.pages.values())

    async def run(self):
        if self.lock_fd is None:
            return 0
        os.fchdir(self.dir_fd)
        if paths.socket_is_ours(self.sock, self.dir_fd):
            paths.unlink_quietly(self.sock, self.dir_fd)
        previous = os.umask(0o177)
        try:
            server = await asyncio.start_unix_server(self.handle, path=self.sock, limit=MAX_REQUEST)
        finally:
            os.umask(previous)
        self.sock_id = paths.socket_is_ours(self.sock, self.dir_fd)
        paths.write_private_json(f"{self.key}.json", self.dir_fd, {
            "session": self.state.session, "namespace": self.config.get("namespace", ""), "endpoint": self.config.get("endpoint_label"),
            "pid": os.getpid(), "started": int(time.time()),
        })
        loop = asyncio.get_running_loop()
        for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            loop.add_signal_handler(signum, self.begin_stop)
        tasks = [asyncio.ensure_future(self.idle_loop()), asyncio.ensure_future(self.watch_loop())]
        try:
            await self.stop.wait()
        finally:
            self.stopping = True
            server.close()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await self.settle()
            await self.cleanup()
        return 0

    def begin_stop(self):
        self.stopping = True
        self.stop.set()

    async def settle(self):
        active = [task for task in self.active if not task.done()]
        if active:
            await asyncio.wait(active, timeout=SETTLE_TIMEOUT)
        for task in active:
            if not task.done():
                task.cancel()
        await asyncio.gather(*active, return_exceptions=True)

    def refuse_closing(self, options: dict, name: str):
        return render(options, error=BrowseError(f"Session {self.state.session} is closing; start a new command after it ends",
                                                 code="session_closing"), name=name)

    async def cleanup(self):
        try:
            await asyncio.wait_for(self._cleanup(), 10)
        except Exception:
            log.exception("cleanup failed")
        if self.sock_id is not None and paths.socket_is_ours(self.sock, self.dir_fd) == self.sock_id:
            paths.unlink_quietly(self.sock, self.dir_fd)
        paths.unlink_quietly(f"{self.key}.json", self.dir_fd)
        try:
            from ardia_cli.browse import claims

            claims.release(self.dir_fd, self.key)
        except Exception:
            pass
        os.close(self.lock_fd)

    async def _cleanup(self):
        from ardia_cli.browse import capture

        if self.state.connected:
            for page in list(self.state.pages.values()):
                if page.session_id:
                    await page.input.release_all()
            ctx = self.bare_ctx()
            if self.state.extras.get("recording"):
                try:
                    await capture.stop_recording(ctx)
                except BrowseError:
                    pass
            if self.state.extras.get("stream"):
                await capture.stop_stream(ctx)
        await self.state.disconnect()

    def bare_ctx(self):
        from ardia_cli.browse.commands import Ctx

        return Ctx(self.state, {}, str(Path.home()), {}, None)

    async def idle_loop(self):
        while True:
            await asyncio.sleep(1)
            now = time.monotonic()
            if self.state.lost or self.state.restarted:
                if self.pending == 0 or now - self.last > EXIT_GRACE:
                    self.stop.set()
                continue
            if self.state.connected:
                if self.pending == 0 and not self.lock.locked() and not self.leases() and not self.holding() and now - self.last > CONNECTED_IDLE:
                    async with self.lock:
                        if self.pending == 0 and not self.leases() and not self.holding():
                            await self.state.disconnect()
            elif self.pending == 0 and now - self.last > self.idle_limit:
                self.stop.set()

    async def watch_loop(self):
        while True:
            await asyncio.sleep(WATCH_INTERVAL)
            browser = self.state.browser
            if browser is not None and browser.link is not None and browser.link.lost.is_set() and not browser.closed_by_us:
                self.state.lost = True
                log.info("Ardia closed the connection; this daemon ends")
                continue
            if browser is None and self.state.instance is not None and self.pending == 0:
                try:
                    endpoint = await asyncio.to_thread(self.state.resolve_endpoint)
                except BrowseError:
                    self.stop.set()
                    continue
                if endpoint.instance != self.state.instance:
                    self.stop.set()

    async def handle(self, reader, writer):
        sock = writer.get_extra_info("socket")
        if sock is None or paths.peer_uid(sock) != os.getuid():
            writer.close()
            return
        self.pending += 1
        self.last = time.monotonic()
        try:
            raw = await asyncio.wait_for(reader.readline(), 30)
            request = json.loads(raw)
            execute = asyncio.ensure_future(self.execute(request))
            self.active.add(execute)
            execute.add_done_callback(self.active.discard)
            gone = asyncio.ensure_future(reader.read(1))
            done, _ = await asyncio.wait({execute, gone}, return_when=asyncio.FIRST_COMPLETED)
            if execute not in done:
                execute.cancel()
                await asyncio.gather(execute, return_exceptions=True)
                return
            gone.cancel()
            code, out, err = execute.result()
            writer.write(encode_answer(code, out, err))
            await writer.drain()
        except Exception:
            log.exception("request failed")
        finally:
            self.pending -= 1
            self.last = time.monotonic()
            try:
                writer.close()
            except Exception:
                pass

    async def execute(self, request: dict) -> tuple[int, str, str]:
        from ardia_cli.browse.commands import ALIASES, Ctx

        argv = request.get("argv") or []
        options = request.get("options") or {}
        name = ALIASES.get(argv[0], argv[0]) if argv else ""
        ctx = Ctx(self.state, options, request.get("cwd") or str(Path.home()), request.get("env") or {}, request.get("stdin"), name)
        if options.get("no_auto_dialog"):
            self.state.auto_dialog = False
        if options.get("pin_tab") is not None:
            self.state.pin_tab = bool(options["pin_tab"])
        if self.stopping:
            return self.refuse_closing(options, name)
        if name == "close":
            return await self.close(ctx)
        async with self.lock:
            if self.stopping:
                return self.refuse_closing(options, name)
            if self.state.lost:
                return render(options, error=ConnectionLost(), name=name)
            try:
                result = await dispatch(ctx, name, argv[1:])
            except BrowseError as error:
                if isinstance(error, ConnectionLost) or (self.state.browser is not None and not self.state.browser.alive and not self.state.browser.closed_by_us):
                    self.state.lost = True
                    error = error if isinstance(error, ConnectionLost) else ConnectionLost()
                if isinstance(error, Unreachable) and self.state.instance is None:
                    self.state.restarted = True
                return render(options, error=error, name=name)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                log.exception("command %s crashed", name)
                return render(options, error=BrowseError(f"{name} failed: {type(error).__name__}: {error}"), name=name)
            return render(options, result=result, name=name)

    async def close(self, ctx):
        from ardia_cli.browse.commands import Result

        closed = 0
        async with self.lock:
            if self.stopping:
                return self.refuse_closing(ctx.options, "close")
            self.stopping = True
            if self.state.opened and not self.state.lost:
                try:
                    await self.state.connect()
                    await self.state.refresh_targets()
                    for target_id in list(self.state.opened):
                        if target_id in self.state.target_infos:
                            await self.state.browser.send("Target.closeTarget", {"targetId": target_id})
                            closed += 1
                        self.state.forget_target(target_id)
                except BrowseError:
                    pass
        self.stop.set()
        text = f"✓ Session {self.state.session} closed ({closed} tab{'s' if closed != 1 else ''} it opened)"
        return render(ctx.options, result=Result({"closed": True, "tabs": closed}, text), name="close")


def encode_answer(code: int, out: str, err: str) -> bytes:
    data = (json.dumps({"exit": code, "out": out, "err": err}, ensure_ascii=False) + "\n").encode()
    if len(data) <= MAX_RESPONSE:
        return data
    message = f"✗ The answer was too large ({len(data)} bytes, the limit is {MAX_RESPONSE}); narrow it (snapshot -s, -d, --max-output)\n"
    return (json.dumps({"exit": 1, "out": "", "err": message}) + "\n").encode()


def take_lease():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(sys.executable))))
    leases = os.path.join(root, ".leases")
    if not os.path.isdir(leases):
        return None
    path = os.path.join(leases, str(os.getpid()))
    try:
        os.close(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644))
    except OSError:
        return None
    return path


def main():
    from ardia_cli import redact

    config = json.loads(sys.stdin.read() or "{}")
    sys.stdin.close()
    sys.stdout = redact.RedactingStream(sys.stdout)
    sys.stderr = redact.RedactingStream(sys.stderr)
    redact.install_log_redaction()
    logging.basicConfig(level=logging.INFO if config.get("debug") else logging.WARNING, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    logging.getLogger("pydoll").setLevel(logging.CRITICAL)
    logging.getLogger("websockets").setLevel(logging.ERROR)
    load_commands()
    lease = take_lease()
    try:
        daemon = Daemon(config)
        status = asyncio.run(daemon.run())
    except paths.PathError as error:
        sys.stderr.write(f"ardia browse daemon: {error}\n")
        status = 2
    finally:
        if lease:
            try:
                os.unlink(lease)
            except OSError:
                pass
        sys.stdout.flush()
        sys.stderr.flush()
    os._exit(status or 0)
