import pathlib
import unittest

from support import compile_and_run

ROOT = pathlib.Path(__file__).resolve().parents[1]


class PrivateServiceHelperTests(unittest.TestCase):
    def test_routing_and_engine_failures(self):
        output = compile_and_run(self, 'private-services', [ROOT / 'tests/fixtures/private_services_scenarios.cc'])
        self.assertIn('private services scenarios passed', output)


if __name__ == '__main__':
    unittest.main()
