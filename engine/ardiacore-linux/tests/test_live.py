import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

from test_session_merge import VALUES

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
LINUX = ROOT / 'src/ardia/linux'
HELPERS = ['ac_linux_live.cc', 'ac_linux_sync_keystore.cc', 'ac_linux_sync_json.cc', 'ac_linux_sync_crypto.cc',
           'ac_linux_sync.cc', 'ac_linux_sync_vault.cc', 'ac_linux_sync_wordlist.cc']
SOURCES = ['ac_linux_live.cc', 'ac_linux_live.h', 'ac_linux_live_service.cc', 'ac_linux_live_service.h']
LIBSECRET = next((path for path in ['/usr/lib/libsecret-1.so.0', '/usr/lib/x86_64-linux-gnu/libsecret-1.so.0',
                                    '/usr/lib64/libsecret-1.so.0'] if os.path.exists(path)), None)
SHARED_CONTRACT = """
import { VIEWER_QUERY } from "../browser/src/state/live/github.ts";
import { CONFLUENCE_CQL, DRIVE_QUERY, NOTION_SEARCH_BODY } from "../browser/src/state/live/documents.ts";
import { LIVE_CAPABILITIES } from "./src/hostLive.ts";
console.log(JSON.stringify({ VIEWER_QUERY, CONFLUENCE_CQL, DRIVE_QUERY, NOTION_SEARCH_BODY, LIVE_CAPABILITIES }));
"""


def build(test, directory):
    compiler = shutil.which('clang++') or shutil.which('c++')
    if compiler is None:
        test.skipTest('C++ compiler is unavailable')
    executable = pathlib.Path(directory) / 'live_host_tool'
    compiled = subprocess.run([
        compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g', '-fsanitize=address,undefined',
        '-fno-omit-frame-pointer', '-I', str(ROOT / 'src'), *[str(LINUX / source) for source in HELPERS],
        str(ROOT / 'tests/fixtures/live_host_tool.cc'), '-o', str(executable), '-lcrypto', '-ldl', '-lpthread',
    ], capture_output=True, text=True, timeout=300)
    test.assertEqual(compiled.returncode, 0, compiled.stderr)
    return executable


def run(test, command, env=None, timeout=120, cwd=None):
    result = subprocess.run([str(part) for part in command], capture_output=True, text=True, timeout=timeout,
                            env={**os.environ, **(env or {})}, cwd=cwd)
    test.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    return result.stdout


def build_service(test, directory):
    compiler = shutil.which('clang++') or shutil.which('c++')
    if compiler is None:
        test.skipTest('C++ compiler is unavailable')
    stubs = pathlib.Path(directory) / 'stubs'
    includes = set()
    for name in ['ac_linux_live_service.cc', 'ac_linux_live_service.h']:
        includes.update(re.findall(r'^#include "([^"]+)"', (LINUX / name).read_text(), re.M))
    for name in includes:
        if name.startswith('ardia/linux/'):
            continue
        (stubs / name).parent.mkdir(parents=True, exist_ok=True)
        (stubs / name).write_text('#include "live_service_support.h"\n')
    (stubs / 'base').mkdir(parents=True, exist_ok=True)
    append = '  void Append(Value&& value) & { entries_.push_back(std::move(value)); }\n'
    test.assertIn(append, VALUES)
    (stubs / 'base/values.h').write_text(VALUES.replace(
        append, append + '  void Append(const char* value) & { Append(Value(value)); }\n'))
    executable = pathlib.Path(directory) / 'live_service'
    compiled = subprocess.run([
        compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g', '-fsanitize=address,undefined',
        '-fno-omit-frame-pointer', f'-I{stubs}', f'-I{ROOT / "tests/fixtures"}', '-I', str(ROOT / 'src'),
        str(LINUX / 'ac_linux_live_service.cc'), *[str(LINUX / source) for source in HELPERS],
        str(ROOT / 'tests/fixtures/live_service_scenarios.cc'), '-o', str(executable), '-lcrypto', '-ldl', '-lpthread',
    ], capture_output=True, text=True, timeout=300)
    test.assertEqual(compiled.returncode, 0, compiled.stderr)
    return executable


