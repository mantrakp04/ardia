import contextlib
import fcntl
import hashlib
import os

from ardia_cli.browse import paths
from ardia_cli.browse.errors import BrowseError


def _name(target_id: str) -> str:
    return hashlib.sha256(target_id.encode()).hexdigest()[:24] + ".json"


@contextlib.contextmanager
def _locked(browse_fd: int):
    folder = paths.open_private_dirat(browse_fd, "claims")
    lock = paths.open_private_file(".lock", folder)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield folder
    finally:
        os.close(lock)
        os.close(folder)


def claim(browse_fd: int, key: str, session: str, target_id: str, kind: str) -> None:
    with _locked(browse_fd) as folder:
        name = _name(target_id)
        current = paths.read_private_json(name, folder, None)
        if current and current.get("owner") != key and paths.lock_held(f"{current.get('owner')}.lock", browse_fd):
            raise BrowseError(
                f"Session {current.get('session')} is already capturing or routing this tab; "
                f"stop it there first (`ardia browse --session {current.get('session')} ...`)",
                code="tab_owned",
            )
        kinds = sorted(set((current or {}).get("kinds", []) if current and current.get("owner") == key else []) | {kind})
        paths.write_private_json(name, folder, {"owner": key, "session": session, "target": target_id, "kinds": kinds})


def release(browse_fd: int, key: str, target_id: str | None = None, kind: str | None = None) -> None:
    with _locked(browse_fd) as folder:
        for entry in os.listdir(folder):
            if not entry.endswith(".json") or entry.startswith("."):
                continue
            current = paths.read_private_json(entry, folder, None)
            if not current or current.get("owner") != key:
                continue
            if target_id is not None and current.get("target") != target_id:
                continue
            kinds = [value for value in current.get("kinds", []) if kind is not None and value != kind]
            if kinds:
                paths.write_private_json(entry, folder, {**current, "kinds": kinds})
            else:
                paths.unlink_quietly(entry, folder)
