import contextlib
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

SKILL_NAME = "ardia"
CUA_SKILL = "cua-driver"
COMPANIONS = (CUA_SKILL,)
MARKER = ".ardia-skill"
TARGETS = {
    "general": (".agents/skills", ".agents/skills"),
    "codex": (".agents/skills", ".agents/skills"),
    "claude-code": (".claude/skills", ".claude/skills"),
    "cursor": (".cursor/skills", ".cursor/skills"),
    "opencode": (".config/opencode/skills", ".opencode/skills"),
}


def skill_source() -> Path:
    return Path(__file__).resolve().parent / "skill"


def destination(target: str, project: bool) -> Path:
    user_dir, project_dir = TARGETS[target]
    base = Path.cwd() / project_dir if project else Path.home() / user_dir
    return base / SKILL_NAME


def shipped_files() -> list[str]:
    source = skill_source()
    files = []
    for root, dirs, names in os.walk(source):
        dirs[:] = sorted(name for name in dirs if name != "__pycache__")
        for name in names:
            if not name.endswith(".pyc"):
                files.append((Path(root) / name).relative_to(source).as_posix())
    return sorted(files)


def legacy_versions() -> list[dict]:
    try:
        versions = json.loads((Path(__file__).resolve().parent / "skill_hashes.json").read_text(encoding="utf-8"))["versions"]
    except (OSError, ValueError, KeyError, TypeError):
        return []
    return [version for version in versions if isinstance(version, dict)]


def safe_relative(name) -> bool:
    if not isinstance(name, str) or not name or name.startswith("/") or "\\" in name:
        return False
    parts = name.split("/")
    return all(part not in ("", ".", "..") for part in parts) and parts[0] != MARKER


def read_marker(folder: Path, skill: str = SKILL_NAME) -> dict | None:
    marker = folder / MARKER
    if marker.is_symlink() or not marker.is_file():
        return None
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("vendor") != "ardia" or not isinstance(data.get("files"), list):
        return None
    if data.get("skill", SKILL_NAME) != skill:
        return None
    return data


def marked_files(folder: Path, skill: str = SKILL_NAME) -> list[str] | None:
    data = read_marker(folder, skill)
    if data is None:
        return None
    return [name for name in data["files"] if safe_relative(name)]


def plain_files(folder: Path) -> set[str] | None:
    files = set()
    for root, dirs, names in os.walk(folder):
        for name in dirs + names:
            path = Path(root) / name
            if path.is_symlink() or not (path.is_dir() or path.is_file()):
                return None
        files.update((Path(root) / name).relative_to(folder).as_posix() for name in names)
    return files


def owned_files(folder: Path, adopt: bool = False) -> list[str] | None:
    if folder.is_symlink() or not folder.is_dir():
        return None
    marked = marked_files(folder)
    if marked is not None or not adopt:
        return marked
    files = plain_files(folder)
    if files is None:
        return None
    try:
        hashes = {name: hashlib.sha256((folder / name).read_bytes()).hexdigest() for name in files}
    except OSError:
        return None
    return sorted(files) if hashes in legacy_versions() else None


def real_parent(folder: Path, name: str) -> Path:
    parent = folder
    for part in name.split("/")[:-1]:
        parent = parent / part
        if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            raise FileExistsError(f"{parent} isn't a plain folder; move it away first")
        if not parent.exists():
            parent.mkdir()
    return parent


def write_file(folder: Path, name: str, data: bytes) -> None:
    parent = real_parent(folder, name)
    handle, staging = tempfile.mkstemp(prefix=".ardia-skill-", dir=parent)
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
        os.chmod(staging, 0o644)
        os.replace(staging, parent / name.split("/")[-1])
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(staging)
        raise


def remove_file(folder: Path, name: str) -> None:
    parent = folder
    for part in name.split("/")[:-1]:
        parent = parent / part
        if parent.is_symlink() or not parent.is_dir():
            return
    path = parent / name.split("/")[-1]
    if not path.is_symlink() and path.is_file():
        path.unlink()


def write_pack(folder: Path, previous: list[str], pack: dict[str, bytes], marker: dict) -> None:
    files = sorted(pack)
    for name in files:
        write_file(folder, name, pack[name])
    for name in sorted(set(previous) - set(files)):
        remove_file(folder, name)
    write_file(folder, MARKER, (json.dumps({**marker, "files": files}, indent=2) + "\n").encode("utf-8"))


