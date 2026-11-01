from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from support import method


ROOT = Path(__file__).resolve().parents[1]


class LaunchClaimsTests(unittest.TestCase):
    def test_launch_claims_acknowledge_without_a_native_launch_tab(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        source = (ROOT / 'src/ardia/linux/ac_linux_host.cc').read_text()
        native = method(source, 'void ShellHostView::ClaimLaunchTab(')
        code = r'''
#include <cassert>
#include <functional>
#include <string>
#include <utility>
#include <vector>
namespace base {
struct Value {
  std::string text;
  bool string = true;
  Value() = default;
  Value(const char* value) : text(value) {}
  Value(int) : string(false) {}
  bool is_string() const { return string; }
  const std::string& GetString() const { return text; }
};
using ListValue = std::vector<Value>;
template<class T> struct OnceCallback;
template<class... A> struct OnceCallback<void(A...)> {
  std::function<void(A...)> fn;
  template<class F> OnceCallback(F value) : fn(std::move(value)) {}
  void Run(A... args) { fn(std::forward<A>(args)...); }
};
}
struct ShellHostView {
  void ClaimLaunchTab(const base::ListValue&, base::OnceCallback<void(bool, base::Value)>);
};
ARDIA_NATIVE
int main() {
  ShellHostView host;
  const auto call = [&](base::ListValue values) {
    bool success = false;
    int replies = 0;
    host.ClaimLaunchTab(std::move(values), [&](bool ok, base::Value) { success = ok; ++replies; });
    assert(replies == 1);
    return success;
  };
  assert(call({"", "", ""}));
  assert(call({"tab-1", "https://restored.test/", "default"}));
  assert(call({"tab-1", "https://restored.test/", "default"}));
  assert(call({"tab-2", "https://work.test/", "p-work"}));
  assert(!call({}));
  assert(!call({"tab-1", "https://restored.test/"}));
  assert(!call({"tab-1", 7, "default"}));
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-launch-claim-') as scratch:
            cpp = Path(scratch) / 'launch.cc'
            binary = Path(scratch) / 'launch'
            cpp.write_text(code.replace('ARDIA_NATIVE', native))
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
