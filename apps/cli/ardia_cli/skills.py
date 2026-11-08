import contextlib
import json
import os
import tempfile
from pathlib import Path

SKILL_NAME = "ardia"
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


LEGACY_LAYOUTS = (
    ("SKILL.md", "references/pydoll.md"),
    ("SKILL.md", "references/browse.md", "references/pydoll.md"),
    ("SKILL.md", "references/automation.md", "references/browse.md", "references/config.md",
     "references/daily-reports.md", "references/userscripts.md"),
    ("SKILL.md", "references/automation.md", "references/config.md", "references/daily-reports.md",
     "references/script.md", "references/troubleshooting.md", "references/userscripts.md"),
)


def shipped_files() -> list[str]:
    source = skill_source()
    files = []
    for root, dirs, names in os.walk(source):
        dirs[:] = sorted(name for name in dirs if name != "__pycache__")
        for name in names:
            if not name.endswith(".pyc"):
                files.append((Path(root) / name).relative_to(source).as_posix())
    return sorted(files)


def known_layouts() -> set[frozenset]:
    return {frozenset(layout) for layout in LEGACY_LAYOUTS} | {frozenset(shipped_files())}


def safe_relative(name) -> bool:
    if not isinstance(name, str) or not name or name.startswith("/") or "\\" in name:
        return False
    parts = name.split("/")
    return all(part not in ("", ".", "..") for part in parts) and parts[0] != MARKER


def marked_files(folder: Path) -> list[str] | None:
    marker = folder / MARKER
    if marker.is_symlink() or not marker.is_file():
        return None
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("vendor") != "ardia" or not isinstance(data.get("files"), list):
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


def owned_files(folder: Path) -> list[str] | None:
    if folder.is_symlink() or not folder.is_dir():
        return None
    marked = marked_files(folder)
    if marked is not None:
        return marked
    files = plain_files(folder)
    if files is None or frozenset(files) not in known_layouts():
        return None
    try:
        head = (folder / "SKILL.md").read_text(encoding="utf-8")[:200]
    except OSError:
        return None
    return sorted(files) if head.startswith("---\nname: ardia\n") else None


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


def install_into(folder: Path) -> None:
    previous: list[str] = []
    if folder.is_symlink() or folder.exists():
        owned = owned_files(folder)
        if owned is None:
            raise FileExistsError(f"{folder} exists and isn't the ardia skill (no {MARKER} marker); move it away first")
        previous = owned
    else:
        folder.mkdir(parents=True)
    source = skill_source()
    files = shipped_files()
    for name in files:
        write_file(folder, name, (source / name).read_bytes())
    for name in sorted(set(previous) - set(files)):
        remove_file(folder, name)
    from ardia_cli import __version__

    marker = {"vendor": "ardia", "version": __version__, "files": files}
    write_file(folder, MARKER, (json.dumps(marker, indent=2) + "\n").encode("utf-8"))


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


def install(targets: list[str], project: bool) -> int:
    written: dict[Path, list[str]] = {}
    for target in dict.fromkeys(targets):
        written.setdefault(destination(target, project), []).append(target)
    status = 0
    installed = []
    for folder, names in written.items():
        try:
            install_into(folder)
        except OSError as error:
            print(f"{', '.join(names)}: error {error}")
            status = 1
            continue
        installed.append(folder.absolute())
        print(f"{', '.join(names)}: {folder}")
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
    save_record(kept)
    return status
