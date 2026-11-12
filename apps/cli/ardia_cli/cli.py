import sys

from ardia_cli import __version__

DESCRIPTION = (
    "Control a running Ardia from the terminal. ardia browse drives the browser (ardia browse --help); "
    "ardia computer operates native Mac apps through the bundled cua-driver (ardia computer --help)."
)
EPILOG = """\
Shared options go before the command or after it, for the commands that take them:
  --port N        a plain DevTools server on 127.0.0.1:N (testing; $ARDIA_PORT)
  --ws URL        a browser WebSocket URL ($ARDIA_WS)
  --data-dir DIR  the Ardia data dir ($ARDIA_DATA_DIR, else the installed app's)
  --timeout S     and --json
A flag wins over its environment variable.

Examples:
  ardia --port 9222 browse snapshot -i
  ardia browse --port 9222 snapshot -i
  ardia windows --json
  ardia tabs --json
  ardia groups create tab-1 tab-2 --name Work --icon 🚀
"""
SKILLS_DESCRIPTION = """\
Install the ardia agent skill (SKILL.md and its references) so coding agents know how to drive Ardia.

Targets and where they install (user level; --project uses the current directory):
  general       ~/.agents/skills            ./.agents/skills
  codex         ~/.agents/skills            ./.agents/skills
  claude-code   ~/.claude/skills            ./.claude/skills
  cursor        ~/.cursor/skills            ./.cursor/skills
  opencode      ~/.config/opencode/skills   ./.opencode/skills

Next to each one it installs cua-driver's own skill (cua-driver, for computer use in native apps through
ardia computer), pinned to the bundled driver; --no-cua skips it. A cua-driver skill that ardia didn't install, from
cua's own installer for one, is left alone.

Installing or updating the CLI runs `ardia skills install --auto`: the skill goes to every coding agent found here
(Claude Code, Codex, Cursor, opencode; general when none is), never over a folder ardia didn't write, and not again where
the user removed it.
Ardia remembers where it installed the skill, and each CLI update rewrites those copies (ardia skills refresh).
"""
SHARED_VALUE_FLAGS = frozenset({"--port", "--ws", "--data-dir", "--timeout"})
SHARED_BOOL_FLAGS = frozenset({"--json"})
BROWSE_SHARED_FLAGS = frozenset({"--port", "--ws", "--data-dir", "--json"})
REMOVED_COMMANDS = {
    "exec": (
        "ardia: unknown command 'exec': it was removed. Drive the browser with ardia browse (ardia browse --help); "
        "ardia pinned and ardia history read favorites and history; ardia run, windows and events reach Ardia's "
        "commands, windows and events."
    ),
}


class UsageError(Exception):
    pass


def take_shared(argv: list[str], index: int, into: list[str]) -> int:
    while index < len(argv):
        token = argv[index]
        name = token.split("=", 1)[0]
        if name in SHARED_VALUE_FLAGS:
            if "=" in token:
                into.append(token)
                index += 1
                continue
            if index + 1 >= len(argv):
                raise UsageError(f"{name} needs a value")
            into.extend(argv[index:index + 2])
            index += 2
            continue
        if token in SHARED_BOOL_FLAGS:
            into.append(token)
            index += 1
            continue
        break
    return index


def flag_names(flags: list[str]) -> list[str]:
    return [token.split("=", 1)[0] for token in flags if token.startswith("--")]


def subcommands(parser) -> dict:
    import argparse

    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            return action.choices
    return {}


def arrange(parser, argv: list[str]) -> tuple[list[str], list[str], list[str]]:
    path: list[str] = []
    hoisted: list[str] = []
    index = 0
    current = parser
    while choices := subcommands(current):
        index = take_shared(argv, index, hoisted)
        if index >= len(argv) or argv[index] not in choices:
            break
        path.append(argv[index])
        current = choices[argv[index]]
        index += 1
    return path, hoisted, argv[index:]


