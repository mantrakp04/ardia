import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from ardia_cli.browse import paths
from ardia_cli.browse.errors import BrowseError, Usage

VALUE_FLAGS = {
    "--session", "--namespace", "--data-dir", "--port", "--ws", "--cdp", "--max-output", "--screenshot-dir", "--screenshot-format",
    "--screenshot-quality", "--idle-timeout", "--init-script", "--enable", "--headers", "--color-scheme", "--download-path",
}
BOOL_FLAGS = {
    "--json", "--no-humanize", "--humanize", "--content-boundaries", "--annotate", "--no-auto-dialog", "--pin-tab", "--no-pin-tab",
    "--debug", "--capture-console", "--show", "--full", "--no-changes",
}
LAUNCH_ONLY = {
    "--headed": False, "--profile": True, "--executable-path": True, "--extension": True, "--args": True, "--user-agent": True,
    "--proxy": True, "--proxy-bypass": True, "--ignore-https-errors": False, "--ca-cert": True, "--no-ca-cert": False,
    "--allow-file-access": False, "--hide-scrollbars": True, "--webgpu": False, "--engine": True, "-p": True, "--provider": True,
    "--restore": False, "--restore-save": True, "--restore-check-url": True, "--restore-check-text": True, "--restore-check-fn": True,
    "--session-name": True, "--state": True, "--auto-connect": False, "--allowed-domains": True, "--action-policy": True,
    "--confirm-actions": True, "--confirm-interactive": False, "--config": True, "--model": True, "--verbose": False, "-v": False,
    "-q": False, "--quiet": False,
}
LAUNCH_HINTS = {
    "--headers": "run `ardia browse set headers <json>` instead",
    "--color-scheme": "run `ardia browse set media dark|light` instead",
    "--download-path": "pass the path to `ardia browse download <sel> <path>` instead",
}
VALUE_FLAGS -= set(LAUNCH_HINTS)
COMMAND_OWNS = {"stream": {"--port"}, "screenshot": {"--annotate", "--full"}, "diff": {"--full"}}
LOCAL_AUTH = {"save", "list", "show", "delete"}


def truthy(value) -> bool:
    return str(value or "").strip().lower() not in ("", "0", "false", "no", "off")


def parse_duration(value: str) -> int:
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(ms|s|m|h)?", str(value).strip())
    if not match:
        raise Usage(f"--idle-timeout takes 10s, 3m, 1h or milliseconds, not {value}")
    number, unit = float(match.group(1)), match.group(2) or "ms"
    return int(number * {"ms": 1, "s": 1000, "m": 60000, "h": 3600000}[unit])


def split_globals(argv: list[str]) -> tuple[dict, list[str]]:
    found: dict = {}
    rest: list[str] = []
    command = None
    index = 0
    while index < len(argv):
        token = argv[index]
        index += 1
        if token == "--":
            rest.append(token)
            rest.extend(argv[index:])
            break
        name, inline = (token.split("=", 1) + [None])[:2] if token.startswith("--") and "=" in token else (token, None)
        owned = COMMAND_OWNS.get(command, set())
        if name in VALUE_FLAGS and name not in owned:
            if inline is None:
                if index >= len(argv):
                    raise Usage(f"{name} needs a value")
                inline = argv[index]
                index += 1
            key = name.lstrip("-").replace("-", "_")
            if name in ("--init-script", "--enable"):
                found.setdefault(key, []).extend(inline.split(",") if name == "--enable" else [inline])
            else:
                found[key] = inline
            continue
        if name in BOOL_FLAGS and name not in owned:
            found[name.lstrip("-").replace("-", "_")] = True if inline is None else truthy(inline)
            continue
        if name in LAUNCH_HINTS:
            raise Usage(f"{name} is a launch option agent-browser applies when it starts its own browser; {LAUNCH_HINTS[name]}")
        if name in LAUNCH_ONLY:
            raise Usage(f"{name} doesn't apply to Ardia: ardia browse drives the browser you're running, so launch options have no effect")
        if command is None and not token.startswith("-"):
            command = token
        rest.append(token)
    return found, rest


