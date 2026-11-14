import asyncio
import contextlib
import fcntl
import hashlib
import json
import os
import re
import secrets
import time
from pathlib import Path

from ardia_cli.browse import paths

LOCK = "tabs.lock"
STALE_FILE_SECONDS = 3 * 24 * 3600
VERSION = 3
MAX_IDS = 1500
MAX_TEMPORARIES = 32
MAX_FILE = 8 * 1024 * 1024
FILE_BUDGET = 1024 * 1024
CLOSE_HOLD = 30.0
APP_TAB = re.compile(r"tab-[A-Za-z0-9_-]{1,80}")
WINDOWS_TIMEOUT = 3.0


def control_socket(state) -> Path | None:
    from ardia_cli import control, endpoint as endpoints

    found = state.endpoint
    source = getattr(found, "source", None)
    if not isinstance(source, str):
        return None
    if getattr(found, "explicit", True) is False:
        return control.announce_path(source)
    root = endpoints.explicit_data_root(state.config.get("data_dir")) if state.config.get("data_dir") else None
    if root is None or not source.startswith(("--port", "ARDIA_PORT")):
        return None
    return root / control.SOCKET_FILE


async def app_windows(state) -> list | None:
    from ardia_cli import control

    path = control_socket(state)
    if path is None:
        return None

    async def ask():
        connection = await control.connect(path, WINDOWS_TIMEOUT, state.caller)
        try:
            return await connection.call("windows", None, WINDOWS_TIMEOUT)
        finally:
            await connection.close()

    try:
        windows = await asyncio.wait_for(ask(), WINDOWS_TIMEOUT * 2)
    except Exception:
        return None
    return windows if isinstance(windows, list) else None


async def app_call(state, method: str, params: dict, timeout: float = WINDOWS_TIMEOUT):
    from ardia_cli import control

    path = control_socket(state)
    if path is None:
        raise control.unreachable("this connection has no control socket")
    connection = await control.connect(path, timeout, state.caller)
    try:
        return await connection.call(method, params, timeout)
    finally:
        await connection.close()


def app_tab_rows(windows) -> list[dict]:
    return [tab for window in windows or [] if isinstance(window, dict) for tab in window.get("tabs") or [] if isinstance(tab, dict) and tab.get("id")]


def reports_targets(rows: list[dict]) -> bool:
    return any("targetId" in row for row in rows)


def pair_by_target(app_rows: list[dict], target_infos: dict) -> dict[str, dict]:
    return {row["targetId"]: {"app": row["id"], "generation": row.get("pageGeneration")} for row in app_rows
            if isinstance(row.get("targetId"), str) and row["targetId"] in target_infos}


async def where_app_has(state, target_id: str) -> str | None:
    windows = await app_windows(state)
    if windows is None:
        return None
    rows = app_tab_rows(windows)
    if not reports_targets(rows):
        return None
    row = next((row for row in rows if row.get("targetId") == target_id), None)
    if row is None:
        return ("`ardia windows` lists no tab with that page: Ardia closed it, unloaded it, or keeps it in a private window "
                "or one of its own")
    return f"Ardia has it open as {row['id']} at {row.get('url') or 'no address yet'}"


async def app_tab_map(state) -> dict[str, str]:
    windows = await app_windows(state)
    if windows is None:
        return {}
    paired = pair_by_target(app_tab_rows(windows), state.target_infos)
    state.app_tabs.update({target: entry["app"] for target, entry in paired.items()})
    state.app_generations.update({target: entry["generation"] for target, entry in paired.items()})
    return {target: entry["app"] for target, entry in paired.items()}


