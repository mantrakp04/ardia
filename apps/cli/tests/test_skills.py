import contextlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import cli, skills

SCRATCH = Path.home() / "ardia-scratch"


def quiet(function, *args):
    with contextlib.redirect_stdout(io.StringIO()) as out:
        status = function(*args)
    return status, out.getvalue()


class Refresh(unittest.TestCase):
    def setUp(self):
        base = SCRATCH if SCRATCH.is_dir() else Path(tempfile.gettempdir())
        self.root = Path(tempfile.mkdtemp(prefix="skills", dir=base)).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.home = self.root / "home"
        self.project = self.root / "project"
        self.cli_home = self.root / "cli"
        for folder in (self.home, self.project):
            folder.mkdir()
        patches = [
            mock.patch.dict(os.environ, {"HOME": str(self.home), "ARDIA_CLI_HOME": str(self.cli_home), "DO_NOT_TRACK": "1"}),
            mock.patch.object(Path, "home", classmethod(lambda cls: self.home)),
            mock.patch.object(Path, "cwd", classmethod(lambda cls: self.project)),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def stale(self, folder: Path) -> None:
        (folder / "SKILL.md").write_text("---\nname: ardia\ndescription: old\n---\nold body\n", encoding="utf-8")
        (folder / "references" / "gone.md").write_text("old\n", encoding="utf-8")

    def current_skill(self) -> str:
        return (skills.skill_source() / "SKILL.md").read_text(encoding="utf-8")

    def test_install_remembers_project_and_user_folders(self):
        self.assertEqual(quiet(skills.install, ["claude-code"], True)[0], 0)
        self.assertEqual(quiet(skills.install, ["codex", "general"], False)[0], 0)
        recorded = json.loads((self.cli_home / "skills.json").read_text())["folders"]
        self.assertEqual(recorded, [str(self.project / ".claude/skills/ardia"), str(self.home / ".agents/skills/ardia")])

    def test_refresh_rewrites_recorded_and_user_copies(self):
        quiet(skills.install, ["claude-code"], True)
        project_copy = self.project / ".claude/skills/ardia"
        user_copy = self.home / ".cursor/skills/ardia"
        shutil.copytree(skills.skill_source(), user_copy, ignore=shutil.ignore_patterns("__pycache__"))
        for folder in (project_copy, user_copy):
            self.stale(folder)
        status, out = quiet(skills.refresh)
        self.assertEqual(status, 0)
        for folder in (project_copy, user_copy):
            self.assertEqual((folder / "SKILL.md").read_text(encoding="utf-8"), self.current_skill())
            self.assertFalse((folder / "references" / "gone.md").exists())
            self.assertIn(f"refreshed {folder}", out)
        recorded = json.loads((self.cli_home / "skills.json").read_text())["folders"]
        self.assertEqual(set(recorded), {str(project_copy), str(user_copy)})

    def test_refresh_leaves_other_skills_and_links_alone(self):
        other = self.home / ".claude/skills/ardia"
        other.mkdir(parents=True)
        (other / "SKILL.md").write_text("---\nname: someone-else\n---\nmine\n", encoding="utf-8")
        target = self.root / "linked"
        shutil.copytree(skills.skill_source(), target)
        self.stale(target)
        (self.home / ".agents/skills").mkdir(parents=True)
        (self.home / ".agents/skills/ardia").symlink_to(target)
        sibling = self.home / ".claude/skills/agent-browser"
        sibling.mkdir()
        (sibling / "SKILL.md").write_text("---\nname: agent-browser\n---\n", encoding="utf-8")
        status, out = quiet(skills.refresh)
        self.assertEqual((status, out), (0, ""))
        self.assertIn("someone-else", (other / "SKILL.md").read_text())
        self.assertIn("old body", (target / "SKILL.md").read_text())
        self.assertTrue((sibling / "SKILL.md").exists())

    def test_refresh_drops_folders_that_are_gone(self):
        quiet(skills.install, ["opencode"], True)
        shutil.rmtree(self.project / ".opencode")
        self.assertEqual(quiet(skills.refresh)[0], 0)
        self.assertEqual(json.loads((self.cli_home / "skills.json").read_text())["folders"], [])

    def test_unreadable_record_is_empty(self):
        self.cli_home.mkdir()
        (self.cli_home / "skills.json").write_text("not json", encoding="utf-8")
        self.assertEqual(skills.recorded_folders(), [])
        self.assertEqual(quiet(skills.refresh)[0], 0)

    def test_cli_runs_refresh(self):
        quiet(skills.install, ["claude-code"], False)
        copy = self.home / ".claude/skills/ardia"
        self.stale(copy)
        status, out = quiet(cli.main, ["skills", "refresh"])
        self.assertEqual(status, 0)
        self.assertEqual((copy / "SKILL.md").read_text(encoding="utf-8"), self.current_skill())


class Contents(unittest.TestCase):
    def test_frontmatter_and_links(self):
        source = skills.skill_source()
        text = (source / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\nname: ardia\ndescription: "))
        frontmatter = text.split("\n---\n", 1)[0].splitlines()[1:]
        self.assertEqual([line.split(":", 1)[0] for line in frontmatter], ["name", "description", "allowed-tools"])
        description = frontmatter[1].split(": ", 1)[1]
        self.assertLessEqual(len(description), 1024)
        self.assertNotIn(": ", description)
        self.assertLess(len(text), 5600)
        for reference in re.findall(r"`(?:references/)?([a-z-]+\.md)`", text):
            self.assertTrue((source / "references" / reference).is_file(), reference)


if __name__ == "__main__":
    unittest.main()
