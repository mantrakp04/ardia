import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
FILES = [SOURCE / 'ardia/linux' / f'ac_linux_{name}.cc' for name in ['media', 'tab_policy']]
FIXTURE = ROOT / 'tests/fixtures/media.h'


class MediaPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-media-policy-')
        directory = Path(cls.directory.name)
        for source in FILES + [p.with_suffix('.h') for p in FILES]:
            for include in re.findall(r'#include "([^"]+)"', source.read_text()):
                if include.startswith('ardia/'):
                    continue
                header = directory / include
                header.parent.mkdir(parents=True, exist_ok=True)
                header.write_text(f'#include "{FIXTURE}"\n')
        cls.binary = directory / 'media-policy'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-no-pie', '-I', str(directory), '-I', str(SOURCE), '-I', str(ROOT / 'tests'), *map(str, FILES), str(ROOT / 'tests/media_policy_test.cc'), '-o', str(cls.binary)], check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        subprocess.run([str(self.binary), name], check=True, text=True, timeout=10,
                       env={**os.environ, "UBSAN_OPTIONS": "halt_on_error=1"})

    def test_media_session_maps_to_now_playing(self):
        self.run_case('mapping')

    def test_a_playing_video_outside_the_session_reports_a_video_without_controls(self):
        self.run_case('page-video')

    def test_a_video_that_played_stays_known_after_the_renderer_reports_it_stopped(self):
        self.run_case('page-videos')

    def test_event_payloads_match_the_shared_page_types(self):
        self.run_case('events')

    def test_reporter_deduplicates_and_snapshots_current_state(self):
        self.run_case('reporter')

    def test_media_commands_validate_and_resolve_against_playback(self):
        self.run_case('commands')

    def test_picture_in_picture_press_and_route(self):
        self.run_case('pip')

    def test_manual_picture_in_picture_takes_the_playing_then_largest_video(self):
        self.run_case('pip-choice')

    def test_protection_predicate_and_discard_freeze_decisions(self):
        self.run_case('protection')

    def test_system_state_from_upower_and_memory(self):
        self.run_case('power')

    def test_power_tracker_merges_signals_and_memory_and_reports_changes_only(self):
        self.run_case('power-tracker')


if __name__ == '__main__':
    unittest.main()