async def app_tab_target(state, app_tab: str) -> dict:
    windows = await app_windows(state)
    if windows is None:
        return {"error": f"Couldn't read Ardia's tab list to look up {app_tab}; use the [tN] ids `ardia browse tab list` prints", "code": "tab_not_found"}
    rows = app_tab_rows(windows)
    tab = next((row for row in rows if row["id"] == app_tab), None)
    if tab is None:
        return {"error": f"Ardia has no tab {app_tab} (`ardia windows` lists them; private windows are left out)", "code": "tab_not_found"}
    if not reports_targets(rows):
        return {"error": f"This Ardia doesn't say which page belongs to {app_tab} (an update adds it); use the [tN] ids `ardia browse tab list` prints",
                "code": "tab_not_found"}
    target = tab.get("targetId")
    if not isinstance(target, str):
        return {"error": f"{app_tab} is open in Ardia but its page isn't loaded (Ardia keeps background tabs asleep until they're shown), "
                         "so there's nothing to drive yet; click it in Ardia, or `ardia browse open <url>` for a copy",
                "code": "tab_asleep", "asleep": True}
    if target not in state.target_infos:
        return {"error": f"{app_tab}'s page isn't one the ardia command can drive (an Ardia page, or not a web page)", "code": "tab_not_found"}
    state.app_tabs[target] = app_tab
    state.app_generations[target] = tab.get("pageGeneration")
    return {"target": target, "url": tab.get("url"), "title": tab.get("title"), "generation": tab.get("pageGeneration")}


def temporary_limit():
    from ardia_cli.browse.errors import BrowseError

    return BrowseError(f"Ardia already has {MAX_TEMPORARIES} tabs open for ardia browse reads and scripts; let them finish, or end "
                       "idle sessions with `ardia browse close --all`", code="temporary_limit")


