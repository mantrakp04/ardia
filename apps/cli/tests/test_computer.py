import contextlib
import hashlib
import io
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import cli, computer, skills

SCRATCH = Path.home() / "ardia-scratch"
REAL_DOWNLOAD = computer.download
REAL_CODE_HASH = computer.code_hash
REAL_VERIFY = computer.verify_app


def quiet(function, *args, **kwargs):
    with contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()) as err:
        status = function(*args, **kwargs)
    return status, out.getvalue(), err.getvalue()


def info_plist(version=computer.VERSION, bundle_id=computer.BUNDLE_ID) -> bytes:
    return plistlib.dumps({"CFBundleIdentifier": bundle_id, "CFBundleShortVersionString": version, "CFBundleExecutable": "cua-driver"})


def tarball(path: Path, entries: dict, links: dict | None = None) -> str:
    with tarfile.open(path, "w:gz") as tar:
        for name, data in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o755
            tar.addfile(info, io.BytesIO(data))
        for name, target in (links or {}).items():
            info = tarfile.TarInfo(name)
            info.type = tarfile.SYMTYPE
            info.linkname = target
            tar.addfile(info)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def driver_entries(top=computer.DRIVER_TOP, version=computer.VERSION) -> dict:
    return {
        f"{top}/cua-driver": b"bare binary",
        f"{top}/libcua_driver_sdk.dylib": b"sdk",
        f"{top}/LICENSE": b"MIT",
        f"{top}/THIRD_PARTY_NOTICES.md": b"notices",
        f"{top}/CuaDriver.app/Contents/Info.plist": info_plist(version),
        f"{top}/CuaDriver.app/Contents/MacOS/cua-driver": b"#!/bin/sh\n",
        f"{top}/CuaDriver.app/Contents/_CodeSignature/CodeResources": b"signed",
    }


SIGNATURE = Path("Contents/_CodeSignature/CodeResources")


def fake_verify(app: Path) -> None:
    if not (Path(app) / SIGNATURE).is_file():
        raise computer.Refused(f"{app} isn't Cua AI's signed {computer.APP_NAME} (code object is not signed at all)")


def fake_code_hash(app: Path) -> str | None:
    signature = Path(app) / SIGNATURE
    return hashlib.sha256(signature.read_bytes() + (computer.app_version(Path(app)) or "").encode()).hexdigest() if signature.is_file() else None


def make_app(folder: Path, version=computer.VERSION, signed=True, signature=b"signed") -> Path:
    (folder / "Contents" / "MacOS").mkdir(parents=True)
    (folder / "Contents" / "Info.plist").write_bytes(info_plist(version))
    (folder / computer.APP_BINARY).write_text("#!/bin/sh\n")
    if signed:
        (folder / SIGNATURE).parent.mkdir(parents=True)
        (folder / SIGNATURE).write_bytes(signature)
    return folder


def skill_entries(body=b"---\nname: cua-driver\n---\nv1\n") -> dict:
    top = computer.SKILLS_TOP
    return {
        f"{top}/SKILL.md": body,
        f"{top}/MACOS.md": b"mac\n",
        f"{top}/LINUX.md": b"linux\n",
        f"{top}/WINDOWS.md": b"windows\n",
        f"{top}/WORKFLOW.md": b"workflow\n",
    }


