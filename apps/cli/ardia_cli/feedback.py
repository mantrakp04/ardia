import hashlib
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from ardia_cli import __version__

FEEDBACK_URL = "https://ardia.dev/api/feedback"
TEST_URL_ENV = "ARDIA_FEEDBACK_URL"
KINDS = ("bug", "slow", "idea", "other")
MAX_TITLE = 67
MAX_DESCRIPTION = 4000
MAX_COMMAND = 300
MAX_STDIN_BYTES = 64 * 1024
MAX_ATTACHMENTS = 10
MB = 1024 * 1024
RECORDING = ("recording.mp4", 100 * MB, "video/mp4")
TRACE = ("trace.json.gz", 50 * MB, "application/gzip")
OTHER_FILE_BYTES = 10 * MB
OTHER_TYPES = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
    "heic": "image/heic", "mov": "video/quicktime", "txt": "text/plain", "log": "text/plain", "md": "text/markdown",
    "json": "application/json", "jsonl": "application/x-ndjson", "csv": "text/csv",
}
REQUEST_TIMEOUT_S = 15
UPLOAD_TIMEOUT_S = 120
DAILY_LIMIT = 20
WINDOW_S = 24 * 60 * 60
LOCAL_FILE = "feedback.jsonl"
MAX_LOCAL_LINES = 200
REFERENCE = re.compile(r"^FB-[A-Z0-9]{2,16}$")
TOKEN = re.compile(r"^[\x21-\x7e]{8,512}$")
DESCRIPTION = """\
Report a problem or an idea to Ardia's developer: a confusing error, a missing command, output that cost you extra
turns, something slow. Give it a short title and say what you ran, what happened and what you expected.

It goes to the feedback service on ardia.dev (sent even while "Share anonymous crash reports and usage stats" is off:
sending a report is consent for that report) and opens a public GitHub issue with the title and description; files you
attach stay private. Before it leaves, secrets are removed by exact pattern (key=value and key: value secrets, auth
headers, known key formats, JWTs), along with emails, URL logins and queries, card numbers and the name in
/Users/<name>. At most 20 a day are sent. When it can't be sent, it's kept on this Mac and the reason is printed.
"""
EPILOG = """\
Examples:
  ardia feedback --title "snapshot -i hides dialog buttons" "the Save button inside a dialog wasn't listed with a ref"
  ardia feedback --kind slow --title "open takes 9 s" --command "ardia browse open https://example.com" "it used to take 1 s"
  echo "fill on a date input typed into the wrong field" | ardia feedback --title "fill misses date inputs"
  ardia feedback --title "click did nothing" --attach shot.png "the button stayed the same after click @e4"

Attach: .mp4 (one recording, 100 MB), .json.gz (one trace, 50 MB), .ips crash reports, and .png .jpg .jpeg .gif .webp
.heic .mov .txt .log .md .json .jsonl .csv (10 MB each), 10 files at most.
"""


class Refused(Exception):
    pass


@dataclass(frozen=True)
class Attachment:
    path: Path
    name: str
    bytes: int
    type: str

    def wire(self) -> dict:
        return {"name": self.name, "bytes": self.bytes, "type": self.type}


@dataclass(frozen=True)
class Outcome:
    sent: bool
    reason: str = ""
    reference: str | None = None
    name: str | None = None
    issue_url: str | None = None


def add_parser(commands, formatter) -> None:
    parser = commands.add_parser("feedback", help="report a problem or idea to Ardia's developer (agents welcome)", description=DESCRIPTION, epilog=EPILOG, formatter_class=formatter)
    parser.add_argument("text", nargs="*", help="what happened and what you expected; - or nothing reads stdin")
    parser.add_argument("--title", help=f"a short title, 1-{MAX_TITLE} characters (required)")
    parser.add_argument("--kind", choices=KINDS, default="bug", help="bug (default), slow, idea or other")
    parser.add_argument("--attach", action="append", default=[], metavar="FILE", help="attach a file (repeatable)")
    parser.add_argument("--command", dest="about", metavar="CMD", help="the command that misbehaved")
    parser.add_argument("--data-dir", help="the Ardia data dir whose install id and session apply")


def read_text(words: list[str], stdin) -> str:
    if words and words != ["-"]:
        return " ".join(words)
    if stdin is None or (not words and stdin.isatty()):
        return ""
    return stdin.buffer.read(MAX_STDIN_BYTES).decode("utf-8", "replace") if hasattr(stdin, "buffer") else stdin.read(MAX_STDIN_BYTES)


