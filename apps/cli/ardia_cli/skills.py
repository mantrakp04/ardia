import json
import os
import shutil
import tempfile
from pathlib import Path

SKILL_NAME = "ardia"
TARGETS = {
    "general": (".agents/skills", ".agents/skills"),
    "codex": (".agents/skills", ".agents/skills"),
    "claude-code": (".claude/skills", ".claude/skills"),
    "cursor": (".cursor/skills", ".cursor/skills"),
    "opencode": (".config/opencode/skills", ".opencode/skills"),
}


def skill_source() -> Path:
    return Path(__file__).resolve().parent / "skill"


def is_ours(folder: Path) -> bool:
    try:
        head = (folder / "SKILL.md").read_text(encoding="utf-8")[:200]
    except OSError:
        return False
    return head.startswith("---\nname: ardia\n")


def destination(target: str, project: bool) -> Path:
    user_dir, project_dir = TARGETS[target]
    base = Path.cwd() / project_dir if project else Path.home() / user_dir
    return base / SKILL_NAME


def install_into(folder: Path) -> None:
    folder.parent.mkdir(parents=True, exist_ok=True)
    if folder.is_symlink() or (folder.exists() and not is_ours(folder)):
        raise FileExistsError(f"{folder} exists and isn't the ardia skill; move it away first")
    staging = Path(tempfile.mkdtemp(prefix=".ardia-skill-", dir=folder.parent))
    try:
        fresh = staging / SKILL_NAME
        shutil.copytree(skill_source(), fresh, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        if folder.exists():
            old = staging / "old"
            os.rename(folder, old)
        os.rename(fresh, folder)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


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
        if folder.is_symlink() or not is_ours(folder):
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
