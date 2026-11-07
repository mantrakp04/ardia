import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'


class ControlCoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-control-core-')
        cls.binary = Path(cls.directory.name) / 'control-core'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
                        '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(SOURCE),
                        str(ROOT / 'tests/control_core_test.cc'), '-o', str(cls.binary)],
                       check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, *args):
        subprocess.run([str(self.binary), *args], check=True, text=True, timeout=30,
                       env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_a_dropped_count_marks_the_next_event_object_only(self):
        self.run_case('marking')

    def test_events_past_one_thousand_drop_the_oldest_and_the_next_one_carries_the_count(self):
        self.run_case('drops')

    def test_replies_are_never_dropped_and_their_tickets_stay_in_order(self):
        self.run_case('replies')

    def test_output_past_four_megabytes_is_refused(self):
        self.run_case('bytes')

    def test_a_partly_written_event_is_never_dropped(self):
        self.run_case('partial-head')

    def test_a_failed_write_leaves_its_ticket_waiting(self):
        self.run_case('failed-write')

    def test_lines_are_split_on_newlines_and_a_partial_line_waits(self):
        self.run_case('framing')

    def test_a_line_over_one_megabyte_closes_the_connection(self):
        self.run_case('long-lines')

    def test_more_than_thirty_two_unanswered_requests_close_the_connection(self):
        self.run_case('pending')

    def test_invalid_utf8_becomes_replacement_characters(self):
        self.run_case('utf8')

    def test_the_data_folder_must_be_real_owned_and_private(self):
        with tempfile.TemporaryDirectory(prefix='ardia-control-folders-') as root:
            self.run_case('folders', root)

    def test_the_socket_is_bound_privately_and_moved_into_place_without_touching_the_umask(self):
        with tempfile.TemporaryDirectory(prefix='ardia-control-bind-') as root:
            self.run_case('bind', root)


if __name__ == '__main__':
    unittest.main()
