import contextlib
import fcntl
import hashlib
import json
import os
import plistlib
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

VERSION = "0.38.0"
DRIVER_SHA256 = "5f71191c082ca07c9dfc13b7c9a6eec60a82818c245a93534cc0eb7911471d72"
SKILLS_SHA256 = "0fe3d607e7212d6c58072a2419163342061dcf5cb89ba1243dea593d7e33be0f"

RELEASE_URL = f"https://github.com/trycua/cua/releases/download/cua-driver-rs-v{VERSION}"
DRIVER_ASSET = f"cua-driver-rs-{VERSION}-darwin-arm64.tar.gz"
DRIVER_TOP = f"cua-driver-rs-{VERSION}-darwin-arm64"
SKILLS_ASSET = f"cua-driver-rs-v{VERSION}-skills.tar.gz"
SKILLS_TOP = f"cua-driver-rs-v{VERSION}-skills"
BUNDLE_ID = "com.trycua.driver"
TEAM_ID = "YCK386LBJ7"
REQUIREMENT = f'identifier "{BUNDLE_ID}" and anchor apple generic and certificate leaf[subject.OU] = "{TEAM_ID}"'
APP_NAME = "CuaDriver.app"
APP_BINARY = "Contents/MacOS/cua-driver"
STAGING_NAME = f".{APP_NAME}.ardia-new"
RETIRED_NAME = f".{APP_NAME}.ardia-old"
LOCK_NAME = ".applications.lock"
LOCK_TIMEOUT_S = 120
APPLICATIONS = Path("/Applications")
LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
SERVER_NAME = "cua-driver"
SKILL_NAME = "cua-driver"
DRIVER_NOTICES = ("LICENSE", "THIRD_PARTY_NOTICES.md")
OTHER_PLATFORM_DOCS = frozenset({"LINUX.md", "WINDOWS.md"})
DAEMON_COMMANDS = frozenset({"mcp", "call", "serve", "permissions"})
DRIVER_COMMANDS = frozenset({
    "mcp", "list-tools", "describe", "call", "serve", "stop", "revoke", "status", "config", "telemetry", "recording",
    "update", "check-update", "doctor", "diagnose", "permissions", "autostart", "skills", "manifest", "extension",
    "perception", "channel", "cursor-theme", "cursor", "sessions", "history", "mcp-config",
})
QUIET_ENV = {"CUA_DRIVER_RS_TELEMETRY_ENABLED": "0", "CUA_DRIVER_RS_UPDATE_CHECK": "0"}
VERSION_DIR = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
TARGETS = ("general", "claude-code", "codex", "cursor", "opencode")
DOWNLOAD_TIMEOUT_S = 60
PINNED_MESSAGE = (
    f"ardia computer: cua-driver is pinned at {VERSION} and updates with the ardia command "
    "(the app installs new versions), not through cua's installer"
)
REFUSED = {
    "update": PINNED_MESSAGE,
    "channel": PINNED_MESSAGE,
    "skills": "ardia computer: run `ardia skills install --target <agent>`; it installs cua-driver's skill pinned to this driver next to ardia's",
}
HELP = f"""\
usage: ardia computer <cua-driver command> [args]
       ardia computer setup
       ardia computer mcp-config [--target general|claude-code|codex|cursor|opencode]

Operates native Mac apps (computer use) through cua-driver {VERSION} (github.com/trycua/cua, MIT), pinned and
checked by ardia. Use ardia browse for web pages in Ardia.

  setup        download the pinned driver, put CuaDriver.app in /Applications (macOS ties the Accessibility and
               Screen Recording permissions to it), link a cua-driver command to this one, then ask for the
               permissions
  mcp-config   print the MCP server entry for an agent, pointing at ardia computer mcp
  help         cua-driver's own help (every other command goes to cua-driver unchanged)

Common commands: mcp, list-tools, describe <tool>, call <tool> '<json>', permissions status|grant, doctor, stop.
update, channel and skills are ardia's job here: the driver updates with ardia, and ardia skills install adds its skill.
"""


class Refused(Exception):
    pass


class Inconclusive(Refused):
    pass


def cua_home(env=None) -> Path:
    from ardia_cli import usage

    return usage.cli_home(env) / "cua-driver"


def version_home(env=None) -> Path:
    return cua_home(env) / VERSION


