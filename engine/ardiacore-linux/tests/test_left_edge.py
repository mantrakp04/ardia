import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'


class LeftEdgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-left-edge-')
        cls.binary = Path(cls.directory.name) / 'left-edge'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
                        '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(SOURCE),
                        str(ROOT / 'tests/left_edge_test.cc'), '-o', str(cls.binary)],
                       check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        subprocess.run([str(self.binary), name], check=True, text=True, timeout=10,
                       env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_the_strip_covers_the_frame_border_and_the_page_edge_like_the_mac_strip(self):
        self.run_case('strip')

    def test_a_peek_stays_over_anywhere_in_its_hold_column_including_over_the_page(self):
        self.run_case('hold')

    def test_a_new_watch_reports_where_the_pointer_already_is(self):
        self.run_case('fresh')

    def test_leaving_past_the_left_edge_into_a_gap_settles_into_a_peek(self):
        self.run_case('settle')

    def test_a_wayland_leave_reported_at_its_last_sample_inside_still_counts_when_the_left_edge_is_nearest(self):
        self.run_case('fast-leave')

    def test_focus_moving_to_the_window_on_the_left_cancels_the_settle(self):
        self.run_case('focus-left')
        self.run_case('settle-inactive')

    def test_leaving_through_any_other_edge_is_not_over(self):
        self.run_case('other-exits')

    def test_a_peek_stays_out_while_the_pointer_is_just_past_the_left_edge(self):
        self.run_case('peek-beside')

    def test_an_inactive_window_gets_no_reach_beyond_its_edge(self):
        self.run_case('inactive')

    def test_nothing_is_reported_while_unwatched_and_a_watch_waits_for_a_settle(self):
        self.run_case('unwatched')
        self.run_case('watch-settling')


if __name__ == '__main__':
    unittest.main()
