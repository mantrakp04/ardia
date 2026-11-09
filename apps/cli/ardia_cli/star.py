import os
import shutil
import subprocess
import sys

REPO = "mantrakp04/ardia"
URL = f"https://github.com/{REPO}"
SESSION = "ardia-star"
GH_TIMEOUT_S = 20
BROWSE_TIMEOUT_S = 60
DESCRIPTION = f"""\
Star {URL} on GitHub for the user. Run it only after the user said yes.
With the GitHub CLI signed in, it stars through gh (gh api -X PUT /user/starred/{REPO}). Otherwise it opens the
page in a new Ardia tab and leaves the Star button to the user; it never clicks it for them.
"""


def add_parser(commands, formatter) -> None:
    parser = commands.add_parser("star", help="star the Ardia repo on GitHub, only after the user says yes", description=DESCRIPTION, formatter_class=formatter)
    parser.add_argument("--data-dir", help="the Ardia data dir to open the page in when gh can't star")


def star_with_gh(run=subprocess.run, which=shutil.which) -> bool:
    gh = which("gh")
    if not gh:
        return False
    try:
        result = run(
            [gh, "api", "--method", "PUT", f"/user/starred/{REPO}", "--silent"],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=GH_TIMEOUT_S,
            env={**os.environ, "GH_PROMPT_DISABLED": "1", "GH_NO_UPDATE_NOTIFIER": "1"},
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def open_in_ardia(data_dir: str | None, run=subprocess.run) -> bool:
    command = [sys.executable, "-I", "-m", "ardia_cli", *(["--data-dir", data_dir] if data_dir else []), "browse", "--session", SESSION, "open", URL, "--show"]
    try:
        result = run(command, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=BROWSE_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def run(args, run=subprocess.run, which=shutil.which, env=None) -> int:
    from ardia_cli import usage

    home = usage.cli_home(os.environ if env is None else env)
    if star_with_gh(run, which):
        outcome, status = "gh", 0
        message = f"★ Starred github.com/{REPO} with the user's GitHub account (through gh). Thanks for the star!"
    elif open_in_ardia(args.data_dir, run):
        outcome, status = "browser", 0
        message = f"Opened github.com/{REPO} in a new Ardia tab. Ask the user to click Star there; ardia doesn't click it for them."
    else:
        outcome, status = "manual", 1
        message = f"Couldn't star through gh or open Ardia. Ask the user to open {URL} and click Star."
    try:
        usage.mark_starred(home, outcome)
    except Exception:
        pass
    (sys.stdout if status == 0 else sys.stderr).write(message + "\n")
    return status
