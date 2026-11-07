import fcntl
import os
import re
import stat
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

DIR_NAME = "Notes"
MAX_NOTE = 8 * 1024
HEADER_LIMIT = 1000
ACTIONS = ("get", "set", "append", "list", "rm")
LABEL = r"[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?"
HOST = re.compile(rf"^(?:{LABEL}(?:\.{LABEL})*|\[[0-9a-f:.]+\])(?::\d{{1,5}})?$")
DEFAULT_PORTS = {"http": 80, "https": 443}
USAGE = "Usage: ardia notes [get|set|append|list|rm] [SITE] [TEXT|-]"


@dataclass
class Request:
    action: str
    site: str | None
    text: str | None = None


def browse_errors():
    from ardia_cli.browse.errors import BrowseError, Usage

    return BrowseError, Usage


def site_of(value: str) -> str:
    BrowseError, _ = browse_errors()
    raw = value.strip()
    if "://" in raw:
        try:
            parts = urlsplit(raw)
            host, port = parts.hostname or "", parts.port
        except ValueError:
            raise BrowseError(f"{value!r} isn't a URL or host[:port]", code="bad_site") from None
        if parts.scheme in DEFAULT_PORTS and port == DEFAULT_PORTS[parts.scheme]:
            port = None
    else:
        head = raw.split("/", 1)[0]
        match = re.fullmatch(r"(\[[^\]]*\]|[^:]*)(?::(\d{1,5}))?", head)
        if not match:
            raise BrowseError(f"{value!r} isn't a host or host:port", code="bad_site")
        host, port = match.group(1).strip("[]"), int(match.group(2)) if match.group(2) else None
    host = host.lower().rstrip(".")
    try:
        host = host.encode("idna").decode("ascii") if not host.isascii() else host
    except UnicodeError:
        raise BrowseError(f"{value!r} has a host name that can't be encoded", code="bad_site") from None
    if ":" in host:
        host = f"[{host}]"
    site = host + (f":{port}" if port is not None else "")
    if not host or not HOST.match(site) or (port is not None and not 0 < port < 65536):
        raise BrowseError(f"{value!r} isn't a host or host:port", code="bad_site")
    return site


def page_site(url: str | None) -> str | None:
    if not url or not url.lower().startswith(("http://", "https://")):
        return None
    try:
        return site_of(url)
    except Exception:
        return None


def looks_like_site(value: str) -> bool:
    if "://" not in value and not re.search(r"[.:]|^localhost$", value.split("/", 1)[0]):
        return False
    if any(char.isspace() for char in value):
        return False
    try:
        site_of(value)
    except Exception:
        return False
    return True


def parse_args(args: list[str]) -> Request:
    _, Usage = browse_errors()
    positional = [arg for arg in args if arg != "--json"]
    if any(arg.startswith("--") for arg in positional):
        raise Usage(USAGE)
    action = positional.pop(0) if positional and positional[0] in ACTIONS else "get"
    if action == "list":
        if positional:
            raise Usage("Usage: ardia notes list")
        return Request(action, None)
    if action in ("get", "rm"):
        if len(positional) > 1:
            raise Usage(f"Usage: ardia notes {action} [SITE]")
        return Request(action, site_of(positional[0]) if positional else None)
    if not positional:
        raise Usage(f"Usage: ardia notes {action} [SITE] TEXT|-  (- reads stdin)")
    if len(positional) >= 2 and looks_like_site(positional[0]):
        return Request(action, site_of(positional[0]), " ".join(positional[1:]))
    return Request(action, None, " ".join(positional))


def open_folder(root: Path, create: bool) -> int | None:
    from ardia_cli.browse import paths

    try:
        return paths.open_private(root, DIR_NAME, create=create)
    except FileNotFoundError:
        return None
    except paths.PathError as error:
        if not create and "doesn't exist" in str(error):
            return None
        raise


def file_name(site: str) -> str:
    return site + ".md"


