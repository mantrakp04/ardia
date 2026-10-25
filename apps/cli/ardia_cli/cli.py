import sys

from ardia_cli import __version__, identity

DESCRIPTION = f"Control a running {identity.PRODUCT} from the terminal."
EXEC_DESCRIPTION = """\
Run Python against the running Ardia, with top-level await.

In scope:
  browser        pydoll Chrome attached to Ardia (closing it only drops the connection)
  tab            the web page the user is looking at; NoPageTab on first use when there is none (New Tab)
  tabs           every web page tab (http, https, about, data, blob), plus the ones new_tab opens
  new_tab(url, background=True)   open a tab and return it once the page has loaded
  js(expression, tab=None)        evaluate JavaScript in tab (else the user's tab, else the last new_tab) and return its value
  await pinned() the user's favorites and pinned tabs from Ardia's saved session, as dicts
                 (title, url, pinned_url, kind favorite|pinned, folder, profile, parked); no incognito
  await history(days=1, limit=200, profile=None, domains=False)
                 recent history per URL, newest first: url, title, visits (in the window), total_visits,
                 last_visit (ISO, local time), profile; domains=True rolls it up per domain.
                 profile is a profile name or its folder under Chromium/ (default: all). Only http(s) pages.
                 Both read Ardia's data dir (the token path's, or --data-dir/$ARDIA_DATA_DIR) and need control on.
  By, Key, asyncio and pydoll's exports (Tab, WebElement, PageEvent, NetworkEvent, ...)

The value of the last expression is printed (strings as is, other values as repr, or JSON with --json).
Ardia keeps running after every exec.

Exit status: 0 done, 1 the code raised or timed out, 2 Ardia can't be reached or closed the connection, 130 interrupted.

Examples:
  ardia exec 'await tab.title()'
  ardia exec 't = await new_tab("https://example.com"); await t.title()'
  ardia exec -f script.py --json
  echo 'len(tabs)' | ardia exec -
  ardia exec 'await history(days=1, domains=True)' --json
"""
EXEC_EPILOG = """\
Endpoint: --ws, else --port (plain DevTools servers only), else $ARDIA_CDP_URL, else
<data dir>/Chromium/ArdiaControl.json with --data-dir or $ARDIA_DATA_DIR, else the installed Ardia's.
"""
SKILLS_DESCRIPTION = """\
Install the ardia agent skill (SKILL.md and a pydoll reference) so coding agents know how to drive Ardia.

Targets and where they install (user level; --project uses the current directory):
  general       ~/.agents/skills            ./.agents/skills
  codex         ~/.agents/skills            ./.agents/skills
  claude-code   ~/.claude/skills            ./.claude/skills
  cursor        ~/.cursor/skills            ./.cursor/skills
  opencode      ~/.config/opencode/skills   ./.opencode/skills
"""


