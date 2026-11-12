import asyncio
import json
import logging
import os
import signal
import sys
import time
from pathlib import Path

from ardia_cli import command_metrics
from ardia_cli.browse import paths
from ardia_cli.caller import parse as parse_caller
from ardia_cli.browse.errors import BrowseError, ConnectionLost, Unreachable, Usage
from ardia_cli.browse.limits import QUEUE_WAIT, command_limit

CONNECTED_IDLE = 30.0
DEFAULT_DAEMON_IDLE = 3600.0
MAX_REQUEST = 16 * 1024 * 1024
MAX_RESPONSE = 256 * 1024 * 1024
OUTPUT_CAP = 6000
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


async def run_one(ctx, argv, options: dict | None = None):
    from ardia_cli.browse.commands import ALIASES, Ctx

    if not argv:
        return None, BrowseError("No command given")
    name = ALIASES.get(argv[0], argv[0])
    sub = Ctx(ctx.state, {**ctx.options, **(options or {})}, ctx.cwd, ctx.env, ctx.stdin, name)
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
    result = await handler(ctx, argv)
    extras = getattr(ctx.state, "extras", None)
    if name != "batch" and isinstance(extras, dict) and extras.get("top_command") != "script":
        from ardia_cli.browse.commands import note_reading

        note_reading(ctx.state, name, argv, result)
    return result


def sanitize(value):
    from ardia_cli.redact import redact

    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {sanitize(key) if isinstance(key, str) else key: sanitize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize(item) for item in value]
    return value


def redact_text(text: str) -> str:
    from ardia_cli.redact import redact

    return redact(text)


def render(options: dict, result=None, error: BrowseError | None = None, name: str = "") -> tuple[int, str, str]:
    from ardia_cli.redact import redact

    code, out, err = _render(options, result, error, name)
    command_metrics.rendered(name, result, error, out)
    return code, redact(out), redact(err)


def _render(options: dict, result=None, error: BrowseError | None = None, name: str = "") -> tuple[int, str, str]:
    from ardia_cli.browse.commands import MUTATING, boundary
    from ardia_cli.printable import inert, json_safe

    as_json = options.get("json")
    if error is not None:
        message = error.message
        if isinstance(error, ConnectionLost) and name in MUTATING:
            message += f"; the outcome of `{name}` is unknown, so it wasn't retried"
        if as_json:
            payload = {"success": False, "data": error.data, "error": message}
            if error.code:
                payload["code"] = error.code
            return error.exit_code, json_safe(json.dumps(sanitize(payload), ensure_ascii=False, separators=(",", ":"))) + "\n", ""
        return error.exit_code, "", f"✗ {inert(message)}\n"
    batch = getattr(result, "batch", None)
    code = 1 if getattr(result, "failed", False) else 0
    if as_json:
        if batch is not None:
            return code, json_safe(json.dumps(sanitize(batch), ensure_ascii=False, separators=(",", ":"))) + "\n", ""
        return code, json_safe(json.dumps(sanitize({"success": True, "data": result.data, "error": None}), ensure_ascii=False, separators=(",", ":"))) + "\n", ""
    text = result.text
    if text is None:
        return code, "", ""
    text = cap(redact_text(text), options, name, getattr(result, "output_cap", None))
    notice = cap_notice(text)
    if result.page_content and options.get("content_boundaries"):
        text = boundary(text)
    return code, inert(text) + "\n", inert(notice) + "\n" if notice else ""


NARROWER = {
    "snapshot": "snapshot -i (interactive only), snapshot -s <css> (one region), find role <role> <action> --name <text> (act without a snapshot)",
    "get": "get text <css> or read -s <css> (one region)",
    "read": "read -s <css> (one region per page), or fewer pages",
    "eval": "return less from the script, or get text <css> / read -s <css> for one region",
    "script": "return fewer fields or rows from the script",
}
CAP_NOTICE = "[output capped at "
NARROW_ANY = "snapshot -i, snapshot -s <css>, get text <css>, read -s <css>, find role <role> <action> --name <text>"


def cap(text: str, options: dict, name: str = "", default: int | None = None) -> str:
    if options.get("full"):
        return text
    limit = options.get("max_output")
    limit = (default or OUTPUT_CAP) if limit is None else int(limit)
    if limit <= 0 or len(text) <= limit:
        return text
    cut = text.rfind("\n", 0, limit + 1)
    cut = cut if cut >= limit * 0.8 else limit
    return text[:cut] + (f"\n{CAP_NOTICE}{cut:,} of {len(text):,} characters. Narrow it instead: {NARROWER.get(name, NARROW_ANY)}. "
                         f"Only if you need every line: --max-output {len(text)}]")


