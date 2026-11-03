import hashlib
import io
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import automation_cli, browsing, config_files, control, endpoint, hooks, scripts_store
from test_automation import Base
from test_config import Sandbox

ON_LINUX = sys.platform.startswith("linux")
INSTALL_SH = Path(__file__).resolve().parents[1] / "install.sh"


def write_control(folder: Path, pid: int | None = None) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / endpoint.CONTROL_FILE
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.write(fd, json.dumps({"port": 9222, "browser": "/devtools/browser/abc-123", "token": "t" * 32, "pid": pid or os.getpid(), "generation": 1}).encode())
    os.close(fd)
    return path


class DataDir(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix="ardia-linux-test-")).resolve()
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.home = self.temp / "home"
        self.home.mkdir()
        patch = mock.patch.dict(os.environ, {"HOME": str(self.home), "XDG_CONFIG_HOME": "", "ARDIA_CONFIG_HOME": "", "ARDIA_DATA_DIR": "", "ARDIA_CDP_URL": ""})
        patch.start()
        self.addCleanup(patch.stop)

    def test_default_data_dir_follows_chromium(self):
        self.assertEqual(endpoint.installed_data_dir(linux=True), self.home / ".config" / "ardia")
        with mock.patch.dict(os.environ, {"XDG_CONFIG_HOME": str(self.temp / "xdg")}):
            self.assertEqual(endpoint.installed_data_dir(linux=True), self.temp / "xdg" / "ardia")
            with mock.patch.dict(os.environ, {"ARDIA_CONFIG_HOME": str(self.temp / "override")}):
                self.assertEqual(endpoint.installed_data_dir(linux=True), self.temp / "override" / "ardia")

    def test_macos_data_dir_is_unchanged(self):
        with mock.patch.dict(os.environ, {"XDG_CONFIG_HOME": str(self.temp / "xdg")}):
            self.assertEqual(endpoint.installed_data_dir(linux=False), self.home / "Library" / "Application Support" / "com.ardia.browser")
        self.assertEqual(endpoint.chromium_dir(self.temp, linux=False), self.temp / "Chromium")
        self.assertEqual(endpoint.chromium_dir(self.temp, linux=True), self.temp)

    def test_control_file_sits_in_the_data_dir_on_linux(self):
        data = self.temp / "data"
        write_control(data / "Chromium")
        with mock.patch.object(endpoint, "LINUX", True):
            with self.assertRaises(endpoint.EndpointError):
                endpoint.resolve(data_dir=str(data))
            write_control(data)
            found = endpoint.resolve(data_dir=str(data))
            self.assertEqual(found.source, str(data / endpoint.CONTROL_FILE))
            self.assertTrue(found.ws.startswith("ws://127.0.0.1:9222/devtools/browser/abc-123?token="))
        with mock.patch.object(endpoint, "LINUX", False):
            self.assertEqual(endpoint.resolve(data_dir=str(data)).source, str(data / "Chromium" / endpoint.CONTROL_FILE))

    def test_installed_data_dir_is_the_default_root(self):
        installed = self.temp / "installed"
        write_control(installed)
        with mock.patch.object(endpoint, "LINUX", True), mock.patch.object(endpoint, "INSTALLED_DATA_DIR", installed):
            self.assertEqual(endpoint.resolve().source, str(installed / endpoint.CONTROL_FILE))
            self.assertEqual(control.socket_path(), installed / control.SOCKET_FILE)

    def test_history_profiles_sit_in_the_data_dir_on_linux(self):
        for name in ("Default", "Profile 1", "Guest Profile", "System Profile"):
            (self.temp / name).mkdir()
            (self.temp / name / "History").write_bytes(b"")
        with mock.patch.object(endpoint, "LINUX", True):
            self.assertEqual([p.name for _, p in browsing.profile_dirs(self.temp, {})], ["Default", "Profile 1"])
        with mock.patch.object(endpoint, "LINUX", False):
            self.assertEqual(browsing.profile_dirs(self.temp, {}), [])


