import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
LINUX = SOURCE / 'ardia/linux'


class MemoryPressureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-memory-pressure-')
        cls.binary = Path(cls.directory.name) / 'memory-pressure'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
                        '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(SOURCE),
                        str(LINUX / 'ac_linux_memory_pressure.cc'), str(ROOT / 'tests/memory_pressure_test.cc'),
                        '-o', str(cls.binary)], check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, *args):
        subprocess.run([str(self.binary), *args], check=True, text=True, timeout=10,
                       env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_parses_pressure_stall_information(self):
        self.run_case('parse')

    def test_finds_the_processes_own_cgroup_before_the_system_file(self):
        self.run_case('cgroup')

    def test_levels_follow_stall_time_with_hysteresis_and_trigger_wakes(self):
        self.run_case('levels')

    def test_watch_combines_sources_and_falls_back_to_meminfo(self):
        with tempfile.TemporaryDirectory(prefix='ardia-psi-') as directory:
            self.run_case('sources', directory)

    def test_repeated_poll_failures_drop_psi_instead_of_spinning(self):
        self.run_case('poll-failures')

    def test_arms_a_kernel_trigger_when_the_system_allows_it(self):
        self.run_case('kernel')


if __name__ == '__main__':
    unittest.main()
