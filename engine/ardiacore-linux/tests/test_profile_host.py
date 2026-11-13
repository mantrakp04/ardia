import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from support import method


ROOT = Path(__file__).resolve().parents[1]
HOST = Path(os.environ.get('ARDIA_PROFILE_HOST_SOURCE', ROOT / 'src/ardia/linux/ac_linux_host.cc'))


class ProfileHostTests(unittest.TestCase):
    def setUp(self):
        self.source = HOST.read_text()

    def test_refused_windows_are_dropped_without_closed_history_and_private_ones_stay_with_their_opener(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        functions = '\n'.join(method(self.source, signature) for signature in (
            'bool PrivateProfileId(', 'void NotifyOpener(', 'void NotifyWindowRefused(', 'void RefuseRequestedWindow('))
        code = r'''
#include "ardia/linux/ac_linux_profiles.h"
#include <cassert>
#include <map>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
std::vector<std::string> log;
namespace base {
struct DictValue {
  std::map<std::string, std::string> values;
  DictValue&& Set(const char* key, std::string value) && { values[key] = std::move(value); return std::move(*this); }
  DictValue Clone() const { return *this; }
};
struct Value {
  DictValue dict;
  explicit Value(DictValue value) : dict(std::move(value)) {}
};
}
namespace ardiacore {
void ReleaseLinuxProfile(std::string_view id) { log.push_back("release:" + std::string(id)); }
}
struct Host {
  std::string name;
  void Event(std::string_view module, std::string_view event, base::Value payload) {
    log.push_back(name + ":" + std::string(module) + "." + std::string(event) + ":" +
                  payload.dict.values["type"] + ":" + payload.dict.values["id"]);
  }
};
std::map<int, Host*>& Hosts() { static std::map<int, Host*> hosts; return hosts; }
struct RequestedWindow { std::string id; std::string page_profile; int opener_host = 0; };
std::map<int, RequestedWindow>& RequestedWindows() { static std::map<int, RequestedWindow> windows; return windows; }
struct Window { void Close() { log.push_back("chrome:close"); } };
struct BrowserWindowInterface {
  Window window;
  Window* GetWindow() { return &window; }
};
ARDIA_NATIVE
int main() {
  Host opener{"opener"};
  Host other{"other"};
  Hosts()[1] = &opener;
  Hosts()[2] = &other;
  RequestedWindows()[7] = {"w-work", "p-work", 1};
  RequestedWindows()[8] = {"w-kept", "", 1};
  RequestedWindows()[9] = {"w-private", "incognito:w-private@", 1};
  BrowserWindowInterface browser;
  RefuseRequestedWindow(&browser, RequestedWindows().find(7));
  assert(!RequestedWindows().contains(7) && RequestedWindows().contains(8));
  assert((log == std::vector<std::string>{
      "opener:ArdiaShell.onWindowEvent:refused:w-work",
      "other:ArdiaShell.onWindowEvent:refused:w-work",
      "chrome:close"}));
  log.clear();
  RefuseRequestedWindow(&browser, RequestedWindows().find(9));
  assert((log == std::vector<std::string>{
      "release:incognito:w-private@",
      "opener:ArdiaShell.onWindowEvent:refused:w-private",
      "chrome:close"}));
  log.clear();
  NotifyOpener(42, base::DictValue().Set("type", "attached").Set("id", "gone"));
  assert(log.empty());
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-profile-host-') as scratch:
            cpp = Path(scratch) / 'refuse.cc'
            binary = Path(scratch) / 'refuse'
            cpp.write_text(code.replace('ARDIA_NATIVE', functions))
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(ROOT / 'src'),
                                     str(ROOT / 'src/ardia/linux/ac_linux_profiles.cc'), str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
