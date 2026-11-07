import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'


class ConfigCoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-config-core-')
        cls.binary = Path(cls.directory.name) / 'config-core'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
                        '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(SOURCE), str(ROOT / 'tests/config_core_test.cc'),
                        '-o', str(cls.binary)],
                       check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, scenario):
        with tempfile.TemporaryDirectory(prefix=f'ardia-config-{scenario}-') as root:
            subprocess.run([str(self.binary), scenario, root], check=True, text=True, timeout=60,
                           env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_reads_take_config_and_theme_files_only_follow_links_and_refuse_fifos_folders_big_files_and_bad_utf8(self):
        self.run_case('reads')

    def test_schemas_go_to_the_schema_folder_and_an_existing_config_folder_replacing_links_and_skipping_unchanged(self):
        self.run_case('schemas')

    def test_the_watcher_notices_its_files_through_links_and_folder_moves_and_ignores_everything_else(self):
        self.run_case('watches')

    def test_the_watcher_follows_link_chains_and_links_whose_targets_appear_later(self):
        self.run_case('links')


if __name__ == '__main__':
    unittest.main()
