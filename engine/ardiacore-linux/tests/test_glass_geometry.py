import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'


class GlassGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-glass-geometry-')
        cls.binary = Path(cls.directory.name) / 'glass-geometry'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
                        '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(SOURCE),
                        str(ROOT / 'tests/glass_geometry_test.cc'), '-o', str(cls.binary)],
                       check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        subprocess.run([str(self.binary), name], check=True, text=True, timeout=10,
                       env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_whole_pixel_panels_map_one_to_one(self):
        self.run_case('whole')

    def test_a_fractional_panel_keeps_its_fractional_origin_and_extent(self):
        self.run_case('fractional')

    def test_shell_zoom_scales_rect_radii_and_blur(self):
        self.run_case('zoom')

    def test_radii_never_exceed_half_the_short_side(self):
        self.run_case('radii')

    def test_invalid_regions_are_refused(self):
        self.run_case('invalid')

    def test_overlap_is_strict(self):
        self.run_case('overlap')


if __name__ == '__main__':
    unittest.main()