class LinuxConfig(Sandbox):
    def setUp(self):
        super().setUp()
        patch = mock.patch.object(endpoint, "LINUX", True)
        patch.start()
        self.addCleanup(patch.stop)

    def test_config_folder_is_the_config_subfolder_of_chromiums_data_dir(self):
        with mock.patch.dict(os.environ, {"ARDIA_DATA_DIR": ""}):
            out, _ = self.ok("config", "path")
            self.assertEqual(out.strip(), str(self.installed / "config"))
            self.assertEqual(config_files.places().schema_candidates("config.schema.json"),
                             [self.installed / "config" / "config.schema.json", self.installed / "config-schema" / "config.schema.json"])
            with mock.patch.dict(os.environ, {"XDG_CONFIG_HOME": str(self.temp / "xdg")}):
                with mock.patch.object(endpoint, "INSTALLED_DATA_DIR", endpoint.installed_data_dir()):
                    out, _ = self.ok("config", "path")
            self.assertEqual(out.strip(), str(self.temp / "xdg" / "ardia" / "config"))

    def test_edit_falls_back_to_xdg_open_without_waiting(self):
        with mock.patch("shutil.which", return_value="/usr/bin/xdg-open"), mock.patch("subprocess.call", return_value=0) as call:
            out, _ = self.ok("config", "edit")
        call.assert_called_once_with(["/usr/bin/xdg-open", str(self.folder / "config.json")])
        self.assertIn("run ardia config check once you've saved it", out)
        self.assertNotIn("config.json: ok", out)

    def test_edit_without_xdg_open_uses_vi(self):
        with mock.patch("shutil.which", return_value=None), mock.patch("subprocess.call", return_value=0) as call:
            self.ok("config", "edit")
        call.assert_called_once_with(["vi", str(self.folder / "config.json")])

    def test_editor_variables_still_win(self):
        with mock.patch.dict(os.environ, {"EDITOR": "nano"}), mock.patch("shutil.which", return_value="/usr/bin/xdg-open"), mock.patch("subprocess.call", return_value=0) as call:
            out, _ = self.ok("config", "edit")
        self.assertEqual(call.call_args[0][0][0], "nano")
        self.assertIn("config.json: ok", out)


