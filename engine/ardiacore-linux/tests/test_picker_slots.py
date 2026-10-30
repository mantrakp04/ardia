import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'


class PickerSlotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-picker-slots-')
        cls.binary = Path(cls.directory.name) / 'picker-slots'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
                        '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(SOURCE),
                        str(ROOT / 'tests/picker_slots_test.cc'), '-o', str(cls.binary)],
                       check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        subprocess.run([str(self.binary), name], check=True, text=True, timeout=10,
                       env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_a_chooser_open_in_one_window_leaves_the_others_free(self):
        self.run_case('per-window')

    def test_a_chooser_that_stopped_showing_without_answering_is_replaced(self):
        self.run_case('stale')


if __name__ == '__main__':
    unittest.main()
