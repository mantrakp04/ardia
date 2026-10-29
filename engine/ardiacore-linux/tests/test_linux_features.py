import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
PATCH = ROOT / 'engine/patches/chromium-linux-auto-pip.patch'
SERIES = ROOT / 'engine/patches/series'


def main_delegate_hunk():
    text = PATCH.read_text()
    start = text.index('+++ b/chrome/app/chrome_main_delegate.cc')
    end = text.index('\n--- a/', start)
    return text[start:end]


def linux_block():
    added = [line[1:] for line in main_delegate_hunk().splitlines() if line.startswith('+') and not line.startswith('+++')]
    start = added.index('#if BUILDFLAG(IS_LINUX)') + 1
    end = added.index('#endif', start)
    return '\n'.join(added[start:end])


HARNESS = r'''
#include <cassert>
#include <map>
#include <string>
namespace switches { inline constexpr char kEnableFeatures[] = "enable-features"; }
namespace base {
class CommandLine {
 public:
  static CommandLine* ForCurrentProcess() { static CommandLine line; return &line; }
  std::string GetSwitchValueASCII(const std::string& name) const { auto found = switches.find(name); return found == switches.end() ? std::string() : found->second; }
  void AppendSwitchASCII(const std::string& name, const std::string& value) { switches[name] = value; }
  std::map<std::string, std::string> switches;
};
}
void Startup() {
BLOCK
}
int main(int argc, char** argv) {
  auto* line = base::CommandLine::ForCurrentProcess();
  if (argc > 1) line->switches["enable-features"] = argv[1];
  Startup();
  std::printf("%s\n", line->GetSwitchValueASCII("enable-features").c_str());
}
'''


class LinuxFeatureTests(unittest.TestCase):
    def test_linux_main_delegate_enables_in_place_web_contents_discard(self):
        self.assertIn('chromium chromium-linux-auto-pip.patch linux', SERIES.read_text().splitlines())
        compiler = shutil.which(os.environ.get('CXX', 'c++'))
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        with tempfile.TemporaryDirectory(prefix='ardia-linux-features-') as scratch:
            source = Path(scratch) / 'features.cc'
            binary = Path(scratch) / 'features'
            source.write_text('#include <cstdio>\n' + HARNESS.replace('BLOCK', linux_block()))
            subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', str(source), '-o', str(binary)], check=True, timeout=60)
            plain = subprocess.run([str(binary)], check=True, capture_output=True, text=True).stdout.strip().split(',')
            merged = subprocess.run([str(binary), 'Existing'], check=True, capture_output=True, text=True).stdout.strip().split(',')
        self.assertIn('WebContentsDiscard', plain)
        self.assertIn('BrowserInitiatedAutomaticPictureInPicture', plain)
        self.assertEqual(merged[0], 'Existing')
        self.assertEqual(set(merged[1:]), set(plain))


if __name__ == '__main__':
    unittest.main()