class SystemdService(Base):
    def setUp(self):
        super().setUp()
        launcher = self.temp / "cli" / "current" / "bin" / "ardia"
        launcher.parent.mkdir(parents=True)
        launcher.write_text("#!/bin/sh\n")
        self.launcher = launcher
        self.calls = []
        self.show = "LoadState=loaded\nActiveState=active\nSubState=running\nUnitFileState=enabled\nMainPID=4242\nExecMainStatus=0\n"

        def fake(arguments):
            self.calls.append(arguments)
            return SimpleNamespace(returncode=0, stdout=self.show if arguments[0] == "show" else "", stderr="")

        for patch in (mock.patch.object(hooks, "systemctl", side_effect=fake), mock.patch.object(endpoint, "LINUX", True)):
            patch.start()
            self.addCleanup(patch.stop)
        self.unit = self.home / ".config" / "systemd" / "user" / hooks.SERVICE

    def installed_env(self, **extra):
        return mock.patch.dict(os.environ, {"ARDIA_DATA_DIR": "", "PATH": "/usr/local/bin:/usr/bin:/bin", **extra})

    def test_install_list_uninstall(self):
        with self.installed_env():
            status, out, err = self.run_cli("hooks", "install")
        self.assertEqual(status, 0, err)
        text = self.unit.read_text()
        log = self.home / ".local" / "state" / "ardia" / "hooks.log"
        self.assertIn(f'ExecStart="{self.launcher}" "hooks" "run" "--log" "{log}"\n', text)
        self.assertIn("Restart=on-failure\n", text)
        self.assertIn("RestartSec=10\n", text)
        self.assertIn("StartLimitIntervalSec=0\n", text)
        self.assertIn(f"WorkingDirectory={self.home}\n", text)
        self.assertIn('Environment="PATH=/usr/local/bin:/usr/bin:/bin" "ARDIA_DATA_DIR="\n', text)
        self.assertIn("WantedBy=default.target\n", text)
        self.assertTrue(log.parent.is_dir())
        self.assertEqual(self.calls, [["daemon-reload"], ["enable", hooks.SERVICE], ["restart", hooks.SERVICE]])
        self.assertIn(f"installed {hooks.SERVICE}: {self.unit}", out)
        self.assertFalse((self.home / "Library").exists())
        with self.installed_env():
            status, out, _ = self.run_cli("hooks", "list")
        self.assertIn(f"systemd user service {hooks.SERVICE}: active (pid 4242)", out)
        self.assertEqual(self.calls[-1][:2], ["show", hooks.SERVICE])
        with self.installed_env():
            status, out, _ = self.run_cli("hooks", "list", "--json")
        agent = json.loads(out)["agent"]
        self.assertEqual((agent["installed"], agent["loaded"], agent["active"], agent["pid"], agent["enabled"]), (True, True, True, 4242, "enabled"))
        self.show = "LoadState=loaded\nActiveState=failed\nSubState=failed\nUnitFileState=enabled\nMainPID=0\nExecMainStatus=1\n"
        with self.installed_env():
            status, out, _ = self.run_cli("hooks", "list")
        self.assertIn(f"systemd user service {hooks.SERVICE}: installed, failed", out)
        with self.installed_env():
            status, out, _ = self.run_cli("hooks", "uninstall")
        self.assertEqual((status, out.strip()), (0, f"uninstalled {hooks.SERVICE}"))
        self.assertFalse(self.unit.exists())
        self.assertEqual(self.calls[-2:], [["disable", "--now", hooks.SERVICE], ["daemon-reload"]])
        with self.installed_env():
            status, out, _ = self.run_cli("hooks", "uninstall")
        self.assertEqual((status, out.strip()), (0, f"{hooks.SERVICE} wasn't installed"))

    def test_xdg_homes(self):
        config, state, data = self.temp / "xc", self.temp / "xs", self.temp / "xd"
        with self.installed_env(XDG_CONFIG_HOME=str(config), XDG_STATE_HOME=str(state), XDG_DATA_HOME=str(data), ARDIA_CLI_HOME=""):
            paths = hooks.agent_paths()
        self.assertEqual(paths.unit, config / "systemd" / "user" / hooks.SERVICE)
        self.assertEqual(paths.log, state / "ardia" / "hooks.log")
        self.assertEqual(paths.launcher, data / "ardia" / "cli" / "current" / "bin" / "ardia")
        with self.installed_env(ARDIA_CLI_HOME=""):
            self.assertEqual(hooks.agent_paths().launcher, self.home / ".local" / "share" / "ardia" / "cli" / "current" / "bin" / "ardia")
        with self.installed_env(XDG_CONFIG_HOME="relative", XDG_STATE_HOME="relative", XDG_DATA_HOME="relative", ARDIA_CLI_HOME=""):
            paths = hooks.agent_paths()
        self.assertEqual(paths.unit, self.home / ".config" / "systemd" / "user" / hooks.SERVICE)
        self.assertEqual(paths.log, self.home / ".local" / "state" / "ardia" / "hooks.log")
        self.assertEqual(paths.launcher, self.home / ".local" / "share" / "ardia" / "cli" / "current" / "bin" / "ardia")

    def test_systemctl_failures(self):
        def failing(arguments):
            self.calls.append(arguments)
            return SimpleNamespace(returncode=1 if arguments[0] == "enable" else 0, stdout="", stderr="Failed to connect to bus: No medium found")

        with self.installed_env(), mock.patch.object(hooks, "systemctl", side_effect=failing):
            status, _, err = self.run_cli("hooks", "install")
        self.assertEqual(status, 1)
        self.assertIn(f"systemctl --user enable {hooks.SERVICE} failed (Failed to connect to bus: No medium found)", err)
        with self.installed_env(), mock.patch.object(hooks, "systemctl", side_effect=FileNotFoundError(2, "No such file")):
            status, _, err = self.run_cli("hooks", "install")
        self.assertEqual(status, 1)
        self.assertIn("systemctl isn't installed", err)
        with self.installed_env(), mock.patch.object(hooks, "systemctl", side_effect=FileNotFoundError(2, "No such file")):
            status, out, _ = self.run_cli("hooks", "list")
        self.assertIn("state unknown", out)

    def test_refused_with_scratch_data_dir(self):
        for verb in ("install", "uninstall"):
            status, _, err = self.run_cli("hooks", verb)
            self.assertEqual(status, 1)
            self.assertIn("the systemd user service is for the installed Ardia only", err)
        self.assertEqual(self.calls, [])
        self.assertFalse(self.unit.exists())

    def test_unit_quoting(self):
        paths = hooks.AgentPaths(Path("/home/a b"), Path("/opt/100%/c\"li"), True, Path("/home/a b/.config"), Path("/home/a b/$state"))
        text = hooks.service_unit(paths, "/bin:/x$y%z")
        self.assertIn('ExecStart="/opt/100%%/c\\"li/current/bin/ardia" "hooks" "run" "--log" "/home/a b/$$state/ardia/hooks.log"\n', text)
        self.assertIn('Environment="PATH=/bin:/x$y%%z" "ARDIA_DATA_DIR="\n', text)
        self.assertIn("WorkingDirectory=/home/a b\n", text)
        with self.assertRaises(hooks.HooksError):
            hooks.service_unit(hooks.AgentPaths(Path("/home/a\nb"), Path("/cli"), True, Path("/c"), Path("/s")), None)

    def test_unit_passes_systemd_analyze(self):
        analyze = shutil.which("systemd-analyze")
        if not analyze:
            self.skipTest("systemd-analyze isn't installed")
        self.launcher.chmod(0o755)
        folder = self.temp / "units"
        folder.mkdir()
        paths = hooks.AgentPaths(self.home, self.temp / "cli", True, self.home / ".config", self.home / ".local" / "state")
        (folder / hooks.SERVICE).write_text(hooks.service_unit(paths, "/usr/bin:/bin"))
        result = subprocess.run([analyze, "verify", "--man=no", str(folder / hooks.SERVICE)], capture_output=True, text=True, timeout=30, env={**os.environ, "SYSTEMD_LOG_LEVEL": "warning"})
        problems = [line for line in (result.stdout + result.stderr).splitlines() if hooks.SERVICE in line]
        self.assertEqual(problems, [])

    def test_help_names_the_service(self):
        status, out, _ = self.run_cli("hooks", "--help")
        self.assertIn("systemd user service", out)
        self.assertIn("${XDG_STATE_HOME:-~/.local/state}/ardia/hooks.log", out)
        self.assertNotIn("LaunchAgent", out)
        status, out, _ = self.run_cli("hooks", "install", "--help")
        self.assertIn(f"systemd/user/{hooks.SERVICE}", out)
        with mock.patch.object(endpoint, "LINUX", False):
            status, out, _ = self.run_cli("hooks", "--help")
        self.assertIn("LaunchAgent (dev.ardia.hooks)", out)
        self.assertIn("~/Library/Logs/Ardia/hooks.log", out)
        self.assertNotIn("systemd", out)