class Sandbox(unittest.TestCase):
    def setUp(self):
        base = SCRATCH if SCRATCH.is_dir() else Path(tempfile.gettempdir())
        self.root = Path(tempfile.mkdtemp(prefix="computer", dir=base)).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.home = self.root / "home"
        self.project = self.root / "project"
        self.cli_home = self.root / "cli"
        self.applications = self.root / "Applications"
        self.assets = self.root / "assets"
        for folder in (self.home, self.project, self.applications, self.assets):
            folder.mkdir()
        self.served: dict[str, Path] = {}
        self.downloads: list[str] = []
        patches = [
            mock.patch.dict(os.environ, {"HOME": str(self.home), "ARDIA_CLI_HOME": str(self.cli_home), "ARDIA_CLI_BIN_DIR": str(self.home / "bin"), "DO_NOT_TRACK": "1"}),
            mock.patch.object(Path, "home", classmethod(lambda cls: self.home)),
            mock.patch.object(Path, "cwd", classmethod(lambda cls: self.project)),
            mock.patch.object(computer, "APPLICATIONS", self.applications),
            mock.patch.object(computer, "download", self.fake_download),
            mock.patch.object(computer, "verify_app", fake_verify),
            mock.patch.object(computer, "code_hash", fake_code_hash),
            mock.patch.object(computer, "register_app", lambda app: None),
            mock.patch.object(computer, "run_driver_quietly", self.fake_run),
            mock.patch.object(computer, "copy_app", lambda source, dest: shutil.copytree(source, dest)),
        ]
        self.ran: list[tuple] = []
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def fake_run(self, binary, *args) -> int:
        self.ran.append((str(binary), *args))
        return 0

    def install_launcher(self) -> Path:
        ardia = self.cli_home / "current" / "bin" / "ardia"
        ardia.parent.mkdir(parents=True, exist_ok=True)
        ardia.write_text("#!/bin/sh\n")
        return ardia

    def fake_download(self, url: str, dest: Path) -> None:
        self.downloads.append(url)
        name = url.rsplit("/", 1)[-1]
        if name not in self.served:
            raise OSError("HTTP Error 404: Not Found")
        shutil.copyfile(self.served[name], dest)

    def serve(self, asset: str, entries: dict, links: dict | None = None) -> str:
        path = self.assets / asset
        digest = tarball(path, entries, links)
        self.served[asset] = path
        return digest

    def serve_driver(self, entries: dict | None = None, links: dict | None = None):
        digest = self.serve(computer.DRIVER_ASSET, entries or driver_entries(), links)
        patch = mock.patch.object(computer, "DRIVER_SHA256", digest)
        patch.start()
        self.addCleanup(patch.stop)

    def serve_skills(self, entries: dict | None = None):
        digest = self.serve(computer.SKILLS_ASSET, entries or skill_entries())
        patch = mock.patch.object(computer, "SKILLS_SHA256", digest)
        patch.start()
        self.addCleanup(patch.stop)


class PinnedDownload(Sandbox):
    def test_fetches_the_pinned_release_and_keeps_only_the_app(self):
        self.serve_driver()
        status, _, err = quiet(computer.ensure_driver)
        app = self.cli_home / "cua-driver" / computer.VERSION / "CuaDriver"
        self.assertEqual(status, app)
        self.assertEqual(self.downloads, [f"https://github.com/trycua/cua/releases/download/cua-driver-rs-v{computer.VERSION}/{computer.DRIVER_ASSET}"])
        self.assertTrue((app / computer.APP_BINARY).is_file())
        self.assertTrue((app.parent / "LICENSE").is_file())
        self.assertFalse((app.parent / "libcua_driver_sdk.dylib").exists())
        self.assertFalse((app.parent / "cua-driver").exists())
        self.assertIn(f"sha256 {computer.DRIVER_SHA256}", err)
        self.assertEqual([entry.name for entry in app.parent.iterdir() if entry.name.startswith(".")], [])
        quiet(computer.ensure_driver)
        self.assertEqual(len(self.downloads), 1)

    def test_checksum_mismatch_installs_nothing(self):
        self.serve(computer.DRIVER_ASSET, driver_entries())
        with mock.patch.object(computer, "DRIVER_SHA256", "0" * 64):
            with self.assertRaises(computer.Refused) as caught:
                quiet(computer.ensure_driver)
        self.assertIn("checksum mismatch", str(caught.exception))
        version_home = self.cli_home / "cua-driver" / computer.VERSION
        self.assertEqual(list(version_home.iterdir()), [])

    @unittest.skipUnless(sys.platform == "darwin", "runs cua-driver, which is macOS only")
    def test_passthrough_reports_a_mismatch_and_never_execs(self):
        self.serve(computer.DRIVER_ASSET, driver_entries())
        with mock.patch.object(computer, "DRIVER_SHA256", "0" * 64), mock.patch.object(os, "execve") as execve:
            status, _, err = quiet(computer.main, ["list-tools"])
        self.assertEqual(status, 1)
        self.assertIn("checksum mismatch", err)
        execve.assert_not_called()

    def test_refuses_entries_outside_the_top_folder_and_links(self):
        self.serve_driver({**driver_entries(), "elsewhere/evil": b"x"})
        with self.assertRaises(computer.Refused):
            quiet(computer.ensure_driver)
        self.serve_driver(driver_entries(), links={f"{computer.DRIVER_TOP}/CuaDriver.app/Contents/Resources": "/etc"})
        with self.assertRaises(computer.Refused):
            quiet(computer.ensure_driver)
        self.assertFalse((self.cli_home / "cua-driver" / computer.VERSION / "CuaDriver").exists())

    def test_refuses_an_app_of_another_version(self):
        self.serve_driver(driver_entries(version="0.0.1"))
        with self.assertRaises(computer.Refused) as caught:
            quiet(computer.ensure_driver)
        self.assertIn("not the pinned", str(caught.exception))

    def test_downloads_are_https_only(self):
        with self.assertRaises(computer.Refused):
            REAL_DOWNLOAD("http://github.com/x", self.root / "x")
        self.assertFalse((self.root / "x").exists())

    def test_old_driver_versions_are_pruned_down_to_one(self):
        home = self.cli_home / "cua-driver"
        for index, name in enumerate(("0.1.0", "0.2.0", "0.3.0")):
            (home / name).mkdir(parents=True)
            os.utime(home / name, (index + 1, index + 1))
        (home / "keep-me").mkdir()
        self.serve_driver()
        quiet(computer.ensure_driver)
        self.assertEqual(sorted(entry.name for entry in home.iterdir()), sorted([computer.VERSION, "0.3.0", "keep-me"]))


