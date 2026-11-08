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


def app_version(app: Path) -> str | None:
    try:
        with open(app / "Contents" / "Info.plist", "rb") as handle:
            info = plistlib.load(handle)
    except (OSError, ValueError, plistlib.InvalidFileException):
        return None
    version = info.get("CFBundleShortVersionString") if isinstance(info, dict) else None
    return version if isinstance(version, str) else None


def app_bundle_id(app: Path) -> str | None:
    try:
        with open(app / "Contents" / "Info.plist", "rb") as handle:
            info = plistlib.load(handle)
    except (OSError, ValueError, plistlib.InvalidFileException):
        return None
    value = info.get("CFBundleIdentifier") if isinstance(info, dict) else None
    return value if isinstance(value, str) else None


def verify_app(app: Path) -> None:
    result = subprocess.run(
        ["/usr/bin/codesign", "--verify", "--deep", "--strict", "-R", f"={REQUIREMENT}", str(app)],
        stdin=subprocess.DEVNULL, capture_output=True, text=True,
    )
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


def ensure_driver(env=None) -> Path:
    app = bundled_app(env)
    if (app / APP_BINARY).is_file() and not app.is_symlink():
        return app
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
    except (OSError, subprocess.SubprocessError):
        return None
    match = re.search(r"^CDHash=([0-9a-f]+)$", result.stderr, re.MULTILINE)
    return match.group(1) if match else None


def installed_by_ardia(app: Path, env=None) -> bool:
    record = read_record(env)
    if record.get("path") != str(app) or not record.get("cdhash"):
        return False
    return code_hash(app) == record["cdhash"]


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
    exists = dest.exists() or dest.is_symlink()
    ours = exists and installed_by_ardia(dest, env)
    if exists and not ours:
        version = app_version(dest) or "of unknown version"
        return f"kept {dest}: CuaDriver.app {version} was put there by something other than ardia (cua's own installer?); ardia computer uses it as is"
    if ours and app_version(dest) == VERSION:
        return f"current {dest} ({VERSION})"
    if not os.access(APPLICATIONS, os.W_OK):
        raise Refused(f"can't write to {APPLICATIONS}; run ardia computer setup from an admin account")
    staging = APPLICATIONS / f".{APP_NAME}.ardia-{os.getpid()}"
    retired = APPLICATIONS / f".{APP_NAME}.ardia-old-{os.getpid()}"
    shutil.rmtree(staging, ignore_errors=True)
    try:
        copy_app(source, staging)
        check_app(staging)
        if ours:
            run_driver_quietly(dest / APP_BINARY, "stop")
            os.rename(dest, retired)
        os.rename(staging, dest)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        if retired.exists() and not dest.exists():
            os.rename(retired, dest)
        raise
    shutil.rmtree(retired, ignore_errors=True)
    register_app(dest)
    save_record({"path": str(dest), "version": VERSION, "cdhash": code_hash(dest)}, env)
    return f"{'updated' if ours else 'installed'} {dest} ({VERSION})"


def bin_dir(env=None) -> Path:
    env = os.environ if env is None else env
    return Path(env.get("ARDIA_CLI_BIN_DIR") or Path.home() / ".local" / "bin").expanduser()


def ardia_command(env=None) -> str:
    from ardia_cli import usage

    installed = usage.cli_home(env) / "current" / "bin" / "ardia"
    if installed.is_file():
        return str(installed)
    found = shutil.which("ardia")
    return str(Path(found).absolute()) if found else "ardia"


def shim_path(env=None) -> Path:
    return cua_home(env) / "bin" / "cua-driver"


def link_command(env=None) -> str:
    shim = shim_path(env)
    shim.parent.mkdir(parents=True, exist_ok=True)
    body = f'#!/bin/sh\nexec {shlex.quote(ardia_command(env))} computer "$@"\n'
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
        source = ensure_driver()
        print(place_app(source))
        print(link_command())
    except (Refused, OSError, subprocess.CalledProcessError) as error:
        say(f"ardia computer: {error}")
        return 1
    dest = installed_app()
    binary = dest / APP_BINARY
    if installed_by_ardia(dest):
        if run_driver_quietly(binary, "telemetry", "disable") == 0:
            print("cua-driver telemetry off (cua-driver telemetry enable turns it back on)")
    if args.no_grant or not (sys.stdin.isatty() and sys.stdout.isatty()):
        print("next: ardia computer permissions grant")
        return 0
    print("Asking macOS for Cua Driver's Accessibility and Screen Recording permissions…")
    sys.stdout.flush()
    return run_driver(["permissions", "grant"])


def refresh() -> int:
    dest = installed_app()
    if not supported() or not dest.is_dir() or app_version(dest) == VERSION or not installed_by_ardia(dest):
        return 0
    try:
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
    print(mcp_config(args.target))
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
    if app.is_dir():
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