def bundled_app(env=None) -> Path:
    return version_home(env) / APP_NAME.removesuffix(".app")


def installed_app() -> Path:
    return APPLICATIONS / APP_NAME


def say(line: str) -> None:
    sys.stderr.write(line + "\n")
    sys.stderr.flush()


def download(url: str, dest: Path) -> None:
    import urllib.error
    import urllib.request

    from ardia_cli import __version__

    class HttpsOnly(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if not newurl.startswith("https://"):
                raise urllib.error.URLError(f"refused a redirect to {newurl}")
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    if not url.startswith("https://"):
        raise Refused(f"refused a download that isn't https: {url}")
    opener = urllib.request.build_opener(HttpsOnly)
    request = urllib.request.Request(url, headers={"User-Agent": f"ardia/{__version__}"})
    with opener.open(request, timeout=DOWNLOAD_TIMEOUT_S) as response, open(dest, "wb") as out:
        shutil.copyfileobj(response, out, 1 << 20)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch_verified(asset: str, expected: str, work: Path) -> Path:
    path = work / asset
    say(f"step download {RELEASE_URL}/{asset}")
    try:
        download(f"{RELEASE_URL}/{asset}", path)
    except Refused:
        raise
    except Exception as error:
        raise Refused(f"couldn't download {asset}: {error}") from error
    actual = sha256_of(path)
    if actual != expected:
        path.unlink(missing_ok=True)
        raise Refused(f"checksum mismatch for {asset}: expected {expected}, got {actual}; nothing was installed")
    say(f"step verify {asset} sha256 {actual}")
    return path


def extract(archive: Path, top: str, dest: Path, keep) -> list[str]:
    try:
        return extract_members(archive, top, dest, keep)
    except tarfile.TarError as error:
        raise Refused(f"couldn't read {archive.name}: {error}") from error


def extract_members(archive: Path, top: str, dest: Path, keep) -> list[str]:
    taken = []
    with tarfile.open(archive, "r:gz") as tar:
        members = []
        for member in tar.getmembers():
            parts = member.name.rstrip("/").split("/")
            if parts[0] != top or any(part in ("", ".", "..") for part in parts):
                raise Refused(f"{archive.name} has an entry outside {top}/: {member.name}")
            inner = "/".join(parts[1:])
            if not inner or not keep(inner):
                continue
            if not (member.isfile() or member.isdir()):
                raise Refused(f"{archive.name} has a link or special file: {member.name}")
            member.name = inner
            members.append(member)
            if member.isfile():
                taken.append(inner)
        tar.extractall(dest, members=members, filter="data")
    return taken


def keeps_driver_file(inner: str) -> bool:
    return inner == APP_NAME or inner.startswith(APP_NAME + "/") or inner in DRIVER_NOTICES


def keeps_skill_file(inner: str) -> bool:
    return "/" not in inner and inner.endswith(".md") and inner not in OTHER_PLATFORM_DOCS


def info_value(app: Path, key: str) -> str | None:
    try:
        with open(app / "Contents" / "Info.plist", "rb") as handle:
            info = plistlib.load(handle)
    except Exception:
        return None
    value = info.get(key) if isinstance(info, dict) else None
    return value if isinstance(value, str) else None


def app_version(app: Path) -> str | None:
    return info_value(app, "CFBundleShortVersionString")


def app_bundle_id(app: Path) -> str | None:
    return info_value(app, "CFBundleIdentifier")


def verify_app(app: Path) -> None:
    try:
        result = subprocess.run(
            ["/usr/bin/codesign", "--verify", "--deep", "--strict", "-R", f"={REQUIREMENT}", str(app)],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise Inconclusive(f"couldn't check the signature of {app}: {error}") from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        raise Refused(f"{app} isn't Cua AI's signed {APP_NAME} ({detail[0] if detail else f'codesign exit {result.returncode}'})")


def check_app(app: Path) -> None:
    if app_bundle_id(app) != BUNDLE_ID:
        raise Refused(f"{app} has bundle id {app_bundle_id(app)}, not {BUNDLE_ID}")
    if app_version(app) != VERSION:
        raise Refused(f"{app} is version {app_version(app)}, not the pinned {VERSION}")
    verify_app(app)


def prune_versions(home: Path) -> None:
    others = []
    for entry in home.iterdir() if home.is_dir() else ():
        if VERSION_DIR.match(entry.name) and entry.name != VERSION and entry.is_dir() and not entry.is_symlink():
            others.append(entry)
    others.sort(key=lambda entry: entry.stat().st_mtime, reverse=True)
    for entry in others[1:]:
        shutil.rmtree(entry, ignore_errors=True)


def remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def ensure_driver(env=None) -> Path:
    app = bundled_app(env)
    if app.exists() or app.is_symlink():
        try:
            if app.is_symlink():
                raise Refused(f"{app} is a link")
            check_app(app)
            return app
        except Inconclusive:
            raise
        except Refused as error:
            say(f"ardia computer: the cached cua-driver failed verification ({error}); fetching it again")
            remove_path(app)
    home = version_home(env)
    home.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=".driver-", dir=home))
    try:
        archive = fetch_verified(DRIVER_ASSET, DRIVER_SHA256, work)
        staged = work / "tree"
        staged.mkdir()
        extract(archive, DRIVER_TOP, staged, keeps_driver_file)
        archive.unlink()
        if not (staged / APP_NAME / APP_BINARY).is_file():
            raise Refused(f"{DRIVER_ASSET} has no {APP_NAME}/{APP_BINARY}")
        check_app(staged / APP_NAME)
        for name in DRIVER_NOTICES:
            if (staged / name).is_file():
                os.replace(staged / name, home / name)
        try:
            os.rename(staged / APP_NAME, app)
        except OSError:
            if not (app / APP_BINARY).is_file():
                raise
            check_app(app)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    say(f"step installed {app}")
    prune_versions(cua_home(env))
    return app