def options_from(found: dict, env: dict) -> dict:
    from ardia_cli.browse.inputs import humanize_default

    humanize = humanize_default(env)
    if found.get("no_humanize"):
        humanize = False
    if found.get("humanize"):
        humanize = True
    max_output = found.get("max_output") or env.get("AGENT_BROWSER_MAX_OUTPUT")
    if max_output is not None:
        try:
            max_output = int(max_output)
        except ValueError:
            raise Usage(f"--max-output takes a number of characters, not {max_output}") from None
    options = {
        "json": found.get("json") or truthy(env.get("AGENT_BROWSER_JSON")),
        "humanize": humanize,
        "timeout_ms": env.get("AGENT_BROWSER_DEFAULT_TIMEOUT") or 25000,
        "max_output": max_output,
        "full": bool(found.get("full")),
        "no_changes": bool(found.get("no_changes")),
        "content_boundaries": found.get("content_boundaries") or truthy(env.get("AGENT_BROWSER_CONTENT_BOUNDARIES")),
        "annotate": found.get("annotate") or truthy(env.get("AGENT_BROWSER_ANNOTATE")),
        "screenshot_dir": found.get("screenshot_dir"),
        "screenshot_format": found.get("screenshot_format"),
        "screenshot_quality": found.get("screenshot_quality"),
        "no_auto_dialog": found.get("no_auto_dialog") or truthy(env.get("AGENT_BROWSER_NO_AUTO_DIALOG")),
        "capture_console": found.get("capture_console"),
        "show": found.get("show"),
        "enable": list(found.get("enable") or []) + [v for v in (env.get("AGENT_BROWSER_ENABLE") or "").split(",") if v],
        "init_scripts": list(found.get("init_script") or []) + [v for v in (env.get("AGENT_BROWSER_INIT_SCRIPTS") or "").split(",") if v],
    }
    if found.get("pin_tab") or truthy(env.get("AGENT_BROWSER_PIN_TAB")):
        options["pin_tab"] = True
    if found.get("no_pin_tab"):
        options["pin_tab"] = False
    return options


def endpoint_choice(found: dict, env: dict) -> tuple[str | None, int | None, str | None]:
    ws = found.get("ws")
    port = found.get("port")
    cdp = found.get("cdp") or env.get("AGENT_BROWSER_CDP")
    if cdp and not ws and not port:
        if str(cdp).isdigit():
            port = cdp
        else:
            ws = cdp
    if port is not None:
        try:
            port = int(port)
        except ValueError:
            raise Usage(f"--port takes a number, not {port}") from None
    return ws, port, found.get("data_dir")


def write(text: str, stream) -> None:
    from ardia_cli.redact import redact

    if text:
        stream.write(redact(text))
        stream.flush()


def register_secrets(ws: str | None, env: dict) -> None:
    from urllib.parse import parse_qs, urlsplit

    from ardia_cli.redact import add_secret

    for url in (ws, env.get("ARDIA_CDP_URL"), env.get("AGENT_BROWSER_CDP")):
        if url and "?" in str(url):
            for values in parse_qs(urlsplit(str(url)).query).values():
                for value in values:
                    add_secret(value)


def print_result(result, as_json: bool, options: dict) -> int:
    from ardia_cli.browse.daemon import render

    code, out, err = render(dict(options, json=as_json), result=result)
    write(out, sys.stdout)
    write(err, sys.stderr)
    return code


def print_error(error: BrowseError, as_json: bool) -> int:
    from ardia_cli import telemetry
    from ardia_cli.browse.daemon import render

    telemetry.note_error_code(error.code)
    code, out, err = render({"json": as_json}, error=error)
    write(out, sys.stdout)
    write(err, sys.stderr)
    return code


def session_id(args: list[str], cwd: str) -> str:
    from ardia_cli.browse.commands import parse

    options, _ = parse(args, {"--scope": "value", "--prefix": "value"})
    scope = options.get("scope") or "cwd"
    base = cwd
    if scope == "worktree":
        try:
            base = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, cwd=cwd, timeout=10).stdout.strip() or cwd
        except (OSError, subprocess.TimeoutExpired):
            base = cwd
    elif scope != "cwd":
        raise Usage("--scope takes cwd or worktree")
    digest = hashlib.sha256(os.path.realpath(base).encode()).hexdigest()[:8]
    prefix = options.get("prefix") or "s"
    return paths.check_name("A session id", f"{prefix}-{digest}")