def check_takes(parser, path: list[str], hoisted: list[str]) -> None:
    leaf = parser
    for name in path:
        leaf = subcommands(leaf)[name]
    for name in flag_names(hoisted):
        if name not in leaf._option_string_actions:
            raise UsageError(f"{' '.join(path)} doesn't take {name}")


def browse_argv(hoisted: list[str], rest: list[str], env) -> list[str]:
    for name in flag_names(hoisted):
        if name not in BROWSE_SHARED_FLAGS:
            raise UsageError(f"ardia browse doesn't take {name}")
    argv = hoisted + rest
    from ardia_cli.browse.cli import split_globals
    from ardia_cli.browse.errors import Usage

    try:
        found, _ = split_globals(argv)
    except Usage:
        return argv
    if found.keys() & {"ws", "port", "cdp"}:
        return argv
    if env.get("ARDIA_WS"):
        return ["--ws", env["ARDIA_WS"], *argv]
    if env.get("ARDIA_PORT"):
        return ["--port", env["ARDIA_PORT"], *argv]
    return argv


def run_browse(hoisted: list[str], rest: list[str]) -> int:
    import os

    try:
        argv = browse_argv(hoisted, rest, os.environ)
    except UsageError as error:
        sys.stderr.write(f"✗ {error}\n")
        return 1
    from ardia_cli import telemetry
    from ardia_cli.browse.cli import main as browse_main

    telemetry.note_browse(argv)
    return browse_main(argv)


def run_notes(hoisted: list[str], rest: list[str]) -> int:
    import importlib

    from ardia_cli import telemetry

    notes = importlib.import_module("ardia_cli.notes")

    telemetry.note_browse(hoisted + rest, command="notes")
    return notes.main(hoisted + rest)


