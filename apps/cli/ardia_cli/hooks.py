import asyncio
import collections
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from ardia_cli import control, endpoint, urlmatch

HOOKS_FILE = "hooks.json"
LABEL = "dev.ardia.hooks"
SERVICE = f"{LABEL}.service"
RESTART_SECONDS = 10
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
HOOK_KEYS = (
    "name", "on", "at", "days", "timezone", "every", "match", "run", "command", "arg", "timeout", "idle", "fullUrls",
    "rewrite", "cancel", "route", "drop", "from", "folder", "permission", "kinds", "omnibox",
)
RULE_KEYS = {"rewrite": "tab.opening", "cancel": "tab.opening", "route": "link.opening", "drop": "link.opening", "folder": "download.deciding", "permission": "permission.requested"}
FILTER_KEYS = {"from": "link.opening", "kinds": "permission.requested"}
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
OPEN_MODES = ("tab", "littleArdia", "window")
MIN_IDLE = 60
MAX_HOOKS = 200
MAX_REWRITES = 50
DEFAULT_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"
COMMAND_BURST = 10
COMMAND_WINDOW = 10.0


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
    command: str | None = None
    arg: str | None = None
    decide: str | None = None
    rules: bool = False
    omnibox: dict | None = field(default=None, compare=False)
    idle: int | None = None
    full_urls: bool = False
    at: str | None = None
    days: tuple = ()
    timezone: str | None = None
    every: int | None = None
    raw: str = field(default="", repr=False)

    @property
    def scheduled(self) -> bool:
        return self.at is not None or self.every is not None

    @property
    def listens(self) -> bool:
        return not self.decide and self.omnibox is None and not self.scheduled

    @property
    def served(self) -> bool:
        return bool(self.program) and (self.decide is not None or self.omnibox is not None)

    @property
    def revision(self) -> str:
        return hashlib.sha256(self.raw.encode("utf-8")).hexdigest()[:32]

    def definition(self) -> dict:
        return json.loads(self.raw) if self.raw else {}

    def wants(self, event: dict) -> bool:
        if not self.listens:
            return False
        name = event.get("event")
        if name in control.NAMED_ONLY_EVENTS:
            if name not in self.events:
                return False
        elif "*" not in self.events and name not in self.events:
            return False
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        if name in control.TAB_IDLE_EVENTS or name in control.USER_IDLE_EVENTS:
            if data.get("idle") != self.idle:
                return False
        if not self.specs:
            return True
        url = data.get("url")
        if not isinstance(url, str) or not url:
            return False
        parts = urlmatch.split(url)
        return any(urlmatch.matches(spec, parts) for spec in self.specs)

    def trigger(self) -> str:
        if self.omnibox is not None:
            keyword = self.omnibox.get("keyword")
            return f"omnibox {self.omnibox.get('title')}" + (f" (keyword {keyword})" if keyword else " (global)")
        if self.at is not None:
            days = f" on {','.join(self.days)}" if self.days else " daily"
            return f"at {self.at}{days}" + (f" {self.timezone}" if self.timezone else "")
        if self.every is not None:
            return f"every {format_duration(self.every)}"
        idle = f" idle {format_duration(self.idle)}" if self.idle else ""
        return f"on {','.join(self.events)}{idle}"

    def action(self) -> str:
        if self.rules:
            keys = [k for k in RULE_KEYS if k in self.definition()]
            return f"answers in Ardia ({', '.join(keys)})"
        if self.command:
            return f"command {self.command}" + (f":{self.arg}" if self.arg else "")
        tail = "" if self.decide or self.omnibox is not None else f"  timeout {self.timeout:g}s"
        return f"run {' '.join(self.program)}{tail}"

    def kind(self) -> str:
        if self.omnibox is not None:
            return "omnibox"
        if self.decide:
            return "decide"
        if self.scheduled:
            return "scheduled"
        return "command" if self.command else "event"

    def to_dict(self) -> dict:
        out = {"name": self.name, "kind": self.kind(), "on": list(self.events), "match": list(self.patterns), "run": list(self.program), "timeout": self.timeout}
        for key, value in (("command", self.command), ("arg", self.arg), ("decide", self.decide), ("idle", self.idle), ("at", self.at), ("every", self.every), ("timezone", self.timezone)):
            if value is not None:
                out[key] = value
        if self.days:
            out["days"] = list(self.days)
        if self.omnibox is not None:
            out["omnibox"] = self.omnibox
        if self.rules:
            out["answers"] = self.action()
        return out


