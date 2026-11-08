import hashlib
import json
import os
import sys
import time

from ardia_cli import __version__

EVENT = "cli_feedback"
MAX_TEXT = 1000
MAX_COMMAND = 300
MAX_STDIN_BYTES = 64 * 1024
DAILY_LIMIT = 20
WINDOW_S = 24 * 60 * 60
LOCAL_FILE = "feedback.jsonl"
MAX_LOCAL_LINES = 200
DESCRIPTION = """\
Tell Ardia's developer what got in your way: a confusing error, a missing command, output that cost you extra turns.
Say what you ran, what happened and what you expected. The text goes through the CLI's crash-and-usage pipeline,
so it's sent only while "Share anonymous crash reports and usage stats" is on; otherwise it's saved on this Mac.
Before it leaves, it's capped at 1,000 characters and stripped of URLs' queries and logins, emails, tokens and
keys, card-like numbers and home folder names. At most 20 a day are sent.
"""
EPILOG = """\
Examples:
  ardia feedback "snapshot -i hid the Save button inside a dialog; expected it listed with a ref"
  ardia feedback --command "ardia browse click @e7" "said element_replaced twice in a row on a static page"
  echo "fill on a date input typed into the wrong field" | ardia feedback
"""


def add_parser(commands, formatter) -> None:
    parser = commands.add_parser("feedback", help="tell Ardia's developer what annoyed you (agents welcome)", description=DESCRIPTION, epilog=EPILOG, formatter_class=formatter)
    parser.add_argument("text", nargs="*", help="what annoyed you and what you expected; - or nothing reads stdin")
    parser.add_argument("--command", dest="about", metavar="CMD", help="the command that misbehaved")
    parser.add_argument("--data-dir", help="the Ardia data dir whose sharing setting applies")


def read_text(words: list[str], stdin) -> str:
    if words and words != ["-"]:
        return " ".join(words)
    if stdin is None or (not words and stdin.isatty()):
        return ""
    return stdin.buffer.read(MAX_STDIN_BYTES).decode("utf-8", "replace") if hasattr(stdin, "buffer") else stdin.read(MAX_STDIN_BYTES)


def save_locally(home, entry: dict):
    from ardia_cli import usage
    from ardia_cli.browse import paths

    dir_fd = usage.open_folder(home)
    try:
        lines = []
        try:
            fd = paths.open_private_file(LOCAL_FILE, dir_fd, os.O_RDONLY)
            try:
                lines = os.read(fd, MAX_LOCAL_LINES * 4096).splitlines(keepends=True)
            finally:
                os.close(fd)
        except FileNotFoundError:
            pass
        lines.append((json.dumps(entry, ensure_ascii=False) + "\n").encode())
        temp = f".{LOCAL_FILE}.{os.getpid()}.tmp"
        fd = paths.open_private_file(temp, dir_fd, os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
        try:
            os.write(fd, b"".join(lines[-MAX_LOCAL_LINES:]))
        finally:
            os.close(fd)
        os.rename(temp, LOCAL_FILE, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
    finally:
        os.close(dir_fd)
    return home / usage.FOLDER / LOCAL_FILE


def keep(home, entry: dict, reason: str) -> int:
    from ardia_cli.browse import paths

    try:
        path = save_locally(home, entry)
    except (OSError, paths.PathError):
        print(f"Thanks. {reason}, so it wasn't sent, and it couldn't be saved either.")
        return 0
    print(f"Thanks. {reason}, so it stayed on this Mac: {path}")
    return 0


def properties(text: str, about: str | None, home, env) -> dict:
    from ardia_cli import caller, telemetry_scrub, usage

    clean, truncated = telemetry_scrub.free_text(text, MAX_TEXT)
    command = telemetry_scrub.free_text(about, MAX_COMMAND)[0] if about else None
    try:
        agent = caller.current().name
    except Exception:
        agent = caller.FALLBACK
    return {
        "text": clean,
        "text_truncated": truncated,
        "text_chars": len(text),
        "about_command": command or None,
        "agent": agent,
        "recent_commands": usage.recent_commands(home) if usage.recording_home(env) else [],
        "cli_version": __version__,
    }


def send(where, install_id: str, props: dict) -> None:
    from ardia_cli import telemetry

    record = telemetry.event(EVENT, install_id, {**props, "$environment": where.environment})
    dir_fd = telemetry.append(where.root, [record])
    if dir_fd is not None:
        try:
            telemetry.start_flush(dir_fd, where, urgent=True)
        finally:
            os.close(dir_fd)


def run(args, stdin=None, env=None) -> int:
    from ardia_cli import telemetry, usage

    env = os.environ if env is None else env
    text = read_text(args.text, sys.stdin if stdin is None else stdin).strip()
    if not text:
        sys.stderr.write('ardia feedback needs text: ardia feedback "what annoyed you, what you expected"\n')
        return 2
    home = usage.cli_home(env)
    props = properties(text, args.about, home, env)
    where = telemetry.target(args.data_dir, False, env)
    install_id = telemetry.consent(where.root) if where else None
    entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **props}
    if install_id is None:
        return keep(home, entry, "Sharing crash reports and usage is off")
    digest = hashlib.sha256(f"{props['text']}\0{props['about_command'] or ''}".encode()).hexdigest()[:16]
    slot = usage.take_feedback_slot(home, digest, DAILY_LIMIT, WINDOW_S, time.time())
    if slot == "duplicate":
        print("Thanks, that one was already sent today.")
        return 0
    if slot == "limited":
        return keep(home, entry, f"{DAILY_LIMIT} notes went out in the last day")
    if slot != "ok":
        return keep(home, entry, "Another ardia was busy with feedback")
    send(where, install_id, props)
    print("Thanks, sent to Ardia's developer.")
    return 0
