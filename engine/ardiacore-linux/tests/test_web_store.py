import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'


class WebStoreQueueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-web-store-')
        cls.binary = pathlib.Path(cls.directory.name) / 'web-store'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
                        '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(ROOT / 'src'),
                        str(LINUX / 'ac_linux_web_store_queue.cc'), str(ROOT / 'tests/web_store_test.cc'),
                        '-o', str(cls.binary)], check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        subprocess.run([str(self.binary), name], check=True, text=True, timeout=10,
                       env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_only_extension_ids_are_queued(self):
        self.run_case('ids')

    def test_requests_are_claimed_in_order_and_finish_on_uninstall_expiry_or_page_change(self):
        self.run_case('queue')


if __name__ == '__main__':
    unittest.main()
