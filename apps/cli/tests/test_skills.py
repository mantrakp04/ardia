import contextlib
import hashlib
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

from ardia_cli import cli, computer, skills

SCRATCH = Path.home() / "ardia-scratch"
OLD_LAYOUT = ("SKILL.md", "references/automation.md", "references/browse.md", "references/config.md",
              "references/daily-reports.md", "references/userscripts.md")


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
            mock.patch.object(computer, "skill_pack", lambda env=None: {"SKILL.md": b"---\nname: cua-driver\n---\n"}),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def current_skill(self) -> str:
        return (skills.skill_source() / "SKILL.md").read_text(encoding="utf-8")

    def make_stale(self, folder: Path) -> None:
        (folder / "SKILL.md").write_text("---\nname: ardia\ndescription: old\n---\nold body\n", encoding="utf-8")
        (folder / "references" / "gone.md").write_text("old\n", encoding="utf-8")
        marker = folder / skills.MARKER
        data = json.loads(marker.read_text(encoding="utf-8"))
        data["files"].append("references/gone.md")
        marker.write_text(json.dumps(data), encoding="utf-8")

    def foreign_ardia(self, folder: Path) -> None:
        folder.mkdir(parents=True)
        (folder / "SKILL.md").write_text("---\nname: ardia\ndescription: someone else's\n---\nmine\n", encoding="utf-8")
        (folder / "sentinel.txt").write_text("keep me\n", encoding="utf-8")

    def old_layout(self, folder: Path, extra: str | None = None) -> None:
        for name in OLD_LAYOUT + ((extra,) if extra else ()):
            (folder / name).parent.mkdir(parents=True, exist_ok=True)
            (folder / name).write_text("---\nname: ardia\n---\nold\n" if name == "SKILL.md" else "old\n", encoding="utf-8")

    def test_install_remembers_project_and_user_folders(self):
        self.assertEqual(quiet(skills.install, ["claude-code"], True)[0], 0)
        self.assertEqual(quiet(skills.install, ["codex", "general"], False)[0], 0)
        recorded = json.loads((self.cli_home / "skills.json").read_text())["folders"]
        self.assertEqual(recorded, [str(self.project / ".claude/skills/ardia"), str(self.home / ".agents/skills/ardia")])

    def test_install_writes_a_marker_listing_the_shipped_files(self):
        quiet(skills.install, ["claude-code"], False)
        folder = self.home / ".claude/skills/ardia"
        marker = json.loads((folder / skills.MARKER).read_text(encoding="utf-8"))
        self.assertEqual(marker["files"], skills.shipped_files())
        self.assertIn("SKILL.md", marker["files"])

    def test_refresh_rewrites_marked_copies_and_removes_only_files_it_shipped(self):
        quiet(skills.install, ["claude-code"], True)
        quiet(skills.install, ["cursor"], False)
        copies = [self.project / ".claude/skills/ardia", self.home / ".cursor/skills/ardia"]
        for folder in copies:
            self.make_stale(folder)
            (folder / "my-notes.md").write_text("mine\n", encoding="utf-8")
            (folder / "references" / "mine.md").write_text("mine\n", encoding="utf-8")
        status, out = quiet(skills.refresh)
        self.assertEqual(status, 0)
        for folder in copies:
            self.assertEqual((folder / "SKILL.md").read_text(encoding="utf-8"), self.current_skill())
            self.assertFalse((folder / "references" / "gone.md").exists())
            self.assertTrue((folder / "my-notes.md").exists())
            self.assertTrue((folder / "references" / "mine.md").exists())
            self.assertIn(f"refreshed {folder}", out)
        recorded = json.loads((self.cli_home / "skills.json").read_text())["folders"]
        self.assertEqual(set(recorded), {str(folder) for folder in copies})

    def test_refresh_never_touches_a_foreign_skill_named_ardia(self):
        folder = self.home / ".claude/skills/ardia"
        self.foreign_ardia(folder)
        status, out = quiet(skills.refresh)
        self.assertEqual(status, 0)
        self.assertIn("someone else's", (folder / "SKILL.md").read_text(encoding="utf-8"))
        self.assertTrue((folder / "sentinel.txt").exists())
        self.assertIn(f"skipped {folder}", out)

    def test_a_marker_that_isnt_ours_doesnt_count(self):
        folder = self.home / ".claude/skills/ardia"
        self.foreign_ardia(folder)
        for content in ("[]", '{"vendor": "someone", "files": ["sentinel.txt"]}', "not json"):
            (folder / skills.MARKER).write_text(content, encoding="utf-8")
            status, out = quiet(skills.refresh)
            self.assertEqual(status, 0)
            self.assertIn(f"skipped {folder}", out)
            self.assertTrue((folder / "sentinel.txt").exists())
            self.assertIn("someone else's", (folder / "SKILL.md").read_text(encoding="utf-8"))

    def test_marker_entries_outside_the_folder_are_never_removed(self):
        quiet(skills.install, ["claude-code"], False)
        folder = self.home / ".claude/skills/ardia"
        outside = self.home / ".claude/skills/keep.md"
        outside.write_text("keep\n", encoding="utf-8")
        marker = json.loads((folder / skills.MARKER).read_text(encoding="utf-8"))
        marker["files"] += ["../keep.md", "/etc/hosts", skills.MARKER]
        (folder / skills.MARKER).write_text(json.dumps(marker), encoding="utf-8")
        self.assertEqual(quiet(skills.refresh)[0], 0)
        self.assertTrue(outside.exists())
        self.assertTrue((folder / skills.MARKER).is_file())

    def test_install_refuses_a_foreign_skill_named_ardia(self):
        folder = self.home / ".claude/skills/ardia"
        self.foreign_ardia(folder)
        status, out = quiet(skills.install, ["claude-code"], False)
        self.assertEqual(status, 1)
        self.assertIn("isn't a copy ardia installed", out)
        self.assertIn("--replace", out)
        self.assertTrue((folder / "sentinel.txt").exists())
        self.assertFalse((folder / skills.MARKER).exists())

    def test_unmarked_folder_with_a_symlinked_skill_md_is_skipped(self):
        target = self.root / "elsewhere.md"
        target.write_text("---\nname: ardia\n---\nlinked\n", encoding="utf-8")
        folder = self.home / ".cursor/skills/ardia"
        self.old_layout(folder)
        (folder / "SKILL.md").unlink()
        (folder / "SKILL.md").symlink_to(target)
        status, out = quiet(skills.refresh)
        self.assertEqual(status, 0)
        self.assertTrue((folder / "SKILL.md").is_symlink())
        self.assertIn("linked", target.read_text(encoding="utf-8"))
        self.assertIn(f"skipped {folder}", out)

    def test_marked_folder_with_a_symlinked_skill_md_never_writes_through_the_link(self):
        quiet(skills.install, ["claude-code"], False)
        folder = self.home / ".claude/skills/ardia"
        target = self.root / "elsewhere.md"
        target.write_text("theirs\n", encoding="utf-8")
        (folder / "SKILL.md").unlink()
        (folder / "SKILL.md").symlink_to(target)
        self.assertEqual(quiet(skills.refresh)[0], 0)
        self.assertEqual(target.read_text(encoding="utf-8"), "theirs\n")
        self.assertFalse((folder / "SKILL.md").is_symlink())
        self.assertEqual((folder / "SKILL.md").read_text(encoding="utf-8"), self.current_skill())

    def test_symlinked_folders_and_markers_are_skipped(self):
        real = self.root / "real-skill"
        quiet(skills.install, ["claude-code"], False)
        shutil.copytree(self.home / ".claude/skills/ardia", real)
        (real / "SKILL.md").write_text("---\nname: ardia\n---\nreal\n", encoding="utf-8")
        (self.home / ".agents/skills").mkdir(parents=True)
        (self.home / ".agents/skills/ardia").symlink_to(real)
        marked = self.home / ".claude/skills/ardia"
        (marked / "SKILL.md").write_text("---\nname: ardia\n---\nstale\n", encoding="utf-8")
        (marked / skills.MARKER).unlink()
        (marked / skills.MARKER).symlink_to(real / skills.MARKER)
        status, out = quiet(skills.refresh)
        self.assertEqual(status, 0)
        self.assertIn("real", (real / "SKILL.md").read_text(encoding="utf-8"))
        self.assertIn("stale", (marked / "SKILL.md").read_text(encoding="utf-8"))
        self.assertIn(f"skipped {marked}", out)
        self.assertNotIn("refreshed", out)

    def test_symlinked_references_folder_is_refused(self):
        quiet(skills.install, ["claude-code"], False)
        folder = self.home / ".claude/skills/ardia"
        outside = self.root / "outside"
        shutil.move(str(folder / "references"), outside)
        (folder / "references").symlink_to(outside)
        (outside / "script.md").write_text("theirs\n", encoding="utf-8")
        status, out = quiet(skills.refresh)
        self.assertEqual(status, 1)
        self.assertEqual((outside / "script.md").read_text(encoding="utf-8"), "theirs\n")
        self.assertIn(f"error {folder}", out)

    def shipped_before(self, folder: Path):
        versions = [{name: hashlib.sha256((folder / name).read_bytes()).hexdigest() for name in OLD_LAYOUT}]
        return mock.patch.object(skills, "legacy_versions", lambda: versions)

    def test_install_adopts_a_copy_whose_every_file_we_shipped(self):
        folder = self.home / ".claude/skills/ardia"
        self.old_layout(folder)
        with self.shipped_before(folder):
            status, out = quiet(skills.install, ["claude-code"], False, False)
        self.assertEqual(status, 0)
        self.assertEqual((folder / "SKILL.md").read_text(encoding="utf-8"), self.current_skill())
        self.assertFalse((folder / "references/browse.md").exists())
        self.assertTrue((folder / skills.MARKER).is_file())

    def test_refresh_never_adopts_an_unmarked_copy(self):
        folder = self.home / ".claude/skills/ardia"
        self.old_layout(folder)
        with self.shipped_before(folder):
            status, out = quiet(skills.refresh)
        self.assertEqual(status, 0)
        self.assertTrue((folder / "references/browse.md").exists())
        self.assertFalse((folder / skills.MARKER).exists())
        self.assertIn(f"skipped {folder}", out)

    def test_a_foreign_skill_in_an_old_layout_is_refused_and_kept(self):
        folder = self.home / ".claude/skills/ardia"
        (folder / "references").mkdir(parents=True)
        (folder / "SKILL.md").write_text("---\nname: ardia\ndescription: theirs\n---\ntheirs\n", encoding="utf-8")
        (folder / "references/pydoll.md").write_text("their docs\n", encoding="utf-8")
        self.assertIn(f"skipped {folder}", quiet(skills.refresh)[1])
        status, out = quiet(skills.install, ["claude-code"], False, False)
        self.assertEqual(status, 1)
        self.assertIn(str(folder), out)
        self.assertIn("--replace", out)
        self.assertIn("theirs", (folder / "SKILL.md").read_text(encoding="utf-8"))
        self.assertEqual((folder / "references/pydoll.md").read_text(encoding="utf-8"), "their docs\n")

    def test_replace_swaps_only_that_folder(self):
        folder = self.home / ".claude/skills/ardia"
        self.foreign_ardia(folder)
        sibling = self.home / ".claude/skills/other"
        sibling.mkdir()
        (sibling / "SKILL.md").write_text("other\n", encoding="utf-8")
        status, out = quiet(skills.install, ["claude-code"], False, False, True)
        self.assertEqual(status, 0)
        self.assertEqual((folder / "SKILL.md").read_text(encoding="utf-8"), self.current_skill())
        self.assertFalse((folder / "sentinel.txt").exists())
        self.assertEqual((sibling / "SKILL.md").read_text(encoding="utf-8"), "other\n")

    def test_replace_removes_a_linked_folder_without_touching_its_target(self):
        target = self.root / "linked-skill"
        self.foreign_ardia(target)
        (self.home / ".claude/skills").mkdir(parents=True)
        (self.home / ".claude/skills/ardia").symlink_to(target)
        status, out = quiet(cli.main, ["skills", "install", "--target", "claude-code", "--no-cua", "--replace"])
        self.assertEqual(status, 0)
        folder = self.home / ".claude/skills/ardia"
        self.assertFalse(folder.is_symlink())
        self.assertTrue((folder / skills.MARKER).is_file())
        self.assertTrue((target / "sentinel.txt").exists())

    def test_an_old_layout_with_extra_files_is_skipped(self):
        folder = self.home / ".claude/skills/ardia"
        self.old_layout(folder, extra="references/mine.md")
        status, out = quiet(skills.refresh)
        self.assertEqual(status, 0)
        self.assertTrue((folder / "references/browse.md").exists())
        self.assertTrue((folder / "references/mine.md").exists())
        self.assertFalse((folder / skills.MARKER).exists())
        self.assertIn(f"skipped {folder}", out)

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
        self.make_stale(copy)
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
        self.assertLess(len(text), 5700)
        for reference in re.findall(r"`(?:references/)?([a-z-]+\.md)`", text):
            self.assertTrue((source / "references" / reference).is_file(), reference)

    def test_versions_shipped_before_the_marker_are_known(self):
        versions = skills.legacy_versions()
        self.assertGreater(len(versions), 5)
        self.assertTrue(all("SKILL.md" in version for version in versions))
        self.assertIn({
            "SKILL.md": "4a8a86544cbe004028cd6d0c1945fe15ebc06978688e316b9e9261b37f8531b5",
            "references/browse.md": "bcc69d79b8d618e68854e867c06a5ef80ccb96cbf51ab034699b2966f2bb0bcb",
        }, [{name: version[name] for name in ("SKILL.md", "references/browse.md")} for version in versions
            if "references/browse.md" in version])


if __name__ == "__main__":
    unittest.main()
