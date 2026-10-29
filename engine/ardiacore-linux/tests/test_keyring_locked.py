import os
import pathlib
import secrets
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

import test_live
import test_sync

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
CONTROL = ROOT / 'tests/fixtures/keyring_control.py'
PASSWORD = secrets.token_hex(16)
TOOLS = ['dbus-daemon', 'gnome-keyring-daemon', 'node', 'Xvfb', 'xdotool']
PROMPTER = pathlib.Path('/usr/lib/gcr-prompter')
BUS_CONFIG = '''<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:path={bus}</listen>
  <servicedir>{services}</servicedir>
  <policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy>
</busconfig>
'''


def has_gi():
    return subprocess.run(['python3', '-I', '-c', 'import gi'], capture_output=True).returncode == 0


def stop(process):
    if not process:
        return
    for sig in [signal.SIGTERM, signal.SIGKILL]:
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            continue


class KeyringLockedAtLaunchTests(unittest.TestCase):
    def test_live_tokens_and_the_sync_key_in_a_private_gnome_keyring_locked_at_launch(self):
        missing = [tool for tool in TOOLS if shutil.which(tool) is None]
        if not PROMPTER.exists():
            missing.append(str(PROMPTER))
        if missing or not test_live.LIBSECRET or not has_gi():
            self.skipTest(f'needs {", ".join(missing) or "libsecret and python gi"}')
        if not (REPO / 'node_modules').exists():
            self.skipTest('workspace dependencies are not installed')
        with tempfile.TemporaryDirectory(prefix='ardia-keyring-') as directory:
            root = pathlib.Path(directory)
            home = root / 'home'
            runtime = root / 'run'
            (home / '.local/share/keyrings').mkdir(parents=True)
            runtime.mkdir(mode=0o700)
            services = root / 'services'
            services.mkdir()
            for name in ['SystemPrompter', 'PrivatePrompter']:
                (services / f'org.gnome.keyring.{name}.service').write_text(
                    f'[D-BUS Service]\nName=org.gnome.keyring.{name}\nExec={PROMPTER}\n')
            (root / 'bus.conf').write_text(BUS_CONFIG.format(bus=root / 'bus', services=services))
            address = f'unix:path={root / "bus"}'
            env = {key: value for key, value in os.environ.items()
                   if key not in {'DISPLAY', 'WAYLAND_DISPLAY', 'GNOME_KEYRING_CONTROL', 'SSH_AUTH_SOCK', 'DBUS_SYSTEM_BUS_ADDRESS'}}
            env.update({'HOME': str(home), 'XDG_DATA_HOME': str(home / '.local/share'), 'XDG_RUNTIME_DIR': str(runtime),
                        'XDG_CONFIG_HOME': str(home / '.config'), 'DBUS_SESSION_BUS_ADDRESS': address,
                        'DBUS_SYSTEM_BUS_ADDRESS': f'unix:path={root / "no-system-bus"}', 'GDK_BACKEND': 'x11'})
            read, write = os.pipe()
            screen = subprocess.Popen(['Xvfb', '-displayfd', str(write), '-screen', '0', '1024x768x24', '-nolisten', 'tcp'],
                                      env=env, pass_fds=[write], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                      start_new_session=True)
            os.close(write)
            bus = daemon = None
            try:
                with os.fdopen(read) as displayfd:
                    display = f':{displayfd.readline().strip()}'
                self.assertNotEqual(display, ':', 'Xvfb never reported its display')
                env['PROMPT_DISPLAY'] = display
                bus = subprocess.Popen(['dbus-daemon', f'--config-file={root / "bus.conf"}', '--nofork'],
                                       env={**env, 'DISPLAY': display}, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, start_new_session=True)
                deadline = time.monotonic() + 10
                while not (root / 'bus').exists():
                    self.assertIsNone(bus.poll(), 'dbus-daemon exited')
                    self.assertLess(time.monotonic(), deadline, 'dbus-daemon never listened')
                    time.sleep(0.05)
                daemon = subprocess.Popen(['gnome-keyring-daemon', '--foreground', '--components=secrets', '--unlock'],
                                          env=env, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                          stderr=subprocess.DEVNULL, start_new_session=True)
                daemon.stdin.write(PASSWORD.encode())
                daemon.stdin.close()
                deadline = time.monotonic() + 15
                while True:
                    probe = subprocess.run(['python3', '-I', str(CONTROL), address, 'locked'], env=env,
                                           capture_output=True, text=True, timeout=30)
                    if probe.returncode == 0 and probe.stdout.strip() == 'false':
                        break
                    self.assertIsNone(daemon.poll(), 'gnome-keyring-daemon exited')
                    self.assertLess(time.monotonic(), deadline, probe.stderr)
                    time.sleep(0.2)
                live_tool = test_live.build(self, directory)
                sync_tool = test_sync.build(self, directory, 'sync_device_tool', 'sync_device_tool.cc')
                result = subprocess.run([
                    'node', '--experimental-strip-types', '--no-warnings', '--import',
                    str(REPO / 'apps/linux/scripts/host-test-loader.mjs'), '--test', '--test-reporter=tap',
                    str(ROOT / 'tests/keyring_locked.test.mjs')], env={
                        **env, 'LIVE_HOST_TOOL': str(live_tool), 'SYNC_DEVICE_TOOL': str(sync_tool),
                        'LIBSECRET': test_live.LIBSECRET, 'KEYRING_CONTROL': str(CONTROL), 'KEYRING_PASSWORD': PASSWORD,
                        'ASAN_OPTIONS': 'detect_leaks=0'}, capture_output=True, text=True, timeout=300)
                output = result.stdout + result.stderr
                self.assertEqual(result.returncode, 0, output)
                self.assertIn('# pass 2', output)
                self.assertIn('# skipped 0', output)
                self.assertNotIn('AddressSanitizer', output)
            finally:
                for process in [daemon, bus, screen]:
                    stop(process)


if __name__ == '__main__':
    unittest.main()