def cap_notice(text: str) -> str:
    last = text.rpartition("\n")[2]
    cut_short = last.startswith("[") and "Narrow it instead: " in last and "--max-output " in last
    return last if last.startswith(CAP_NOTICE) or cut_short else ""


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
        try:
            self.state.registry.forget()
        except Exception:
            pass
        os.close(self.lock_fd)

    async def _cleanup(self):
        from ardia_cli.browse import capture, temptabs

        await temptabs.drain(self.state)
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
            writer.write(encode_answer(code, out, err, command_metrics.answer_fields(request)))
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

        command_metrics.begin(request)
        argv = request.get("argv") or []
        options = request.get("options") or {}
        name = ALIASES.get(argv[0], argv[0]) if argv else ""
        ctx = Ctx(self.state, options, request.get("cwd") or str(Path.home()), request.get("env") or {}, request.get("stdin"), name)
        self.state.caller = parse_caller(request.get("caller")) or self.state.caller
        if options.get("no_auto_dialog"):
            self.state.auto_dialog = False
        if options.get("pin_tab") is not None:
            self.state.pin_tab = bool(options["pin_tab"])
        if self.stopping:
            return self.refuse_closing(options, name)
        if name == "close":
            return await self.close(ctx)
        try:
            await asyncio.wait_for(self.lock.acquire(), QUEUE_WAIT)
        except asyncio.TimeoutError:
            return render(options, error=self.busy_error(), name=name)
        try:
            if self.stopping:
                return self.refuse_closing(options, name)
            if self.state.lost:
                return render(options, error=ConnectionLost(), name=name)
            self.state.extras.pop("notice", None)
            if self.state.connected:
                await self.state.announce_caller(self.state.endpoint)
            self.state.extras.pop("close_after_batch", None)
            self.state.extras["top_command"] = name
            self.state.extras["running"] = {"name": name, "since": time.monotonic()}
            limit = command_limit(name, argv[1:], ctx.timeout)
            try:
                code, out, err = await asyncio.wait_for(self.answer(ctx, name, argv, options), limit)
            except asyncio.TimeoutError:
                code, out, err = render(options, error=timed_out(name, limit), name=name)
            await self.restore_metrics()
            notice = self.state.extras.pop("notice", None)
            err = (redact_text(notice) + "\n" if notice else "") + err
            close_after = self.state.extras.pop("close_after_batch", None) and name == "batch" and code == 0
        finally:
            self.state.extras.pop("running", None)
            self.lock.release()
        if close_after:
            closed_code, closed_out, closed_err = await self.close(ctx)
            return max(code, closed_code), joined_batch(out, closed_out, options), err + closed_err
        return code, out, err

    async def restore_metrics(self):
        from ardia_cli.browse.actions import restore_metrics

        for page in list(self.state.pages.values()):
            if getattr(page, "temporary_metrics", False) and page.session_id and self.state.connected:
                await restore_metrics(page)

    def busy_error(self) -> BrowseError:
        running = self.state.extras.get("running") or {}
        age = f" for {time.monotonic() - running['since']:.0f} s" if running.get("since") else ""
        what = f"`{running['name']}`" if running.get("name") else "another command"
        return BrowseError(f"This session is still running {what}{age}; this command waited {QUEUE_WAIT:g} s for it and gave up without "
                           "running. Try again shortly, or use another --session", code="session_busy")

    async def answer(self, ctx, name, argv, options) -> tuple[int, str, str]:
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
            from ardia_cli import telemetry

            telemetry.report_exception(error, "browse_daemon", self.config)
            return render(options, error=BrowseError(f"{name} failed: {type(error).__name__}: {error}"), name=name)
        return render(options, result=result, name=name)

    async def close(self, ctx):
        from ardia_cli.browse.commands import Result

        closed = 0
        kept = []
        async with self.lock:
            if self.stopping:
                return self.refuse_closing(ctx.options, "close")
            self.stopping = True
            leftovers = self.state.instance is not None and self.state.registry.temporaries(self.state.instance)
            if (self.state.opened or leftovers) and not self.state.lost:
                try:
                    from ardia_cli.browse import temptabs

                    await self.state.connect()
                    await self.state.refresh_targets()
                    await temptabs.sweep(self.state)
                    registry, instance = self.state.registry, self.state.instance
                    for target_id in list(self.state.opened):
                        if target_id not in self.state.target_infos:
                            self.state.forget_target(target_id)
                            continue
                        if not registry.reserve_close(instance, target_id):
                            users = registry.others(instance)[1].get(target_id) or ["another session"]
                            kept.append(f"[{self.state.tab_id(target_id)}], which session {', '.join(users)} uses")
                            self.state.forget_target(target_id)
                            continue
                        try:
                            await self.state.browser.send("Target.closeTarget", {"targetId": target_id})
                            closed += 1
                        finally:
                            registry.finish_close(instance, target_id)
                        self.state.forget_target(target_id)
                except BrowseError:
                    pass
        self.stop.set()
        text = f"✓ Session {self.state.session} closed ({closed} tab{'s' if closed != 1 else ''} it opened)"
        if kept:
            text += f"; left open: {'; '.join(kept)}"
        return render(ctx.options, result=Result({"closed": True, "tabs": closed, "keptOpen": kept}, text), name="close")


def joined_batch(out: str, closed: str, options: dict) -> str:
    if not options.get("json"):
        return (out.rstrip("\n") + "\n\n" if out.strip() else "") + closed
    try:
        outcomes = json.loads(out)
        answer = json.loads(closed)
    except ValueError:
        return out + closed
    outcomes.append({"command": ["close"], "success": answer.get("success", False), "result": answer.get("data"), "error": answer.get("error")})
    return json.dumps(outcomes, ensure_ascii=False, separators=(",", ":")) + "\n"




def timed_out(name: str, limit: float) -> BrowseError:
    from ardia_cli.browse.commands import MUTATING

    unknown = ", so its outcome is unknown and it wasn't retried" if name in MUTATING else ""
    return BrowseError(f"`{name}` didn't finish within {limit:g} s and was stopped{unknown}. Snapshot to see where the page is", code="command_timeout")


def encode_answer(code: int, out: str, err: str, fields: dict | None = None) -> bytes:
    data = (json.dumps({"exit": code, "out": out, "err": err, **(fields or {})}, ensure_ascii=False) + "\n").encode()
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
    except Exception as error:
        from ardia_cli import telemetry

        telemetry.report_exception(error, "browse_daemon", config, fatal=True)
        raise
    finally:
        if lease:
            try:
                os.unlink(lease)
            except OSError:
                pass
        sys.stdout.flush()
        sys.stderr.flush()
    os._exit(status or 0)
