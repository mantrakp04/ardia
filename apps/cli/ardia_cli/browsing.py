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

from ardia_cli import identity
from ardia_cli.endpoint import EndpointError, require_control

DEFAULT_PROFILE_ID = "default"
WEBKIT_EPOCH_OFFSET = 11644473600
SUBFRAME_TRANSITIONS = (3, 4)
BUSY_TIMEOUT_MS = 500
COPY_ATTEMPTS = 3
HISTORY_BUDGET = 20
MAX_ROWS = 200_000
PROGRESS_STEPS = 1000
EXIT_JOIN = 1.0
_work_dirs: set[str] = set()
_workers: set = set()
_state = threading.Lock()
_closing = False
MAX_SESSION_BYTES = 256 * 1024 * 1024
PRIVATE_PREFIXES = ("incognito", "guest", "private", "System Profile", "Guest Profile")
NO_DATA_DIR = (
    "{name}() needs Ardia's data dir, and --port/--ws/$ARDIA_CDP_URL don't say where it is: "
    "pass --data-dir DIR or set $ARDIA_DATA_DIR"
)


class BrowsingDataError(RuntimeError):
    __module__ = "__main__"


class OutOfTime(BrowsingDataError):
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
        workers = list(_workers)
    deadline = time.monotonic() + EXIT_JOIN
    for worker in workers:
        worker.join(max(0.0, deadline - time.monotonic()))
    with _state:
        leftovers = list(_work_dirs)
    for work in leftovers:
        shutil.rmtree(work, ignore_errors=True)


def run_bounded(function, *args, budget: float = HISTORY_BUDGET, **kwargs):
    import asyncio

    loop = asyncio.get_running_loop()
    future = loop.create_future()
    deadline = time.monotonic() + budget

    def settle(outcome, error):
        if future.done():
            return
        if error is not None:
            future.set_exception(error)
        else:
            future.set_result(outcome)

    def work():
        try:
            outcome, error = function(*args, deadline=deadline, **kwargs), None
        except BaseException as caught:
            outcome, error = None, caught
        finally:
            with _state:
                _workers.discard(threading.current_thread())
        try:
            loop.call_soon_threadsafe(settle, outcome, error)
        except RuntimeError:
            pass

    worker = threading.Thread(target=work, name=f"ardia-{function.__name__}", daemon=True)
    with _state:
        if _closing:
            raise OutOfTime(f"{function.__name__}() stopped: the command is exiting")
        _workers.add(worker)
    worker.start()

    async def wait():
        try:
            return await asyncio.wait_for(asyncio.shield(future), budget + 1)
        except asyncio.TimeoutError:
            raise OutOfTime(f"{function.__name__}() ran out of time") from None

    return wait()


def checked_root(root: Path | None, name: str) -> Path:
    if root is None:
        raise BrowsingDataError(NO_DATA_DIR.format(name=name))
    try:
        require_control(root)
    except EndpointError as error:
        raise BrowsingDataError(str(error)) from None
    return root


def read_session(root: Path, deadline: float) -> dict:
    path = root / "session.json"
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return {}
    except OSError as error:
        raise BrowsingDataError(f"can't read {path} ({error.strerror})") from None
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise BrowsingDataError(f"{path} isn't a regular file")
        chunks = []
        size = 0
        while chunk := os.read(fd, 1024 * 1024):
            out_of_time(deadline, "reading session.json")
            size += len(chunk)
            if size > MAX_SESSION_BYTES:
                raise BrowsingDataError(f"{path} is too big")
            chunks.append(chunk)
        raw = b"".join(chunks)
    finally:
        os.close(fd)
    try:
        session = json.loads(raw)
    except ValueError:
        raise BrowsingDataError(f"{path} isn't valid JSON ({identity.PRODUCT} may be writing it; try again)") from None
    return session if isinstance(session, dict) and session.get("version") == 2 else {}


