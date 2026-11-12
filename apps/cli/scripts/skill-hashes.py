#!/usr/bin/env python3
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

UNTIL = "d2963fca5"
SKILL = "apps/cli/ardia_cli/skill"
OUT = Path(__file__).resolve().parents[1] / "ardia_cli" / "skill_hashes.json"
DESCRIPTION = (
    "Writes ardia_cli/skill_hashes.json: the SHA-256 of every file in each version of the ardia agent skill that "
    f"installed without a .ardia-skill marker (every commit up to {UNTIL}). ardia skills install adopts an unmarked "
    "copy only when its files match one of these versions exactly. The list is frozen: later installs write the "
    "marker. --check exits 1 when the checked-in file differs from what git history gives."
)


def git(root: Path, *args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, check=True).stdout


def versions(root: Path) -> list[dict]:
    seen = {}
    for commit in git(root, "rev-list", UNTIL, "--", SKILL).decode().split():
        names = [name for name in git(root, "ls-tree", "-r", "--name-only", commit, "--", f"{SKILL}/").decode().split("\n") if name]
        version = {name[len(SKILL) + 1:]: hashlib.sha256(git(root, "show", f"{commit}:{name}")).hexdigest() for name in names}
        if version:
            seen[json.dumps(version, sort_keys=True)] = version
    return [seen[key] for key in sorted(seen)]


def main() -> int:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument("--check", action="store_true", help="compare instead of writing")
    args = parser.parse_args()
    root = Path(git(Path(__file__).resolve().parent, "rev-parse", "--show-toplevel").decode().strip())
    text = json.dumps({"until": UNTIL, "versions": versions(root)}, indent=1, sort_keys=True) + "\n"
    if args.check:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print(f"{OUT} is out of date; run {Path(__file__).name}", file=sys.stderr)
            return 1
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"{OUT}: {text.count('SKILL.md')} versions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