def build_parser():
    import argparse

    parser = argparse.ArgumentParser(prog=identity.COMMAND, description=DESCRIPTION)
    parser.add_argument("--version", action="version", version=f"{identity.COMMAND} {__version__}")
    commands = parser.add_subparsers(dest="command", metavar="<command>")

    run = commands.add_parser(
        "exec",
        help=f"run Python against the running {identity.PRODUCT}",
        description=identity.brand(EXEC_DESCRIPTION),
        epilog=identity.brand(EXEC_EPILOG),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    run.add_argument("code", nargs="?", metavar="CODE", help="Python code, or - to read it from stdin")
    run.add_argument("-f", "--file", metavar="FILE", help="read the code from FILE")
    run.add_argument("--data-dir", metavar="DIR", help=f"the {identity.PRODUCT} data dir to find (default: $ARDIA_DATA_DIR, else the installed app's)")
    run.add_argument("--port", type=int, metavar="N", help="a plain DevTools server on 127.0.0.1:N (testing)")
    run.add_argument("--ws", metavar="URL", help="a browser WebSocket URL")
    run.add_argument("--timeout", type=float, default=300, metavar="SECONDS", help="stop the code after this long (default 300, 0 for none)")
    run.add_argument("--json", action="store_true", help="print the last value as JSON")

    skills = commands.add_parser("skills", help=f"install the {identity.COMMAND} agent skill")
    skill_commands = skills.add_subparsers(dest="skills_command", metavar="<command>")
    install = skill_commands.add_parser(
        "install",
        help="install the skill for one or more agents",
        description=identity.brand(SKILLS_DESCRIPTION),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    from ardia_cli.skills import TARGETS

    install.add_argument("--target", action="append", choices=sorted(TARGETS), metavar="TARGET", help="general, codex, claude-code, cursor or opencode; repeat for several (default: general)")
    install.add_argument("--project", action="store_true", help="install into the current directory's project folders")

    from ardia_cli import scripts_cli

    scripts_cli.add_parser(commands, argparse.RawDescriptionHelpFormatter)
    return parser


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv == ["--version"]:
        print(f"{identity.COMMAND} {__version__}")
        return 0
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "exec":
        return run_exec(args, parser)
    if args.command == "skills":
        if args.skills_command != "install":
            parser.parse_args(["skills", "--help"])
        from ardia_cli.skills import install

        return install(args.target or ["general"], args.project)
    if args.command == "scripts":
        from ardia_cli import scripts_cli

        return scripts_cli.run(args, parser)
    parser.print_help()
    return 0


def read_source(args) -> tuple[str, str]:
    if args.file:
        if args.code not in (None,):
            raise SystemExit(f"{identity.COMMAND} exec: give CODE or -f FILE, not both")
        if args.file == "-":
            return sys.stdin.read(), "<stdin>"
        with open(args.file, encoding="utf-8") as handle:
            return handle.read(), args.file
    if args.code is None or args.code == "-":
        if args.code is None and sys.stdin.isatty():
            raise SystemExit(f"{identity.COMMAND} exec: give CODE, - (stdin) or -f FILE")
        return sys.stdin.read(), "<stdin>"
    return args.code, "<exec>"


def run_exec(args, parser) -> int:
    from ardia_cli import redact as redaction

    out = sys.stdout = redaction.RedactingStream(sys.stdout)
    err = sys.stderr = redaction.RedactingStream(sys.stderr)
    redaction.install_log_redaction()
    try:
        return _run_exec(args)
    finally:
        out.drain()
        err.drain()


def _run_exec(args) -> int:
    import asyncio

    from ardia_cli.endpoint import EndpointError, data_root, explicit_data_root, resolve

    try:
        source, filename = read_source(args)
    except OSError as error:
        sys.stderr.write(f"{identity.COMMAND} exec: {error}\n")
        return 1

    from ardia_cli import runner

    try:
        runner.compile_code(source, filename)
    except SyntaxError as error:
        runner.print_err(runner.format_syntax_error(error))
        return 1
    try:
        endpoint = resolve(ws=args.ws, port=args.port, data_dir=args.data_dir)
        root = explicit_data_root(args.data_dir) if endpoint.explicit else data_root(args.data_dir)
        value = asyncio.run(runner.run_code(source, filename, endpoint, args.timeout or None, root))
    except EndpointError as error:
        runner.print_err(f"{identity.COMMAND}: {error}")
        return 2
    except runner.UserCodeError as error:
        runner.print_err(runner.format_user_error(error))
        return 1
    except runner.ExecTimeout as error:
        runner.print_err(f"{identity.COMMAND} exec: {error}")
        return 1
    except KeyboardInterrupt:
        runner.print_err(f"{identity.COMMAND} exec: interrupted")
        return 130
    except asyncio.CancelledError:
        runner.print_err(f"{identity.COMMAND} exec: terminated")
        return 143
    try:
        text = runner.format_value(value, args.json)
    except (TypeError, ValueError) as error:
        runner.print_err(f"{identity.COMMAND} exec: can't print the result as JSON ({error})")
        return 1
    if text is not None:
        sys.stdout.write(text + "\n")
    sys.stdout.flush()
    return 0