def run_local(command: str, args: list[str], root: Path, options: dict, dir_fd_factory, key_for):
    from ardia_cli.browse import client, plugins, readurl, vault
    from ardia_cli.browse.commands import Result, parse

    if command == "auth":
        action = args[0] if args else "list"
        if action == "save":
            parsed, positional = parse(args[1:], {"--url": "value", "--origin": "multi", "--username": "value", "--password": "value",
                                                  "--password-stdin": "bool", "--username-selector": "value", "--password-selector": "value",
                                                  "--submit-selector": "value"})
            if not positional:
                raise Usage("Usage: ardia browse auth save <name> --url <https url> --username <u> [--password-stdin]")
            meta = vault.save(root, positional[0], parsed, lambda: sys.stdin.read())
            return Result(vault.public(meta), f"✓ Saved {positional[0]} for {', '.join(meta['origins'])} (password in the login Keychain)")
        if action == "list":
            rows = vault.listing(root)
            return Result({"profiles": rows}, "\n".join(f"{row['name']}  {row.get('username') or '-'}  {row['url']}" for row in rows) or "No saved auth profiles")
        if action == "show":
            if len(args) < 2:
                raise Usage("Usage: ardia browse auth show <name>")
            meta = vault.public(vault.load_meta(root, args[1]))
            return Result({"profile": meta}, "\n".join(f"{key}: {value}" for key, value in meta.items() if value is not None))
        if action == "delete":
            if len(args) < 2:
                raise Usage("Usage: ardia browse auth delete <name>")
            vault.delete(root, args[1])
            return Result({"deleted": args[1]}, f"✓ Deleted {args[1]}")
        raise Usage(f"Unknown auth subcommand: {action}")
    if command == "plugin":
        action = args[0] if args else "list"
        if action == "add":
            parsed, positional = parse(args[1:], {"--name": "value", "--capability": "multi"})
            if not positional:
                raise Usage("Usage: ardia browse plugin add <npm-name[@version] | owner/repo[#ref]> [--name n]")
            plugin = plugins.add(root, positional[0], parsed.get("name"), parsed.get("capability"))
            return Result({"plugin": plugin}, f"✓ Added {plugin['name']} ({plugin['spec']})")
        if action == "list":
            rows = plugins.registry(root)
            return Result({"plugins": rows}, "\n".join(f"{row['name']}  {', '.join(row['capabilities'])}" for row in rows) or "No plugins")
        if action == "show":
            if len(args) < 2:
                raise Usage("Usage: ardia browse plugin show <name>")
            plugin = plugins.find(root, args[1])
            return Result({"plugin": plugin}, json.dumps(plugin, indent=2))
        if action == "remove":
            if len(args) < 2:
                raise Usage("Usage: ardia browse plugin remove <name>")
            plugins.remove(root, args[1])
            return Result({"removed": args[1]}, f"✓ Removed {args[1]}")
        if action == "run":
            parsed, positional = parse(args[1:], {"--payload": "value"})
            if len(positional) < 2:
                raise Usage("Usage: ardia browse plugin run <name> <type> [--payload json]")
            payload = json.loads(parsed["payload"]) if parsed.get("payload") else {}
            data = plugins.call(root, positional[0], positional[1], payload)
            return Result(data if isinstance(data, dict) else {"result": data}, json.dumps(data, ensure_ascii=False, indent=2))
        raise Usage(f"Unknown plugin subcommand: {action}")
    if command == "notes":
        from ardia_cli import notes

        request = notes.parse_args(args)
        if request.text == "-":
            request.text = read_stdin_text()
        return notes.run_request(root, request, None)
    if command == "read":
        from ardia_cli.browse import readpages

        parsed, positional = parse(args, readpages.flags(), readpages.ALIASES)
        if readpages.single_fetch(parsed, positional):
            return readurl.run(positional[0], parsed, options)
        return readpages.run_local(parsed, positional, read_stdin_urls(args), options)
    if command == "session":
        action = args[0] if args else None
        if action == "id":
            value = session_id(args[1:], os.getcwd())
            return Result({"session": value}, value)
        if action == "list":
            dir_fd = dir_fd_factory()
            try:
                rows = client.live_sessions(dir_fd)
            finally:
                os.close(dir_fd)
            current = options.get("_session")
            lines = ["Active sessions:"] + [f"{'→' if row['session'] == current else ' '} {row['session']}" for row in rows]
            return Result({"sessions": rows}, "\n".join(lines) if rows else "No active sessions")
        return None
    return None