def read_note(folder: int, site: str) -> str | None:
    from ardia_cli.browse import paths

    try:
        fd = paths.open_private_file(file_name(site), folder, os.O_RDONLY | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    try:
        raw = os.read(fd, MAX_NOTE + 1)
    finally:
        os.close(fd)
    return raw[:MAX_NOTE].decode("utf-8", errors="replace")


def write_note(folder: int, site: str, text: str) -> int:
    from ardia_cli.browse import paths

    BrowseError, _ = browse_errors()
    data = text.encode("utf-8")
    if len(data) > MAX_NOTE:
        raise BrowseError(
            f"Notes for {site} would be {len(data):,} bytes; the limit is {MAX_NOTE // 1024} KB per site. "
            f"Shorten them (`ardia notes set {site} -` replaces them from stdin)",
            data={"site": site, "bytes": len(data), "limit": MAX_NOTE}, code="notes_too_large",
        )
    name = file_name(site)
    temp = f".{name}.{os.getpid()}.tmp"
    fd = paths.open_private_file(temp, folder, os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
    try:
        os.write(fd, data)
    finally:
        os.close(fd)
    os.rename(temp, name, src_dir_fd=folder, dst_dir_fd=folder)
    return len(data)


def load(root: Path, site: str) -> str | None:
    folder = open_folder(root, create=False)
    if folder is None:
        return None
    try:
        return read_note(folder, site)
    finally:
        os.close(folder)


def header(root: Path, url: str | None) -> tuple[str | None, str | None]:
    site = page_site(url)
    if site is None:
        return None, None
    try:
        text = load(root, site)
    except Exception:
        return site, None
    text = (text or "").strip()
    if not text:
        return site, None
    shown = text if len(text) <= HEADER_LIMIT else text[:HEADER_LIMIT] + f"… ({len(text) - HEADER_LIMIT} more characters: `ardia notes get {site}`)"
    lines = shown.splitlines() or [""]
    rendered = [f"# notes for {site} (ardia notes): {lines[0]}"] + [f"# {line}" for line in lines[1:]]
    return site, "\n".join(rendered)


def listing(folder: int) -> list[dict]:
    rows = []
    for entry in sorted(os.listdir(folder)):
        if entry.startswith(".") or not entry.endswith(".md"):
            continue
        try:
            info = os.stat(entry, dir_fd=folder, follow_symlinks=False)
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(info.st_mode):
            continue
        rows.append({"site": entry[:-3], "bytes": info.st_size, "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(info.st_mtime))})
    return rows


def run_request(root: Path, request: Request, page_url: str | None):
    from ardia_cli.browse.commands import Result

    BrowseError, _ = browse_errors()
    if request.action == "list":
        folder = open_folder(root, create=False)
        rows = [] if folder is None else listing_closing(folder)
        lines = [f"{row['site']}  {row['bytes']} bytes  {row['modified']}" for row in rows]
        return Result({"notes": rows}, "\n".join(lines) or "No site notes yet (`ardia notes set <site> <text>`)")
    site = request.site or page_site(page_url)
    if site is None:
        raise BrowseError(
            f"The session's tab isn't a web page ({page_url or 'no URL'}), so there's no site to default to; name one: `ardia notes {request.action} <host[:port]> …`",
            code="bad_site",
        )
    if request.action == "get":
        text = load(root, site)
        return Result({"site": site, "notes": text}, text.rstrip("\n") if text else f"(no notes for {site})")
    folder = open_folder(root, create=request.action != "rm")
    if folder is None:
        return Result({"site": site, "removed": False}, f"No notes for {site}")
    try:
        fcntl.flock(folder, fcntl.LOCK_EX)
        if request.action == "rm":
            from ardia_cli.browse import paths

            existed = read_note(folder, site) is not None
            paths.unlink_quietly(file_name(site), folder)
            return Result({"site": site, "removed": existed}, f"✓ Removed the notes for {site}" if existed else f"No notes for {site}")
        text = request.text or ""
        if request.action == "append":
            current = read_note(folder, site) or ""
            text = current + ("\n" if current and not current.endswith("\n") else "") + text
        if text and not text.endswith("\n"):
            text += "\n"
        size = write_note(folder, site, text)
        verb = "Saved" if request.action == "set" else "Added to"
        return Result({"site": site, "bytes": size}, f"✓ {verb} the notes for {site} ({size:,} of {MAX_NOTE:,} bytes)")
    finally:
        os.close(folder)


def listing_closing(folder: int) -> list[dict]:
    try:
        return listing(folder)
    finally:
        os.close(folder)


def main(argv: list[str]) -> int:
    from ardia_cli.browse import cli

    return cli.main(["notes", *argv])
