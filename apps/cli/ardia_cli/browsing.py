import atexit
import json
import os
import shutil
import sqlite3
import stat
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, urlsplit

from ardia_cli import endpoint
from ardia_cli.endpoint import EndpointError, chromium_dir, require_control

DEFAULT_PROFILE_ID = "default"
WEBKIT_EPOCH_OFFSET = 11644473600
SUBFRAME_TRANSITIONS = (3, 4)
BUSY_TIMEOUT_MS = 500
COPY_ATTEMPTS = 3
HISTORY_BUDGET = 20
MAX_ROWS = 200_000
PROGRESS_STEPS = 1000
_work_dirs: set[str] = set()
_state = threading.Lock()
_closing = False
MAX_SESSION_BYTES = 256 * 1024 * 1024
MAX_LINUX_SESSION_BYTES = 8 * 1024 * 1024
MAX_LOCAL_STATE_BYTES = 64 * 1024 * 1024
LINUX_SESSION = ("Ardia", "linux-session.json")
LOCAL_STATE = "Local State"
LEGACY_PIN_KEYS = ("pinned", "pinnedAsRow", "tileFolder")
PRIVATE_PREFIXES = ("incognito", "guest", "private", "System Profile", "Guest Profile")


class BrowsingDataError(RuntimeError):
    pass


class OutOfTime(BrowsingDataError):
    pass


class NotRunning(BrowsingDataError):
    pass


def out_of_time(deadline: float, what: str) -> None:
    if _closing:
        raise OutOfTime(f"{what} stopped: the command is exiting")
    if time.monotonic() > deadline:
        raise OutOfTime(f"{what} ran out of time")


def connect(target, deadline: float, **kwargs) -> sqlite3.Connection:
    connection = sqlite3.connect(target, **kwargs)
    connection.set_progress_handler(lambda: 1 if _closing or time.monotonic() > deadline else 0, PROGRESS_STEPS)
    return connection


def new_work_dir() -> str:
    with _state:
        if _closing:
            raise OutOfTime("stopped: the command is exiting")
        work = tempfile.mkdtemp(prefix="ardia-history-")
        _work_dirs.add(work)
    return work


def drop_work_dir(work: str) -> None:
    shutil.rmtree(work, ignore_errors=True)
    with _state:
        _work_dirs.discard(work)


@atexit.register
def _shut_down() -> None:
    global _closing
    with _state:
        _closing = True
        leftovers = list(_work_dirs)
    for work in leftovers:
        shutil.rmtree(work, ignore_errors=True)


def checked_root(root: Path) -> Path:
    try:
        require_control(root)
    except EndpointError as error:
        raise NotRunning(str(error)) from None
    return root


def open_beneath(root: Path, parts: tuple[str, ...]) -> int | None:
    path = root.joinpath(*parts)
    try:
        folder = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    except FileNotFoundError:
        return None
    except OSError as error:
        raise BrowsingDataError(f"can't read {path} ({error.strerror})") from None
    try:
        for part in parts[:-1]:
            inner = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=folder)
            os.close(folder)
            folder = inner
        return os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=folder)
    except FileNotFoundError:
        return None
    except OSError as error:
        raise BrowsingDataError(f"can't read {path} ({error.strerror})") from None
    finally:
        os.close(folder)


def read_json(root: Path, parts: tuple[str, ...], deadline: float, limit: int):
    path = root.joinpath(*parts)
    fd = open_beneath(root, parts)
    if fd is None:
        return None
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise BrowsingDataError(f"{path} isn't a regular file")
        chunks = []
        size = 0
        while chunk := os.read(fd, 1024 * 1024):
            out_of_time(deadline, f"reading {parts[-1]}")
            size += len(chunk)
            if size > limit:
                raise BrowsingDataError(f"{path} is too big")
            chunks.append(chunk)
        raw = b"".join(chunks)
    finally:
        os.close(fd)
    try:
        return json.loads(raw)
    except ValueError:
        raise BrowsingDataError(f"{path} isn't valid JSON (Ardia may be writing it; try again)") from None


def regular_profile_folder(name) -> bool:
    if not isinstance(name, str) or "/" in name or "\0" in name:
        return False
    if name == "Default":
        return True
    if not name.startswith("Profile ") or name == "Profile ":
        return False
    suffix = name[len("Profile ") :]
    return not (any(suffix.lower().startswith(p.lower()) for p in PRIVATE_PREFIXES) or "@" in suffix or ":" in suffix)


