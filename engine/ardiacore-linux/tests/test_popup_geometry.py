import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'


class PopupGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-popup-geometry-')
        cls.binary = Path(cls.directory.name) / 'popup-geometry'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
                        '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(SOURCE),
                        str(ROOT / 'tests/popup_geometry_test.cc'), '-o', str(cls.binary)],
                       check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        subprocess.run([str(self.binary), name], check=True, text=True, timeout=10,
                       env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_the_popup_hangs_from_the_anchor_by_its_right_edge(self):
        self.run_case('right')

    def test_a_popup_wider_than_the_space_left_of_its_anchor_slides_right_but_stays_in_the_room(self):
        self.run_case('clamped')

    def test_the_renderer_limits_shrink_with_the_room(self):
        self.run_case('limits')

    def test_a_room_below_the_minimum_lowers_the_minimum_and_no_room_shows_nothing(self):
        self.run_case('tiny')

    def test_the_placement_is_in_shell_css_px_and_scales_with_shell_zoom_but_the_size_does_not(self):
        self.run_case('zoom')

    def test_at_a_fractional_scale_the_origin_lands_on_whole_device_pixels(self):
        self.run_case('pixels')

    def test_non_finite_placements_and_zoom_are_refused(self):
        self.run_case('finite')


if __name__ == '__main__':
    unittest.main()
