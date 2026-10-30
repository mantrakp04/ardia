import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
LINUX = ROOT / 'src/ardia/linux'
SEALED = REPO / 'packages/sync/tests/fixtures/sealed-0.2.32.b64'
WORDLIST = REPO / 'packages/sync/ios/Core/Wordlist.swift'
HELPERS = ['ac_linux_sync.cc', 'ac_linux_sync_crypto.cc', 'ac_linux_sync_wordlist.cc', 'ac_linux_sync_json.cc',
           'ac_linux_sync_vault.cc', 'ac_linux_sync_keystore.cc', 'ac_linux_credentials.cc']


def build(test, directory, name, fixture):
    compiler = shutil.which('clang++') or shutil.which('c++')
    if compiler is None:
        test.skipTest('C++ compiler is unavailable')
    executable = pathlib.Path(directory) / name
    compiled = subprocess.run([
        compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g', '-fsanitize=address,undefined',
        '-fno-omit-frame-pointer', '-I', str(ROOT / 'src'), *[str(LINUX / source) for source in HELPERS],
        str(ROOT / 'tests/fixtures' / fixture), '-o', str(executable), '-lcrypto', '-ldl',
    ], capture_output=True, text=True, timeout=300)
    test.assertEqual(compiled.returncode, 0, compiled.stderr)
    return executable


def run(test, command, env=None, timeout=120):
    result = subprocess.run([str(part) for part in command], capture_output=True, text=True, timeout=timeout,
                            env={**os.environ, **(env or {})})
    test.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    return result.stdout


class SyncHelperTests(unittest.TestCase):
    def test_crypto_vault_keystore_core_and_cross_format_exchange(self):
        if shutil.which('node') is None:
            self.skipTest('node is unavailable')
        with tempfile.TemporaryDirectory(prefix='ardia-sync-') as directory:
            root = pathlib.Path(directory)
            for name in ['scratch', 'reference', 'linux']:
                (root / name).mkdir()
            run(self, ['node', ROOT / 'tests/sync_reference.mjs', 'generate', root / 'reference', WORDLIST])
            scenarios = build(self, directory, 'sync_scenarios', 'sync_scenarios.cc')
            fixture_secret = secrets.token_hex(8)
            output = run(self, [scenarios, root / 'scratch', SEALED, root / 'reference', root / 'linux'],
                         env={'ARDIA_FIXTURE_SECRET': fixture_secret})
            self.assertIn('sync scenarios passed', output)
            self.assertIn('mac-vector chain gbcx4r55mk3rlaegbggknyx4ta scope nr4ncp5iyqzqgjn6ol4zksqtne', output)
            self.assertIn('cross-format reference files opened and Linux files written', output)
            verified = run(self, ['node', ROOT / 'tests/sync_reference.mjs', 'verify', root / 'linux'])
            self.assertIn('reference verified 2 Linux files and 1 passwords', verified)
            self.assertNotIn(fixture_secret, output)
            native = re.findall(r'^capability (\S+)$', output, re.M)
            script = ("import('./src/hostSync.ts').then((m) => console.log(JSON.stringify(m.SYNC_CAPABILITIES)))")
            result = subprocess.run(['node', '--experimental-strip-types', '--input-type=module', '-e', script],
                                    cwd=REPO / 'apps/linux', capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(sorted(native), sorted(json.loads(result.stdout)))

    def test_two_devices_merge_through_the_native_vault(self):
        if shutil.which('node') is None:
            self.skipTest('node is unavailable')
        with tempfile.TemporaryDirectory(prefix='ardia-sync-tool-') as directory:
            tool = build(self, directory, 'sync_device_tool', 'sync_device_tool.cc')
            output = run(self, ['node', '--experimental-strip-types', '--no-warnings', '--import',
                                REPO / 'apps/linux/scripts/host-test-loader.mjs', '--test', '--test-reporter=tap',
                                ROOT / 'tests/sync_devices.test.mjs'],
                         env={'SYNC_DEVICE_TOOL': str(tool)}, timeout=300)
            self.assertIn("# pass 1", output)
            self.assertIn('# skipped 0', output)


if __name__ == '__main__':
    unittest.main()