def is_private(profile_id: str) -> bool:
    return not isinstance(profile_id, str) or profile_id.startswith("incognito:")


def profile_names(session: dict) -> dict[str, str]:
    profiles = session.get("profiles") or {}
    return {pid: (p.get("name") or pid) for pid, p in profiles.items() if isinstance(p, dict) and not is_private(pid)}


def pinned(root: Path | None, deadline: float | None = None) -> list[dict]:
    deadline = deadline if deadline is not None else time.monotonic() + HISTORY_BUDGET
    root = checked_root(root, "pinned")
    session = read_session(root, deadline)
    names = profile_names(session)
    order = [pid for pid in session.get("profileOrder") or [] if pid in names] + [pid for pid in names if pid not in (session.get("profileOrder") or [])]
    tabs = {t["id"]: t for t in session.get("tabs") or [] if isinstance(t, dict) and "id" in t}
    groups = [g for g in session.get("groups") or [] if isinstance(g, dict)]
    pinned_groups = {tab_id: g for g in groups if g.get("pinned") for tab_id in g.get("tabIds") or []}
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

    windows = [w for w in session.get("windows") or [] if isinstance(w, dict) and not w.get("incognito")]
    for window in windows:
        for tab_id in window.get("tabIds") or []:
            tab = tabs.get(tab_id)
            if not tab:
                continue
            key = tab.get("pinKey") or tab_id
            group = pinned_groups.get(tab_id)
            if tab.get("pinned"):
                add(tab.get("profileId", ""), key, tab, "favorite", None, False)
            elif group:
                add(tab.get("profileId", ""), key, tab, "pinned", group.get("name") or None, False)
    for profile_id, parked in (session.get("parkedPins") or {}).items():
        if not isinstance(parked, dict):
            continue
        folders = {g.get("id"): g.get("name") for g in parked.get("groups") or [] if isinstance(g, dict)}
        for tab in parked.get("tabs") or []:
            if not isinstance(tab, dict):
                continue
            group_id = tab.get("groupId")
            kind = "pinned" if group_id else "favorite"
            add(tab.get("profileId") or profile_id, tab.get("id", ""), tab, kind, folders.get(group_id) or None if group_id else None, True)
    return [row for _, row in sorted(rows, key=lambda item: item[0])]


def profile_dirs(root: Path, session: dict) -> list[tuple[str, Path]]:
    chromium = root / "Chromium"
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
        if name != "Default" and not name.startswith("Profile "):
            continue
        suffix = name[len("Profile ") :] if name.startswith("Profile ") else ""
        if any(suffix.lower().startswith(p.lower()) for p in PRIVATE_PREFIXES) or "@" in suffix or ":" in suffix:
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
            raise sqlite3.OperationalError(f"{identity.PRODUCT} holds History locked")

    out_of_time(deadline, "history()")
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


def history(root: Path | None, days: float = 1, limit: int | None = 200, profile: str | None = None, domains: bool = False, deadline: float | None = None) -> list[dict]:
    deadline = deadline if deadline is not None else time.monotonic() + HISTORY_BUDGET
    root = checked_root(root, "history")
    if not isinstance(days, (int, float)) or days <= 0:
        raise BrowsingDataError("days must be a positive number")
    if limit is not None and (not isinstance(limit, int) or limit <= 0):
        raise BrowsingDataError("limit must be a positive integer or None")
    session = read_session(root, deadline)
    profiles = pick_profiles(profile_dirs(root, session), profile)
    cutoff = int((time.time() - days * 86400 + WEBKIT_EPOCH_OFFSET) * 1_000_000)
    rows: list[dict] = []
    for label, folder in profiles:
        out_of_time(deadline, "history()")
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
                    out_of_time(deadline, "history()")
                    found.extend(batch)
                    if len(found) >= MAX_ROWS:
                        break
            except sqlite3.OperationalError as error:
                if time.monotonic() > deadline:
                    raise OutOfTime("history() ran out of time") from None
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
