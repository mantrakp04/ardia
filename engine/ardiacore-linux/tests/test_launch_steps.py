import pathlib
import shutil
import subprocess
import tempfile
import unittest


SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'src'


class LaunchStepsTests(unittest.TestCase):
    def test_launch_steps_record_known_steps_once_per_process(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        code = r'''#include <cassert>
#include <string>
#include <vector>
#include "ardia/linux/ac_linux_launch_steps.h"
int main() {
  using namespace ardia::linux_launch;
  LaunchSteps steps;
  assert(steps.List().empty());
  assert(!steps.Done("version"));
  assert(steps.Complete("version"));
  assert(!steps.Complete("version"));
  assert(steps.Done("version"));
  assert(steps.Complete("onboarding"));
  assert(!steps.Complete("unknown"));
  assert(!steps.Complete(""));
  assert(!steps.Complete("version "));
  assert(!steps.Complete(std::string("version\0x", 9)));
  assert((steps.List() == std::vector<std::string>{"onboarding", "version"}));
  for (const auto step : kSteps) assert(ValidStep(step));
  assert(!ValidStep("Version"));
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-launch-steps-test-') as scratch:
            scratch = pathlib.Path(scratch)
            cpp = scratch / 'steps.cc'
            cpp.write_text(code)
            binary = scratch / 'steps'
            subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', '-I', str(SOURCE), str(cpp), '-o', str(binary)], check=True, capture_output=True)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
