import os
import shutil
import tempfile
from pathlib import Path

from ardia_cli import identity

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
    return head.startswith(f"---\nname: {identity.COMMAND}\n")


def destination(target: str, project: bool) -> Path:
    user_dir, project_dir = TARGETS[target]
    base = Path.cwd() / project_dir if project else Path.home() / user_dir
    return base / identity.COMMAND


def install_into(folder: Path) -> None:
    folder.parent.mkdir(parents=True, exist_ok=True)
    if folder.is_symlink() or (folder.exists() and not is_ours(folder)):
        raise FileExistsError(f"{folder} exists and isn't the {identity.COMMAND} skill; move it away first")
    staging = Path(tempfile.mkdtemp(prefix=".ardia-skill-", dir=folder.parent))
    try:
        fresh = staging / identity.COMMAND
        shutil.copytree(skill_source(), fresh, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        if not identity.is_upstream():
            for page in fresh.rglob("*.md"):
                page.write_text(identity.brand(page.read_text(encoding="utf-8")), encoding="utf-8")
        if folder.exists():
            old = staging / "old"
            os.rename(folder, old)
        os.rename(fresh, folder)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def install(targets: list[str], project: bool) -> int:
    written: dict[Path, list[str]] = {}
    for target in dict.fromkeys(targets):
        written.setdefault(destination(target, project), []).append(target)
    status = 0
    for folder, names in written.items():
        try:
            install_into(folder)
        except OSError as error:
            print(f"{', '.join(names)}: error {error}")
            status = 1
            continue
        print(f"{', '.join(names)}: {folder}")
    return status