@unittest.skipUnless(sys.platform == "darwin", "runs cua-driver, which is macOS only")
class Passthrough(Sandbox):
    def install_fake_app(self, version=computer.VERSION, signed=True) -> Path:
        return make_app(self.applications / computer.APP_NAME, version, signed)

    def test_execs_the_installed_app_with_argv_unchanged(self):
        app = self.install_fake_app()
        with mock.patch.object(os, "execve") as execve, mock.patch.dict(os.environ, {"CUA_DRIVER_RS_UPDATE_CHECK": "1"}):
            quiet(cli.main, ["computer", "call", "click", '{"pid": 1, "x": 2}', "--json"])
        binary, argv, env = execve.call_args.args
        self.assertEqual(binary, str(app / computer.APP_BINARY))
        self.assertEqual(argv, [binary, "call", "click", '{"pid": 1, "x": 2}', "--json"])
        self.assertEqual(env["CUA_DRIVER_RS_TELEMETRY_ENABLED"], "0")
        self.assertEqual(env["CUA_DRIVER_RS_UPDATE_CHECK"], "1")

    def test_an_unsigned_installed_app_never_runs(self):
        self.install_fake_app(signed=False)
        for command in (["list-tools"], ["mcp"], ["--version"]):
            with mock.patch.object(os, "execve") as execve:
                status, _, err = quiet(computer.main, command)
            self.assertEqual(status, 1)
            self.assertIn("isn't Cua AI's signed", err)
            self.assertIn("move it away", err)
            execve.assert_not_called()

    def test_a_signed_foreign_app_of_another_version_runs_as_is(self):
        app = self.install_fake_app(version="0.41.3")
        with mock.patch.object(os, "execve") as execve:
            quiet(computer.main, ["list-tools"])
        self.assertEqual(execve.call_args.args[0], str(app / computer.APP_BINARY))

    def test_a_cached_bundle_that_fails_verification_is_fetched_again(self):
        self.serve_driver()
        cached = quiet(computer.ensure_driver)[0]
        (cached / SIGNATURE).unlink()
        (cached / computer.APP_BINARY).write_text("#!/bin/sh\necho tampered\n")
        with mock.patch.object(os, "execve") as execve:
            _, _, err = quiet(computer.main, ["list-tools"])
        self.assertEqual(len(self.downloads), 2)
        self.assertIn("fetching it again", err)
        self.assertEqual((cached / computer.APP_BINARY).read_text(), "#!/bin/sh\n")
        self.assertTrue((cached / SIGNATURE).is_file())
        self.assertEqual(execve.call_args.args[0], str(cached / computer.APP_BINARY))

    def test_a_cached_bundle_with_a_broken_info_plist_is_fetched_again(self):
        self.serve_driver()
        cached = quiet(computer.ensure_driver)[0]
        with open(cached / "Contents" / "Info.plist", "ab") as plist:
            plist.write(b"x")
        with mock.patch.object(os, "execve") as execve:
            _, _, err = quiet(computer.main, ["list-tools"])
        self.assertEqual(len(self.downloads), 2)
        self.assertIn("fetching it again", err)
        self.assertEqual(computer.app_version(cached), computer.VERSION)
        execve.assert_called_once()

    def test_an_inconclusive_check_keeps_the_cached_bundle(self):
        self.serve_driver()
        cached = quiet(computer.ensure_driver)[0]
        with mock.patch.object(computer, "verify_app", mock.Mock(side_effect=computer.Inconclusive("codesign timed out"))), mock.patch.object(os, "execve") as execve:
            status, _, err = quiet(computer.main, ["list-tools"])
        self.assertEqual(status, 1)
        self.assertIn("codesign timed out", err)
        self.assertEqual(len(self.downloads), 1)
        self.assertTrue((cached / computer.APP_BINARY).is_file())
        execve.assert_not_called()

    def test_help_word_maps_to_the_driver_help(self):
        self.install_fake_app()
        with mock.patch.object(os, "execve") as execve:
            quiet(computer.main, ["help", "permissions"])
        self.assertEqual(execve.call_args.args[1][1:], ["--help", "permissions"])

    def test_without_setup_daemon_commands_point_at_setup(self):
        with mock.patch.object(os, "execve") as execve:
            status, _, err = quiet(computer.main, ["mcp"])
        self.assertEqual(status, 1)
        self.assertIn("ardia computer setup", err)
        execve.assert_not_called()

    def test_without_setup_other_commands_use_the_bundled_copy(self):
        self.serve_driver()
        with mock.patch.object(os, "execve") as execve:
            quiet(computer.main, ["list-tools"])
        self.assertEqual(execve.call_args.args[0], str(self.cli_home / "cua-driver" / computer.VERSION / "CuaDriver" / computer.APP_BINARY))

    def test_update_channel_and_skills_are_refused(self):
        for word in ("update", "channel", "skills"):
            with mock.patch.object(os, "execve") as execve:
                status, _, err = quiet(computer.main, [word, "--apply"])
            self.assertEqual(status, 2)
            self.assertIn("ardia", err)
            execve.assert_not_called()

    def test_an_outdated_app_ardia_installed_says_so(self):
        app = self.install_fake_app(version="0.0.9")
        computer.save_record({"path": str(app), "version": "0.0.9", "cdhash": fake_code_hash(app)})
        with mock.patch.object(os, "execve"):
            _, _, err = quiet(computer.main, ["list-tools"])
        self.assertIn("ardia computer setup", err)

    def test_shared_flags_are_refused(self):
        status, _, err = quiet(cli.main, ["--port", "9", "computer", "list-tools"])
        self.assertEqual(status, 2)
        self.assertIn("computer doesn't take --port", err)

    def test_help_mentions_computer(self):
        _, out, _ = quiet(cli.main, ["computer", "--help"])
        self.assertIn("ardia computer setup", out)
        self.assertIn(computer.VERSION, out)
        with self.assertRaises(SystemExit):
            quiet(cli.main, ["--help"])
        self.assertIn("computer", cli.build_parser().format_help())


