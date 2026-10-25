import contextlib
import io
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import cli, endpoint, identity, skills

INSTALL_SCRIPT = Path(__file__).resolve().parents[1] / "install.sh"
FORK = {"PRODUCT": "Name", "COMMAND": "name", "BUNDLE_ID": "com.example.name", "RELEASE_REPO": "owner/repo"}


def as_fork():
    return mock.patch.multiple(identity, **FORK)


class Upstream(unittest.TestCase):
    def test_the_committed_identity_is_upstreams(self):
        self.assertEqual(
            (identity.PRODUCT, identity.COMMAND, identity.BUNDLE_ID, identity.RELEASE_REPO),
            ("Ardia", "ardia", "com.ardia.browser", "mantrakp04/ardia"),
        )
        self.assertTrue(identity.is_upstream())

    def test_brand_leaves_upstream_text_alone(self):
        text = (skills.skill_source() / "SKILL.md").read_text(encoding="utf-8")
        self.assertIs(identity.brand(text), text)

    def test_installed_data_dir(self):
        self.assertEqual(endpoint.installed_data_dir(), Path.home() / "Library" / "Application Support" / "com.ardia.browser")


class Fork(unittest.TestCase):
    def setUp(self):
        patch = as_fork()
        patch.start()
        self.addCleanup(patch.stop)
        self.home = Path(tempfile.mkdtemp(prefix="ardia-identity-")).resolve()
        self.addCleanup(shutil.rmtree, self.home, True)

    def test_brand_renames_the_app_and_the_command(self):
        self.assertEqual(identity.brand("Let the ardia command control Ardia."), "Let the name command control Name.")
        self.assertEqual(identity.brand("ardia exec 'x'; Ardia's window; ardia: no"), "name exec 'x'; Name's window; name: no")

    def test_brand_keeps_what_the_engine_and_the_web_name(self):
        kept = [
            "<data dir>/Chromium/ArdiaControl.json",
            "$ARDIA_DATA_DIR",
            "https://ardia.dev",
            "ardia://settings",
            "GET /ardia/active?token=",
            "python -m ardia_cli",
            "ardia-userscript:///x",
            "the Ardia Scripts extension",
            "`ardia: <Method> isn't allowed for the ardia command`",
        ]
        for text in kept:
            self.assertEqual(identity.brand(text), text)

    def test_help_names_the_fork(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit):
            cli.build_parser().parse_args(["exec", "--help"])
        self.assertIn("usage: name exec", out.getvalue())
        self.assertIn("Run Python against the running Name", out.getvalue())
        self.assertIn("name exec 'await tab.title()'", out.getvalue())
        self.assertNotIn("ardia exec", out.getvalue())
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            cli.main(["--version"])
        self.assertTrue(out.getvalue().startswith("name "))

    def test_the_installed_data_dir_follows_the_bundle_id(self):
        with mock.patch.dict(os.environ, {"HOME": str(self.home)}):
            os.environ.pop("ARDIA_DATA_DIR", None)
            self.assertEqual(endpoint.data_root(), Path.home() / "Library" / "Application Support" / "com.example.name")
            os.environ["ARDIA_DATA_DIR"] = str(self.home / "scratch")
            self.assertEqual(endpoint.data_root(), self.home / "scratch")

    def test_the_skill_installs_as_the_fork(self):
        with mock.patch.object(Path, "home", lambda: self.home), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(skills.install(["claude-code"], False), 0)
        folder = self.home / ".claude" / "skills" / "name"
        page = (folder / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(page.startswith("---\nname: name\ndescription: Drive the user's running Name browser"))
        self.assertTrue(skills.is_ours(folder))
        for path in folder.rglob("*.md"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("ardia exec", text, path)
            self.assertNotIn("ardia scripts", text, path)
        self.assertIn("`ardia: <Method> isn't allowed for the ardia command`", page)
        self.assertFalse((self.home / ".claude" / "skills" / "ardia").exists())


@unittest.skipUnless(sys.platform == "darwin" and os.uname().machine == "arm64", "install.sh runs on Apple silicon only")
class Installer(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="ardia-install-")).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.home = self.root / "home"
        self.home.mkdir()

    def tarball(self, says: str, version: str = "1.2.3") -> str:
        top = self.root / "src" / f"ardia-cli-{version}"
        (top / "bin").mkdir(parents=True, exist_ok=True)
        launcher = top / "bin" / "ardia"
        launcher.write_text(f"#!/bin/sh\necho '{says} {version}'\n")
        launcher.chmod(0o755)
        path = self.root / f"ardia-cli-{version}-macos-arm64.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            archive.add(top, arcname=top.name)
        digest = subprocess.run(["shasum", "-a", "256", str(path)], capture_output=True, text=True, check=True).stdout
        Path(f"{path}.sha256").write_text(digest)
        return path.as_uri()

    def install(self, url: str, *flags: str) -> subprocess.CompletedProcess:
        env = {key: value for key, value in os.environ.items() if not key.startswith("ARDIA_CLI_")}
        env.update(HOME=str(self.home), ARDIA_CLI_URL=url, SHELL="/bin/zsh")
        return subprocess.run(["/bin/sh", str(INSTALL_SCRIPT), *flags], env=env, capture_output=True, text=True, timeout=120)

    def test_a_fork_installs_its_own_command_and_home(self):
        result = self.install(self.tarball("name"), "--product", "Name", "--repo", "owner/repo")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        link = self.home / ".local" / "bin" / "name"
        cli_home = self.home / "Library" / "Application Support" / "Name" / "CLI"
        self.assertIn(f"installed {link}", result.stdout)
        self.assertEqual(os.readlink(link), str(cli_home / "current" / "bin" / "ardia"))
        self.assertEqual(os.readlink(cli_home / "current"), "1.2.3")
        self.assertFalse((self.home / ".local" / "bin" / "ardia").exists())
        self.assertFalse((self.home / "Library" / "Application Support" / "Ardia").exists())
        result = self.install(self.tarball("name"), "--product", "Name", "--uninstall")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(link.is_symlink())
        self.assertFalse((cli_home / "current").is_symlink())
        self.assertFalse((cli_home / "1.2.3").exists())

    def test_upstream_defaults_are_unchanged(self):
        result = self.install(self.tarball("ardia"))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        link = self.home / ".local" / "bin" / "ardia"
        self.assertIn(f"installed {link}", result.stdout)
        self.assertEqual(os.readlink(link), str(self.home / "Library" / "Application Support" / "Ardia" / "CLI" / "current" / "bin" / "ardia"))

    def test_a_tarball_baked_for_another_app_is_refused(self):
        result = self.install(self.tarball("ardia"), "--product", "Name")
        self.assertEqual(result.returncode, 1)
        self.assertIn("error the tarball is for another app: it says ardia 1.2.3, not name 1.2.3", result.stdout)
        self.assertFalse((self.home / ".local" / "bin" / "name").exists())

    def test_bad_names_are_refused(self):
        for flags in (["--product", "../x"], ["--product", "My App"], ["--repo", "no-slash"], ["--repo", "a/b c"]):
            result = self.install(self.tarball("ardia"), *flags)
            self.assertEqual(result.returncode, 1, flags)
            self.assertTrue(result.stdout.startswith("error bad --"), result.stdout)


if __name__ == "__main__":
    unittest.main()
