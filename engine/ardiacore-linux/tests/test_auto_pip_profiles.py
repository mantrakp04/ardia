import pathlib
import unittest

from support import compile_and_run

ROOT = pathlib.Path(__file__).resolve().parents[1]


class AutoPictureInPictureProfileTests(unittest.TestCase):
    def test_the_preference_reaches_every_regular_profile_and_later_loads(self):
        output = compile_and_run(self, 'auto-pip-preference', [ROOT / 'tests/fixtures/auto_pip_preference_scenarios.cc'])
        self.assertIn('auto pip preference scenarios passed', output)


if __name__ == '__main__':
    unittest.main()
