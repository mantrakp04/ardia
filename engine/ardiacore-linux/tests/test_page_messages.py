import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
FILES = [SOURCE / 'ardia/linux' / f'ac_linux_{name}.cc' for name in ['page_messages', 'link_gesture', 'page_evaluation']]
FIXTURE = ROOT / 'tests/fixtures/page_state.h'


class PageMessageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-page-messages-')
        directory = Path(cls.directory.name)
        for source in FILES + [p.with_suffix('.h') for p in FILES]:
            for include in re.findall(r'#include "([^"]+)"', source.read_text()):
                if include.startswith('ardia/'):
                    continue
                header = directory / include
                header.parent.mkdir(parents=True, exist_ok=True)
                header.write_text(f'#include "{FIXTURE}"\n#include <limits>\n')
        cls.binary = directory / 'page-messages'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
                        '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-no-pie', '-I', str(directory),
                        '-I', str(SOURCE), *map(str, FILES), str(ROOT / 'tests/page_messages_test.cc'), '-o', str(cls.binary)],
                       check=True, text=True, timeout=90)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        subprocess.run([str(self.binary), name], check=True, text=True, timeout=10,
                       env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_kinds_are_an_allowlist_with_bounded_envelopes(self):
        self.run_case('kinds')

    def test_only_the_current_primary_main_document_drives_tab_state(self):
        self.run_case('senders')

    def test_payloads_are_rebuilt_from_validated_fields(self):
        self.run_case('normalization')

    def test_now_playing_is_reduced_to_video_and_state_before_any_limit(self):
        self.run_case('now-playing-reports')

    def test_flooding_is_rate_limited_and_muted_per_document(self):
        self.run_case('budget')

    def test_link_modifier_options_match_macos(self):
        self.run_case('options')

    def test_peek_and_split_require_a_matching_trusted_mouse_up(self):
        self.run_case('gestures')

    def test_evaluation_runs_only_pinned_operations(self):
        self.run_case('evaluation')

    def test_link_drops_need_a_real_drag_that_ended_over_the_page(self):
        self.run_case('link-drops')

    def test_a_drag_is_over_its_page_until_the_exit_settles(self):
        self.run_case('drag-over')

    def test_input_activity_is_announced_at_most_twice_a_second(self):
        self.run_case('activity')


if __name__ == '__main__':
    unittest.main()
