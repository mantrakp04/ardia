import asyncio
import json
import os
import signal
import sys
import time
from pathlib import Path

from ardia_cli import control, hooks
from ardia_cli.control import MethodError, Unreachable

DATA_DIR_HELP = "the Ardia data dir (default: $ARDIA_DATA_DIR, else the installed app's)"
RUN_DESCRIPTION = """\
Run one of Ardia's commands, exactly as its menu item or shortcut would, in the last focused window or --window.
ARG is one of the command's variants (ardia commands lists them); COMMAND:ARG works too.

Exit status: 0 dispatched, 1 refused, unknown or no such window, 2 Ardia can't be reached (or the connection
dropped after the request went out, so the command may or may not have run).

Examples:
  ardia run newTab
  ardia run selectTab 3
  ardia run toggleSidebar --window 2
"""
EVENTS_DESCRIPTION = f"""\
Print Ardia's events as they happen, until interrupted. EVENT is one of:
  {", ".join(control.EVENTS)}
(default: all of them). --json prints each event's raw JSON line.

Exit status: 1 an unknown event, 2 Ardia can't be reached or the connection dropped, 130 interrupted.
"""
ON_DESCRIPTION = """\
Run PROGRAM for each matching event, until interrupted. The event's JSON line is PROGRAM's stdin; its environment
has ARDIA_EVENT, ARDIA_WINDOW_ID, ARDIA_TAB_ID, ARDIA_PROFILE, ARDIA_URL and ARDIA_TITLE (set or removed for every
run). PROGRAM runs directly, never through a shell unless PROGRAM is one; a leading ~ is expanded.

--match takes userscript match patterns (https://*.example.com/*); any of them may match, and events without a URL
never match. One run at a time, at most 100 events waiting (the oldest are dropped, with a warning). A run is
stopped after --timeout seconds (default 60): SIGTERM, then SIGKILL 5 s later. When Ardia quits or control turns
off it reconnects with backoff.

Examples:
  ardia on tab.navigated --match 'https://*.youtube.com/*' -- ~/bin/yt-hook
  ardia on tab.opened,tab.closed -- /bin/sh -c 'echo "$ARDIA_EVENT $ARDIA_URL" >> ~/tabs.log'
"""
HOOKS_DESCRIPTION = """\
Run hooks from hooks.json in the config folder (~/.config/ardia, or <data dir>/config with --data-dir or
$ARDIA_DATA_DIR) in one process:

  {
    "hooks": [
      { "name": "yt-to-media", "on": ["tab.navigated"], "match": ["https://*.youtube.com/*"],
        "run": ["~/bin/yt-hook"], "timeout": 30 }
    ]
  }

Each hook runs like ardia on (see ardia on --help). run re-reads hooks.json when it changes; an invalid file keeps
the hooks loaded before. Output goes to ~/Library/Logs/Ardia/hooks.log (rotated at 5 MB).

Commands:
  run         run the hooks until interrupted
  install     run them at login: a LaunchAgent (dev.ardia.hooks) that keeps ardia hooks run alive
  uninstall   remove the LaunchAgent
  list        the hooks in hooks.json and whether the LaunchAgent runs
"""