@unittest.skipUnless(ON_LINUX, "Linux only")
class LinuxKernel(unittest.TestCase):
    def test_peer_uid(self):
        first, second = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        with first, second:
            self.assertEqual(control.peer_uid(first), os.getuid())

    def test_long_socket_path_limit(self):
        with tempfile.TemporaryDirectory(prefix="ardia-") as temp:
            deep = Path(temp) / ("x" * (control.LINUX_SUN_PATH_MAX - len(temp) - len(control.SOCKET_FILE) + 1))
            with self.assertRaises(control.Unreachable) as caught:
                control.check_socket(deep / control.SOCKET_FILE)
            self.assertIn(f"over the {control.LINUX_SUN_PATH_MAX}", str(caught.exception))

    def test_exchange_rename(self):
        with tempfile.TemporaryDirectory(prefix="ardia-swap-") as temp:
            root = Path(temp)
            (root / "a").mkdir()
            (root / "a" / "x").write_text("a")
            (root / "b").mkdir()
            (root / "b" / "y").write_text("b")
            fd = os.open(temp, os.O_RDONLY | os.O_DIRECTORY)
            try:
                scripts_store.swap(fd, "a", "b")
                with self.assertRaises(FileNotFoundError):
                    scripts_store.swap(fd, "a", "missing")
            finally:
                os.close(fd)
            self.assertEqual(sorted(os.listdir(root / "a")), ["y"])
            self.assertEqual(sorted(os.listdir(root / "b")), ["x"])


def fake_tarball(folder: Path, version: str) -> Path:
    path = folder / f"ardia-cli-{version}-linux-x64.tar.gz"
    with tarfile.open(path, "w:gz") as archive:
        def add(name, data=None, mode=0o755):
            info = tarfile.TarInfo(f"ardia-cli-{version}{name}")
            info.mtime = int(time.time())
            if data is None:
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                archive.addfile(info)
            else:
                info.mode = mode
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))

        add("")
        add("/bin")
        add("/.leases")
        add("/bin/ardia", f"#!/bin/sh\necho 'ardia {version}'\n".encode())
        link = tarfile.TarInfo(f"ardia-cli-{version}/bin/python3")
        link.type = tarfile.SYMTYPE
        link.linkname = "ardia"
        archive.addfile(link)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    (folder / f"{path.name}.sha256").write_text(f"{digest}  {path.name}\n")
    return path