def format_duration(seconds: int) -> str:
    for unit, size in (("d", 86400), ("h", 3600), ("m", 60)):
        if seconds % size == 0:
            return f"{seconds // size}{unit}"
    return f"{seconds}s"


def parse_duration(value) -> int | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if len(text) < 2 or not text[:-1].isdigit() or text[-1] not in "smhd":
        return None
    return int(text[:-1]) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[text[-1]]


def check_timeout(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= 86400:
        raise ValueError("timeout must be a number of seconds, more than 0 and at most 86400")
    return float(value)


def check_hook_events(names) -> list[str]:
    from ardia_cli.schema_check import did_you_mean

    names = list(names)
    known = control.EVENTS + control.DECIDE_EVENTS
    for name in names:
        if name != "*" and name not in known:
            raise ValueError(f"unknown event {name}{did_you_mean(name, known)}; events: {', '.join(known)}")
    return names


def make_hook(name: str, events, patterns, program, timeout=DEFAULT_TIMEOUT, idle=None, full_urls=False) -> Hook:
    events = tuple(control.check_events(events))
    if not events:
        raise ValueError("give at least one event")
    idle_events = [e for e in events if e in control.TAB_IDLE_EVENTS or e in control.USER_IDLE_EVENTS]
    if idle_events and idle is None:
        raise ValueError(f"{idle_events[0]} needs an idle threshold, like --idle 30m")
    if idle is not None and (not idle_events or idle < MIN_IDLE):
        raise ValueError("--idle goes with tab.idle, tab.resumed, user.idle or user.active and is at least 1m")
    specs = parse_patterns(patterns)
    if not program or not all(isinstance(p, str) and p and "\0" not in p for p in program):
        raise ValueError("run must be a non-empty list of strings: [program, args…]")
    return Hook(name, events, tuple(patterns), tuple(program), check_timeout(timeout), tuple(specs), idle=idle, full_urls=full_urls)


def parse_patterns(patterns) -> list:
    specs = []
    for pattern in patterns:
        try:
            specs.append(urlmatch.parse(pattern))
        except urlmatch.PatternError as error:
            raise ValueError(f"bad match pattern {pattern}: {error}") from None
    return specs


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _string_list(value) -> bool:
    return isinstance(value, list) and all(isinstance(v, str) for v in value)


def _check_trigger(item: dict) -> None:
    triggers = [k for k in ("on", "at", "every", "omnibox") if k in item]
    if len(triggers) != 1:
        raise ValueError("give exactly one of on, at, every or omnibox")
    if "at" in item:
        at = item["at"]
        if not isinstance(at, str) or len(at) != 5 or at[2] != ":" or not (at[:2].isdigit() and at[3:].isdigit()) or int(at[:2]) > 23 or int(at[3:]) > 59:
            raise ValueError('at must be a time like "09:00"')
    if "days" in item:
        if "at" not in item:
            raise ValueError("days only goes with at")
        if not _string_list(item["days"]) or not item["days"] or any(d not in DAYS for d in item["days"]):
            raise ValueError(f"days must be a list of {', '.join(DAYS)}")
    if "timezone" in item:
        if "at" not in item or not isinstance(item["timezone"], str):
            raise ValueError("timezone goes with at and is a name like Europe/Paris")
        try:
            from zoneinfo import ZoneInfo

            ZoneInfo(item["timezone"])
        except Exception:
            raise ValueError(f"timezone {item['timezone']} isn't a known time zone") from None
    if "every" in item:
        every = parse_duration(item["every"])
        if every is None or every < 60:
            raise ValueError('every must be a duration like "15m" or "1h", at least 1m')


def _check_rules(item: dict, decide: str) -> None:
    if "rewrite" in item:
        rules = item["rewrite"]
        if not isinstance(rules, list) or not 1 <= len(rules) <= MAX_REWRITES:
            raise ValueError(f'rewrite must be a list of 1 to {MAX_REWRITES} {{"match", "to"}} rules')
        for rule in rules:
            if not isinstance(rule, dict) or set(rule) != {"match", "to"} or not isinstance(rule["match"], str) or not isinstance(rule["to"], str):
                raise ValueError('each rewrite rule is {"match": pattern, "to": URL}')
            parse_patterns([rule["match"]])
            target = rule["to"]
            for lead in ("{url}", "{origin}"):
                if target.startswith(lead):
                    target = "https://x" + target[len(lead):]
            if not target.lower().startswith(("http://", "https://")):
                raise ValueError(f"rewrite to {rule['to']} must be an http or https URL")
    for key in ("cancel", "drop"):
        if key in item and item[key] is not True:
            raise ValueError(f"{key} must be true")
    if "route" in item:
        route = item["route"]
        if not isinstance(route, dict) or set(route) - {"profile", "open"} or not route:
            raise ValueError('route is {"profile"?: name, "open"?: "tab" | "littleArdia" | "window"}')
        if "profile" in route and (not isinstance(route["profile"], str) or not route["profile"]):
            raise ValueError("route.profile must be a profile name or id")
        if "open" in route and route["open"] not in OPEN_MODES:
            raise ValueError(f"route.open must be {', '.join(OPEN_MODES)}")
    if "folder" in item:
        folder = item["folder"]
        if not isinstance(folder, str) or not folder.startswith("~/"):
            raise ValueError("folder must be a path under your home folder, starting with ~/")
        if any(part in (".", "..") for part in folder.split("/")):
            raise ValueError("folder can't contain . or .. parts")
    if "permission" in item and item["permission"] not in ("allow", "deny", "ask"):
        raise ValueError("permission must be allow, deny or ask")
    answers = [k for k in RULE_KEYS if k in item]
    if len(answers) > 1 and not (decide == "tab.opening" and "rewrite" in item and "cancel" not in item):
        raise ValueError("give one answer: one of the decide keys")


def _check_omnibox(value) -> dict:
    if not isinstance(value, dict) or set(value) - {"title", "keyword", "global"}:
        raise ValueError('omnibox is {"title", "keyword"} or {"title", "global": true}')
    if not isinstance(value.get("title"), str) or not value["title"].strip():
        raise ValueError("omnibox needs a title")
    keyword = value.get("keyword")
    if keyword is not None and (not isinstance(keyword, str) or not 1 <= len(keyword) <= 32 or any(c.isspace() for c in keyword)):
        raise ValueError("omnibox.keyword must be one word")
    if "global" in value and value["global"] is not True:
        raise ValueError("omnibox.global must be true")
    if ("keyword" in value) == ("global" in value):
        raise ValueError("omnibox takes a keyword or global: true, not both")
    return {"title": value["title"].strip(), "keyword": keyword, "global": value.get("global") is True}


def hook_from(item: dict) -> Hook:
    from ardia_cli.schema_check import did_you_mean

    name = item["name"]
    unknown = [k for k in item if k not in HOOK_KEYS]
    if unknown:
        raise ValueError(f"unknown key {unknown[0]}{did_you_mean(unknown[0], HOOK_KEYS)}")
    _check_trigger(item)
    events = item.get("on", [])
    events = [events] if isinstance(events, str) else events
    if not _string_list(events):
        raise ValueError("on must be a list of event names")
    check_hook_events(events)
    if "on" in item and not events:
        raise ValueError("give at least one event")
    decide = next((e for e in events if e in control.DECIDE_EVENTS), None)
    if decide and len(events) != 1:
        raise ValueError(f"{decide} goes alone in on")
    patterns = item.get("match", [])
    patterns = [patterns] if isinstance(patterns, str) else patterns
    if not _string_list(patterns):
        raise ValueError("match must be a list of match patterns")
    specs = parse_patterns(patterns)
    rule_keys = [k for k in item if k in RULE_KEYS]
    actions = sum(1 for k in ("run", "command") if k in item) + (1 if rule_keys else 0)
    if actions != 1:
        raise ValueError("give exactly one of run, command or a decide answer (rewrite, cancel, route, drop, folder, permission)")
    for key in rule_keys + [k for k in item if k in FILTER_KEYS]:
        owner = RULE_KEYS.get(key) or FILTER_KEYS[key]
        if decide != owner:
            raise ValueError(f'{key} only goes with on: ["{owner}"]')
    program = item.get("run")
    if isinstance(program, str):
        raise ValueError(f'run must be a list, like ["{program}"], or ["/bin/sh", "-c", "…"] for a shell line')
    if "run" in item and (not _string_list(program) or not program or not all(p and "\0" not in p for p in program)):
        raise ValueError("run must be a non-empty list of strings: [program, args…]")
    command = item.get("command")
    if "command" in item:
        if not isinstance(command, str) or not command:
            raise ValueError("command must be a command id")
        if decide or "omnibox" in item:
            raise ValueError("command can't answer a decide event or the omnibox")
    if "arg" in item:
        if "command" not in item:
            raise ValueError("arg only goes with command")
        if not isinstance(item["arg"], str):
            raise ValueError("arg must be a string")
    timeout = DEFAULT_TIMEOUT
    if "timeout" in item:
        if decide or "omnibox" in item or "run" not in item:
            raise ValueError("timeout only goes with run on events and schedules; decide and omnibox hooks have fixed deadlines")
        timeout = check_timeout(item["timeout"])
    idle_events = [e for e in events if e in control.TAB_IDLE_EVENTS or e in control.USER_IDLE_EVENTS]
    idle = None
    if "idle" in item:
        idle = parse_duration(item["idle"])
        if not idle_events:
            raise ValueError("idle only goes with tab.idle, tab.resumed, user.idle or user.active")
        if idle is None or idle < MIN_IDLE:
            raise ValueError('idle must be a duration like "30m", at least 1m')
    elif idle_events:
        raise ValueError(f'{idle_events[0]} needs idle, like "idle": "30m"')
    if "fullUrls" in item and not isinstance(item["fullUrls"], bool):
        raise ValueError("fullUrls must be true or false")
    if rule_keys:
        _check_rules(item, decide)
    omnibox = None
    if "omnibox" in item:
        omnibox = _check_omnibox(item["omnibox"])
        if "run" not in item:
            raise ValueError("an omnibox hook needs run")
    for key in FILTER_KEYS:
        value = item.get(key, [])
        value = [value] if isinstance(value, str) else value
        if not _string_list(value):
            raise ValueError(f"{key} must be a list of strings")
    return Hook(
        name,
        tuple(events),
        tuple(patterns),
        tuple(program or ()),
        timeout,
        tuple(specs),
        command=command,
        arg=item.get("arg"),
        decide=decide,
        rules=bool(rule_keys),
        omnibox=omnibox,
        idle=idle,
        full_urls=item.get("fullUrls") is True,
        at=item.get("at"),
        days=tuple(item.get("days", ())),
        timezone=item.get("timezone"),
        every=parse_duration(item["every"]) if "every" in item else None,
        raw=canonical(item),
    )


def parse_hooks(text: str) -> list[Hook]:
    from ardia_cli import config_files

    try:
        document = config_files.parse_json(text)
    except json.JSONDecodeError as error:
        raise HooksError(f"{HOOKS_FILE} doesn't parse: line {error.lineno} column {error.colno}: {error.msg}") from None
    except ValueError as error:
        raise HooksError(f"{HOOKS_FILE} doesn't parse: {error}") from None
    if not isinstance(document, dict) or not isinstance(document.get("hooks"), list):
        raise HooksError(f'{HOOKS_FILE} must be an object with a "hooks" list')
    if len(document["hooks"]) > MAX_HOOKS:
        raise HooksError(f"{HOOKS_FILE} has more than {MAX_HOOKS} hooks")
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
        try:
            hooks.append(hook_from(item))
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
    private = event.get("event") == "notification.shown"
    for variable, key in EVENT_ENV.items():
        env.pop(variable, None)
        if private and key in ("title", "url"):
            continue
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
                if pumps:
                    _, draining = await asyncio.wait(pumps, timeout=max(deadline - loop.time(), 0))
                    if draining:
                        raise asyncio.TimeoutError
                    await asyncio.gather(*pumps)
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


LAUNCH_STATE = "ArdiaHooks.state.json"
LAUNCH_SEEN_CAP = 200


def minimized_event(event: dict) -> dict:
    data = event.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("url"), str):
        return event
    url = data["url"]
    cut = min([i for i in (url.find("?"), url.find("#")) if i >= 0], default=-1)
    if cut < 0:
        return event
    return {**event, "data": {**data, "url": url[:cut]}}