class Registry:
    def __init__(self, browse_fd: int | None, key: str, session: str):
        self.browse_fd = browse_fd
        self.key = key
        self.session = session
        self.run = secrets.token_hex(8)
        self.instances: set = set()

    @staticmethod
    def file_for(instance: str | None) -> str:
        return f"tabs-{hashlib.sha256(str(instance).encode()).hexdigest()[:20]}.json"

    def prune_files(self, keep: str):
        cutoff = time.time() - STALE_FILE_SECONDS
        for name in os.listdir(self.browse_fd):
            if name.startswith("tabs-") and name.endswith(".json") and name != keep:
                with contextlib.suppress(OSError):
                    if os.stat(name, dir_fd=self.browse_fd, follow_symlinks=False).st_mtime < cutoff:
                        os.unlink(name, dir_fd=self.browse_fd)

    @contextlib.contextmanager
    def _open(self, instance: str | None):
        name = self.file_for(instance)
        self.instances.add(instance)
        lock = paths.open_private_file(LOCK, self.browse_fd)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                data = paths.read_private_json(name, self.browse_fd, None, MAX_FILE)
            except paths.PathError:
                data = None
            if not isinstance(data, dict) or data.get("instance") != instance or data.get("version") != VERSION or not self.within_caps(data):
                self.prune_files(name)
                data = {"version": VERSION, "instance": instance, "next": 1, "ids": {}, "opened": {}, "using": {}, "closing": {}}
            before = repr(data)
            yield data
            if repr(data) != before:
                self.compact(data)
                paths.write_private_json(name, self.browse_fd, data)
        finally:
            os.close(lock)

    @staticmethod
    def within_caps(data: dict) -> bool:
        opened = data.get("opened")
        return isinstance(opened, dict) and sum(1 for owner in opened.values() if owner.get("temporary")) <= MAX_TEMPORARIES

    def live(self, key: str) -> bool:
        return key == self.key or paths.lock_held(f"{key}.lock", self.browse_fd)

    def compact(self, data: dict):
        for key in [key for key in data["using"] if not self.live(key)]:
            del data["using"][key]
        for target in [target for target, owner in data["opened"].items() if not owner.get("temporary") and not self.live(owner.get("key", ""))]:
            del data["opened"][target]
        now = time.time()
        for target in [target for target, entry in data["closing"].items() if not self.live(entry.get("key", "")) or now - entry.get("at", 0) > CLOSE_HOLD
                       or (entry.get("key") == self.key and entry.get("run") != self.run)]:
            del data["closing"][target]
        ids = data["ids"]
        if len(ids) > MAX_IDS:
            keep = set(data["opened"]) | {entry["target"] for entry in data["using"].values()}
            for target in sorted(ids, key=lambda target: ids[target][1]):
                if len(ids) <= MAX_IDS:
                    break
                if target not in keep:
                    del ids[target]
        self.fit(data)

    @staticmethod
    def encoded_size(data: dict) -> int:
        return len(json.dumps(data, ensure_ascii=False).encode())

    def fit(self, data: dict):
        size = self.encoded_size(data)
        protected = {target for target, owner in data["opened"].items() if owner.get("temporary")} | set(data["closing"])
        protected |= {entry["target"] for entry in data["using"].values()}
        ids = data["ids"]
        labels = data["opened"]
        unused = sorted((seen, target) for target, (_, seen) in ids.items() if target not in protected and target not in labels)
        attributed = sorted((owner.get("at", 0), target) for target, owner in labels.items() if target not in protected)
        for table, order in ((ids, unused), (labels, attributed)):
            for _, target in order:
                if size <= FILE_BUDGET:
                    break
                size -= len(json.dumps({target: table[target]}, ensure_ascii=False).encode())
                del table[target]
                if table is labels:
                    ids.pop(target, None)
            size = self.encoded_size(data)
        if size > FILE_BUDGET:
            from ardia_cli.browse.errors import BrowseError

            raise BrowseError(f"The tab registry would be {size:,} bytes with only owned tabs left (the limit is {FILE_BUDGET:,})", code="registry_full")

    def numbers(self, instance: str | None, targets, present=None, taken_at: float | None = None) -> dict[str, str]:
        targets = list(targets)
        if self.browse_fd is None:
            return {}
        now = time.time()
        with self._open(instance) as data:
            ids = data["ids"]
            if present is not None and taken_at is not None:
                alive = set(present) | set(targets)
                for target in [target for target, (_, seen) in ids.items() if target not in alive and seen < taken_at]:
                    del ids[target]
                    data["opened"].pop(target, None)
            for target in targets:
                if target not in ids:
                    ids[target] = [data["next"], now]
                    data["next"] += 1
                elif taken_at is not None and ids[target][1] < taken_at:
                    ids[target][1] = taken_at
            return {target: f"t{ids[target][0]}" for target in targets if target in ids}

    def target_of(self, instance: str | None, tab: str) -> str | None:
        if self.browse_fd is None or not tab[1:].isdigit():
            return None
        with self._open(instance) as data:
            number = int(tab[1:])
            return next((target for target, (value, _) in data["ids"].items() if value == number), None)

    def note_opened(self, instance: str | None, target: str):
        if self.browse_fd is None:
            return
        with self._open(instance) as data:
            data["opened"][target] = {"key": self.key, "session": self.session, "at": time.time()}

    def temporary_record(self) -> dict:
        return {"key": self.key, "session": self.session, "temporary": True, "run": self.run, "at": time.time()}

    def reserve_temporary(self, instance: str | None) -> str | None:
        if self.browse_fd is None:
            return None
        with self._open(instance) as data:
            if sum(1 for owner in data["opened"].values() if owner.get("temporary")) >= MAX_TEMPORARIES:
                raise temporary_limit()
            slot = "SLOT" + secrets.token_hex(14).upper()
            data["opened"][slot] = self.temporary_record()
            return slot

    def note_temporary(self, instance: str | None, target: str, slot: str | None = None):
        if self.browse_fd is None:
            return
        with self._open(instance) as data:
            held = [other for other, owner in data["opened"].items() if owner.get("temporary") and other not in (target, slot)]
            if len(held) >= MAX_TEMPORARIES:
                raise temporary_limit()
            if slot is not None:
                data["opened"].pop(slot, None)
            data["opened"][target] = self.temporary_record()

    def temporaries(self, instance: str | None) -> list[str]:
        if self.browse_fd is None:
            return []
        with self._open(instance) as data:
            return [target for target, owner in data["opened"].items() if owner.get("temporary") and owner.get("key") == self.key]

    def claim_orphans(self, instance: str | None) -> list[str]:
        if self.browse_fd is None:
            return []
        with self._open(instance) as data:
            claimed = []
            for target, owner in data["opened"].items():
                if not owner.get("temporary"):
                    continue
                if owner.get("key") != self.key and not self.live(owner.get("key", "")):
                    owner.update(key=self.key, session=self.session, run=None)
                if owner.get("key") == self.key and owner.get("run") != self.run:
                    claimed.append(target)
            return claimed

    def drop_temporary(self, instance: str | None, target: str):
        if self.browse_fd is None:
            return
        with self._open(instance) as data:
            owner = data["opened"].get(target)
            if owner and owner.get("temporary") and owner.get("key") == self.key:
                del data["opened"][target]

    def refusal(self, data: dict, target: str) -> str | None:
        closing = data["closing"].get(target)
        if closing and closing.get("key") != self.key and self.live(closing.get("key", "")):
            return f"session {closing.get('session')} is closing it"
        owner = data["opened"].get(target)
        if owner and owner.get("temporary") and owner.get("key") != self.key:
            return f"session {owner.get('session')} opened it only to read it and will close it"
        return None

    def note_using(self, instance: str | None, target: str | None):
        if self.browse_fd is None:
            return
        from ardia_cli.browse.errors import BrowseError

        with self._open(instance) as data:
            if target is None:
                data["using"].pop(self.key, None)
                return
            why = self.refusal(data, target)
            if why:
                raise BrowseError(f"That tab can't be used: {why}", data={"targetId": target}, code="tab_closing")
            data["using"][self.key] = {"session": self.session, "target": target}

    def reserve_close(self, instance: str | None, target: str) -> bool:
        if self.browse_fd is None:
            return True
        with self._open(instance) as data:
            held = data["closing"].get(target, {})
            if self.refusal(data, target) or (held.get("key") == self.key and held.get("run") == self.run):
                return False
            if any(key != self.key and entry.get("target") == target and self.live(key) for key, entry in data["using"].items()):
                return False
            data["closing"][target] = {"key": self.key, "session": self.session, "run": self.run, "at": time.time()}
            return True

    def release_close(self, instance: str | None, target: str):
        if self.browse_fd is None:
            return
        with self._open(instance) as data:
            if data["closing"].get(target, {}).get("key") == self.key:
                del data["closing"][target]
            owner = data["opened"].get(target)
            if owner and owner.get("temporary") and owner.get("key") == self.key:
                owner["run"] = None

    def finish_close(self, instance: str | None, target: str):
        if self.browse_fd is None:
            return
        with self._open(instance) as data:
            if data["closing"].get(target, {}).get("key") == self.key:
                del data["closing"][target]
            owner = data["opened"].get(target)
            if owner and owner.get("key") == self.key:
                del data["opened"][target]
            if data["using"].get(self.key, {}).get("target") == target:
                del data["using"][self.key]

    def forget(self):
        if self.browse_fd is None:
            return
        for instance in list(self.instances):
            with self._open(instance) as data:
                data["using"].pop(self.key, None)
                for target in [target for target, owner in data["opened"].items() if owner.get("key") == self.key and not owner.get("temporary")]:
                    del data["opened"][target]

    def others(self, instance: str | None) -> tuple[dict[str, str], dict[str, list[str]]]:
        if self.browse_fd is None:
            return {}, {}
        with self._open(instance) as data:
            opened = {target: owner["session"] for target, owner in data["opened"].items()
                      if owner.get("key") != self.key and not owner.get("temporary") and self.live(owner.get("key", ""))}
            using: dict[str, list[str]] = {}
            for key, entry in data["using"].items():
                if key != self.key and self.live(key):
                    using.setdefault(entry["target"], []).append(entry["session"])
            return opened, using

    def hidden(self, instance: str | None) -> set[str]:
        if self.browse_fd is None:
            return set()
        with self._open(instance) as data:
            return {target for target, owner in data["opened"].items() if owner.get("temporary")} | {
                target for target, entry in data["closing"].items() if entry.get("key") != self.key}