@unittest.skipUnless(sys.platform == "darwin", "installs CuaDriver.app, which is macOS only")
class Setup(Sandbox):
    def setUp(self):
        super().setUp()
        self.serve_driver()
        self.install_launcher()

    def dest(self) -> Path:
        return self.applications / computer.APP_NAME

    def ours(self, version="0.0.9", signature=b"old") -> Path:
        app = make_app(self.dest(), version, signature=signature)
        computer.save_record({"path": str(app), "version": version, "cdhash": fake_code_hash(app)})
        return app

    def test_installs_into_applications_and_records_it(self):
        status, out, _ = quiet(computer.setup, ["--no-grant"])
        self.assertEqual(status, 0)
        app = self.dest()
        self.assertTrue((app / computer.APP_BINARY).is_file())
        self.assertIn(f"installed {app}", out)
        record = computer.read_record()
        self.assertEqual((record["path"], record["state"], record["cdhash"]), (str(app), "committed", fake_code_hash(app)))
        link = self.home / "bin" / "cua-driver"
        self.assertTrue(link.is_symlink())
        self.assertIn("computer", Path(os.readlink(link)).read_text())
        self.assertEqual([entry.name for entry in self.applications.iterdir()], [computer.APP_NAME])

    def test_never_replaces_an_app_ardia_didnt_install(self):
        app = make_app(self.dest(), "0.41.3")
        status, out, _ = quiet(computer.setup, ["--no-grant"])
        self.assertEqual(status, 0)
        self.assertIn("kept", out)
        self.assertEqual(computer.app_version(app), "0.41.3")

    def test_updates_an_app_it_installed_and_refresh_is_a_no_op_once_current(self):
        app = self.ours()
        status, out, _ = quiet(computer.refresh)
        self.assertEqual(status, 0)
        self.assertIn(f"updated {app}", out)
        self.assertEqual(computer.app_version(app), computer.VERSION)
        self.assertIn((str(app / computer.APP_BINARY), "stop"), self.ran)
        self.assertEqual(quiet(computer.refresh)[1], "")
        self.assertEqual(sorted(entry.name for entry in self.applications.iterdir()), [computer.APP_NAME])

    def test_refresh_never_runs_a_tampered_app_it_installed(self):
        app = self.ours()
        (app / SIGNATURE).unlink()
        computer.save_record({"path": str(app), "version": "0.0.9", "cdhash": "recorded-before-tampering"})
        with mock.patch.object(computer, "code_hash", lambda app: "recorded-before-tampering"):
            status, _, err = quiet(computer.refresh)
        self.assertEqual(status, 1)
        self.assertIn("isn't Cua AI's signed", err)
        self.assertEqual(self.ran, [])
        self.assertEqual(computer.app_version(app), "0.0.9")

    def test_setup_never_runs_an_unsigned_app_for_telemetry(self):
        quiet(computer.setup, ["--no-grant"])
        (self.dest() / SIGNATURE).unlink()
        self.ran.clear()
        with mock.patch.object(computer, "code_hash", lambda app: computer.read_record()["cdhash"]):
            quiet(computer.setup, ["--no-grant"])
        self.assertEqual(self.ran, [])

    def test_a_failed_record_commit_is_recovered_on_the_next_run(self):
        app = self.ours()
        real_save = computer.save_record

        def failing_commit(record, env=None):
            if record.get("state") != "pending":
                raise OSError("disk full")
            real_save(record, env)

        with mock.patch.object(computer, "save_record", failing_commit):
            status, _, err = quiet(computer.refresh)
        self.assertEqual(status, 1)
        self.assertIn("disk full", err)
        status, out, _ = quiet(computer.setup, ["--no-grant"])
        self.assertEqual(status, 0)
        self.assertNotIn("kept", out)
        self.assertIn(f"current {app}", out)
        record = computer.read_record()
        self.assertEqual((record["state"], record["version"], record["cdhash"]), ("committed", computer.VERSION, fake_code_hash(app)))
        self.assertEqual(sorted(entry.name for entry in self.applications.iterdir()), [computer.APP_NAME])

    def test_a_failed_pending_write_changes_nothing(self):
        app = self.ours()
        before = computer.read_record()
        with mock.patch.object(computer, "save_record", mock.Mock(side_effect=OSError("read-only"))):
            self.assertEqual(quiet(computer.refresh)[0], 1)
        self.assertEqual(computer.app_version(app), "0.0.9")
        self.assertEqual(computer.read_record(), before)
        self.assertEqual(sorted(entry.name for entry in self.applications.iterdir()), [computer.APP_NAME])
        self.assertEqual(self.ran, [])

    def test_death_between_the_renames_restores_the_old_app(self):
        app = self.ours()
        old = computer.read_record()
        new = make_app(self.applications / computer.STAGING_NAME, signature=b"new")
        computer.save_record({"path": str(app), "version": computer.VERSION, "cdhash": fake_code_hash(new), "state": "pending", "previous": old})
        os.rename(app, self.applications / computer.RETIRED_NAME)
        with mock.patch.object(os, "execve") as execve:
            quiet(computer.main, ["list-tools"])
        self.assertEqual(computer.app_version(app), "0.0.9")
        self.assertEqual(computer.read_record()["cdhash"], old["cdhash"])
        self.assertEqual(computer.read_record()["state"], "committed")
        self.assertEqual(sorted(entry.name for entry in self.applications.iterdir()), [computer.APP_NAME])
        self.assertEqual(execve.call_args.args[0], str(app / computer.APP_BINARY))

    def test_death_after_the_swap_commits_the_new_app(self):
        app = self.ours()
        old = computer.read_record()
        os.rename(app, self.applications / computer.RETIRED_NAME)
        new = make_app(app, signature=b"new")
        computer.save_record({"path": str(app), "version": computer.VERSION, "cdhash": fake_code_hash(new), "state": "pending", "previous": old})
        self.assertEqual(quiet(computer.refresh)[0], 0)
        record = computer.read_record()
        self.assertEqual((record["state"], record["cdhash"]), ("committed", fake_code_hash(new)))
        self.assertNotIn("previous", record)
        self.assertEqual(sorted(entry.name for entry in self.applications.iterdir()), [computer.APP_NAME])

    def swapped_but_uncommitted(self) -> tuple[Path, dict]:
        app = self.ours()
        old = computer.read_record()
        os.rename(app, self.applications / computer.RETIRED_NAME)
        new = make_app(app, signature=b"new")
        pending = {"path": str(app), "version": computer.VERSION, "cdhash": fake_code_hash(new), "state": "pending", "previous": old}
        computer.save_record(pending)
        return app, pending

    def codesign_fails(self, flag: str, error: BaseException):
        real_run = subprocess.run

        def run(args, *rest, **kwargs):
            if args and args[0] == "/usr/bin/codesign" and flag in args:
                raise error
            return real_run(args, *rest, **kwargs)

        return mock.patch.object(computer.subprocess, "run", run)

    def assert_still_pending(self, pending: dict) -> None:
        self.assertEqual(computer.read_record(), pending)
        self.assertTrue((self.applications / computer.RETIRED_NAME).is_dir())
        self.assertTrue(computer.needs_recovery())

    def test_a_transient_hash_failure_keeps_the_pending_record_and_the_backup(self):
        app, pending = self.swapped_but_uncommitted()
        with mock.patch.object(computer, "code_hash", REAL_CODE_HASH), self.codesign_fails("-dvvv", subprocess.TimeoutExpired("codesign", 30)):
            status, _, err = quiet(computer.refresh)
            self.assertEqual(status, 1)
            self.assertIn("recovery is pending", err)
            self.assert_still_pending(pending)
            with mock.patch.object(os, "execve"):
                _, _, err = quiet(computer.main, ["list-tools"])
            self.assertIn("recovery is pending", err)
            self.assert_still_pending(pending)
        self.assertEqual(quiet(computer.refresh)[0], 0)
        record = computer.read_record()
        self.assertEqual((record["state"], record["cdhash"]), ("committed", pending["cdhash"]))
        self.assertTrue(computer.installed_by_ardia(app))
        self.assertFalse(computer.needs_recovery())
        self.assertEqual(sorted(entry.name for entry in self.applications.iterdir()), [computer.APP_NAME])

    def test_a_transient_verification_failure_keeps_the_pending_record_and_the_backup(self):
        _, pending = self.swapped_but_uncommitted()
        with mock.patch.object(computer, "verify_app", REAL_VERIFY), self.codesign_fails("--verify", OSError("Resource temporarily unavailable")):
            status, _, err = quiet(computer.setup, ["--no-grant"])
        self.assertEqual(status, 1)
        self.assertIn("recovery is pending", err)
        self.assert_still_pending(pending)

    def test_a_definite_mismatch_still_restores_the_previous_record(self):
        app, pending = self.swapped_but_uncommitted()
        (app / SIGNATURE).write_bytes(b"something else")
        self.assertEqual(quiet(computer.refresh)[0], 0)
        record = computer.read_record()
        self.assertEqual((record["state"], record["cdhash"]), ("committed", pending["previous"]["cdhash"]))
        self.assertFalse(computer.needs_recovery())

    def test_setup_waits_for_another_setup_and_gives_up_at_its_deadline(self):
        with mock.patch.object(computer, "LOCK_TIMEOUT_S", 0.2), computer.applications_lock():
            status, _, err = quiet(computer.setup, ["--no-grant"])
        self.assertEqual(status, 1)
        self.assertIn("another ardia computer setup", err)
        self.assertFalse(self.dest().exists())

    def test_refresh_leaves_a_foreign_app_alone(self):
        app = make_app(self.dest(), "0.0.9")
        self.assertEqual(quiet(computer.refresh), (0, "", ""))
        self.assertEqual(computer.app_version(app), "0.0.9")

    def test_keeps_a_cua_driver_command_that_isnt_ours(self):
        (self.home / "bin").mkdir()
        (self.home / "bin" / "cua-driver").write_text("theirs\n")
        _, out, _ = quiet(computer.setup, ["--no-grant"])
        self.assertIn("kept", out)
        self.assertEqual((self.home / "bin" / "cua-driver").read_text(), "theirs\n")