def skill_pack(env=None) -> dict[str, bytes]:
    folder = version_home(env) / "skills"
    if not (folder.is_dir() and not folder.is_symlink() and (folder / "SKILL.md").is_file()):
        home = version_home(env)
        home.mkdir(parents=True, exist_ok=True)
        work = Path(tempfile.mkdtemp(prefix=".skills-", dir=home))
        try:
            archive = fetch_verified(SKILLS_ASSET, SKILLS_SHA256, work)
            staged = work / "skills"
            staged.mkdir()
            names = extract(archive, SKILLS_TOP, staged, keeps_skill_file)
            if "SKILL.md" not in names:
                raise Refused(f"{SKILLS_ASSET} has no SKILL.md")
            if folder.is_symlink():
                folder.unlink()
            elif folder.exists():
                shutil.rmtree(folder)
            try:
                os.rename(staged, folder)
            except OSError:
                if not (folder / "SKILL.md").is_file():
                    raise
        finally:
            shutil.rmtree(work, ignore_errors=True)
    pack = {}
    for entry in sorted(folder.iterdir()):
        if entry.is_file() and not entry.is_symlink() and keeps_skill_file(entry.name):
            pack[entry.name] = entry.read_bytes()
    return pack


def record_path(env=None) -> Path:
    return cua_home(env) / "applications.json"