class LiveServiceTests(unittest.TestCase):
    def test_chromium_glue_refuses_private_callers_namespaces_ids_and_drives_the_loader(self):
        with tempfile.TemporaryDirectory(prefix='ardia-live-service-') as directory:
            service = build_service(self, directory)
            output = run(self, [service, pathlib.Path(directory) / 'profile'])
        self.assertIn('live service scenarios passed', output)

    def test_core_against_local_fake_providers(self):
        if shutil.which('node') is None:
            self.skipTest('node is unavailable')
        if not (REPO / 'node_modules').exists():
            self.skipTest('workspace dependencies are not installed')
        with tempfile.TemporaryDirectory(prefix='ardia-live-') as directory:
            tool = build(self, directory)
            self.assertIn('live self-test passed', run(self, [tool, '--self-test']))
            if LIBSECRET:
                bus = f'unix:path={pathlib.Path(directory) / "no-such-bus"}'
                secret = run(self, [tool, '--secret-service', LIBSECRET], env={
                    'DBUS_SESSION_BUS_ADDRESS': bus, 'DBUS_SYSTEM_BUS_ADDRESS': bus, 'DISPLAY': '',
                    'ASAN_OPTIONS': 'detect_leaks=0'})
                self.assertIn('secret service without a bus: unavailable', secret)
            output = run(self, ['node', '--experimental-strip-types', '--import',
                                REPO / 'apps/linux/scripts/host-test-loader.mjs', '--test', '--test-reporter=tap',
                                ROOT / 'tests/live_services.test.mjs'],
                         env={'LIVE_HOST_TOOL': str(tool)}, timeout=300)
            self.assertIn('# pass 18', output)
            self.assertIn('# fail 0', output)
            self.assertNotIn('AddressSanitizer', output)

    def test_core_against_documented_provider_replies(self):
        if shutil.which('node') is None:
            self.skipTest('node is unavailable')
        if not (REPO / 'node_modules').exists():
            self.skipTest('workspace dependencies are not installed')
        with tempfile.TemporaryDirectory(prefix='ardia-live-contract-') as directory:
            tool = build(self, directory)
            output = run(self, ['node', '--experimental-strip-types', '--import',
                                REPO / 'apps/linux/scripts/host-test-loader.mjs', '--test', '--test-reporter=tap',
                                ROOT / 'tests/live_provider_contract.test.mjs'],
                         env={'LIVE_HOST_TOOL': str(tool)}, timeout=300)
            self.assertIn('# pass 14', output)
            self.assertIn('# fail 0', output)
            self.assertNotIn('AddressSanitizer', output)

    def test_native_fixed_requests_match_the_shared_provider_contract(self):
        if shutil.which('node') is None:
            self.skipTest('node is unavailable')
        if not (REPO / 'node_modules').exists():
            self.skipTest('workspace dependencies are not installed')
        with tempfile.TemporaryDirectory(prefix='ardia-live-contract-') as directory:
            tool = build(self, directory)
            native = json.loads(run(self, [tool, '--contract']))
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

    def test_live_sources_never_log_stay_registered_and_refuse_private_windows(self):
        for name in SOURCES:
            text = (LINUX / name).read_text()
            for forbidden in ['LOG(', 'VLOG(', 'printf', 'std::cerr', 'std::cout', 'TRACE_EVENT', 'SCOPED_CRASH_KEY',
                              'DumpWithoutCrashing']:
                self.assertNotIn(forbidden, text, f'{name} uses {forbidden}')
        gn = (LINUX / 'BUILD.gn').read_text()
        for name in SOURCES:
            self.assertIn(f'"{name}"', gn)
        host = (LINUX / 'ac_linux_host.cc').read_text()
        self.assertIn('#include "ardia/linux/ac_linux_live_service.h"', host)
        retire = host[host.index('  void RetireRenderer() {'):]
        self.assertTrue(retire[:retire.index('\n  }\n')].split('\n')[1].strip().startswith('LinuxLiveCallerGone(LiveCaller());'))
        destructor = host[host.index('ShellHostView::~ShellHostView() {'):]
        self.assertIn('LinuxLiveCallerGone(LiveCaller());', destructor[:destructor.index('\n}\n')])
        self.assertIn('AppendLinuxLiveCapabilities(capabilities)', host)
        invoke = host[host.index('void ShellHostView::Invoke('):]
        invoke = invoke[:invoke.index('\n}\n')]
        self.assertIn('LinuxLiveInvokes(method)', invoke)
        self.assertEqual(host.count('LinuxLiveInvoke('), 1)
        self.assertIn('!private_window_.empty()', invoke[invoke.index('LinuxLiveInvokes(method)'):][:400])
        self.assertIn('bool ShellHostView::Trusted(content::WebUI* ui) const', host)
        service = (LINUX / 'ac_linux_live_service.cc').read_text()
        self.assertIn('IsOffTheRecord()', service)
        self.assertIn('caller.private_window', service)
        self.assertIn('ERR_PRIVATE_SERVICE', service)
        self.assertIn('CredentialsMode::kOmit', service)
        self.assertIn('RedirectMode::kError', service)
        self.assertIn('SchemeIs(url::kHttpsScheme)', service)
        self.assertIn('linux_sync::UseFileKeyStore(', service)
        self.assertIn('live::LiveKeySchema()', service)
        self.assertIn('cookies_allowed: NO', service)
        bootstrap = (LINUX / 'bootstrap.js').read_text()
        for method in ['ArdiaLive.request', 'ArdiaLive.connect', 'ArdiaLive.disconnect']:
            self.assertIn(f'["{method}", 180000]', bootstrap)

    def test_renderer_live_modules_have_no_network_or_secret_storage_of_their_own(self):
        linux = REPO / 'apps/linux/src'
        for name in ['hostLive.ts', 'liveSources.ts', 'liveNet.ts']:
            text = (linux / name).read_text()
            self.assertIsNone(re.search(r'XMLHttpRequest|WebSocket|EventSource|sendBeacon|keychain|localStorage', text), name)
            calls = [m for m in re.finditer(r'(?<![\w.])fetch\(', text)
                     if not text[:m.start()].endswith('async ') and not text[m.end():].startswith('folder: LiveFolder)')]
            self.assertEqual(calls, [], f'{name} calls the global fetch')
        vite = (REPO / 'apps/linux/vite.config.ts').read_text()
        self.assertIn('[here("../browser/src/state/live/sources.ts"), here("./src/liveSources.ts")]', vite)
        self.assertIn('[here("../browser/src/state/live/net.ts"), here("./src/liveNet.ts")]', vite)


if __name__ == '__main__':
    unittest.main()