def app_profile_folder(root: Path, deadline: float) -> str:
    try:
        local_state = read_json(root, (LOCAL_STATE,), deadline, MAX_LOCAL_STATE_BYTES)
    except OutOfTime:
        raise
    except BrowsingDataError:
        local_state = None
    profile = local_state.get("profile") if isinstance(local_state, dict) else None
    last_used = profile.get("last_used") if isinstance(profile, dict) else None
    return last_used if regular_profile_folder(last_used) else "Default"


def read_session(root: Path, deadline: float, linux: bool | None = None) -> dict:
    if endpoint.LINUX if linux is None else linux:
        session = read_json(root, (app_profile_folder(root, deadline), *LINUX_SESSION), deadline, MAX_LINUX_SESSION_BYTES)
        return session if isinstance(session, dict) else {}
    session = read_json(root, ("session.json",), deadline, MAX_SESSION_BYTES)
    if not isinstance(session, dict):
        return {}
    version = session.get("version")
    return session if isinstance(version, int) and not isinstance(version, bool) and version >= 2 else {}


def is_private(profile_id: str) -> bool:
    return not isinstance(profile_id, str) or profile_id.startswith("incognito:")


def profile_names(session: dict) -> dict[str, str]:
    profiles = session.get("profiles")
    if not isinstance(profiles, dict):
        return {}
    return {pid: (p.get("name") or pid) for pid, p in profiles.items() if isinstance(p, dict) and not is_private(pid)}


def entries(value) -> list[dict]:
    if isinstance(value, dict):
        return [{"id": key, **item} if "id" not in item else item for key, item in value.items() if isinstance(item, dict)]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def strings(value) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def folder_name(folder) -> str | None:
    return folder.get("name") or None if isinstance(folder, dict) and isinstance(folder.get("name"), str) else None


def pin_of(tab: dict) -> tuple[str, str | None] | None:
    if any(key in tab for key in LEGACY_PIN_KEYS) or "pin" not in tab:
        if tab.get("pinned") is not True:
            return None
        return ("pinned", None) if tab.get("pinnedAsRow") is True else ("favorite", folder_name(tab.get("tileFolder")))
    pin = tab.get("pin")
    if not isinstance(pin, dict):
        return None
    if pin.get("as") == "row":
        return "pinned", None
    if pin.get("as") == "tile":
        return "favorite", folder_name(pin.get("folder"))
    return None


def pinned_group_of(groups: list[dict]) -> dict[str, dict]:
    by_id = {g["id"]: g for g in groups if isinstance(g.get("id"), str)}

    def depth(group: dict) -> int:
        seen = set()
        while isinstance(group.get("parentId"), str) and group["parentId"] in by_id and group["parentId"] not in seen:
            seen.add(group["parentId"])
            group = by_id[group["parentId"]]
        return len(seen)

    found: dict[str, dict] = {}
    for group in sorted((g for g in groups if g.get("pinned") is True), key=depth):
        for tab_id in strings(group.get("tabIds")):
            found[tab_id] = group
    return found


def ordered_windows(session: dict) -> list[dict]:
    windows = [w for w in entries(session.get("windows")) if not w.get("incognito") and w.get("kind", "main") == "main"]
    order = {wid: index for index, wid in enumerate(strings(session.get("windowOrder")))}
    return sorted(windows, key=lambda w: order.get(w.get("id"), len(order)))