@unittest.skipUnless(ON_LINUX and platform.machine() == "x86_64" and shutil.which("flock") and shutil.which("sha256sum"), "Linux x86_64 with flock and sha256sum")
class InstallScript(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix="ardia-install-test-")).resolve()
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.dist = self.temp / "dist"
        self.dist.mkdir()
        self.tools = self.temp / "tools"
        self.tools.mkdir()
        self.use_home("home")

    def use_home(self, name):
        self.home = self.temp / name
        self.home.mkdir()
        self.cli_home = self.home / ".local" / "share" / "ardia" / "cli"
        self.bin = self.home / ".local" / "bin" / "ardia"

    def login_shell(self, name: str) -> Path:
        shell = self.tools / "shells" / name
        shell.parent.mkdir(exist_ok=True)
        shell.write_text("#!/bin/sh\nprintf '%s' /usr/bin:/bin\n")
        shell.chmod(0o755)
        getent = self.tools / "getent"
        getent.write_text(f"#!/bin/sh\necho \"me:x:1000:1000::/home/me:{shell}\"\n")
        getent.chmod(0o755)
        return shell

    def install(self, version=None, *args, url_version=None, env=None):
        url_version = url_version or version
        tarball = self.dist / f"ardia-cli-{url_version}-linux-x64.tar.gz"
        if not tarball.exists():
            fake_tarball(self.dist, url_version)
        environment = {
            "PATH": f"{self.tools}:/usr/local/bin:/usr/bin:/bin",
            "HOME": str(self.home),
            "TMPDIR": str(self.temp),
            "ARDIA_CLI_URL": f"file://{tarball}",
            "SHELL": "/bin/sh",
        }
        environment.update(env or {})
        command = ["/bin/sh", str(INSTALL_SH)]
        if version:
            command += ["--version", version]
        result = subprocess.run(command + list(args), capture_output=True, text=True, env=environment, timeout=60)
        return result.returncode, result.stdout.splitlines(), result.stderr

    def versions(self):
        return sorted(p.name for p in self.cli_home.iterdir() if not p.name.startswith(".") and p.name != "current")

    def current(self):
        return os.readlink(self.cli_home / "current")

    def test_install_noop_upgrade_and_retention(self):
        self.login_shell("zsh")
        status, lines, err = self.install("0.0.1")
        self.assertEqual(status, 0, err)
        self.assertEqual(lines, ["step resolve", "version 0.0.1", "step download", "step verify", "step install", "step link", f"path {self.home / '.zprofile'}", f"installed {self.bin}"])
        self.assertEqual(os.readlink(self.bin), str(self.cli_home / "current" / "bin" / "ardia"))
        self.assertEqual(self.current(), "0.0.1")
        self.assertEqual(subprocess.run([str(self.bin)], capture_output=True, text=True).stdout.strip(), "ardia 0.0.1")
        self.assertEqual((self.home / ".zprofile").read_text(), 'export PATH="$HOME/.local/bin:$PATH"\n')

        status, lines, _ = self.install("0.0.1")
        self.assertEqual((status, lines), (0, ["step resolve", "version 0.0.1", f"installed {self.bin}"]))

        digest = hashlib.sha256(fake_tarball(self.dist, "0.0.2").read_bytes()).hexdigest()
        status, lines, err = self.install("0.0.2", "--sha256", digest)
        self.assertEqual(status, 0, err)
        self.assertEqual(lines, ["step resolve", "version 0.0.2", "step download", "step verify", "step install", f"installed {self.bin}"])
        self.assertEqual((self.current(), self.versions()), ("0.0.2", ["0.0.1", "0.0.2"]))
        self.assertEqual((self.home / ".zprofile").read_text().count("export PATH"), 1)

        status, _, err = self.install("0.0.3")
        self.assertEqual(status, 0, err)
        self.assertEqual((self.current(), self.versions()), ("0.0.3", ["0.0.2", "0.0.3"]))

        lease = self.cli_home / "0.0.2" / ".leases" / str(os.getpid())
        lease.write_text("")
        dead = subprocess.Popen(["true"])
        dead.wait()
        (self.cli_home / "0.0.3" / ".leases" / str(dead.pid)).write_text("")
        status, _, err = self.install("0.0.4")
        self.assertEqual(status, 0, err)
        self.assertEqual((self.current(), self.versions()), ("0.0.4", ["0.0.2", "0.0.3", "0.0.4"]))
        lease.unlink()
        status, _, err = self.install("0.0.5")
        self.assertEqual(status, 0, err)
        self.assertEqual((self.current(), self.versions()), ("0.0.5", ["0.0.4", "0.0.5"]))
        self.assertTrue((self.cli_home / ".lock").is_file())

        status, lines, _ = self.install(None, "--uninstall")
        self.assertEqual((status, lines), (0, ["step uninstall", "uninstalled"]))
        self.assertFalse(os.path.lexists(self.bin))
        self.assertEqual(sorted(os.listdir(self.cli_home)), [".lock"])

    def test_version_from_url_and_xdg_data_home(self):
        self.login_shell("zsh")
        data = self.temp / "xdg-data"
        status, lines, err = self.install(None, url_version="0.0.7", env={"XDG_DATA_HOME": str(data)})
        self.assertEqual(status, 0, err)
        self.assertIn("version 0.0.7", lines)
        self.assertEqual(os.readlink(data / "ardia" / "cli" / "current"), "0.0.7")
        self.assertEqual(os.readlink(self.bin), str(data / "ardia" / "cli" / "current" / "bin" / "ardia"))
        self.use_home("home-relative")
        self.login_shell("zsh")
        status, _, err = self.install("0.0.7", env={"XDG_DATA_HOME": "relative/data"})
        self.assertEqual(status, 0, err)
        self.assertEqual(os.readlink(self.cli_home / "current"), "0.0.7")

    def test_login_file_per_shell(self):
        cases = [("zsh", None, ".zprofile"), ("bash", None, ".profile"), ("bash", ".bash_profile", ".bash_profile"), ("fish", None, ".profile"), ("sh", None, ".profile")]
        for index, (shell, existing, expected) in enumerate(cases):
            with self.subTest(shell=shell, existing=existing):
                self.use_home(f"home-{index}")
                self.login_shell(shell)
                if existing:
                    (self.home / existing).write_text("# mine")
                status, lines, err = self.install("0.0.1")
                self.assertEqual(status, 0, err)
                self.assertIn(f"path {self.home / expected}", lines)
                self.assertTrue((self.home / expected).read_text().endswith('\nexport PATH="$HOME/.local/bin:$PATH"\n' if existing else 'export PATH="$HOME/.local/bin:$PATH"\n'))

    def test_no_path_line_when_login_path_has_the_bin_dir(self):
        shell = self.login_shell("bash")
        shell.write_text("#!/bin/sh\nprintf '%s' \"/usr/bin:$HOME/.local/bin\"\n")
        status, lines, err = self.install("0.0.1")
        self.assertEqual(status, 0, err)
        self.assertFalse([line for line in lines if line.startswith("path ")])
        self.assertFalse((self.home / ".profile").exists())

    def test_custom_bin_dir_skips_the_path_line(self):
        self.login_shell("zsh")
        bin_dir = self.temp / "bin"
        status, lines, err = self.install("0.0.1", env={"ARDIA_CLI_BIN_DIR": str(bin_dir)})
        self.assertEqual(status, 0, err)
        self.assertEqual(lines[-1], f"installed {bin_dir / 'ardia'}")
        self.assertFalse(any(line.startswith("path ") for line in lines))

    def test_refuses_a_foreign_ardia(self):
        self.login_shell("zsh")
        self.bin.parent.mkdir(parents=True)
        self.bin.write_text("#!/bin/sh\n")
        status, lines, _ = self.install("0.0.1")
        self.assertEqual(status, 1)
        self.assertEqual(lines[-1], f"error {self.bin} already exists and isn't this CLI's link; move it away and run this again")
        self.assertFalse(self.cli_home.exists())

    def test_checksum_mismatch(self):
        self.login_shell("zsh")
        status, lines, _ = self.install("0.0.1", "--sha256", "0" * 64)
        self.assertEqual(status, 1)
        self.assertTrue(lines[-1].startswith("error checksum mismatch: expected " + "0" * 64))
        self.assertFalse((self.cli_home / "current").exists())

    def test_download_needs_a_pinned_digest(self):
        status, lines, _ = self.install("0.0.1", env={"ARDIA_CLI_URL": ""})
        self.assertEqual(status, 1)
        self.assertTrue(lines[-1].startswith("error no --sha256"))

    def test_refuses_links_out_of_the_tree(self):
        self.login_shell("zsh")
        path = self.dist / "ardia-cli-0.0.9-linux-x64.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            link = tarfile.TarInfo("ardia-cli-0.0.9/bin/ardia")
            link.type = tarfile.SYMTYPE
            link.linkname = "/bin/sh"
            archive.addfile(link)
        (self.dist / f"{path.name}.sha256").write_text(hashlib.sha256(path.read_bytes()).hexdigest() + "\n")
        status, lines, _ = self.install("0.0.9")
        self.assertEqual((status, lines[-1]), (1, "error the tarball has links that point outside it"))


if __name__ == "__main__":
    unittest.main()