def read_record(env=None) -> dict:
    try:
        data = json.loads(record_path(env).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_record(record: dict, env=None) -> None:
    path = record_path(env)
    path.parent.mkdir(parents=True, exist_ok=True)
    staging = path.with_name(f".applications.{os.getpid()}.json")
    staging.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    os.replace(staging, path)


def code_hash(app: Path) -> str | None:
    try:
        result = subprocess.run(["/usr/bin/codesign", "-dvvv", str(app)], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as error:
        raise Inconclusive(f"couldn't read the code hash of {app}: {error}") from error
    match = re.search(r"^CDHash=([0-9a-f]+)$", result.stderr, re.MULTILINE)
    return match.group(1) if match else None


def committed(record: dict) -> bool:
    return record.get("state", "committed") == "committed"


def installed_by_ardia(app: Path, env=None) -> bool:
    record = read_record(env)
    if not committed(record) or record.get("path") != str(app) or not record.get("cdhash"):
        return False
    return code_hash(app) == record["cdhash"]


def quietly_ours(app: Path, env=None) -> bool:
    try:
        return installed_by_ardia(app, env)
    except Inconclusive:
        return False


def forget_record(env=None) -> None:
    with contextlib.suppress(FileNotFoundError):
        record_path(env).unlink()


def restore_record(previous, env=None) -> None:
    if isinstance(previous, dict) and previous.get("path"):
        save_record({**{key: value for key, value in previous.items() if key != "previous"}, "state": "committed"}, env)
    else:
        forget_record(env)


@contextlib.contextmanager
def applications_lock(env=None):
    home = cua_home(env)
    home.mkdir(parents=True, exist_ok=True)
    fd = os.open(home / LOCK_NAME, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        deadline = time.monotonic() + LOCK_TIMEOUT_S
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise Refused(f"another ardia computer setup or refresh is still running (waited {LOCK_TIMEOUT_S} s)") from None
                time.sleep(0.1)
        yield
    finally:
        os.close(fd)


def needs_recovery(env=None) -> bool:
    return (
        (APPLICATIONS / RETIRED_NAME).exists() or (APPLICATIONS / RETIRED_NAME).is_symlink()
        or (APPLICATIONS / STAGING_NAME).exists() or (APPLICATIONS / STAGING_NAME).is_symlink()
        or not committed(read_record(env))
    )


def signed_by_cua(app: Path) -> bool:
    try:
        verify_app(app)
    except Refused:
        return False
    return True


def pending_verdict(dest: Path, pending) -> str:
    if not dest.is_dir() or not pending:
        return "mismatch"
    if code_hash(dest) != pending:
        return "mismatch"
    try:
        verify_app(dest)
    except Inconclusive:
        raise
    except Refused:
        return "tampered"
    return "match"


def recover(env=None) -> bool:
    dest = installed_app()
    staging = APPLICATIONS / STAGING_NAME
    retired = APPLICATIONS / RETIRED_NAME
    if not (dest.exists() or dest.is_symlink()) and (retired.exists() or retired.is_symlink()):
        os.rename(retired, dest)
    record = read_record(env)
    if not committed(record):
        try:
            verdict = pending_verdict(dest, record.get("cdhash"))
        except Inconclusive as error:
            say(f"ardia computer: recovery is pending for {dest} ({error}); the next ardia computer run tries again")
            return False
        if verdict == "match":
            save_record({key: value for key, value in record.items() if key not in ("previous", "state")} | {"state": "committed"}, env)
        else:
            if verdict == "tampered" and retired.is_dir():
                remove_path(dest)
                os.rename(retired, dest)
            restore_record(record.get("previous"), env)
    if staging.exists() or staging.is_symlink():
        remove_path(staging)
    if (retired.exists() or retired.is_symlink()) and (dest.exists() or dest.is_symlink()):
        remove_path(retired)
    return True


def copy_app(source: Path, dest: Path) -> None:
    subprocess.run(["/usr/bin/ditto", str(source), str(dest)], stdin=subprocess.DEVNULL, check=True, capture_output=True)


def register_app(app: Path) -> None:
    subprocess.run([LSREGISTER, "-f", str(app)], stdin=subprocess.DEVNULL, check=False, capture_output=True)


def run_driver_quietly(binary: Path, *args: str) -> int:
    try:
        return subprocess.run(
            [str(binary), *args], env=driver_env(os.environ), stdin=subprocess.DEVNULL, capture_output=True, timeout=60,
        ).returncode
    except (OSError, subprocess.SubprocessError):
        return 1


def place_app(source: Path, env=None) -> str:
    dest = installed_app()
    staging = APPLICATIONS / STAGING_NAME
    retired = APPLICATIONS / RETIRED_NAME
    exists = dest.exists() or dest.is_symlink()
    ours = exists and installed_by_ardia(dest, env)
    if exists and not ours:
        version = app_version(dest) or "of unknown version"
        return f"kept {dest}: CuaDriver.app {version} was put there by something other than ardia (cua's own installer?); ardia computer uses it as is"
    if ours:
        verify_app(dest)
        if app_version(dest) == VERSION:
            return f"current {dest} ({VERSION})"
    if not os.access(APPLICATIONS, os.W_OK):
        raise Refused(f"can't write to {APPLICATIONS}; run ardia computer setup from an admin account")
    previous = read_record(env) if ours else None
    try:
        if staging.exists() or staging.is_symlink():
            remove_path(staging)
        copy_app(source, staging)
        check_app(staging)
        new_hash = code_hash(staging)
        if not new_hash:
            raise Refused(f"couldn't read the code hash of {staging}")
        save_record({"path": str(dest), "version": VERSION, "cdhash": new_hash, "state": "pending", "previous": previous}, env)
    except BaseException:
        if staging.exists() or staging.is_symlink():
            remove_path(staging)
        raise
    try:
        if ours:
            run_driver_quietly(dest / APP_BINARY, "stop")
            os.rename(dest, retired)
        os.rename(staging, dest)
    except BaseException:
        if (retired.exists() or retired.is_symlink()) and not (dest.exists() or dest.is_symlink()):
            os.rename(retired, dest)
        if staging.exists() or staging.is_symlink():
            remove_path(staging)
        restore_record(previous, env)
        raise
    save_record({"path": str(dest), "version": VERSION, "cdhash": new_hash, "state": "committed"}, env)
    if retired.exists() or retired.is_symlink():
        remove_path(retired)
    register_app(dest)
    return f"{'updated' if ours else 'installed'} {dest} ({VERSION})"


def bin_dir(env=None) -> Path:
    env = os.environ if env is None else env
    return Path(env.get("ARDIA_CLI_BIN_DIR") or Path.home() / ".local" / "bin").expanduser()


def trusted_launcher(env=None) -> Path | None:
    from ardia_cli import usage

    cli_home = usage.cli_home(env)
    current = cli_home / "current" / "bin" / "ardia"
    try:
        if current.is_file() and current.resolve(strict=True).is_relative_to(cli_home.resolve(strict=True)):
            return current
    except OSError:
        pass
    root = Path(sys.executable).resolve().parents[2]
    launcher = root / "bin" / "ardia"
    if Path(sys.executable).resolve().parent.parent == root / "python" and launcher.is_file() and not launcher.is_symlink():
        return launcher
    return None


def ardia_command(env=None) -> str:
    launcher = trusted_launcher(env)
    if launcher is None:
        raise Refused(
            "can't find the installed ardia launcher ($ARDIA_CLI_HOME/current/bin/ardia), and won't take whatever "
            "ardia is first on PATH; install the ardia command from Ardia (Settings › Advanced) and run this again"
        )
    return str(launcher)


def shim_path(env=None) -> Path:
    return cua_home(env) / "bin" / "cua-driver"


def link_command(env=None) -> str:
    launcher = ardia_command(env)
    shim = shim_path(env)
    shim.parent.mkdir(parents=True, exist_ok=True)
    body = f'#!/bin/sh\nexec {shlex.quote(launcher)} computer "$@"\n'
    staging = shim.with_name(f".cua-driver.{os.getpid()}")
    staging.write_text(body, encoding="utf-8")
    os.chmod(staging, 0o755)
    os.replace(staging, shim)
    link = bin_dir(env) / "cua-driver"
    if link.is_symlink() and os.readlink(link) == str(shim):
        return f"current {link}"
    if link.exists() or link.is_symlink():
        return f"kept {link}: it isn't ardia's; run ardia computer instead of cua-driver"
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(shim)
    return f"linked {link} -> {shim}"


def driver_env(environ) -> dict:
    env = dict(environ)
    for name, value in QUIET_ENV.items():
        env.setdefault(name, value)
    return env


def setup(argv: list[str]) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="ardia computer setup", description="Download the pinned cua-driver, put CuaDriver.app in /Applications and ask for its permissions.")
    parser.add_argument("--no-grant", action="store_true", help="stop before asking for the permissions")
    args = parser.parse_args(argv)
    if not supported():
        say("ardia computer: computer use through cua-driver needs macOS here")
        return 1
    try:
        with applications_lock():
            if not recover():
                return 1
            print(place_app(ensure_driver()))
        print(link_command())
    except (Refused, OSError, subprocess.CalledProcessError) as error:
        say(f"ardia computer: {error}")
        return 1
    dest = installed_app()
    if quietly_ours(dest) and signed_by_cua(dest):
        if run_driver_quietly(dest / APP_BINARY, "telemetry", "disable") == 0:
            print("cua-driver telemetry off (cua-driver telemetry enable turns it back on)")
    if args.no_grant or not (sys.stdin.isatty() and sys.stdout.isatty()):
        print("next: ardia computer permissions grant")
        return 0
    print("Asking macOS for Cua Driver's Accessibility and Screen Recording permissions…")
    sys.stdout.flush()
    return run_driver(["permissions", "grant"])


def refresh() -> int:
    if not supported():
        return 0
    dest = installed_app()
    try:
        with applications_lock():
            if not recover():
                return 1
            if not dest.is_dir() or app_version(dest) == VERSION or not installed_by_ardia(dest):
                return 0
            print(place_app(ensure_driver()))
    except (Refused, OSError, subprocess.CalledProcessError) as error:
        say(f"ardia computer: {error}")
        return 1
    return 0


def mcp_config(target: str, env=None) -> str:
    command = ardia_command(env)
    args = ["computer", "mcp"]
    if target == "claude-code":
        entry = json.dumps({"command": command, "args": args})
        return f"claude mcp add-json --scope user {SERVER_NAME} {shlex.quote(entry)}"
    if target == "codex":
        return f"codex mcp add {SERVER_NAME} -- {shlex.join([command, *args])}"
    if target == "opencode":
        return json.dumps({"mcp": {SERVER_NAME: {"type": "local", "command": [command, *args], "enabled": True}}}, indent=2)
    entry = {"command": command, "args": args}
    if target == "cursor":
        entry["type"] = "stdio"
    return json.dumps({"mcpServers": {SERVER_NAME: entry}}, indent=2)


def print_mcp_config(argv: list[str]) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="ardia computer mcp-config", description="Print the MCP server entry for an agent. It runs ardia computer mcp, so it keeps working across ardia and cua-driver updates.")
    parser.add_argument("--target", choices=TARGETS, default="general", help="claude-code and codex print the command that adds it; the others print the JSON to paste (default: general)")
    args = parser.parse_args(argv)
    try:
        print(mcp_config(args.target))
    except Refused as error:
        say(f"ardia computer: {error}")
        return 1
    return 0


def supported() -> bool:
    return sys.platform == "darwin"


def stale_notice(app: Path) -> str | None:
    version = app_version(app)
    record = read_record()
    if version == VERSION or record.get("path") != str(app) or record.get("version") != version:
        return None
    return f"ardia computer: {app} is cua-driver {version}, ardia pins {VERSION}; run ardia computer setup to update it"


def run_driver(argv: list[str]) -> int:
    if not supported():
        say("ardia computer: computer use through cua-driver needs macOS here")
        return 1
    app = installed_app()
    try:
        if needs_recovery():
            with applications_lock():
                recover()
    except (Refused, OSError) as error:
        say(f"ardia computer: {error}")
        return 1
    if app.exists() or app.is_symlink():
        try:
            verify_app(app)
        except Inconclusive as error:
            say(f"ardia computer: {error}; try again")
            return 1
        except Refused as error:
            say(f"ardia computer: {error}. ardia won't run it: move it away and run ardia computer setup")
            return 1
        binary = app / APP_BINARY
        notice = stale_notice(app)
        if notice:
            say(notice)
    elif argv and argv[0] in DAEMON_COMMANDS:
        say(
            f"ardia computer: Cua Driver isn't set up yet. Run ardia computer setup: it puts {APP_NAME} in {APPLICATIONS}, "
            "which macOS ties the Accessibility and Screen Recording permissions to"
        )
        return 1
    else:
        try:
            binary = ensure_driver() / APP_BINARY
        except (Refused, OSError) as error:
            say(f"ardia computer: {error}")
            return 1
    from ardia_cli import telemetry

    telemetry.finish_before_exec()
    os.execve(str(binary), [str(binary), *argv], driver_env(os.environ))
    return 1


def label(argv: list[str]) -> str:
    first = argv[0] if argv else "help"
    if first in DRIVER_COMMANDS or first in ("setup", "refresh", "help", "--version", "--help", "-h"):
        return first.lstrip("-")
    return "other"


def main(argv: list[str]) -> int:
    from ardia_cli import telemetry

    telemetry.note_command("computer", label(argv))
    first = argv[0] if argv else None
    if first in (None, "-h", "--help"):
        print(HELP, end="")
        return 0
    if first == "setup":
        return setup(argv[1:])
    if first == "mcp-config":
        return print_mcp_config(argv[1:])
    if first == "refresh" and len(argv) == 1:
        return refresh()
    if first in REFUSED:
        say(REFUSED[first])
        return 2
    if first == "help":
        argv = ["--help", *argv[1:]]
    return run_driver(argv)