class LaunchSeen:
    def __init__(self, path: Path | None):
        self.path = path
        self.seen: list[str] = []
        if path is not None:
            try:
                loaded = json.loads(path.read_text())
                if isinstance(loaded, dict) and isinstance(loaded.get("seen"), list):
                    self.seen = [k for k in loaded["seen"] if isinstance(k, str)][-LAUNCH_SEEN_CAP:]
            except (OSError, ValueError):
                pass

    def first(self, key: str) -> bool:
        if key in self.seen:
            return False
        self.seen = [*self.seen, key][-LAUNCH_SEEN_CAP:]
        if self.path is not None:
            try:
                temp = self.path.with_name(self.path.name + f".{os.getpid()}")
                fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, "w") as handle:
                    json.dump({"version": 1, "seen": self.seen}, handle)
                os.replace(temp, self.path)
            except OSError:
                pass
        return True


class CommandRunner:
    def __init__(self, hook: Hook, log: Log, service):
        self.hook = hook
        self.log = log
        self.service = service
        self.recent: collections.deque = collections.deque()
        self.tasks: set = set()

    def offer(self, event: dict) -> None:
        now = time.monotonic()
        while self.recent and now - self.recent[0] > COMMAND_WINDOW:
            self.recent.popleft()
        if len(self.recent) >= COMMAND_BURST:
            self.log.write(f"warning: hook {self.hook.name}: more than {COMMAND_BURST} commands in {COMMAND_WINDOW:g} s; skipped one (a hook may be triggering itself)")
            return
        self.recent.append(now)
        task = asyncio.ensure_future(self._run(event))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def _run(self, event: dict) -> None:
        connection = self.service.connection
        if connection is None or connection.closed:
            self.log.write(f"hook {self.hook.name}: Ardia isn't connected; {self.hook.command} didn't run")
            return
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        params = {"command": self.hook.command}
        if self.hook.arg is not None:
            params["arg"] = self.hook.arg
        window = data.get("windowId") if "windowId" in data else data.get("focusedWindowId") if event.get("event") == "app.launched" else None
        if isinstance(window, str):
            params["window"] = window
        if isinstance(data.get("tabId"), str) and self.service.scopes.get(self.hook.command) == "page":
            params["tab"] = data["tabId"]
        try:
            await connection.call("run", params, timeout=10)
        except control.MethodError as error:
            self.log.write(f"hook {self.hook.name}: {self.hook.command}: {error.message}")
        except control.Unreachable as error:
            self.log.write(f"hook {self.hook.name}: {self.hook.command} may not have run: {error}")

    def close(self) -> None:
        pass

    async def stop(self, grace: float = 2.0) -> None:
        if self.tasks:
            await asyncio.wait(list(self.tasks), timeout=grace)


