import asyncio
import collections
import json
import os
import plistlib
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from ardia_cli import control, urlmatch

HOOKS_FILE = "hooks.json"
LABEL = "dev.ardia.hooks"
QUEUE_CAP = 100
DEFAULT_TIMEOUT = 60.0
KILL_GRACE = 5.0
DRAIN_GRACE = 1.0
LOG_LIMIT = 5 * 1024 * 1024
LINE_LIMIT = 64 * 1024
ENV_LIMIT = 4096
BACKOFF_START = 1.0
BACKOFF_MAX = 30.0
WATCH_INTERVAL = 1.0
EVENT_ENV = {
    "ARDIA_EVENT": None,
    "ARDIA_WINDOW_ID": "windowId",
    "ARDIA_TAB_ID": "tabId",
    "ARDIA_PROFILE": "profile",
    "ARDIA_URL": "url",
    "ARDIA_TITLE": "title",
}
HOOK_KEYS = ("name", "on", "match", "run", "timeout")
DEFAULT_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"


class HooksError(Exception):
    pass


@dataclass(frozen=True)
class Hook:
    name: str
    events: tuple
    patterns: tuple = ()
    program: tuple = ()
    timeout: float = DEFAULT_TIMEOUT
    specs: tuple = field(default=(), compare=False, repr=False)

    def wants(self, event: dict) -> bool:
        name = event.get("event")
        if "*" not in self.events and name not in self.events:
            return False
        if not self.specs:
            return True
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        url = data.get("url")
        if not isinstance(url, str) or not url:
            return False
        parts = urlmatch.split(url)
        return any(urlmatch.matches(spec, parts) for spec in self.specs)

    def to_dict(self) -> dict:
        return {"name": self.name, "on": list(self.events), "match": list(self.patterns), "run": list(self.program), "timeout": self.timeout}