def build_parser():
    import argparse

    parser = argparse.ArgumentParser(prog="ardia", description=DESCRIPTION, epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", action="version", version=f"ardia {__version__}")
    commands = parser.add_subparsers(dest="command", metavar="<command>")
    commands.add_parser("browse", help="drive the browser with agent-browser's commands (ardia browse --help)", add_help=False)
    commands.add_parser("notes", help="read and write notes (ardia notes --help)", add_help=False)
    commands.add_parser("computer", help="operate native Mac apps through the bundled cua-driver: computer use (ardia computer --help)", add_help=False)

    from ardia_cli import browsing_cli

    browsing_cli.add_parsers(commands, argparse.RawDescriptionHelpFormatter)

    skills = commands.add_parser("skills", help="install the ardia agent skill")
    skill_commands = skills.add_subparsers(dest="skills_command", metavar="<command>")
    install = skill_commands.add_parser(
        "install",
        help="install the skill for one or more agents",
        description=SKILLS_DESCRIPTION,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    from ardia_cli.skills import TARGETS

    install.add_argument("--target", action="append", choices=sorted(TARGETS), metavar="TARGET", help="general, codex, claude-code, cursor or opencode; repeat for several (default: general)")
    install.add_argument("--project", action="store_true", help="install into the current directory's project folders")
    install.add_argument("--no-cua", action="store_true", help="don't install cua-driver's computer-use skill next to it")
    install.add_argument("--replace", action="store_true", help="replace an ardia folder that ardia didn't install (only that folder)")
    install.add_argument("--auto", action="store_true", help="install for every coding agent found on this Mac (or general when none is), skipping folders ardia didn't write and copies the user removed")
    skill_commands.add_parser("refresh", help="rewrite every copy of the skill installed before with this CLI's version")

    from ardia_cli import scripts_cli

    scripts_cli.add_parser(commands, argparse.RawDescriptionHelpFormatter)

    from ardia_cli import config_cli

    config_cli.add_parsers(commands, argparse.RawDescriptionHelpFormatter)

    from ardia_cli import automation_cli

    automation_cli.add_parsers(commands, argparse.RawDescriptionHelpFormatter)

    from ardia_cli import workspace_cli

    workspace_cli.add_parsers(commands, argparse.RawDescriptionHelpFormatter)

    from ardia_cli import feedback, star

    feedback.add_parser(commands, argparse.RawDescriptionHelpFormatter)
    star.add_parser(commands, argparse.RawDescriptionHelpFormatter)
    return parser


def command_label(path: list[str], rest: list[str]) -> list[str]:
    if path:
        return path[:2]
    if rest and not rest[0].startswith("-"):
        return [rest[0] if rest[0] in REMOVED_COMMANDS else "unknown"]
    return ["none"]


def option_names(parser, path: list[str]) -> set[str]:
    names = set(parser._option_string_actions)
    for name in path:
        parser = subcommands(parser)[name]
        names |= set(parser._option_string_actions)
    return names


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv == ["--version"]:
        print(f"ardia {__version__}")
        return 0
    from ardia_cli import printable, telemetry

    try:
        index = take_shared(argv, 0, [])
    except UsageError:
        index = len(argv)
    browse_renders_its_own = index < len(argv) and argv[index] in ("browse", "notes")
    with printable.inert_output(json_stdout=browse_renders_its_own or printable.json_requested(argv)):
        return telemetry.track(argv, lambda: run(argv))


def run(argv: list[str]) -> int:
    from ardia_cli import telemetry

    leading: list[str] = []
    try:
        index = take_shared(argv, 0, leading)
    except UsageError as error:
        sys.stderr.write(f"ardia: {error}\n")
        return 2
    command = argv[index] if index < len(argv) else None
    if command == "browse":
        return run_browse(leading, argv[index + 1:])
    if command == "notes":
        return run_notes(leading, argv[index + 1:])
    if command == "computer":
        if leading:
            sys.stderr.write(f"ardia: computer doesn't take {flag_names(leading)[0]}\n")
            return 2
        from ardia_cli import computer

        return computer.main(argv[index + 1:])
    parser = build_parser()
    try:
        path, hoisted, rest = arrange(parser, argv)
        telemetry.note_command(*command_label(path, rest), allowed_flags=option_names(parser, path))
        if path:
            check_takes(parser, path, hoisted)
    except UsageError as error:
        sys.stderr.write(f"ardia: {error}\n")
        return 2
    if not path and rest and not rest[0].startswith("-"):
        sys.stderr.write(REMOVED_COMMANDS.get(rest[0], f"ardia: unknown command '{rest[0]}' (see ardia --help)") + "\n")
        return 2
    argv = path + hoisted + rest if path else rest
    from ardia_cli.automation_cli import split_program

    argv, program = split_program(argv)
    args = parser.parse_args(argv)
    args.program = program
    if args.command in ("pinned", "history"):
        from ardia_cli import browsing_cli

        return browsing_cli.run(args)
    if args.command == "skills":
        if args.skills_command not in ("install", "refresh"):
            parser.parse_args(["skills", "--help"])
        from ardia_cli import skills

        if args.skills_command == "refresh":
            return skills.refresh()
        if args.auto:
            return skills.install_detected(not args.no_cua)
        return skills.install(args.target or ["general"], args.project, not args.no_cua, args.replace)
    if args.command == "scripts":
        from ardia_cli import scripts_cli

        return scripts_cli.run(args, parser)
    if args.command in ("run", "commands", "windows", "events", "on", "hooks"):
        from ardia_cli import automation_cli

        return automation_cli.dispatch(args, parser)
    if args.command in ("tabs", "groups", "apply"):
        from ardia_cli import workspace_cli

        return workspace_cli.run(args, parser)
    if args.command in ("config", "theme"):
        from ardia_cli import config_cli

        return (config_cli.run_config if args.command == "config" else config_cli.run_theme)(args, parser)
    if args.command == "feedback":
        from ardia_cli import feedback

        return feedback.run(args)
    if args.command == "star":
        from ardia_cli import star

        return star.run(args)
    parser.print_help()
    return 0
