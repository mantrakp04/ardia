import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
LINUX = ROOT / 'src/ardia/linux'
HELPERS = ['ac_linux_live.cc', 'ac_linux_sync_keystore.cc', 'ac_linux_sync_json.cc', 'ac_linux_sync_crypto.cc',
           'ac_linux_sync.cc', 'ac_linux_sync_vault.cc', 'ac_linux_sync_wordlist.cc']
LIBSECRET = next((path for path in ['/usr/lib/libsecret-1.so.0', '/usr/lib/x86_64-linux-gnu/libsecret-1.so.0',
                                    '/usr/lib64/libsecret-1.so.0'] if os.path.exists(path)), None)
SHARED_CONTRACT = """
import { VIEWER_QUERY } from "../browser/src/state/live/github.ts";
import { CONFLUENCE_CQL, DRIVE_QUERY, NOTION_SEARCH_BODY } from "../browser/src/state/live/documents.ts";
import { LIVE_CAPABILITIES } from "./src/hostLive.ts";
console.log(JSON.stringify({ VIEWER_QUERY, CONFLUENCE_CQL, DRIVE_QUERY, NOTION_SEARCH_BODY, LIVE_CAPABILITIES }));
"""


def run(test, command, env=None, timeout=120, cwd=None):
    result = subprocess.run([str(part) for part in command], capture_output=True, text=True, timeout=timeout,
                            env={**os.environ, **(env or {})}, cwd=cwd)
    test.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    return result.stdout


class LiveServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None or shutil.which('node') is None:
            raise unittest.SkipTest('a C++ compiler or node is unavailable')
        if not (REPO / 'node_modules').exists():
            raise unittest.SkipTest('workspace dependencies are not installed')
        cls.scratch = tempfile.TemporaryDirectory(prefix='ardia-live-')
        cls.addClassCleanup(cls.scratch.cleanup)
        cls.tool = pathlib.Path(cls.scratch.name) / 'live_host_tool'
        compiled = subprocess.run([
            compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g', '-fsanitize=address,undefined',
            '-fno-omit-frame-pointer', '-I', str(ROOT / 'src'), *[str(LINUX / source) for source in HELPERS],
            str(ROOT / 'tests/fixtures/live_host_tool.cc'), '-o', str(cls.tool), '-lcrypto', '-ldl', '-lpthread',
        ], capture_output=True, text=True, timeout=300)
        if compiled.returncode:
            raise AssertionError(compiled.stderr)

    def node_suite(self, name, passed):
        output = run(self, ['node', '--experimental-strip-types', '--import',
                            REPO / 'apps/linux/scripts/host-test-loader.mjs', '--test', '--test-reporter=tap',
                            ROOT / 'tests' / name], env={'LIVE_HOST_TOOL': str(self.tool)}, timeout=300)
        self.assertIn(f'# pass {passed}', output)
        self.assertIn('# fail 0', output)
        self.assertNotIn('AddressSanitizer', output)

    def test_core_against_local_fake_providers(self):
        self.assertIn('live self-test passed', run(self, [self.tool, '--self-test']))
        if LIBSECRET:
            bus = f'unix:path={pathlib.Path(self.scratch.name) / "no-such-bus"}'
            secret = run(self, [self.tool, '--secret-service', LIBSECRET], env={
                'DBUS_SESSION_BUS_ADDRESS': bus, 'DBUS_SYSTEM_BUS_ADDRESS': bus, 'DISPLAY': '',
                'ASAN_OPTIONS': 'detect_leaks=0'})
            self.assertIn('secret service without a bus: unavailable', secret)
        self.node_suite('live_services.test.mjs', 15)

    def test_core_against_documented_provider_replies(self):
        self.node_suite('live_provider_contract.test.mjs', 9)

    def test_native_fixed_requests_match_the_shared_provider_contract(self):
        native = json.loads(run(self, [self.tool, '--contract']))
        shared = json.loads(run(self, ['node', '--experimental-strip-types', '--import',
                                       REPO / 'apps/linux/scripts/host-test-loader.mjs', '--input-type=module',
                                       '-e', SHARED_CONTRACT], cwd=REPO / 'apps/linux'))
        self.assertEqual(native['viewerQuery'], shared['VIEWER_QUERY'])
        self.assertEqual(native['confluenceCql'], shared['CONFLUENCE_CQL'])
        self.assertEqual(native['driveQuery'], shared['DRIVE_QUERY'])
        self.assertEqual(json.loads(native['notionSearchBody']), shared['NOTION_SEARCH_BODY'])
        self.assertEqual(native['methods'], shared['LIVE_CAPABILITIES'])
        browser = REPO / 'apps/browser/src/state/live'
        self.assertIn(f'"Notion-Version": "{native["notionVersion"]}"', (browser / 'sources.ts').read_text())
        self.assertIn(f'scope: "{native["githubScope"]}"', (browser / 'sources.ts').read_text())
        self.assertIn(f'const REDIRECT = "{native["googleRedirect"]}";', (browser / 'googleAuth.ts').read_text())


if __name__ == '__main__':
    unittest.main()
