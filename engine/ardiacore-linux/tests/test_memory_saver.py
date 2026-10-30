import pathlib
import tempfile
import unittest

from support import VALUES, compile_and_run

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'


class MemorySaverHelperTests(unittest.TestCase):
    def test_requests_and_replies_are_validated_against_the_engine_shape(self):
        with tempfile.TemporaryDirectory(prefix='ardia-memory-saver-') as directory:
            include = pathlib.Path(directory) / 'include'
            (include / 'base').mkdir(parents=True)
            (include / 'base/values.h').write_text(VALUES)
            output = compile_and_run(self, 'memory-saver', [
                LINUX / 'ac_linux_memory_saver.cc', ROOT / 'tests/fixtures/memory_saver_scenarios.cc',
            ], extra_includes=[include])
        self.assertIn('memory saver scenarios passed', output)


if __name__ == '__main__':
    unittest.main()