def pinned(root: Path | None, deadline: float | None = None) -> list[dict]:
    deadline = deadline if deadline is not None else time.monotonic() + HISTORY_BUDGET
    root = checked_root(root)
    session = read_session(root, deadline)
    names = profile_names(session)
    saved_order = strings(session.get("profileOrder"))
    order = [pid for pid in saved_order if pid in names] + [pid for pid in names if pid not in saved_order]
    tabs = {t["id"]: t for t in entries(session.get("tabs")) if isinstance(t.get("id"), str)}
    group_of = pinned_group_of(entries(session.get("groups")))
    seen: set[tuple[str, str]] = set()
    rows: list[tuple[int, dict]] = []

    def add(profile_id: str, key: str, tab: dict, kind: str, folder: str | None, parked: bool):
        if is_private(profile_id) or profile_id not in names or (profile_id, key) in seen:
            return
        seen.add((profile_id, key))
        url = tab.get("url") or tab.get("pinnedUrl") or ""
        rows.append(
            (
                order.index(profile_id),
                {
                    "title": tab.get("customTitle") or tab.get("title") or url,
                    "url": url,
                    "pinned_url": tab.get("pinnedUrl"),
                    "kind": kind,
                    "folder": folder,
                    "profile": names[profile_id],
                    "parked": parked,
                },
            )
        )

    for window in ordered_windows(session):
        for tab_id in strings(window.get("tabIds")):
            tab = tabs.get(tab_id)
            if not tab:
                continue
            key = tab.get("pinKey") or tab_id
            pin = pin_of(tab)
            group = group_of.get(tab_id)
            if group and not (pin and pin[0] == "favorite"):
                pin = ("pinned", group.get("name") or None)
            if pin:
                add(tab.get("profileId", ""), key, tab, pin[0], pin[1], False)
    parked_pins = session.get("parkedPins")
    for profile_id, parked in (parked_pins.items() if isinstance(parked_pins, dict) else ()):
        if not isinstance(parked, dict):
            continue
        folders = {g.get("id"): g.get("name") for g in entries(parked.get("groups"))}
        for tab in entries(parked.get("tabs")):
            group_id = tab.get("groupId")
            kind, folder = ("pinned", folders.get(group_id) or None) if group_id else (pin_of(tab) or ("favorite", None))
            add(tab.get("profileId") or profile_id, tab.get("id", ""), tab, kind, folder, True)
    return [row for _, row in sorted(rows, key=lambda item: item[0])]


def profile_dirs(root: Path, session: dict) -> list[tuple[str, Path]]:
    chromium = chromium_dir(root)
    names = profile_names(session)
    profiles = session.get("profiles") or {}
    by_dir: dict[str, str] = {}
    for pid, name in names.items():
        data_id = (profiles.get(pid) or {}).get("dataId") or pid
        by_dir["Default" if data_id == DEFAULT_PROFILE_ID else f"Profile {data_id}"] = name
    found = []
    try:
        entries = sorted(chromium.iterdir())
    except OSError:
        return found
    for entry in entries:
        name = entry.name
        if not regular_profile_folder(name):
            continue
        if entry.is_symlink() or not entry.is_dir():
            continue
        history = entry / "History"
        if history.is_symlink() or not history.is_file():
            continue
        found.append((by_dir.get(name, name), entry))
    return found


def pick_profiles(found: list[tuple[str, Path]], profile: str | None) -> list[tuple[str, Path]]:
    if profile is None:
        return found
    chosen = [item for item in found if profile in (item[0], item[1].name)]
    if not chosen:
        known = ", ".join(sorted({label for label, _ in found})) or "none"
        raise BrowsingDataError(f"no profile named {profile!r} has history (known: {known})")
    return chosen


def snapshot(history: Path, work: Path, deadline: float) -> tuple[Path, str]:
    target = work / "History"
    uri = f"file:{quote(str(history))}?mode=ro"
    backup_deadline = min(deadline, time.monotonic() + BUSY_TIMEOUT_MS / 1000)

    def give_up(_status, _remaining, _total):
        if _closing or time.monotonic() > backup_deadline:
            raise sqlite3.OperationalError("Ardia holds History locked")

    out_of_time(deadline, "reading history")
    try:
        source = connect(uri, backup_deadline, uri=True, timeout=BUSY_TIMEOUT_MS / 1000)
        try:
            source.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
            copy = connect(target, deadline)
            try:
                source.backup(copy, pages=256, progress=give_up, sleep=0.05)
            finally:
                copy.close()
        finally:
            source.close()
        check(target, deadline)
        return target, "backup"
    except (sqlite3.Error, OSError):
        clear(work)
    last = None
    for attempt in range(COPY_ATTEMPTS):
        if _closing or time.monotonic() >= deadline:
            break
        try:
            copy_file(history, target, deadline)
            for suffix in ("-wal", "-journal"):
                side = Path(str(history) + suffix)
                if side.is_file() and not side.is_symlink():
                    copy_file(side, Path(str(target) + suffix), deadline)
            check(target, deadline)
            return target, "copy"
        except (sqlite3.Error, OSError, OutOfTime) as error:
            last = error
            clear(work)
            if isinstance(error, OutOfTime):
                break
            time.sleep(min(0.2 * (attempt + 1), max(0.0, deadline - time.monotonic())))
    raise BrowsingDataError(f"can't read {history} ({last or 'out of time'})")