def add_parsers(commands, formatter):
    def data_dir(parser):
        parser.add_argument("--data-dir", metavar="DIR", help=DATA_DIR_HELP)
        return parser

    run = data_dir(commands.add_parser("run", help="run one of Ardia's commands", description=RUN_DESCRIPTION, formatter_class=formatter))
    run.add_argument("command_id", metavar="COMMAND", help="a command id (see ardia commands)")
    run.add_argument("arg", nargs="?", metavar="ARG", help="one of the command's variants")
    run.add_argument("--window", metavar="ID", help="a window id from ardia windows (default: the last focused window)")
    run.add_argument("--json", action="store_true", help="print the reply as JSON")

    listing = data_dir(commands.add_parser("commands", help="list the commands ardia run can run", description="List the commands ardia run can run: ids, titles and variants."))
    listing.add_argument("--json", action="store_true", help="print JSON")

    windows = data_dir(commands.add_parser("windows", help="list Ardia's windows and their tabs", description="List Ardia's windows and their tabs (private windows are never included)."))
    windows.add_argument("--json", action="store_true", help="print JSON")

    events = data_dir(commands.add_parser("events", help="print events as they happen", description=EVENTS_DESCRIPTION, formatter_class=formatter))
    events.add_argument("events", nargs="*", metavar="EVENT", help="event names (default: all)")
    events.add_argument("--json", action="store_true", help="print the raw JSON lines")

    on = data_dir(commands.add_parser("on", help="run a program for each event", description=ON_DESCRIPTION, formatter_class=formatter, usage="ardia on [-h] [--data-dir DIR] [--match PATTERN] [--timeout S] EVENT[,EVENT...] -- PROGRAM [ARGS...]"))
    on.add_argument("events", metavar="EVENT[,EVENT...]", help="event names, comma-separated")
    on.add_argument("--match", action="append", default=[], metavar="PATTERN", help="a match pattern for the event's URL; repeat for several")
    on.add_argument("--timeout", type=float, default=hooks.DEFAULT_TIMEOUT, metavar="S", help="stop a run after this many seconds (default 60)")

    group = commands.add_parser("hooks", help="run hooks from hooks.json, at login if you like", description=HOOKS_DESCRIPTION, formatter_class=formatter)
    sub = group.add_subparsers(dest="hooks_command", metavar="<command>")
    hooks_run = data_dir(sub.add_parser("run", help="run the hooks until interrupted", description="Run every hook in hooks.json until interrupted, reloading the file when it changes."))
    hooks_run.add_argument("--log", metavar="PATH", help="where output goes (default ~/Library/Logs/Ardia/hooks.log; - for the terminal)")
    data_dir(sub.add_parser("install", help="run the hooks at login (LaunchAgent dev.ardia.hooks)", description="Write ~/Library/LaunchAgents/dev.ardia.hooks.plist, which runs the installed ardia's hooks run at login\nand keeps it alive, and load it. Refused with --data-dir or $ARDIA_DATA_DIR.", formatter_class=formatter))
    data_dir(sub.add_parser("uninstall", help="remove the LaunchAgent", description="Unload and remove the dev.ardia.hooks LaunchAgent. Refused with --data-dir or $ARDIA_DATA_DIR."))
    hooks_list = data_dir(sub.add_parser("list", help="list the hooks and the LaunchAgent's state", description="List the hooks in hooks.json, check them, and show whether the LaunchAgent is loaded. Exit 1 if hooks.json is invalid."))
    hooks_list.add_argument("--json", action="store_true", help="print JSON")


def split_program(argv: list[str]) -> tuple[list[str], list[str] | None]:
    if argv[:1] != ["on"] or "--" not in argv:
        return argv, None
    index = argv.index("--")
    return argv[:index], argv[index + 1:]


def say(text: str) -> None:
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def complain(text: str) -> None:
    sys.stdout.flush()
    sys.stderr.write(text + "\n")
    sys.stderr.flush()


def dispatch(args, parser) -> int:
    handlers = {"run": cmd_run, "commands": cmd_commands, "windows": cmd_windows, "events": cmd_events, "on": cmd_on}
    if args.command == "hooks":
        handler = {"run": hooks_run, "install": hooks_install, "uninstall": hooks_uninstall, "list": hooks_list}.get(args.hooks_command)
        if handler is None:
            parser.parse_args(["hooks", "--help"])
            return 0
    else:
        handler = handlers[args.command]
    try:
        return handler(args)
    except KeyboardInterrupt:
        complain(f"ardia {args.command}: interrupted")
        return 130


def socket_for(args) -> Path:
    return control.socket_path(args.data_dir)


async def with_connection(args, work):
    connection = await control.connect(socket_for(args))
    try:
        return await work(connection)
    finally:
        await connection.close()


def call(args, method: str, params=None, timeout=control.CALL_TIMEOUT):
    return asyncio.run(with_connection(args, lambda c: c.call(method, params, timeout)))


