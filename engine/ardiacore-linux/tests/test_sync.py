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
SOURCES = HELPERS[:-1] + ['ac_linux_sync.h', 'ac_linux_sync_crypto.h', 'ac_linux_sync_json.h', 'ac_linux_sync_vault.h',
                     'ac_linux_sync_keystore.h', 'ac_linux_sync_service.cc', 'ac_linux_sync_service.h']
LIBSECRET = next((path for path in ['/usr/lib/libsecret-1.so.0', '/usr/lib/x86_64-linux-gnu/libsecret-1.so.0',
                                    '/usr/lib64/libsecret-1.so.0'] if os.path.exists(path)), None)


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
            self.assertIn('sealed logins: 3 sealed, partial and locked reads refused', output)
            self.assertIn('held key: a second window unlocks from memory, the save waits for an open default collection', output)
            self.assertIn("held key: another device's key is never saved under the held device", output)
            self.assertRegex(output, r'large local state: \d{8} sealed bytes round trip')
            verified = run(self, ['node', ROOT / 'tests/sync_reference.mjs', 'verify', root / 'linux'])
            self.assertIn('reference verified 2 Linux files and 1 passwords', verified)
            self.assertNotIn(fixture_secret, output)
            if LIBSECRET:
                bus = f'unix:path={root / "no-such-bus"}'
                secret = run(self, [scenarios, '--secret-service', LIBSECRET], env={
                    'DBUS_SESSION_BUS_ADDRESS': bus, 'DBUS_SYSTEM_BUS_ADDRESS': bus, 'DISPLAY': '',
                    'ASAN_OPTIONS': 'detect_leaks=0'})
                self.assertIn('secret service without a bus: unavailable', secret)
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
            self.assertIn("# pass 2", output)
            self.assertIn('# skipped 0', output)

    def test_sync_sources_never_log_and_stay_registered(self):
        for name in SOURCES:
            text = (LINUX / name).read_text()
            for forbidden in ['LOG(', 'VLOG(', 'printf', 'std::cerr', 'std::cout', 'TRACE_EVENT', 'SCOPED_CRASH_KEY',
                              'DumpWithoutCrashing']:
                self.assertNotIn(forbidden, text.replace('snprintf', ''), f'{name} uses {forbidden}')
        gn = (LINUX / 'BUILD.gn').read_text()
        for name in SOURCES:
            self.assertIn(f'"{name}"', gn)
        self.assertIn('//third_party/boringssl', gn)
        self.assertIn('//components/qr_code_generator', gn)
        host = (LINUX / 'ac_linux_host.cc').read_text()
        self.assertIn('#include "ardia/linux/ac_linux_sync_service.h"', host)
        self.assertIn('LinuxSyncInvokes(method)', host)
        self.assertIn('AppendLinuxSyncCapabilities(capabilities)', host)
        service = (LINUX / 'ac_linux_sync_service.cc').read_text()
        self.assertIn('IsOffTheRecord()', service)
        self.assertIn('Holds(', service)
        self.assertIn('ardia::Reauth(', service)
        self.assertIn('sync::PhraseClipboard(', service)
        self.assertIn('WriteRawDataForTest(ui::ClipboardFormatType::CustomPlatformType(format)', service)
        self.assertIn('MarkAsConfidential()', service)
        self.assertIn('sync::UseFileKeyStore(', service)
        self.assertIn('GetDefaultUserDataDirectory', service)
        self.assertIn('case sync::Route::kPasswords:', service)
        passwords = service[service.index('case sync::Route::kPasswords:'):]
        self.assertLess(passwords.index('Ui().lease.Holds(caller.key, NowMs())'), passwords.index('SyncPasswords('))
        self.assertIn('Core().SealLogins(std::move(read))', service)
        self.assertIn('Core().OpenLogin(save)', service)
        self.assertIn('LinuxCredentialsReadLogins(', service)
        self.assertIn('LinuxCredentialsSaveLogin(', service)
        self.assertNotIn('->password', service)
        self.assertNotIn('.password', service)
        credentials = (LINUX / 'ac_linux_credential_service.cc').read_text()
        reader = credentials[credentials.index('class SyncLoginReader'):]
        self.assertIn('GetAutofillableLogins(', reader)
        self.assertIn('password_value.secure_value()', reader)
        self.assertIn('SecretUTF8(', reader)
        self.assertNotIn('password_value.value()', reader)
        self.assertIn('kSkipUndecryptablePasswords', credentials)
        self.assertIn('credentials::Store::kPasswords, probes.passwords', credentials[credentials.index('void ReadLoginsFor'):])
        save = credentials[credentials.index('void LinuxCredentialsSaveLogin'):]
        self.assertIn('credentials::PlanSyncedLogin(', save)
        self.assertIn('if (!plans.storable)', save)
        self.assertLess(save.index('std::move(plans.remove)'), save.index('std::move(plans.save)'))
        usable = credentials[credentials.index('bool LinuxCredentialsPasswordsUsable'):]
        self.assertIn('credentials::PasswordsSyncUsable(', usable)
        self.assertIn('kSkipUndecryptablePasswords', usable)
        self.assertIn('GetError()', usable)
        self.assertIn('if (!parsed->holdable) return std::move(done).Run(true, base::Value(kSkippedLogin));', service)
        self.assertIn('LinuxSyncedSave::kSkipped', service)
        status = service[service.index('void SyncStatus('):]
        self.assertIn('LinuxCredentialsPasswordsUsable(', status)
        self.assertIn('if (method == "ArdiaSync.status") return SyncStatus(', service)
        for forbidden in ['LOG(', 'VLOG(', 'printf', 'TRACE_EVENT', 'SCOPED_CRASH_KEY']:
            self.assertNotIn(forbidden, credentials)
        vault = (LINUX / 'ac_linux_sync_vault.cc').read_text()
        for unsafe in ['opendir', 'rmdir', 'lstat', 'unlink']:
            self.assertIsNone(re.search(rf'(?<![a-z_]){unsafe}\(', vault), f'the vault walks paths with {unsafe}')
        self.assertIn('O_NOFOLLOW', vault)
        self.assertIn('AT_REMOVEDIR', vault)


if __name__ == '__main__':
    unittest.main()