def clean_title(title: str | None) -> str:
    from ardia_cli import telemetry_scrub

    title = " ".join((title or "").split())
    if not title:
        raise Refused(f'ardia feedback needs --title "…" (1-{MAX_TITLE} characters)')
    if len(title) > MAX_TITLE:
        raise Refused(f"the title is {len(title)} characters; keep it to {MAX_TITLE}")
    clean = telemetry_scrub.scrub(title)
    if telemetry_scrub.only_placeholders(clean):
        raise Refused("nothing is left of the title once secrets and personal data are removed; describe the problem instead")
    return clean


def clean_description(text: str) -> tuple[str, bool]:
    from ardia_cli import telemetry_scrub

    if not text.strip():
        raise Refused('ardia feedback needs a description: ardia feedback --title "…" "what happened, what you expected"')
    clean, truncated = telemetry_scrub.free_text(text.strip(), MAX_DESCRIPTION)
    if telemetry_scrub.only_placeholders(clean):
        raise Refused("nothing is left of the description once secrets and personal data are removed; describe what happened without them")
    return clean, truncated


def attachment_kind(path: Path, counts: dict) -> tuple[str, int, str]:
    lower = path.name.lower()
    if lower.endswith(".mp4"):
        counts["mp4"] = counts.get("mp4", 0) + 1
        if counts["mp4"] > 1:
            raise Refused("only one .mp4 recording can be attached")
        return RECORDING
    if lower.endswith(".json.gz"):
        counts["trace"] = counts.get("trace", 0) + 1
        if counts["trace"] > 1:
            raise Refused("only one .json.gz trace can be attached")
        return TRACE
    if lower.endswith(".ips"):
        counts["ips"] = counts.get("ips", 0) + 1
        return f"crash-{counts['ips']}.ips", OTHER_FILE_BYTES, "text/plain"
    extension = lower.rsplit(".", 1)[-1] if "." in lower else ""
    if extension not in OTHER_TYPES:
        raise Refused(f"{path.name}: can't attach this kind of file (see ardia feedback --help for the kinds)")
    counts["other"] = counts.get("other", 0) + 1
    return f"attachment-{counts['other']}.{extension}", OTHER_FILE_BYTES, OTHER_TYPES[extension]


def attachments(files: list[str]) -> list[Attachment]:
    import stat

    if len(files) > MAX_ATTACHMENTS:
        raise Refused(f"at most {MAX_ATTACHMENTS} files can be attached")
    counts: dict = {}
    found = []
    for file in files:
        path = Path(file).expanduser()
        try:
            info = os.stat(path)
        except OSError as error:
            raise Refused(f"{file}: {error.strerror or 'can not be read'}") from None
        if not stat.S_ISREG(info.st_mode):
            raise Refused(f"{file}: not a file")
        name, cap, kind = attachment_kind(path, counts)
        if info.st_size == 0:
            raise Refused(f"{file}: the file is empty")
        if info.st_size > cap:
            raise Refused(f"{file}: {info.st_size / MB:.1f} MB is over the {cap // MB} MB limit for this kind of file")
        found.append(Attachment(path.resolve(), name, info.st_size, kind))
    return found


def feedback_url(env) -> tuple[str | None, str]:
    from ardia_cli import telemetry

    override = env.get(TEST_URL_ENV)
    if override:
        if telemetry.LOOPBACK_URL.match(override if "/" in override.split("://", 1)[-1] else override + "/"):
            from urllib.parse import urlsplit

            base = override.rstrip("/")
            return (base + "/api/feedback" if urlsplit(base).path in ("", "/") else base), ""
        return None, f"{TEST_URL_ENV} isn't a loopback http:// URL"
    if telemetry.is_dev_build():
        return None, f"this ardia is a checkout build ({__version__}), which never sends to ardia.dev; set {TEST_URL_ENV} to a local service"
    return FEEDBACK_URL, ""


def blocked_reason(env) -> str | None:
    from ardia_cli import telemetry

    do_not_track = (env.get("DO_NOT_TRACK") or "").strip()
    if do_not_track.lower() not in ("", "0", "false"):
        return f"DO_NOT_TRACK={do_not_track} is set"
    sharing = (env.get("ARDIA_TELEMETRY") or "").strip()
    if sharing.lower() in telemetry.OFF_VALUES:
        return f"ARDIA_TELEMETRY={sharing} is set"
    for name in telemetry.TEST_ENDPOINT_ENV:
        if env.get(name):
            return f"{name} points ardia at a test browser"
    return None