def closest_commands(name: str, catalog) -> str:
    from ardia_cli.schema_check import did_you_mean

    ids = [c.get("id") for c in catalog if isinstance(c, dict) and isinstance(c.get("id"), str)]
    return did_you_mean(name, ids)


def cmd_run(args) -> int:
    command, arg = args.command_id, args.arg
    if arg is None and ":" in command:
        command, arg = command.split(":", 1)
    params = {"command": command}
    if arg is not None:
        params["arg"] = arg
    if args.window is not None:
        params["window"] = parse_id(args.window)

    async def work(connection):
        try:
            return await connection.call("run", params), None
        except MethodError as error:
            catalog = None
            if error.code in ("unknown_command", "bad_request"):
                try:
                    catalog = await connection.call("commands")
                except (MethodError, Unreachable):
                    catalog = None
            return error, catalog

    try:
        result, catalog = asyncio.run(with_connection(args, work))
    except Unreachable as error:
        if error.sent:
            complain(f"ardia run: the connection dropped after the request went out, so {command} may or may not have run ({error})")
        else:
            complain(f"ardia: {error}")
        return 2
    if isinstance(result, MethodError):
        hint = ""
        if catalog is not None and result.code == "unknown_command":
            hint = closest_commands(command, catalog)
        elif catalog is not None and arg is not None:
            spec = next((c for c in catalog if isinstance(c, dict) and c.get("id") == command), None)
            variants = spec.get("variants") if spec else None
            if variants:
                from ardia_cli.schema_check import did_you_mean

                hint = did_you_mean(arg, variants)
        complain(f"ardia run: {result.message}{hint}")
        return 1
    say(json.dumps(result, ensure_ascii=False) if args.json else f"ran {command}{':' + arg if arg else ''}")
    return 0


def parse_id(text: str):
    return int(text) if text.isdigit() and len(text) < 16 else text


def unreachable_exit(error: Unreachable) -> int:
    complain(f"ardia: {error}")
    return 2


def cmd_commands(args) -> int:
    try:
        catalog = call(args, "commands")
    except Unreachable as error:
        return unreachable_exit(error)
    except MethodError as error:
        complain(f"ardia commands: {error.message}")
        return 1
    if args.json:
        say(json.dumps(catalog, indent=2, ensure_ascii=False))
        return 0
    rows = [c for c in catalog or [] if isinstance(c, dict)]
    width = min(max((len(str(c.get("id", ""))) for c in rows), default=0), 40)
    for item in rows:
        variants = item.get("variants")
        tail = f"  [{', '.join(map(str, variants))}]" if variants else ""
        say(f"{str(item.get('id', '')).ljust(width)}  {item.get('title', '')}{tail}")
    return 0


def cmd_windows(args) -> int:
    try:
        windows = call(args, "windows")
    except Unreachable as error:
        return unreachable_exit(error)
    except MethodError as error:
        complain(f"ardia windows: {error.message}")
        return 1
    if args.json:
        say(json.dumps(windows, indent=2, ensure_ascii=False))
        return 0
    for window in windows or []:
        if not isinstance(window, dict):
            continue
        flags = [str(window.get("kind", "normal"))] + (["focused"] if window.get("focused") else [])
        profile = window.get("profileName") or window.get("profile") or ""
        say(f"window {window.get('id')}  {', '.join(flags)}  {profile}".rstrip())
        for tab in window.get("tabs") or []:
            marks = ("*" if tab.get("active") else " ") + ("p" if tab.get("pinned") else " ")
            group = f"  (group {tab['group']})" if tab.get("group") is not None else ""
            title = tab.get("title") or ""
            say(f"  {marks} {tab.get('id')}  {title}  {tab.get('url', '')}{group}")
    return 0


