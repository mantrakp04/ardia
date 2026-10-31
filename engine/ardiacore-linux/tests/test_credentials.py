import json
import pathlib
import re
import subprocess
import tempfile
import unittest

from support import compile_and_run

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


if __name__ == '__main__':
    unittest.main()