class StuckTools(unittest.TestCase):
    def stuck(self, command, **kwargs):
        self.timeouts.append(kwargs.get("timeout"))
        raise subprocess.TimeoutExpired(command, kwargs.get("timeout"))

    def setUp(self):
        self.timeouts = []

    def test_a_stuck_copy_is_refused(self):
        with mock.patch.object(computer.subprocess, "run", self.stuck), self.assertRaises(computer.Refused) as caught:
            computer.copy_app(Path("/tmp/a"), Path("/tmp/b"))
        self.assertIn(f"took over {computer.COPY_TIMEOUT} s", str(caught.exception))
        self.assertEqual(self.timeouts, [computer.COPY_TIMEOUT])

    def test_a_stuck_registration_is_skipped(self):
        with mock.patch.object(computer.subprocess, "run", self.stuck):
            computer.register_app(Path("/tmp/a"))
        self.assertEqual(self.timeouts, [computer.REGISTER_TIMEOUT])


@unittest.skipIf(sys.platform == "darwin", "the refusal is for other systems")
class Unsupported(Sandbox):
    def test_setup_and_passthrough_say_macos_only_and_never_exec(self):
        self.serve_driver()
        with mock.patch.object(os, "execve") as execve:
            for argv in (["computer", "setup", "--no-grant"], ["computer", "list-tools"]):
                status, _, err = quiet(cli.main, argv)
                self.assertEqual(status, 1, argv)
                self.assertIn("needs macOS", err)
        execve.assert_not_called()
        self.assertEqual(self.downloads, [])
        self.assertEqual(list(self.applications.iterdir()), [])