def describe_event(event: dict) -> str:
    stamp = event.get("time")
    when = time.strftime("%H:%M:%S", time.localtime(stamp / 1000)) if isinstance(stamp, (int, float)) and not isinstance(stamp, bool) else "--:--:--"
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    parts = [when, str(event.get("event"))]
    if "windowId" in data:
        parts.append(f"window {data['windowId']}")
    if "tabId" in data:
        parts.append(f"tab {data['tabId']}")
    if data.get("url"):
        parts.append(str(data["url"]))
    if data.get("title"):
        parts.append(json.dumps(data["title"], ensure_ascii=False))
    if data.get("sameDocument"):
        parts.append("(same document)")
    if "keys" in data and isinstance(data["keys"], list):
        parts.append(", ".join(map(str, data["keys"])))
    if "tabId" not in data and data.get("profile"):
        parts.append(str(data["profile"]))
    return "  ".join(parts)


def cmd_events(args) -> int:
    try:
        names = control.check_events(args.events) or ["*"]
    except ValueError as error:
        complain(f"ardia events: {error}")
        return 1

    async def work(connection):
        await connection.subscribe(names)
        while True:
            event, raw = await connection.next_line()
            behind = connection.take_dropped()
            if behind:
                complain(f"ardia events: {behind} event{'s' if behind != 1 else ''} dropped before this one because printing fell behind")
            dropped = event.get("dropped")
            if isinstance(dropped, int) and not isinstance(dropped, bool) and dropped > 0 and not args.json:
                complain(f"ardia events: Ardia dropped {dropped} event{'s' if dropped != 1 else ''} before this one")
            say(raw if args.json else describe_event(event))

    try:
        asyncio.run(with_connection(args, work))
    except Unreachable as error:
        return unreachable_exit(error)
    except MethodError as error:
        complain(f"ardia events: {error.message}")
        return 1
    except BrokenPipeError:
        return 0
    return 0


def cmd_on(args) -> int:
    program = getattr(args, "program", None)
    if not program:
        complain("ardia on: give the program after --, like: ardia on tab.opened -- ~/bin/hook")
        return 1
    try:
        hook = hooks.make_hook("on", [e for e in args.events.split(",") if e], args.match, program, args.timeout)
    except ValueError as error:
        complain(f"ardia on: {error}")
        return 1
    holder = {}

    async def main():
        service = hooks.Service(socket_for(args), hooks.Log(), capture=False)
        holder["service"] = service
        service.set_hooks([hook])
        await service.run_forever()

    return run_with(holder, main)


def run_with(holder, main) -> int:
    async def wrapper():
        loop = asyncio.get_running_loop()
        stopping = asyncio.Event()
        received = {}
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            loop.add_signal_handler(signum, lambda s=signum: (received.setdefault("signal", s), stopping.set()))
        work = asyncio.ensure_future(main())
        stopper = asyncio.ensure_future(stopping.wait())
        try:
            done, _ = await asyncio.wait({work, stopper}, return_when=asyncio.FIRST_COMPLETED)
            if work in done:
                work.result()
        finally:
            for task in (work, stopper):
                task.cancel()
            await asyncio.gather(work, stopper, return_exceptions=True)
            service = holder.get("service")
            if service is not None:
                await service.stop()
        return 130 if received.get("signal") == signal.SIGINT else 0

    return asyncio.run(wrapper())


def hooks_file(args) -> Path:
    from ardia_cli import config_files

    return config_files.places(args.data_dir).folder / hooks.HOOKS_FILE


def hooks_run(args) -> int:
    paths = hooks.agent_paths()
    log_path = None if args.log == "-" else Path(args.log).expanduser() if args.log else paths.log
    log = hooks.Log(log_path)
    path = hooks_file(args)
    holder = {}

    async def main():
        service = hooks.Service(socket_for(args), log, capture=True)
        holder["service"] = service
        log.write(f"ardia hooks run: watching {path}")
        try:
            await asyncio.gather(hooks.watch_hooks(path, service, log), service.run_forever())
        except asyncio.CancelledError:
            raise
        except Exception as error:
            log.write(f"ardia hooks run stopped: {type(error).__name__}: {error}")
            raise

    try:
        return run_with(holder, main)
    finally:
        log.close()