def check_timeout(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= 86400:
        raise ValueError("timeout must be a number of seconds, more than 0 and at most 86400")
    return float(value)


def make_hook(name: str, events, patterns, program, timeout=DEFAULT_TIMEOUT) -> Hook:
    events = tuple(control.check_events(events))
    if not events:
        raise ValueError("give at least one event")
    specs = []
    for pattern in patterns:
        try:
            specs.append(urlmatch.parse(pattern))
        except urlmatch.PatternError as error:
            raise ValueError(f"bad match pattern {pattern}: {error}") from None
    if not program or not all(isinstance(p, str) and p and "\0" not in p for p in program):
        raise ValueError("run must be a non-empty list of strings: [program, args…]")
    return Hook(name, events, tuple(patterns), tuple(program), check_timeout(timeout), tuple(specs))


def parse_hooks(text: str) -> list[Hook]:
    from ardia_cli import config_files
    from ardia_cli.schema_check import did_you_mean

    try:
        document = config_files.parse_json(text)
    except json.JSONDecodeError as error:
        raise HooksError(f"{HOOKS_FILE} doesn't parse: line {error.lineno} column {error.colno}: {error.msg}") from None
    except ValueError as error:
        raise HooksError(f"{HOOKS_FILE} doesn't parse: {error}") from None
    if not isinstance(document, dict) or not isinstance(document.get("hooks"), list):
        raise HooksError(f'{HOOKS_FILE} must be an object with a "hooks" list')
    hooks, problems, names = [], [], set()
    for index, item in enumerate(document["hooks"], 1):
        label = f"hook {index}"
        if not isinstance(item, dict):
            problems.append(f"{label} must be an object")
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            problems.append(f"{label} needs a name")
            continue
        label = f"hook {name}"
        if name in names:
            problems.append(f"{label}: the name is used twice")
            continue
        names.add(name)
        unknown = [k for k in item if k not in HOOK_KEYS]
        if unknown:
            problems.append(f"{label}: unknown key {unknown[0]}{did_you_mean(unknown[0], HOOK_KEYS)}")
            continue
        events = item.get("on")
        events = [events] if isinstance(events, str) else events
        patterns = item.get("match", [])
        patterns = [patterns] if isinstance(patterns, str) else patterns
        program = item.get("run")
        if isinstance(program, str):
            problems.append(f'{label}: run must be a list, like ["{program}"], or ["/bin/sh", "-c", "…"] for a shell line')
            continue
        if not isinstance(events, list) or not all(isinstance(e, str) for e in events):
            problems.append(f"{label}: on must be a list of event names")
            continue
        if not isinstance(patterns, list) or not all(isinstance(p, str) for p in patterns):
            problems.append(f"{label}: match must be a list of match patterns")
            continue
        try:
            hooks.append(make_hook(name, events, patterns, program if isinstance(program, list) else None, item.get("timeout", DEFAULT_TIMEOUT)))
        except ValueError as error:
            problems.append(f"{label}: {error}")
    if problems:
        raise HooksError("; ".join(problems))
    return hooks


def read_hooks(path: Path) -> list[Hook]:
    from ardia_cli import config_files

    try:
        text = config_files.read_text(path)
    except config_files.ConfigError as error:
        raise HooksError(str(error)) from None
    return parse_hooks(text)


def env_value(value) -> str:
    text = str(value).replace("\0", "")
    encoded = text.encode("utf-8")
    if len(encoded) <= ENV_LIMIT:
        return text
    return encoded[:ENV_LIMIT].decode("utf-8", "ignore")


def hook_env(event: dict, base=None) -> dict:
    env = dict(os.environ if base is None else base)
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    for variable, key in EVENT_ENV.items():
        env.pop(variable, None)
        value = event.get("event") if key is None else data.get(key)
        if value is not None and not isinstance(value, (dict, list, bool)):
            env[variable] = env_value(value)
    return env


def program_argv(program) -> list[str]:
    first, *rest = program
    if first.startswith("~"):
        first = os.path.expanduser(first)
    return [first, *rest]


class Log:
    def __init__(self, path: Path | None = None, stream=None, limit: int = LOG_LIMIT):
        self.path = path
        self.stream = stream
        self.limit = limit
        self._fd = None

    def _open(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fd = os.open(self.path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        os.fchmod(self._fd, 0o600)

    def write(self, text: str) -> None:
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {text.rstrip()}\n"
        if self.path is None:
            stream = self.stream or sys.stderr
            stream.write(line)
            stream.flush()
            return
        data = line.encode("utf-8", "replace")
        try:
            if self._fd is None:
                self._open()
            size = os.fstat(self._fd).st_size
            if size and size + len(data) > self.limit:
                os.close(self._fd)
                self._fd = None
                os.replace(self.path, self.path.with_name(self.path.name + ".1"))
                self._open()
            os.write(self._fd, data)
        except OSError as error:
            sys.stderr.write(f"ardia hooks: can't write {self.path}: {error.strerror or error}\n{line}")

    def close(self) -> None:
        if self._fd is not None:
            os.close(self._fd)
            self._fd = None


class HookRunner:
    def __init__(self, hook: Hook, log: Log, capture: bool, cap: int = QUEUE_CAP, kill_grace: float = KILL_GRACE):
        self.hook = hook
        self.log = log
        self.capture = capture
        self.cap = cap
        self.kill_grace = kill_grace
        self.queue: collections.deque = collections.deque()
        self.dropped = 0
        self.runs = 0
        self._wake = asyncio.Event()
        self._closing = False
        self._last_warning = 0.0
        self.process = None
        self.task = asyncio.ensure_future(self._loop())

    def offer(self, event: dict) -> None:
        if self._closing:
            return
        if len(self.queue) >= self.cap:
            self.queue.popleft()
            self.dropped += 1
            now = time.monotonic()
            if now - self._last_warning >= 5:
                self.log.write(f"warning: hook {self.hook.name}: {self.cap} events waiting, dropped the oldest ({self.dropped} so far)")
                self._last_warning = now
        self.queue.append(event)
        self._wake.set()

    async def _loop(self):
        while True:
            while not self.queue:
                if self._closing:
                    return
                self._wake.clear()
                await self._wake.wait()
            event = self.queue.popleft()
            try:
                await self.run_once(event)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.log.write(f"hook {self.hook.name}: {type(error).__name__}: {error}")

    async def run_once(self, event: dict) -> int | None:
        self.runs += 1
        argv = program_argv(self.hook.program)
        pipe = asyncio.subprocess.PIPE if self.capture else None
        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=pipe,
                stderr=pipe,
                env=hook_env(event),
                start_new_session=True,
            )
        except (OSError, ValueError) as error:
            self.log.write(f"hook {self.hook.name}: can't run {argv[0]}: {getattr(error, 'strerror', None) or error}")
            return None
        self.process = process
        pumps = [asyncio.ensure_future(self._pump(stream)) for stream in (process.stdout, process.stderr) if stream is not None]
        payload = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.hook.timeout
        timed_out = False
        try:
            try:
                await asyncio.wait_for(self._feed(process, payload), self.hook.timeout)
                status = await asyncio.wait_for(process.wait(), max(deadline - loop.time(), 0))
                await asyncio.wait_for(asyncio.gather(*pumps), max(deadline - loop.time(), 0))
            except asyncio.TimeoutError:
                timed_out = True
                status = await self._stop_group(process, pumps)
        finally:
            self.process = None
        if timed_out:
            self.log.write(f"hook {self.hook.name}: stopped after its {self.hook.timeout:g} s timeout (with anything it left running)")
        elif status != 0:
            self.log.write(f"hook {self.hook.name}: {argv[0]} exited with status {status}")
        return status

    async def _feed(self, process, payload: bytes) -> None:
        try:
            process.stdin.write(payload)
            await process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            try:
                process.stdin.close()
            except Exception:
                pass

    @staticmethod
    def _signal_group(process, sig) -> None:
        try:
            os.killpg(process.pid, sig)
            return
        except (ProcessLookupError, PermissionError):
            pass
        try:
            process.send_signal(sig)
        except ProcessLookupError:
            pass

    async def _stop_group(self, process, pumps) -> int | None:
        for sig, grace in ((signal.SIGTERM, self.kill_grace), (signal.SIGKILL, DRAIN_GRACE)):
            self._signal_group(process, sig)
            leader = asyncio.ensure_future(process.wait())
            waiting = [leader, *(p for p in pumps if not p.done())]
            await asyncio.wait(waiting, timeout=grace)
            if leader.done() and all(p.done() for p in pumps):
                return leader.result()
            if not leader.done():
                leader.cancel()
        for pump in pumps:
            if not pump.done():
                pump.cancel()
        await asyncio.gather(*pumps, return_exceptions=True)
        transport = getattr(process, "_transport", None)
        if transport is not None:
            transport.close()
        try:
            return await asyncio.wait_for(process.wait(), DRAIN_GRACE)
        except asyncio.TimeoutError:
            return None

    async def _pump(self, stream):
        pending = b""
        cutting = False
        while True:
            chunk = await stream.read(65536)
            if not chunk:
                break
            pending += chunk
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                if cutting:
                    cutting = False
                    continue
                self._emit(line)
            if len(pending) > LINE_LIMIT and not cutting:
                self._emit(pending[:LINE_LIMIT], cut=True)
                cutting = True
            if cutting:
                pending = b""
        if pending and not cutting:
            self._emit(pending)

    def _emit(self, line: bytes, cut: bool = False) -> None:
        text = line[:LINE_LIMIT].decode("utf-8", "replace")
        self.log.write(f"[{self.hook.name}] {text}{' …(line cut at 64 KB)' if cut or len(line) > LINE_LIMIT else ''}")

    def close(self) -> None:
        self._closing = True
        self.queue.clear()
        self._wake.set()

    async def stop(self, grace: float = 2.0) -> None:
        self.close()
        process = self.process
        if process is not None and process.returncode is None:
            self._signal_group(process, signal.SIGTERM)
        try:
            await asyncio.wait_for(asyncio.shield(self.task), grace)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            if process is not None:
                self._signal_group(process, signal.SIGKILL)
            self.task.cancel()


class Service:
    def __init__(self, socket_path: Path, log: Log, capture: bool, connect=None, backoff_start=None, backoff_max=None):
        self.socket_path = socket_path
        self.log = log
        self.capture = capture
        self.connect = connect or control.connect
        self.backoff_start = BACKOFF_START if backoff_start is None else backoff_start
        self.backoff_max = BACKOFF_MAX if backoff_max is None else backoff_max
        self.runners: dict[str, HookRunner] = {}
        self.retired: list[HookRunner] = []
        self.changed = asyncio.Event()
        self.subscribed = asyncio.Event()
        self.connections = 0

    def set_hooks(self, hooks) -> None:
        wanted = {hook.name: hook for hook in hooks}
        for name, runner in list(self.runners.items()):
            if wanted.get(name) != runner.hook:
                runner.close()
                self.retired.append(runner)
                del self.runners[name]
        self.retired = [r for r in self.retired if not r.task.done()]
        for name, hook in wanted.items():
            if name not in self.runners:
                self.runners[name] = HookRunner(hook, self.log, self.capture)
        self.changed.set()

    def event_names(self) -> list[str]:
        names = set()
        for runner in self.runners.values():
            names.update(runner.hook.events)
        if "*" in names:
            return ["*"]
        return [name for name in control.EVENTS if name in names]

    def dispatch(self, event: dict) -> None:
        dropped = event.get("dropped")
        if isinstance(dropped, int) and not isinstance(dropped, bool) and dropped > 0:
            self.log.write(f"warning: Ardia dropped {dropped} event{'s' if dropped != 1 else ''} before this one because the runner fell behind")
        for runner in list(self.runners.values()):
            if runner.hook.wants(event):
                runner.offer(event)

    async def run_forever(self) -> None:
        delay = self.backoff_start
        reported = None
        while True:
            try:
                connection = await self.connect(self.socket_path)
            except control.Unreachable as error:
                if reported != str(error):
                    self.log.write(f"{error}; retrying")
                    reported = str(error)
                await asyncio.sleep(delay)
                delay = min(delay * 2, self.backoff_max)
                continue
            delay = self.backoff_start
            reported = None
            self.connections += 1
            gap = " (events in between may have been missed)" if self.connections > 1 else ""
            self.log.write(f"connected to Ardia {connection.info.get('version', '')}".rstrip() + gap)
            try:
                await self._serve(connection)
            except control.Unreachable as error:
                self.log.write(f"lost Ardia: {error}")
            except control.MethodError as error:
                self.log.write(f"Ardia refused the subscription ({error.code}: {error.message}); retrying")
                await asyncio.sleep(delay)
                delay = min(delay * 2, self.backoff_max)
            finally:
                self.subscribed.clear()
                await connection.close()

    async def _serve(self, connection) -> None:
        self.changed.set()
        reading = None
        waiting = None
        try:
            while True:
                if self.changed.is_set():
                    self.changed.clear()
                    await connection.subscribe(self.event_names())
                    self.subscribed.set()
                if reading is None:
                    reading = asyncio.ensure_future(connection.next_event())
                if waiting is None:
                    waiting = asyncio.ensure_future(self.changed.wait())
                done, _ = await asyncio.wait({reading, waiting}, return_when=asyncio.FIRST_COMPLETED)
                if reading in done:
                    event = reading.result()
                    reading = None
                    behind = connection.take_dropped()
                    if behind:
                        self.log.write(f"warning: {behind} event{'s' if behind != 1 else ''} dropped before this one because the runner fell behind reading them")
                    self.dispatch(event)
                if waiting in done:
                    waiting = None
        finally:
            for task in (reading, waiting):
                if task is not None and not task.done():
                    task.cancel()

    async def stop(self) -> None:
        await asyncio.gather(*(runner.stop() for runner in [*self.runners.values(), *self.retired]), return_exceptions=True)


def file_signature(path: Path):
    try:
        info = os.stat(path)
        link = os.lstat(path)
    except OSError:
        return None
    return (info.st_ino, info.st_dev, info.st_size, info.st_mtime_ns, link.st_ino, link.st_mtime_ns)


async def watch_hooks(path: Path, service: Service, log: Log, interval: float = WATCH_INTERVAL) -> None:
    seen = object()
    while True:
        signature = file_signature(path)
        if signature != seen:
            seen = signature
            load(path, service, log)
        await asyncio.sleep(interval)


def load(path: Path, service: Service, log: Log) -> None:
    try:
        hooks = read_hooks(path)
    except FileNotFoundError:
        log.write(f"no {path} yet; waiting for it")
        service.set_hooks([])
        return
    except (HooksError, OSError) as error:
        log.write(f"{path}: {getattr(error, 'strerror', None) or error}; keeping the hooks loaded before")
        return
    service.set_hooks(hooks)
    log.write(f"loaded {len(hooks)} hook{'s' if len(hooks) != 1 else ''}: {', '.join(h.name for h in hooks) or 'none'}")


@dataclass(frozen=True)
class AgentPaths:
    home: Path
    cli_home: Path

    @property
    def agents(self) -> Path:
        return self.home / "Library" / "LaunchAgents"

    @property
    def plist(self) -> Path:
        return self.agents / f"{LABEL}.plist"

    @property
    def logs(self) -> Path:
        return self.home / "Library" / "Logs" / "Ardia"

    @property
    def log(self) -> Path:
        return self.logs / "hooks.log"

    @property
    def launcher(self) -> Path:
        return self.cli_home / "current" / "bin" / "ardia"


def agent_paths() -> AgentPaths:
    home = Path.home()
    cli_home = os.environ.get("ARDIA_CLI_HOME") or str(home / "Library" / "Application Support" / "Ardia" / "CLI")
    return AgentPaths(home, Path(cli_home).expanduser())


def agent_plist(paths: AgentPaths, path_env: str | None) -> dict:
    return {
        "Label": LABEL,
        "ProgramArguments": [str(paths.launcher), "hooks", "run", "--log", str(paths.log)],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ProcessType": "Background",
        "WorkingDirectory": str(paths.home),
        "EnvironmentVariables": {"PATH": path_env or DEFAULT_PATH, "ARDIA_DATA_DIR": ""},
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def launchctl(arguments: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(["/bin/launchctl", *arguments], capture_output=True, text=True, timeout=20)


def domain() -> str:
    return f"gui/{os.getuid()}"


def agent_state(run=None) -> dict:
    run = run or launchctl
    try:
        result = run(["print", f"{domain()}/{LABEL}"])
    except (OSError, subprocess.TimeoutExpired):
        return {"loaded": None}
    if result.returncode != 0:
        return {"loaded": False}
    state = {"loaded": True}
    for line in result.stdout.splitlines():
        key, sep, value = line.strip().partition(" = ")
        name = key.replace(" ", "_")
        if sep and key in ("state", "pid", "last exit code") and name not in state:
            state[name] = int(value) if value.lstrip("-").isdigit() else value
    return state