class Launcher(Sandbox):
    def test_the_shim_never_captures_an_ardia_found_on_path(self):
        impostor = self.root / "evil" / "ardia"
        impostor.parent.mkdir()
        impostor.write_text("#!/bin/sh\n")
        impostor.chmod(0o755)
        with mock.patch.dict(os.environ, {"PATH": f"{impostor.parent}:/usr/bin:/bin"}), mock.patch.object(sys, "executable", "/usr/bin/python3"):
            with self.assertRaises(computer.Refused) as caught:
                computer.link_command()
        self.assertIn("installed ardia launcher", str(caught.exception))
        self.assertFalse(computer.shim_path().exists())
        self.assertFalse((self.home / "bin" / "cua-driver").exists())

    def test_the_shim_runs_the_installed_launcher(self):
        ardia = self.install_launcher()
        quiet(computer.link_command)
        self.assertIn(str(ardia), computer.shim_path().read_text())

    def test_a_current_link_pointing_outside_the_cli_home_isnt_trusted(self):
        elsewhere = self.root / "elsewhere"
        (elsewhere / "bin").mkdir(parents=True)
        (elsewhere / "bin" / "ardia").write_text("#!/bin/sh\n")
        self.cli_home.mkdir()
        (self.cli_home / "current").symlink_to(elsewhere)
        with mock.patch.object(sys, "executable", "/usr/bin/python3"), self.assertRaises(computer.Refused):
            computer.link_command()

    def test_the_running_installation_is_trusted_when_current_is_missing(self):
        root = self.root / "ardia-cli-0.0.1"
        (root / "python" / "bin").mkdir(parents=True)
        (root / "python" / "bin" / "python3").write_text("")
        (root / "bin").mkdir()
        (root / "bin" / "ardia").write_text("#!/bin/sh\n")
        with mock.patch.object(sys, "executable", str(root / "python" / "bin" / "python3")):
            self.assertEqual(computer.trusted_launcher(), root / "bin" / "ardia")