def install_into(folder: Path, companions: list[str] | None = None, adopt: bool = False, replace: bool = False) -> None:
    previous: list[str] = []
    owned = owned_files(folder, adopt) if folder.is_symlink() or folder.exists() else None
    if owned is not None:
        previous = owned
        if companions is None:
            companions = (read_marker(folder) or {}).get("companions")
    elif folder.is_symlink() or folder.exists():
        if not replace:
            raise FileExistsError(f"{folder} exists and isn't a copy ardia installed; move it away, or replace that folder with --replace")
        if folder.is_symlink() or not folder.is_dir():
            folder.unlink()
        else:
            shutil.rmtree(folder)
        folder.mkdir()
    else:
        folder.mkdir(parents=True)
    source = skill_source()
    pack = {name: (source / name).read_bytes() for name in shipped_files()}
    from ardia_cli import __version__

    marker = {"vendor": "ardia", "version": __version__}
    if isinstance(companions, list):
        marker["companions"] = [name for name in companions if name in COMPANIONS]
    write_pack(folder, previous, pack, marker)


def note_companions(folder: Path, names: list[str]) -> None:
    data = read_marker(folder)
    if data is None:
        return
    data["companions"] = names
    write_file(folder, MARKER, (json.dumps(data, indent=2) + "\n").encode("utf-8"))


def companion_folder(folder: Path) -> Path:
    return folder.parent / CUA_SKILL


def install_companion(folder: Path) -> str:
    from ardia_cli import computer

    previous: list[str] = []
    if folder.is_symlink() or folder.exists():
        owned = None if folder.is_symlink() or not folder.is_dir() else marked_files(folder, CUA_SKILL)
        if owned is None:
            return f"kept {folder}: a {CUA_SKILL} skill is already there and ardia didn't install it (cua-driver's own installer?)"
        previous = owned
    pack = computer.skill_pack()
    if not folder.exists():
        folder.mkdir(parents=True)
    marker = {"vendor": "ardia", "skill": CUA_SKILL, "upstream": f"trycua/cua cua-driver-rs-v{computer.VERSION}", "version": computer.VERSION}
    write_pack(folder, previous, pack, marker)
    return f"{CUA_SKILL} {computer.VERSION}: {folder}"


def companion_line(folder: Path) -> tuple[str, int]:
    from ardia_cli import computer

    try:
        return install_companion(folder), 0
    except (OSError, computer.Refused) as error:
        return f"error {folder}: {error}", 1


def record_path() -> Path:
    cli_home = os.environ.get("ARDIA_CLI_HOME") or str(Path.home() / "Library" / "Application Support" / "Ardia" / "CLI")
    return Path(cli_home).expanduser() / "skills.json"


def recorded_folders() -> list[Path]:
    try:
        folders = json.loads(record_path().read_text(encoding="utf-8")).get("folders", [])
    except (OSError, ValueError, AttributeError):
        return []
    return [Path(folder) for folder in folders if isinstance(folder, str) and os.path.isabs(folder)]


def save_record(folders: list[Path]) -> None:
    path = record_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        staging = path.with_name(f".skills.{os.getpid()}.json")
        staging.write_text(json.dumps({"folders": [str(folder) for folder in dict.fromkeys(folders)]}, indent=2) + "\n", encoding="utf-8")
        os.replace(staging, path)
    except OSError:
        pass


def install(targets: list[str], project: bool, computer_use: bool = True, replace: bool = False) -> int:
    written: dict[Path, list[str]] = {}
    for target in dict.fromkeys(targets):
        written.setdefault(destination(target, project), []).append(target)
    status = 0
    installed = []
    for folder, names in written.items():
        try:
            install_into(folder, None if computer_use else [], adopt=True, replace=replace)
        except OSError as error:
            print(f"{', '.join(names)}: error {error}")
            status = 1
            continue
        installed.append(folder.absolute())
        print(f"{', '.join(names)}: {folder}")
        if computer_use:
            line, failed = companion_line(companion_folder(folder))
            print(f"{', '.join(names)}: {line}")
            if failed:
                status = 1
            else:
                note_companions(folder, list(COMPANIONS))
    if installed:
        save_record(recorded_folders() + installed)
    return status


def refresh() -> int:
    user_folders = [destination(target, False) for target in TARGETS]
    status = 0
    kept = []
    for folder in dict.fromkeys(recorded_folders() + user_folders):
        if not (folder.is_symlink() or folder.exists()):
            continue
        if owned_files(folder) is None:
            print(f"skipped {folder}: not installed by ardia skills install (no {MARKER} marker)")
            continue
        kept.append(folder)
        try:
            install_into(folder)
        except OSError as error:
            print(f"error {folder}: {error}")
            status = 1
            continue
        print(f"refreshed {folder}")
        companions = (read_marker(folder) or {}).get("companions")
        cua = companion_folder(folder)
        ours = marked_files(cua, CUA_SKILL) is not None and not cua.is_symlink()
        if (companions is None and not (cua.is_symlink() or cua.exists())) or (ours and (companions is None or CUA_SKILL in companions)):
            line, failed = companion_line(cua)
            print(line if line.startswith("error") else f"refreshed {cua}")
            if failed:
                status = 1
                continue
        if companions is None:
            note_companions(folder, list(COMPANIONS))
    save_record(kept)
    return status
