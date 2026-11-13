import pathlib
import subprocess
import tempfile
import unittest

from support import VALUES, compile_and_run

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'


class SiteControlsHelperTests(unittest.TestCase):
    def test_permissions_data_clearing_and_blocker_state_machine(self):
        with tempfile.TemporaryDirectory(prefix='ardia-site-controls-') as directory:
            include = pathlib.Path(directory) / 'include'
            (include / 'base').mkdir(parents=True)
            (include / 'base/values.h').write_text(VALUES)
            output = compile_and_run(self, 'site-controls', [
                LINUX / 'ac_linux_site_controls.cc', ROOT / 'tests/fixtures/site_controls_scenarios.cc',
            ], extra_includes=[include])
        self.assertIn('site controls scenarios passed', output)

    def test_bridge_page_against_a_simulated_ublock_dashboard(self):
        result = subprocess.run(['node', '--test', str(ROOT / 'tests/content_blocker_bridge.test.mjs')],
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertRegex(result.stdout, r'pass 10\b')


if __name__ == '__main__':
    unittest.main()