def identity(doc: dict | None) -> tuple[str, bool]:
    from ardia_cli import telemetry

    install_id = telemetry.sharing_id(doc)
    return (install_id, True) if install_id else (str(uuid.uuid4()), False)


def body(kind: str, title: str, description: str, truncated: bool, about: str | None, found: list[Attachment], doc: dict | None, install_id: str, environment: str, home) -> dict:
    from ardia_cli import caller, telemetry, telemetry_scrub, usage

    info = telemetry.system_info()
    try:
        agent = caller.current().name
    except Exception:
        agent = caller.FALLBACK
    about_clean = telemetry_scrub.free_text(about, MAX_COMMAND)[0] if about else None
    app_version = doc.get("lastVersion") if doc else None
    app_build = doc.get("lastBuild") if doc else None
    return {
        "kind": kind,
        "title": title,
        "description": description,
        "source": "cli",
        "install_id": install_id,
        "session_id": telemetry.session_id(doc),
        "app_version": app_version if isinstance(app_version, str) else None,
        "app_build": str(app_build) if isinstance(app_build, (str, int)) and not isinstance(app_build, bool) else None,
        "channel": doc.get("channel") if doc and isinstance(doc.get("channel"), str) else None,
        "os_version": info["os_version"],
        "arch": info["arch"],
        "cli_version": __version__,
        "watch_days": 0,
        "diagnostics": {
            "agent": agent,
            "about_command": about_clean or None,
            "recent_commands": usage.recent_commands(home) if home is not None else [],
            "description_truncated": truncated,
            "environment": environment,
            "python_version": info["python"],
        },
        "attachments": [item.wire() for item in found],
    }


def request(method: str, url: str, data, headers: dict, timeout: float) -> tuple[int, dict, str]:
    import urllib.error
    import urllib.request

    from ardia_cli import telemetry

    headers = {telemetry.INGEST_KEY_HEADER: telemetry.CLI_INGEST_KEY, **headers}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=timeout) as response:
            raw = response.read(64 * 1024)
            status = response.status
    except urllib.error.HTTPError as error:
        with error:
            return error.code, {}, service_refusal(error.code, error.read(8192))
    except (urllib.error.URLError, OSError) as error:
        reason = getattr(error, "reason", None) or error
        return 0, {}, f"the network failed ({reason})"
    try:
        answer = json.loads(raw) if raw else {}
    except ValueError:
        answer = {}
    return status, answer if isinstance(answer, dict) else {}, ""


def service_refusal(status: int, raw: bytes) -> str:
    from ardia_cli import telemetry_scrub

    try:
        message = json.loads(raw).get("message")
    except (ValueError, AttributeError):
        message = None
    if isinstance(message, str) and message.strip():
        return f"the feedback service answered HTTP {status}: {telemetry_scrub.free_text(message, 200)[0]}"
    return f"the feedback service answered HTTP {status}"


def post_json(url: str, payload: dict, token: str | None = None) -> tuple[int, dict, str]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return request("POST", url, json.dumps(payload, ensure_ascii=False).encode(), headers, REQUEST_TIMEOUT_S)


def upload(url: str, item: Attachment, token: str) -> tuple[int, str]:
    from urllib.parse import quote

    with open(item.path, "rb") as handle:
        headers = {"Authorization": f"Bearer {token}", "Content-Type": item.type, "Content-Length": str(item.bytes)}
        status, _, failure = request("PUT", f"{url}/files/{quote(item.name)}", handle, headers, UPLOAD_TIMEOUT_S)
    return status, failure


def issue_link(value, base: str) -> str | None:
    from ardia_cli import telemetry

    if not isinstance(value, str) or len(value) > 2048:
        return None
    if value.startswith("https://") or (value.startswith("file://") and telemetry.LOOPBACK_URL.match(base + "/")):
        return value
    return None


