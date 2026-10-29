import json
import pathlib
import re
import subprocess
import tempfile
import unittest

from test_downloads import compile_and_run

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
SECRETS = ['correct horse', 'battery', '4111 1111', '4111111111111111']


class CredentialHelperTests(unittest.TestCase):
    def test_plans_payloads_availability_errors_and_export_cleanup(self):
        with tempfile.TemporaryDirectory(prefix='ardia-credentials-') as directory:
            output = compile_and_run(self, 'credentials', [
                LINUX / 'ac_linux_credentials.cc', ROOT / 'tests/fixtures/credentials_scenarios.cc',
            ], args=[directory])
        self.assertIn('credentials scenarios passed', output)
        for secret in SECRETS:
            self.assertNotIn(secret, output)
        native = re.findall(r'^capability (\S+)$', output, re.M)
        script = "import('./src/hostCredentials.ts').then((m) => console.log(JSON.stringify(m.CREDENTIAL_CAPABILITIES)))"
        result = subprocess.run(['node', '--experimental-strip-types', '--input-type=module', '-e', script],
                                cwd=ROOT.parents[1] / 'apps/linux', capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(native), 9)
        self.assertEqual(sorted(native), sorted(json.loads(result.stdout)))

    def test_private_windows_are_refused_before_any_credential_call_is_parsed_or_routed(self):
        service = (LINUX / 'ac_linux_credential_service.cc').read_text()
        invokes = service[service.index('bool LinuxCredentialsInvokes('):]
        self.assertIn('return credentials::ClaimsInvoke(method);', invokes[:invokes.index('\n}\n')])
        invoke = service[service.index('void LinuxCredentialsInvoke('):]
        invoke = invoke[:invoke.index('\n}\n')]
        self.assertIn('credentials::PlanWindowInvoke(private_window, method, args)', invoke)
        self.assertNotIn('credentials::PlanInvoke(', invoke)
        self.assertIn('credentials::kPrivateCredentialsMessage', service)
        host = (LINUX / 'ac_linux_host.cc').read_text()
        invoke_host = host[host.index('void ShellHostView::Invoke('):]
        self.assertLess(invoke_host.index('LinuxCredentialsInvokes(method)'), invoke_host.index('Unsupported Linux host method'))

    def test_credential_sources_never_log_or_trace(self):
        for name in ['ac_linux_credentials.cc', 'ac_linux_credentials.h', 'ac_linux_credential_service.cc',
                     'ac_linux_credential_service.h']:
            text = (LINUX / name).read_text()
            for forbidden in ['LOG(', 'VLOG(', 'printf', 'std::cerr', 'std::cout', 'TRACE_EVENT', 'crash_keys',
                              'SCOPED_CRASH_KEY', 'base::debug::', 'DumpWithoutCrashing']:
                self.assertNotIn(forbidden, text, f'{name} uses {forbidden}')

    def test_secret_payloads_use_hex_and_the_service_cleanses_parsed_replies(self):
        service = (LINUX / 'ac_linux_credential_service.cc').read_text()
        self.assertIn('Cleanse(', service)
        self.assertNotIn('base::WriteJson', service)
        host = (LINUX / 'ac_linux_host.cc').read_text()
        self.assertIn('LinuxCredentialsHandles(name)', host)
        self.assertIn('LinuxCredentialsInvokes(method)', host)
        self.assertLess(host.index('LinuxCredentialsHandles(name)'), host.index('ardiacore::linux_contract::FindRoute(name)'))
        contract = (LINUX / 'ac_linux_contract.h').read_text()
        for name in ['passwords.', 'autofill.', 'ac_passwords', 'ac_autofill']:
            self.assertNotIn(name, contract)

    def test_status_reports_which_key_provider_encrypts_new_data(self):
        service = (LINUX / 'ac_linux_credential_service.cc').read_text()
        self.assertIn('encryptor.EncryptString(credentials::kProtectionProbeText)', service)
        self.assertIn('credentials::ProtectionFromCiphertext(', service)
        self.assertIn('probe->protection = protection;', service)
        status = service[service.index('base::Value Status('):service.index('struct PendingCall {')]
        self.assertIn('credentials::DescribeStorage(backend, probes.passwords.protection)', status)
        for key in ['"protection"', '"protectionFallback"', '"storage"']:
            self.assertIn(f'.Set({key}', status)


    def test_a_loading_password_store_is_awaited_before_it_is_judged(self):
        service = (LINUX / 'ac_linux_credential_service.cc').read_text()
        wait = service[service.index('void AwaitPasswordStore('):service.index('void WithProbes(')]
        self.assertIn('StoreErrorOf(store->GetError())', wait)
        self.assertIn('credentials::AwaitsStore(error, ', wait)
        self.assertIn('PostDelayedTask(', wait)
        self.assertIn('base::Milliseconds(credentials::kStoreReadyPollMs)', wait)
        probes = service[service.index('void WithProbes('):service.index('base::DictValue StatusEntry(')]
        self.assertNotIn('GetError()', probes)
        self.assertIn('AwaitPasswordStore(', probes)
        run_for = service[service.index('void RunFor('):service.index('void Run(std::string_view')]
        self.assertIn('WithProbes(profile, passwords, encryption,', run_for)

if __name__ == '__main__':
    unittest.main()