def refuse_scratch(args, verb: str) -> bool:
    if args.data_dir or os.environ.get("ARDIA_DATA_DIR"):
        complain(f"ardia hooks {verb}: refused while --data-dir or $ARDIA_DATA_DIR picks a data dir; the LaunchAgent is for the installed Ardia only")
        return True
    return False


def hooks_install(args, launchctl=None, sleep=time.sleep) -> int:
    import plistlib

    from ardia_cli import config_files

    if refuse_scratch(args, "install"):
        return 1
    launchctl = launchctl or hooks.launchctl
    paths = hooks.agent_paths()
    if not os.path.exists(paths.launcher):
        complain(f"ardia hooks install: the ardia command isn't installed at {paths.launcher}; turn on \"Let the ardia command control Ardia\" in Ardia's Settings to install it")
        return 1
    try:
        hooks.read_hooks(hooks_file(args))
    except FileNotFoundError:
        complain(f"warning: there's no {hooks_file(args)} yet; the hooks start once it exists")
    except (hooks.HooksError, OSError) as error:
        complain(f"warning: {error}")
    paths.agents.mkdir(parents=True, exist_ok=True)
    paths.logs.mkdir(parents=True, exist_ok=True)
    data = plistlib.dumps(hooks.agent_plist(paths, os.environ.get("PATH")), sort_keys=False)
    config_files.write_text(paths.plist, data.decode("utf-8"))
    launchctl(["bootout", f"{hooks.domain()}/{hooks.LABEL}"])
    result = None
    for attempt in range(3):
        result = launchctl(["bootstrap", hooks.domain(), str(paths.plist)])
        if result.returncode == 0:
            break
        sleep(0.5)
    if result.returncode != 0:
        complain(f"ardia hooks install: launchctl bootstrap failed ({(result.stderr or result.stdout).strip() or result.returncode})")
        return 1
    say(f"installed {hooks.LABEL}: {paths.plist}")
    say(f"it runs {paths.launcher} hooks run at login and keeps it alive; output goes to {paths.log}")
    return 0


def hooks_uninstall(args, launchctl=None) -> int:
    if refuse_scratch(args, "uninstall"):
        return 1
    launchctl = launchctl or hooks.launchctl
    paths = hooks.agent_paths()
    result = launchctl(["bootout", f"{hooks.domain()}/{hooks.LABEL}"])
    existed = os.path.lexists(paths.plist)
    if existed:
        os.unlink(paths.plist)
    if not existed and result.returncode != 0:
        say(f"{hooks.LABEL} wasn't installed")
        return 0
    say(f"uninstalled {hooks.LABEL}")
    return 0


def hooks_list(args, launchctl=None) -> int:
    path = hooks_file(args)
    problem = None
    found = []
    try:
        found = hooks.read_hooks(path)
    except FileNotFoundError:
        problem = f"there's no {path} yet"
    except (hooks.HooksError, OSError) as error:
        problem = f"{path}: {getattr(error, 'strerror', None) or error}"
    paths = hooks.agent_paths()
    installed = os.path.lexists(paths.plist)
    state = hooks.agent_state(launchctl) if installed and not (args.data_dir or os.environ.get("ARDIA_DATA_DIR")) else {"loaded": False}
    if args.json:
        say(json.dumps({"file": str(path), "problem": problem, "hooks": [h.to_dict() for h in found], "agent": {"installed": installed, **state}}, indent=2, ensure_ascii=False))
        return 1 if problem and os.path.lexists(path) else 0
    for hook in found:
        match = f"  match {' '.join(hook.patterns)}" if hook.patterns else ""
        say(f"{hook.name}  on {','.join(hook.events)}{match}  run {' '.join(hook.program)}  timeout {hook.timeout:g}s")
    if problem:
        complain(f"ardia hooks: {problem}")
    if not installed:
        say(f"LaunchAgent {hooks.LABEL}: not installed (ardia hooks install)")
    else:
        running = f", running (pid {state['pid']})" if state.get("pid") else ""
        loaded = "loaded" if state.get("loaded") else "installed, not loaded"
        say(f"LaunchAgent {hooks.LABEL}: {loaded}{running}")
    return 1 if problem and os.path.lexists(path) else 0