def clear(work: Path) -> None:
    for leftover in work.iterdir():
        try:
            leftover.unlink()
        except OSError:
            pass


def copy_file(source: Path, target: Path, deadline: float) -> None:
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise OSError(f"{source} isn't a regular file")
        with open(target, "xb") as writer:
            while chunk := os.read(fd, 1024 * 1024):
                out_of_time(deadline, f"copying {source.name}")
                writer.write(chunk)
    finally:
        os.close(fd)


def check(path: Path, deadline: float) -> None:
    connection = connect(path, deadline)
    try:
        connection.execute("SELECT count(*) FROM urls").fetchone()
        connection.execute("SELECT count(*) FROM visits").fetchone()
    finally:
        connection.close()


def iso(webkit_us: int) -> str:
    return datetime.fromtimestamp(webkit_us / 1_000_000 - WEBKIT_EPOCH_OFFSET).astimezone().isoformat(timespec="seconds")


def history(root: Path, days: float = 1, limit: int | None = 200, profile: str | None = None, domains: bool = False, deadline: float | None = None) -> list[dict]:
    deadline = deadline if deadline is not None else time.monotonic() + HISTORY_BUDGET
    root = checked_root(root)
    if not isinstance(days, (int, float)) or days <= 0:
        raise BrowsingDataError("days must be a positive number")
    if limit is not None and (not isinstance(limit, int) or limit <= 0):
        raise BrowsingDataError("limit must be a positive integer or None")
    session = read_session(root, deadline)
    profiles = pick_profiles(profile_dirs(root, session), profile)
    cutoff = int((time.time() - days * 86400 + WEBKIT_EPOCH_OFFSET) * 1_000_000)
    rows: list[dict] = []
    for label, folder in profiles:
        out_of_time(deadline, "reading history")
        work = new_work_dir()
        try:
            os.chmod(work, 0o700)
            path, _ = snapshot(folder / "History", Path(work), deadline)
            connection = connect(path, deadline)
            try:
                cursor = connection.execute(
                    """
                    SELECT u.url, u.title, COUNT(v.id), MAX(v.visit_time), u.visit_count
                    FROM visits v JOIN urls u ON u.id = v.url
                    WHERE v.visit_time >= ? AND (v.transition & 255) NOT IN (?, ?) AND u.hidden = 0
                      AND (u.url LIKE 'http://%' OR u.url LIKE 'https://%')
                    GROUP BY u.id
                    """,
                    (cutoff, *SUBFRAME_TRANSITIONS),
                )
                found = []
                while batch := cursor.fetchmany(1000):
                    out_of_time(deadline, "reading history")
                    found.extend(batch)
                    if len(found) >= MAX_ROWS:
                        break
            except sqlite3.OperationalError as error:
                if time.monotonic() > deadline:
                    raise OutOfTime("reading history ran out of time") from None
                raise BrowsingDataError(f"can't read {folder.name}'s history ({error})") from None
            finally:
                connection.close()
        finally:
            drop_work_dir(work)
        for url, title, visits, last, total in found:
            rows.append({"url": url, "title": title or "", "visits": visits, "total_visits": total, "last_visit": last, "profile": label})
    rows.sort(key=lambda row: row["last_visit"], reverse=True)
    if domains:
        rolled: dict[tuple[str, str], dict] = {}
        for row in rows:
            host = (urlsplit(row["url"]).hostname or "").removeprefix("www.")
            entry = rolled.setdefault((row["profile"], host), {"domain": host, "visits": 0, "pages": 0, "last_visit": row["last_visit"], "top_title": row["title"], "profile": row["profile"]})
            entry["visits"] += row["visits"]
            entry["pages"] += 1
        result = sorted(rolled.values(), key=lambda entry: (entry["visits"], entry["last_visit"]), reverse=True)
    else:
        result = rows
    if limit is not None:
        result = result[:limit]
    for entry in result:
        entry["last_visit"] = iso(entry["last_visit"])
    return result
