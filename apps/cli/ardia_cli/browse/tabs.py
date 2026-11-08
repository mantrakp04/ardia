import asyncio
import contextlib
import fcntl
import hashlib
import os
import re
import time
from pathlib import Path

from ardia_cli.browse import paths

LOCK = "tabs.lock"
STALE_FILE_SECONDS = 3 * 24 * 3600
VERSION = 2
MAX_IDS = 1500
MAX_FILE = 1024 * 1024
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


def app_tab_rows(windows) -> list[dict]:
    return [tab for window in windows or [] if isinstance(window, dict) for tab in window.get("tabs") or [] if isinstance(tab, dict) and tab.get("id")]


def pair_by_url(app_rows: list[dict], target_infos: dict) -> dict[str, str]:
    app_by_url: dict[str, list[str]] = {}
    for tab in app_rows:
        app_by_url.setdefault(str(tab.get("url") or ""), []).append(tab["id"])
    targets_by_url: dict[str, list[str]] = {}
    for target_id, info in target_infos.items():
        targets_by_url.setdefault(str(info.get("url") or ""), []).append(target_id)
    paired = {}
    for url, ids in app_by_url.items():
        targets = targets_by_url.get(url, [])
        if url and len(ids) == 1 and len(targets) == 1:
            paired[targets[0]] = ids[0]
    return paired


async def app_tab_map(state) -> dict[str, str]:
    windows = await app_windows(state)
    if windows is None:
        return {}
    paired = pair_by_url(app_tab_rows(windows), state.target_infos)
    state.app_tabs.update(paired)
    return paired


async def app_tab_target(state, app_tab: str) -> dict:
    windows = await app_windows(state)
    if windows is None:
        return {"error": f"Couldn't read Ardia's tab list to look up {app_tab}; use the [tN] ids `ardia browse tab list` prints", "code": "tab_not_found"}
    rows = app_tab_rows(windows)
    tab = next((row for row in rows if row["id"] == app_tab), None)
    if tab is None:
        return {"error": f"Ardia has no tab {app_tab} (`ardia windows` lists them; private windows are left out)", "code": "tab_not_found"}
    url = str(tab.get("url") or "")
    known = state.app_tabs
    remembered = [target for target, owner in known.items() if owner == app_tab and target in state.target_infos and state.target_infos[target].get("url") == url]
    if len(remembered) == 1:
        return {"target": remembered[0], "url": url, "title": tab.get("title")}
    targets = [target for target, info in state.target_infos.items() if info.get("url") == url]
    same_url = [row["id"] for row in rows if str(row.get("url") or "") == url]
    if len(targets) == 1 and len(same_url) == 1:
        return {"target": targets[0], "url": url, "title": tab.get("title")}
    if not targets:
        return {"error": f"{app_tab} is open in Ardia but its page isn't loaded (Ardia keeps background tabs asleep until they're shown), "
                         "so there's nothing to drive yet; click it in Ardia, or `ardia browse open <url>` for a copy",
                "code": "tab_asleep", "asleep": True}
    listed = ", ".join(f"[{state.tab_id(target)}]" for target in targets)
    return {"error": f"{app_tab} has the same address as other tabs ({listed}), so it can't be told apart from them; pick it by its [tN] id",
            "code": "ambiguous_tab", "candidates": [state.tab_id(target) for target in targets]}


class Registry:
    def __init__(self, browse_fd: int | None, key: str, session: str):
        self.browse_fd = browse_fd
        self.key = key
        self.session = session
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
            data = paths.read_private_json(name, self.browse_fd, None, MAX_FILE)
            if not isinstance(data, dict) or data.get("instance") != instance or data.get("version") != VERSION:
                self.prune_files(name)
                data = {"version": VERSION, "instance": instance, "next": 1, "ids": {}, "opened": {}, "using": {}, "closing": {}}
            before = repr(data)
            yield data
            if repr(data) != before:
                self.compact(data)
                paths.write_private_json(name, self.browse_fd, data)
        finally:
            os.close(lock)

    def live(self, key: str) -> bool:
        return key == self.key or paths.lock_held(f"{key}.lock", self.browse_fd)

    def compact(self, data: dict):
        for key in [key for key in data["using"] if not self.live(key)]:
            del data["using"][key]
        for target in [target for target, owner in data["opened"].items() if not owner.get("temporary") and not self.live(owner.get("key", ""))]:
            del data["opened"][target]
        now = time.time()
        for target in [target for target, entry in data["closing"].items() if not self.live(entry.get("key", "")) or now - entry.get("at", 0) > CLOSE_HOLD]:
            del data["closing"][target]
        ids = data["ids"]
        if len(ids) > MAX_IDS:
            keep = set(data["opened"]) | {entry["target"] for entry in data["using"].values()}
            for target in sorted(ids, key=lambda target: ids[target][1]):
                if len(ids) <= MAX_IDS:
                    break
                if target not in keep:
                    del ids[target]

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

    def note_temporary(self, instance: str | None, target: str):
        if self.browse_fd is None:
            return
        with self._open(instance) as data:
            data["opened"][target] = {"key": self.key, "session": self.session, "temporary": True, "at": time.time()}

    def temporaries(self, instance: str | None) -> list[str]:
        if self.browse_fd is None:
            return []
        with self._open(instance) as data:
            return [target for target, owner in data["opened"].items() if owner.get("temporary") and owner.get("key") == self.key]

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
            if self.refusal(data, target) or data["closing"].get(target, {}).get("key") == self.key:
                return False
            if any(key != self.key and entry.get("target") == target and self.live(key) for key, entry in data["using"].items()):
                return False
            data["closing"][target] = {"key": self.key, "session": self.session, "at": time.time()}
            return True

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
