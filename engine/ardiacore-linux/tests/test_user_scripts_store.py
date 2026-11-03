import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'


class UserScriptsStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-user-scripts-store-')
        cls.binary = Path(cls.directory.name) / 'user-scripts-store'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
                        '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-pthread', '-I', str(SOURCE),
                        str(ROOT / 'tests/user_scripts_store_test.cc'), '-o', str(cls.binary)],
                       check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        with tempfile.TemporaryDirectory(prefix=f'ardia-user-scripts-{name}-') as root:
            subprocess.run([str(self.binary), name, root], check=True, text=True, timeout=30,
                           env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_generations_parse_as_whole_trimmed_integers(self):
        self.run_case('parse')

    def test_the_folder_reads_empty_absent_pending_invalid_and_ready_like_the_mac(self):
        self.run_case('states')

    def test_script_files_must_be_plain_relative_files_with_no_links_on_the_way(self):
        self.run_case('files')

    def test_a_read_waits_for_the_cli_lock_and_then_reads(self):
        self.run_case('lock')

    def test_a_lock_that_isnt_a_plain_file_answers_busy_without_blocking(self):
        self.run_case('fifo')

    def test_the_change_token_stays_ascii_whatever_bytes_the_generation_files_hold(self):
        self.run_case('ascii-token')

    def test_status_is_written_atomically_and_links_are_never_followed(self):
        self.run_case('status')

    def test_the_watch_signature_follows_the_generation_and_the_extension_folder_only(self):
        self.run_case('signature')


if __name__ == '__main__':
    unittest.main()
