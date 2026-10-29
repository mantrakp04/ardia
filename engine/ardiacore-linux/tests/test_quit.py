import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

from test_renderer_contract import method as extract
from test_session_merge import VALUES

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
LINUX = ROOT / 'src' / 'ardia' / 'linux'
HOST = (LINUX / 'ac_linux_host.cc').read_text()
BRANCH = '  if (method == "ArdiaShell.quit" || method == "ArdiaShell.downloadsInProgress")'

HARNESS = r'''#include <cassert>
#include <functional>
#include <string>
#include <vector>
#include "base/values.h"

#define FROM_HERE 0
int exits = 0;
int downloads = 0;
std::vector<std::function<void()>> posted;
namespace chrome { void AttemptExit() { ++exits; } }
struct DownloadCoreService { static int BlockingShutdownCountAllProfiles() { return downloads; } };
namespace base {
template <class> class OnceCallback;
template <class R, class... A> class OnceCallback<R(A...)> {
 public:
  template <class F> OnceCallback(F fn) : fn_(std::move(fn)) {}
  R Run(A... args) && { auto fn = std::move(fn_); return fn(std::forward<A>(args)...); }
 private:
  std::function<R(A...)> fn_;
};
inline std::function<void()> BindOnce(void (*fn)()) { return fn; }
struct SingleThreadTaskRunner {
  static SingleThreadTaskRunner* GetCurrentDefault() { static SingleThreadTaskRunner runner; return &runner; }
  void PostTask(int, std::function<void()> task) { posted.push_back(std::move(task)); }
};
}

struct Reply { bool called = false; bool ok = false; base::Value value; };

Reply Invoke(const std::string& method, base::ListValue values) {
  Reply reply;
  base::OnceCallback<void(bool, base::Value)> done([&reply](bool ok, base::Value value) {
    reply.called = true; reply.ok = ok; reply.value = std::move(value);
  });
  [&] {
BRANCH
  }();
  return reply;
}

int main() {
  downloads = 3;
  auto count = Invoke("ArdiaShell.downloadsInProgress", base::ListValue());
  assert(count.called && count.ok && count.value.is_int() && count.value.GetInt() == 3);
  assert(exits == 0 && posted.empty());
  auto refused = Invoke("ArdiaShell.downloadsInProgress", base::ListValue().Append(base::Value("x")));
  assert(refused.called && !refused.ok);
  auto quit = Invoke("ArdiaShell.quit", base::ListValue());
  assert(quit.called && quit.ok && quit.value.is_none());
  assert(exits == 0 && posted.size() == 1);
  posted.front()();
  assert(exits == 1);
  posted.clear();
  auto bad = Invoke("ArdiaShell.quit", base::ListValue().Append(base::Value(true)));
  assert(bad.called && !bad.ok && posted.empty() && exits == 1);
  auto other = Invoke("ArdiaShell.copyText", base::ListValue());
  assert(!other.called && posted.empty());
}
'''


class QuitRouteTests(unittest.TestCase):
    def test_quit_and_download_count_routes_run_production_code(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        self.assertIsNotNone(compiler)
        branch = extract(HOST, BRANCH)
        with tempfile.TemporaryDirectory(prefix='ardia-quit-') as directory:
            root = pathlib.Path(directory)
            (root / 'base').mkdir()
            (root / 'base/values.h').write_text(VALUES)
            (root / 'main.cc').write_text(HARNESS.replace('BRANCH', branch))
            binary = root / 'quit'
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', '-fsanitize=address,undefined',
                                    '-fno-omit-frame-pointer', '-I', str(root), str(root / 'main.cc'), '-o', str(binary)],
                                   capture_output=True, text=True, timeout=120)
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            ran = subprocess.run([str(binary)], capture_output=True, text=True, timeout=20)
            self.assertEqual(ran.returncode, 0, ran.stdout + ran.stderr)

    def test_routes_are_advertised_and_chromium_leaves_the_download_question_to_ardia(self):
        self.assertIn('.Append("ArdiaShell.quit")', HOST)
        self.assertIn('.Append("ArdiaShell.downloadsInProgress")', HOST)
        self.assertIn('#include "chrome/browser/lifetime/application_lifetime.h"', HOST)
        self.assertIn('#include "chrome/browser/download/download_core_service.h"', HOST)
        initialize = HOST[HOST.index('g_ardia_linux_close_hooks = {'):]
        self.assertIn('SetLinuxQuitAsksAboutDownloads(true);', initialize[:initialize.index('LinuxExtensionsDelegate extensions;')])
        patch = (REPO / 'engine/patches/chromium-linux-document-close.patch').read_text()
        self.assertIn('+  if (download_count == 0 || ardia::LinuxQuitAsksAboutDownloads()) {', patch)

    def test_quit_never_runs_inside_the_reply_and_sources_stay_comment_free(self):
        branch = extract(HOST, BRANCH)
        self.assertIn('PostTask(', branch)
        self.assertIn('chrome::AttemptExit', branch)
        self.assertNotIn('AttemptUserExit', branch)
        hooks = (LINUX / 'ac_linux_close_hooks.cc').read_text() + (LINUX / 'ac_linux_close_hooks.h').read_text()
        self.assertIsNone(re.search(r'//|/\*', hooks))


if __name__ == '__main__':
    unittest.main()