class Service:
    def __init__(self, socket_path: Path, log: Log, capture: bool, connect=None, backoff_start=None, backoff_max=None, state_path=None):
        from ardia_cli.hook_decide import Decider
        from ardia_cli.hook_schedule import Scheduler

        self.socket_path = socket_path
        self.log = log
        self.capture = capture
        self.connect = connect or control.connect
        self.backoff_start = BACKOFF_START if backoff_start is None else backoff_start
        self.backoff_max = BACKOFF_MAX if backoff_max is None else backoff_max
        self.runners: dict = {}
        self.retired: list = []
        self.hooks: dict[str, Hook] = {}
        self.changed = asyncio.Event()
        self.subscribed = asyncio.Event()
        self.connections = 0
        self.connection = None
        self.scopes: dict[str, str | None] = {}
        self.decider = Decider(log)
        self.scheduler = Scheduler(self.fire_scheduled, log)
        self.launches = LaunchSeen(state_path)
        self.accepted: dict[str, tuple[str, Hook]] = {}

    def set_hooks(self, hooks) -> None:
        wanted = {hook.name: hook for hook in hooks}
        for name, runner in list(self.runners.items()):
            if wanted.get(name) != runner.hook:
                runner.close()
                self.retired.append(runner)
                del self.runners[name]
        self.retired = [r for r in self.retired if not getattr(r, "task", None) or not r.task.done()]
        for name, hook in wanted.items():
            if name in self.runners or hook.decide or hook.omnibox is not None:
                continue
            self.runners[name] = CommandRunner(hook, self.log, self) if hook.command else HookRunner(hook, self.log, self.capture)
        self.hooks = wanted
        self.scheduler.set_hooks(hooks)
        self.changed.set()

    def event_names(self) -> list[str]:
        names = set()
        for runner in self.runners.values():
            if runner.hook.listens:
                names.update(runner.hook.events)
        if "*" in names:
            return ["*", *(name for name in control.NAMED_ONLY_EVENTS if name in names)]
        return [name for name in control.EVENTS if name in names]

    def subscription(self) -> dict:
        extra = {}
        listening = [r.hook for r in self.runners.values() if r.hook.listens]
        if any(h.full_urls for h in listening):
            extra["fullUrls"] = True
        tab = sorted({h.idle for h in listening if h.idle and any(e in control.TAB_IDLE_EVENTS for e in h.events)})
        user = sorted({h.idle for h in listening if h.idle and any(e in control.USER_IDLE_EVENTS for e in h.events)})
        if tab or user:
            extra["idle"] = {**({"tab": tab} if tab else {}), **({"user": user} if user else {})}
        served = [h.definition() for h in self.hooks.values() if h.served]
        if served:
            extra["hooks"] = served
        return extra

    def dispatch(self, event: dict) -> None:
        dropped = event.get("dropped")
        if isinstance(dropped, int) and not isinstance(dropped, bool) and dropped > 0:
            self.log.write(f"warning: Ardia dropped {dropped} event{'s' if dropped != 1 else ''} before this one because the runner fell behind")
        launch = event.get("data", {}).get("launchId") if event.get("event") == "app.launched" and isinstance(event.get("data"), dict) else None
        for runner in list(self.runners.values()):
            hook = runner.hook
            if not hook.wants(event):
                continue
            if launch is not None and not self.launches.first(f"{launch}:{hook.name}:{hook.revision}"):
                continue
            runner.offer(event if hook.full_urls else minimized_event(event))

    def fire_scheduled(self, hook: Hook, event: dict) -> None:
        runner = self.runners.get(hook.name)
        if runner is None:
            return
        if isinstance(runner, HookRunner) and (runner.process is not None or runner.queue):
            self.log.write(f"hook {hook.name}: still running from the last time; skipped {event['data']['occurrence']}")
            return
        runner.offer(event)

    async def run_forever(self) -> None:
        schedules = asyncio.ensure_future(self.scheduler.run())
        try:
            await self._connect_forever()
        finally:
            schedules.cancel()
            await asyncio.gather(schedules, return_exceptions=True)

    async def _connect_forever(self) -> None:
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
            self.connection = connection
            try:
                await self._serve(connection)
            except control.Unreachable as error:
                self.log.write(f"lost Ardia: {error}")
            except control.MethodError as error:
                self.log.write(f"Ardia refused the subscription ({error.code}: {error.message}); retrying")
                await asyncio.sleep(delay)
                delay = min(delay * 2, self.backoff_max)
            finally:
                self.connection = None
                self.accepted = {}
                self.subscribed.clear()
                await self.decider.stop()
                await connection.close()

    async def _load_scopes(self, connection) -> None:
        if not any(isinstance(r, CommandRunner) for r in self.runners.values()):
            return
        try:
            catalog = await connection.call("commands", timeout=10)
        except (control.MethodError, control.Unreachable):
            return
        if isinstance(catalog, list):
            self.scopes = {c.get("id"): c.get("scope") for c in catalog if isinstance(c, dict)}

    async def _subscribe(self, connection) -> None:
        extra = self.subscription()
        sent = {h.name: h for h in self.hooks.values() if h.served}
        self.accepted = {}
        reply = await connection.subscribe(self.event_names(), extra)
        revisions = reply.get("revisions") if isinstance(reply, dict) and isinstance(reply.get("revisions"), dict) else {}
        self.accepted = {name: (revision, sent[name]) for name, revision in revisions.items() if name in sent and isinstance(revision, str)}
        if extra.get("hooks"):
            served = reply.get("served", []) if isinstance(reply, dict) else []
            missing = [h.name for h in self.hooks.values() if h.served and h.name not in served]
            if missing:
                self.log.write(f"Ardia doesn't take these hooks from this runner yet (not in its hooks.json, or changed): {', '.join(missing)}")
        await self._load_scopes(connection)

    async def _serve(self, connection) -> None:
        self.changed.set()
        reading = deciding = waiting = None
        try:
            while True:
                if self.changed.is_set():
                    self.changed.clear()
                    await self._subscribe(connection)
                    self.subscribed.set()
                if reading is None:
                    reading = asyncio.ensure_future(connection.next_event())
                if deciding is None:
                    deciding = asyncio.ensure_future(connection.next_decide())
                if waiting is None:
                    waiting = asyncio.ensure_future(self.changed.wait())
                done, _ = await asyncio.wait({reading, deciding, waiting}, return_when=asyncio.FIRST_COMPLETED)
                if deciding in done:
                    message = deciding.result()
                    deciding = None
                    self.decider.handle(message, self.accepted, connection)
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
            for task in (reading, deciding, waiting):
                if task is not None and not task.done():
                    task.cancel()

    async def stop(self) -> None:
        await self.decider.stop()
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
    linux: bool = False
    config_home: Path | None = None
    state_home: Path | None = None

    @property
    def agents(self) -> Path:
        if self.linux:
            return self.config_home / "systemd" / "user"
        return self.home / "Library" / "LaunchAgents"

    @property
    def plist(self) -> Path:
        return self.agents / f"{LABEL}.plist"

    @property
    def unit(self) -> Path:
        return self.agents / SERVICE

    @property
    def definition(self) -> Path:
        return self.unit if self.linux else self.plist

    @property
    def logs(self) -> Path:
        if self.linux:
            return self.state_home / "ardia"
        return self.home / "Library" / "Logs" / "Ardia"

    @property
    def log(self) -> Path:
        return self.logs / "hooks.log"

    @property
    def launcher(self) -> Path:
        return self.cli_home / "current" / "bin" / "ardia"