class McpConfig(Sandbox):
    def test_claude_code_and_codex_point_at_ardia_computer_mcp(self):
        ardia = self.install_launcher()
        _, out, _ = quiet(computer.main, ["mcp-config", "--target", "claude-code"])
        prefix = "claude mcp add-json --scope user cua-driver "
        self.assertTrue(out.startswith(prefix))
        import shlex

        entry = json.loads(shlex.split(out[len(prefix):])[0])
        self.assertEqual(entry, {"command": str(ardia), "args": ["computer", "mcp"]})
        _, out, _ = quiet(computer.main, ["mcp-config", "--target", "codex"])
        self.assertEqual(shlex.split(out), ["codex", "mcp", "add", "cua-driver", "--", str(ardia), "computer", "mcp"])
        _, out, _ = quiet(computer.main, ["mcp-config"])
        self.assertEqual(json.loads(out), {"mcpServers": {"cua-driver": {"command": str(ardia), "args": ["computer", "mcp"]}}})


class CuaSkills(Sandbox):
    def setUp(self):
        super().setUp()
        self.serve_skills()

    def cua(self, base: str = ".claude/skills") -> Path:
        return self.home / base / "cua-driver"

    def test_install_puts_the_pinned_cua_skill_next_to_ours(self):
        status, out, _ = quiet(skills.install, ["claude-code"], False)
        self.assertEqual(status, 0)
        folder = self.cua()
        self.assertEqual(sorted(entry.name for entry in folder.iterdir()), [skills.MARKER, "MACOS.md", "SKILL.md", "WORKFLOW.md"])
        marker = json.loads((folder / skills.MARKER).read_text())
        self.assertEqual((marker["vendor"], marker["skill"], marker["version"]), ("ardia", "cua-driver", computer.VERSION))
        self.assertIn(f"cua-driver {computer.VERSION}: {folder}", out)
        ours = json.loads((self.home / ".claude/skills/ardia" / skills.MARKER).read_text())
        self.assertEqual(ours["companions"], ["cua-driver"])

    def test_no_cua_skips_it(self):
        status, _, _ = quiet(cli.main, ["skills", "install", "--target", "codex", "--no-cua"])
        self.assertEqual(status, 0)
        self.assertFalse(self.cua(".agents/skills").exists())
        self.assertEqual(quiet(skills.refresh)[0], 0)
        self.assertFalse(self.cua(".agents/skills").exists())

    def test_a_cua_skill_from_cuas_installer_is_left_alone(self):
        theirs = self.home / ".cua-driver" / "skills" / "cua-driver"
        theirs.mkdir(parents=True)
        (theirs / "SKILL.md").write_text("theirs\n")
        (self.home / ".claude/skills").mkdir(parents=True)
        self.cua().symlink_to(theirs)
        status, out, _ = quiet(skills.install, ["claude-code"], False)
        self.assertEqual(status, 0)
        self.assertIn(f"kept {self.cua()}", out)
        self.assertEqual((theirs / "SKILL.md").read_text(), "theirs\n")
        self.assertEqual(sorted(entry.name for entry in theirs.iterdir()), ["SKILL.md"])
        _, out, _ = quiet(skills.refresh)
        self.assertEqual((theirs / "SKILL.md").read_text(), "theirs\n")
        self.assertTrue(self.cua().is_symlink())

    def test_an_unmarked_cua_folder_is_left_alone(self):
        folder = self.cua()
        folder.mkdir(parents=True)
        (folder / "SKILL.md").write_text("hand made\n")
        for marker in (None, '{"vendor": "ardia", "files": ["SKILL.md"]}'):
            if marker:
                (folder / skills.MARKER).write_text(marker)
            _, out, _ = quiet(skills.install, ["claude-code"], False)
            self.assertIn(f"kept {folder}", out)
            self.assertEqual((folder / "SKILL.md").read_text(), "hand made\n")

    def test_refresh_rewrites_ours_and_drops_files_it_no_longer_ships(self):
        quiet(skills.install, ["claude-code"], False)
        folder = self.cua()
        (folder / "mine.md").write_text("mine\n")
        self.serve_skills({f"{computer.SKILLS_TOP}/SKILL.md": b"v2\n", f"{computer.SKILLS_TOP}/MACOS.md": b"mac2\n"})
        shutil.rmtree(self.cli_home / "cua-driver" / computer.VERSION / "skills")
        status, out, _ = quiet(skills.refresh)
        self.assertEqual(status, 0)
        self.assertEqual((folder / "SKILL.md").read_text(), "v2\n")
        self.assertFalse((folder / "WORKFLOW.md").exists())
        self.assertTrue((folder / "mine.md").exists())
        self.assertIn(f"refreshed {folder}", out)

    def test_refresh_never_writes_through_a_linked_file(self):
        quiet(skills.install, ["claude-code"], False)
        target = self.root / "elsewhere.md"
        target.write_text("theirs\n")
        (self.cua() / "SKILL.md").unlink()
        (self.cua() / "SKILL.md").symlink_to(target)
        self.assertEqual(quiet(skills.refresh)[0], 0)
        self.assertEqual(target.read_text(), "theirs\n")
        self.assertFalse((self.cua() / "SKILL.md").is_symlink())

    def test_refresh_adds_it_once_to_copies_from_before_and_never_brings_back_a_deleted_one(self):
        quiet(skills.install, ["claude-code"], False, False)
        ours = self.home / ".claude/skills/ardia" / skills.MARKER
        data = json.loads(ours.read_text())
        del data["companions"]
        ours.write_text(json.dumps(data))
        self.assertEqual(quiet(skills.refresh)[0], 0)
        self.assertTrue((self.cua() / "SKILL.md").is_file())
        shutil.rmtree(self.cua())
        self.assertEqual(quiet(skills.refresh)[0], 0)
        self.assertFalse(self.cua().exists())
        quiet(skills.install, ["claude-code"], False)
        self.assertTrue(self.cua().exists())

    def test_a_failed_download_is_reported_and_retried_on_the_next_refresh(self):
        self.served.clear()
        status, out, _ = quiet(skills.install, ["claude-code"], False)
        self.assertEqual(status, 1)
        self.assertIn(f"error {self.cua()}", out)
        self.assertTrue((self.home / ".claude/skills/ardia/SKILL.md").is_file())
        self.assertNotIn("companions", json.loads((self.home / ".claude/skills/ardia" / skills.MARKER).read_text()))
        self.serve_skills()
        self.assertEqual(quiet(skills.refresh)[0], 0)
        self.assertTrue((self.cua() / "SKILL.md").is_file())

    def test_a_cua_skill_checksum_mismatch_installs_nothing(self):
        with mock.patch.object(computer, "SKILLS_SHA256", "f" * 64):
            status, out, _ = quiet(skills.install, ["claude-code"], False)
        self.assertEqual(status, 1)
        self.assertIn("checksum mismatch", out)
        self.assertFalse(self.cua().exists())

    def test_the_ardia_marker_doesnt_claim_a_cua_folder_and_back(self):
        quiet(skills.install, ["claude-code"], False)
        self.assertIsNone(skills.marked_files(self.cua()))
        self.assertIsNone(skills.marked_files(self.home / ".claude/skills/ardia", skills.CUA_SKILL))


if __name__ == "__main__":
    unittest.main()
