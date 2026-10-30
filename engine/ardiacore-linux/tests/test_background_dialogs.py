import pathlib
import shutil
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'src'

PICKS = r'''#include <cassert>
#include <string>
#include <vector>
#include "ardia/linux/ac_linux_background_dialogs.h"

using ardiacore::LinuxFileChooserPicks;

int main() {
  assert(LinuxFileChooserPicks("").empty());
  assert((LinuxFileChooserPicks("/tmp/a.bin") == std::vector<std::string>{"/tmp/a.bin"}));
  assert((LinuxFileChooserPicks("/tmp/a.bin\r\n\nrelative.bin\n/tmp/b c.bin\n") ==
          std::vector<std::string>{"/tmp/a.bin", "/tmp/b c.bin"}));
  assert(LinuxFileChooserPicks(std::string("/tmp/a\0b", 8)).empty());
  std::string many;
  for (int i = 0; i < 100; ++i) many += "/tmp/" + std::to_string(i) + "\n";
  assert(LinuxFileChooserPicks(many).size() == ardiacore::kLinuxFileChooserPickLimit);
  assert(LinuxFileChooserPicks(std::string(ardiacore::kLinuxFileChooserFileLimit + 1, '/')).empty());
  return 0;
}
'''


class BackgroundFileDialogTests(unittest.TestCase):
    def test_answers_are_absolute_paths_one_per_line_and_bounded(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if not compiler:
            self.skipTest('C++ compiler is unavailable')
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / 'picks.cc'
            binary = pathlib.Path(directory) / 'picks'
            source.write_text(PICKS)
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(SOURCE),
                                    str(source), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stderr)
            ran = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(ran.returncode, 0, ran.stderr)


if __name__ == '__main__':
    unittest.main()