def notes_need_page(args: list[str]) -> bool:
    from ardia_cli import notes

    try:
        return notes.parse_args(args).site is None and notes.parse_args(args).action != "list"
    except BrowseError:
        return False


def read_stdin_text() -> str:
    from ardia_cli import notes

    text = sys.stdin.read(notes.MAX_NOTE * 4 + 1)
    if len(text) > notes.MAX_NOTE * 4:
        raise Usage(f"stdin is over {notes.MAX_NOTE * 4} characters; notes hold at most {notes.MAX_NOTE // 1024} KB per site")
    return text


def read_args(args: list[str]):
    from ardia_cli.browse import readpages
    from ardia_cli.browse.commands import parse

    try:
        return parse(args, readpages.flags(), readpages.ALIASES)
    except Usage:
        return None


def read_runs_locally(args: list[str]) -> bool:
    from ardia_cli.browse import readpages

    parsed = read_args(args)
    return parsed is not None and readpages.runs_locally(*parsed)


def read_stdin_urls(args: list[str]) -> str | None:
    from ardia_cli.browse import readpages

    parsed = read_args(args)
    if parsed is None or not readpages.reads_stdin(*parsed):
        return None
    return sys.stdin.read(readpages.MAX_STDIN)


def script_source(args: list[str], cwd: str) -> str:
    from ardia_cli.browse import script
    from ardia_cli.browse.commands import parse

    parsed, positional = parse(args, {"--timeout": "value", "--stdin": "bool"})
    if len(positional) > 1:
        raise Usage("Usage: ardia browse script [file.js] [--timeout 90s]; quote the script in a heredoc on stdin, or put it in a file")
    if positional and positional[0] != "-":
        path = Path(cwd, os.path.expanduser(positional[0]))
        try:
            with open(path, encoding="utf-8") as handle:
                source = handle.read(script.MAX_SOURCE + 1)
        except OSError as error:
            raise Usage(f"Can't read {positional[0]}: {error.strerror or error}") from None
    elif positional or parsed.get("stdin") or not sys.stdin.isatty():
        source = sys.stdin.read(script.MAX_SOURCE + 1)
    else:
        raise Usage("ardia browse script reads the script from a file or stdin: ardia browse script <<'EOF' … EOF")
    if len(source) > script.MAX_SOURCE:
        raise Usage(f"The script is over {script.MAX_SOURCE // 1024} KB")
    return source


def main(argv: list[str]) -> int:
    try:
        code = run(argv)
        sys.stdout.flush()
        return code
    except BrokenPipeError:
        quiet_stdout()
        return 141


def quiet_stdout() -> None:
    try:
        sink = os.open(os.devnull, os.O_WRONLY)
        os.dup2(sink, sys.stdout.fileno())
        os.close(sink)
    except (OSError, ValueError):
        pass