def submit(base: str, payload: dict, found: list[Attachment]) -> Outcome:
    from urllib.parse import quote

    status, created, failure = post_json(base, payload)
    if not 200 <= status < 300:
        return Outcome(False, failure or f"the feedback service answered HTTP {status}")
    reference, token = created.get("id"), created.get("upload_token")
    if not isinstance(reference, str) or not REFERENCE.match(reference) or not isinstance(token, str) or not TOKEN.match(token):
        return Outcome(False, "the feedback service gave an answer ardia couldn't read")
    item_url = f"{base}/{quote(reference)}"
    for item in found:
        status, failure = upload(item_url, item, token)
        if not 200 <= status < 300:
            return Outcome(False, f"uploading {item.path.name} failed: {failure or f'HTTP {status}'}", reference)
    status, done, failure = post_json(f"{item_url}/complete", {}, token)
    if not 200 <= status < 300:
        return Outcome(False, f"finishing {reference} failed: {failure or f'HTTP {status}'}", reference)
    name = done.get("name") if isinstance(done.get("name"), str) else created.get("name")
    return Outcome(True, reference=reference, name=name if isinstance(name, str) else None, issue_url=issue_link(done.get("issue_url"), base))


def save_locally(home: Path, entry: dict) -> Path:
    from ardia_cli import usage
    from ardia_cli.browse import paths

    dir_fd = usage.open_folder(home)
    try:
        lines = []
        try:
            fd = paths.open_private_file(LOCAL_FILE, dir_fd, os.O_RDONLY)
            try:
                lines = os.read(fd, MAX_LOCAL_LINES * 8192).splitlines(keepends=True)
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


def keep(home: Path | None, entry: dict, reason: str) -> int:
    from ardia_cli.browse import paths

    if home is None:
        print(f"Not sent: {reason}. It wasn't saved either: a checkout build keeps notes only with ARDIA_CLI_HOME set.")
        return 1
    try:
        path = save_locally(home, {**entry, "reason": reason})
    except (OSError, paths.PathError) as error:
        print(f"Not sent: {reason}. It couldn't be saved on this Mac either ({error}).")
        return 1
    print(f"Not sent: {reason}. It's kept on this Mac: {path}")
    return 1


def release_slot(home: Path, digest: str) -> None:
    from ardia_cli import usage

    try:
        usage.release_feedback_slot(home, digest)
    except Exception:
        pass


def run(args, stdin=None, env=None) -> int:
    from ardia_cli import telemetry, usage
    from ardia_cli.endpoint import data_root

    env = os.environ if env is None else env
    text = read_text(args.text, sys.stdin if stdin is None else stdin)
    try:
        title = clean_title(args.title)
        description, truncated = clean_description(text)
        found = attachments(args.attach)
    except Refused as refused:
        sys.stderr.write(f"ardia feedback: {refused}\n")
        return 2
    home = usage.recording_home(env)
    explicit = args.data_dir or env.get("ARDIA_DATA_DIR")
    root = Path(os.path.abspath(data_root(explicit))) if explicit or not telemetry.is_dev_build() else None
    doc = telemetry.read_consent(root) if root is not None else None
    install_id, sharing = identity(doc)
    environment = telemetry.environment_for(root) if root is not None else "dev"
    payload = body(args.kind, title, description, truncated, args.about, found, doc, install_id, environment, home)
    entry = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **{key: payload[key] for key in ("kind", "title", "description", "cli_version")},
        "about_command": payload["diagnostics"]["about_command"],
        "attachments": [str(item.path) for item in found],
    }
    base, url_problem = feedback_url(env)
    reason = blocked_reason(env) or url_problem
    if reason or base is None:
        return keep(home, entry, reason)
    digest = hashlib.sha256(f"{args.kind}\0{title}\0{description}".encode()).hexdigest()[:16]
    slot = usage.take_feedback_slot(home, digest, DAILY_LIMIT, WINDOW_S, time.time()) if home is not None else "ok"
    if slot == "duplicate":
        print("Not sent again: the same report already went out in the last day.")
        return 0
    if slot == "limited":
        return keep(home, entry, f"{DAILY_LIMIT} reports already went out in the last day")
    if slot != "ok":
        return keep(home, entry, "another ardia was updating the report count (try again)")
    outcome = submit(base, payload, found)
    if not outcome.sent:
        if home is not None:
            release_slot(home, digest)
        return keep(home, {**entry, "reference": outcome.reference} if outcome.reference else entry, outcome.reason)
    print(f"Sent. Reference {outcome.reference}.")
    print(f"Issue: {outcome.issue_url}" if outcome.issue_url else "No public issue was opened for it; the developer still has it.")
    if outcome.name:
        print(f"You appear to us as {outcome.name}{'' if sharing else ' (a one-time id: sharing is off)'}.")
    return 0
