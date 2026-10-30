from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class DelayedPictureInPictureTests(unittest.TestCase):
    def test_cancelled_entry_cannot_close_a_replacement_window(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        source = (Path(__file__).resolve().parents[1] / 'src/ardia/linux/ac_linux_host.cc').read_text()
        start = source.index('  void CloseCancelledPictureInPicture(')
        brace = source.index('{', start)
        end = brace + 1
        depth = 1
        while depth:
            depth += (source[end] == '{') - (source[end] == '}')
            end += 1
        method = source[start:end]
        exit_start = source.index('  void OnExitPictureInPicture() override {')
        exit_end = source.index('  void CloseCancelledPictureInPicture(', exit_start)
        exit_method = source[exit_start:exit_end].replace(' override', '')
        code = r'''
#include <cassert>
#include <cstdint>
#include <map>
namespace content { struct WebContents {}; }
namespace base {
template<class T> struct WeakPtr {
  T* value;
  WeakPtr(T* pointer = nullptr) : value(pointer) {}
  explicit operator bool() const { return value != nullptr; }
  T* get() const { return value; }
};
}
bool g_ardia_auto_picture_in_picture_off = false;
struct PictureInPictureWindowManager {
  content::WebContents* opener = nullptr;
  int closes = 0;
  static PictureInPictureWindowManager* GetInstance() {
    static PictureInPictureWindowManager manager;
    return &manager;
  }
  content::WebContents* GetWebContents() { return opener; }
  void ExitPictureInPicture() { ++closes; }
};
struct Host {
  int shown = 0;
  bool cancelled = false;
  int TabShown(content::WebContents*) { return shown; }
  bool AutoPictureInPictureCancelled(content::WebContents*) { return cancelled; }
  void ConsumeAutoPictureInPictureCancellation(content::WebContents*) { cancelled = false; }
};
std::map<int, Host*> hosts;
auto& Hosts() { return hosts; }
struct HostRegistry {
  uint64_t pip_generation_ = 1;
  base::WeakPtr<content::WebContents> pip_opener_;
  void ReportPictureInPicture(bool) {}
'''
        main = r'''
};
int main() {
  content::WebContents source, replacement;
  auto* manager = PictureInPictureWindowManager::GetInstance();
  manager->opener = &source;
  Host host;
  hosts[1] = &host;
  HostRegistry registry;
  registry.CloseCancelledPictureInPicture(1, {&source});
  assert(manager->closes == 0);
  host.shown = 2;
  registry.CloseCancelledPictureInPicture(1, {&source});
  assert(manager->closes == 1);
  registry.pip_generation_ = 2;
  registry.CloseCancelledPictureInPicture(1, {&source});
  assert(manager->closes == 1);
  manager->opener = &replacement;
  registry.CloseCancelledPictureInPicture(2, {&source});
  assert(manager->closes == 1);
  manager->opener = &source;
  host.shown = 0;
  g_ardia_auto_picture_in_picture_off = true;
  registry.CloseCancelledPictureInPicture(2, {&source});
  assert(manager->closes == 2);
  registry.CloseCancelledPictureInPicture(2, {nullptr});
  assert(manager->closes == 2);
  host.cancelled = true;
  registry.pip_opener_ = &source;
  registry.OnExitPictureInPicture();
  assert(!host.cancelled);
  assert(!registry.pip_opener_);
  assert(registry.pip_generation_ == 3);
  g_ardia_auto_picture_in_picture_off = false;
  registry.CloseCancelledPictureInPicture(3, {&source});
  assert(manager->closes == 2);
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-delayed-pip-test-') as scratch:
            scratch = Path(scratch)
            cpp = scratch / 'delayed_pip.cc'
            cpp.write_text(code + method + exit_method + main)
            binary = scratch / 'delayed_pip'
            subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', str(cpp), '-o', str(binary)], check=True, capture_output=True)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