def agent_paths(linux: bool | None = None) -> AgentPaths:
    home = Path.home()
    if endpoint.LINUX if linux is None else linux:
        cli_home = os.environ.get("ARDIA_CLI_HOME") or str(endpoint.xdg_dir("XDG_DATA_HOME", ".local", "share", absolute=True) / "ardia" / "cli")
        return AgentPaths(home, Path(cli_home).expanduser(), True, endpoint.config_home(absolute=True), endpoint.xdg_dir("XDG_STATE_HOME", ".local", "state", absolute=True))
    from ardia_cli import usage

    return AgentPaths(home, usage.cli_home())


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


def systemd_text(value: str) -> str:
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise HooksError(f"{value!r} has control characters, which a systemd unit can't hold")
    return value.replace("%", "%%")


def systemd_quote(value: str, expands_variables: bool = True) -> str:
    text = systemd_text(value).replace("\\", "\\\\").replace('"', '\\"')
    if expands_variables:
        text = text.replace("$", "$$")
    return f'"{text}"'


def service_unit(paths: AgentPaths, path_env: str | None) -> str:
    command = " ".join(systemd_quote(part) for part in (str(paths.launcher), "hooks", "run", "--log", str(paths.log)))
    environment = " ".join(systemd_quote(item, expands_variables=False) for item in (f"PATH={path_env or DEFAULT_PATH}", "ARDIA_DATA_DIR="))
    return f"""[Unit]
Description=Ardia hooks (ardia hooks run)
StartLimitIntervalSec=0

[Service]
Type=exec
ExecStart={command}
WorkingDirectory={systemd_text(str(paths.home))}
Environment={environment}
Restart=on-failure
RestartSec={RESTART_SECONDS}
StandardOutput=null
StandardError=null

[Install]
WantedBy=default.target
"""


def systemctl(arguments: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(["systemctl", "--user", *arguments], capture_output=True, text=True, timeout=20)


SERVICE_PROPERTIES = ("LoadState", "ActiveState", "SubState", "UnitFileState", "MainPID", "ExecMainStatus")


def service_state(run=None) -> dict:
    run = run or systemctl
    try:
        result = run(["show", SERVICE, "--property=" + ",".join(SERVICE_PROPERTIES)])
    except (OSError, subprocess.TimeoutExpired):
        return {"loaded": None}
    if result.returncode != 0:
        return {"loaded": None}
    values = {}
    for line in result.stdout.splitlines():
        key, sep, value = line.strip().partition("=")
        if sep:
            values[key] = value
    if values.get("LoadState") != "loaded":
        return {"loaded": False}
    state = {"loaded": True, "active": values.get("ActiveState") == "active", "state": values.get("ActiveState", ""), "substate": values.get("SubState", ""), "enabled": values.get("UnitFileState", "")}
    pid = values.get("MainPID", "0")
    if pid.isdigit() and int(pid) > 0:
        state["pid"] = int(pid)
    status = values.get("ExecMainStatus", "")
    if status.lstrip("-").isdigit():
        state["last_exit_code"] = int(status)
    return state