def run(argv: list[str]) -> int:
    from ardia_cli import endpoint as endpoints
    from ardia_cli.browse import client, help as helptext

    env = dict(os.environ)
    try:
        found, rest = split_globals(argv)
    except Usage as error:
        sys.stderr.write(f"✗ {error.message}\n")
        return 1
    as_json = bool(found.get("json") or truthy(env.get("AGENT_BROWSER_JSON")))
    if not rest or rest[0] in ("help", "--help", "-h"):
        topic = rest[1] if len(rest) > 1 else None
        sys.stdout.write((helptext.COMMANDS.get(topic) or helptext.OVERVIEW) + "\n")
        return 0
    if rest[0] in ("--version", "-V"):
        from ardia_cli import __version__

        sys.stdout.write(f"ardia browse {__version__}\n")
        return 0
    if "--help" in rest[1:] or "-h" in rest[1:]:
        sys.stdout.write((helptext.COMMANDS.get(rest[0]) or helptext.OVERVIEW) + "\n")
        return 0
    try:
        options = options_from(found, env)
        session = paths.check_name("A session name", found.get("session") or env.get("AGENT_BROWSER_SESSION") or "default")
        namespace = found.get("namespace") or env.get("AGENT_BROWSER_NAMESPACE") or ""
        if namespace:
            paths.check_name("A namespace", namespace)
        ws, port, data_dir = endpoint_choice(found, env)
        register_secrets(ws, env)
        root = endpoints.data_root(data_dir)
        endpoint_key, endpoint_label = client.endpoint_key(ws, port, root)
        key = paths.session_key(namespace, endpoint_key, session)
        options["_session"] = session
        command = rest[0]
        args = rest[1:]

        def dir_fd_factory():
            return paths.browse_dir(root)

        local_auth = command == "auth" and (args[:1] or ["list"])[0] in LOCAL_AUTH
        local_notes = command == "notes" and not notes_need_page(args)
        if local_auth or local_notes or command == "plugin" or (command == "read" and read_runs_locally(args)) or (command == "session" and args[:1] in (["id"], ["list"])):
            result = run_local(command, args, root, options, dir_fd_factory, None)
            if result is not None:
                return print_result(result, as_json, options)
        stdin = None
        if command == "notes" and "-" in args:
            stdin = read_stdin_text()
        elif (command in ("eval", "addinitscript") and "--stdin" in args) or (command == "batch" and not [a for a in args if not a.startswith("--")] and not sys.stdin.isatty()):
            stdin = sys.stdin.read()
        elif command == "read":
            stdin = read_stdin_urls(args)
        elif command == "script":
            stdin = script_source(args, os.getcwd())
        if command == "close" and "--all" in args:
            return close_all(root, as_json, options)
        idle = found.get("idle_timeout") or env.get("AGENT_BROWSER_IDLE_TIMEOUT_MS")
        config = {
            "session": session, "namespace": namespace, "key": key, "data_root": str(root), "ws": ws, "port": port, "data_dir": data_dir,
            "endpoint_label": endpoint_label, "idle_timeout_ms": parse_duration(idle) if idle else None, "debug": bool(found.get("debug")),
            "no_auto_dialog": options["no_auto_dialog"], "pin_tab": options.get("pin_tab"),
        }
        dir_fd = dir_fd_factory()
        try:
            sock = client.ensure_daemon(dir_fd, key, config)
        finally:
            os.close(dir_fd)
        env_subset = {name: value for name, value in env.items() if name.startswith("AGENT_BROWSER_")}
        from ardia_cli import caller, telemetry

        request = {
            "argv": rest, "options": options, "cwd": os.getcwd(), "env": env_subset, "stdin": stdin, "telemetry": telemetry.shareable(env),
            "caller": caller.current().wire(),
        }
        answer = client.request(sock, request)
    except BrowseError as error:
        return print_error(error, as_json)
    except endpoints.EndpointError as error:
        from ardia_cli.browse.errors import Unreachable

        return print_error(Unreachable(str(error)), as_json)
    except paths.PathError as error:
        return print_error(BrowseError(str(error)), as_json)
    except KeyboardInterrupt:
        sys.stderr.write("✗ interrupted\n")
        return 130
    telemetry.note_answer(answer)
    write(answer.get("out") or "", sys.stdout)
    write(answer.get("err") or "", sys.stderr)
    return int(answer.get("exit") or 0)


def close_all(root: Path, as_json: bool, options: dict) -> int:
    from ardia_cli.browse import client
    from ardia_cli.browse.commands import Result

    dir_fd = paths.browse_dir(root)
    closed = []
    try:
        for row in client.live_sessions(dir_fd):
            sock = client.connect(dir_fd, f"{row['key']}.sock")
            if sock is None:
                continue
            try:
                client.request(sock, {"argv": ["close"], "options": {}, "cwd": os.getcwd(), "env": {}, "stdin": None})
                closed.append(row["session"])
            except BrowseError:
                pass
    finally:
        os.close(dir_fd)
    return print_result(Result({"closed": closed}, f"✓ Closed {len(closed)} session{'s' if len(closed) != 1 else ''}"), as_json, options)
