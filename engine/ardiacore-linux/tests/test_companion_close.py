import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST = ROOT / 'src/ardia/linux/ac_linux_host.cc'


def method(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


PRELUDE = r'''
#include <cassert>
#include <deque>
#include <functional>
#include <memory>
#include <string>
#include <utility>
#include <vector>
#define FROM_HERE 0
namespace base {
template<class Signature> class OnceCallback;
template<class R, class... Args> class OnceCallback<R(Args...)> {
  std::function<R(Args...)> callback_;
 public:
  OnceCallback() = default;
  template<class F> OnceCallback(F callback) : callback_(std::move(callback)) {}
  R Run(Args... args) { auto callback = std::move(callback_); return callback(args...); }
};
template<class F, class... Bound> auto BindOnce(F function, Bound... bound) {
  return [function, bound...]() mutable { return function(std::move(bound)...); };
}
struct DoNothing {};
struct SingleThreadTaskRunner {
  std::deque<OnceCallback<void()>> tasks;
  static SingleThreadTaskRunner* GetCurrentDefault() { static SingleThreadTaskRunner runner; return &runner; }
  void PostTask(int, OnceCallback<void()> task) { tasks.push_back(std::move(task)); }
  void Drain() { while (!tasks.empty()) { auto task = std::move(tasks.front()); tasks.pop_front(); task.Run(); } }
};
template<class T> struct WeakPtr {
  T* pointer = nullptr;
  std::shared_ptr<bool> alive;
  explicit operator bool() const { return pointer && alive && *alive; }
  T* operator->() const { assert(bool(*this)); return pointer; }
  T* get() const { return bool(*this) ? pointer : nullptr; }
};
}
namespace browser_shutdown {
inline bool trying_to_quit = false;
inline bool IsTryingToQuit() { return trying_to_quit; }
}
struct Tab {
  std::string name;
  bool beforeunload = false;
  bool unload = false;
};
std::vector<std::string> unloads;
std::vector<std::string> prompts;
std::vector<std::string> history;
struct BrowserWindowInterface;
struct Strip {
  std::vector<Tab> tabs;
  int count() const { return static_cast<int>(tabs.size()); }
  void RemoveObserver(void*) {}
};
struct UnloadController {
  enum class State { kIdle, kBeforeUnloadConfirmed, kUnloadCompleted };
  State state = State::kIdle;
  bool force_skip = false;
  BrowserWindowInterface* browser = nullptr;
  static UnloadController* From(BrowserWindowInterface* browser);
  void set_force_skip_warning_user_on_close(bool value) { force_skip = value; }
  bool is_attempting_to_close_browser() const { return state != State::kIdle; }
  bool RunBeforeUnloadForShutdown(bool skip_beforeunload, base::DoNothing);
};
struct Window {
  BrowserWindowInterface* browser;
  void Close();
};
struct BrowserWindowInterface {
  std::string name;
  bool companion = true;
  bool closed = false;
  std::shared_ptr<bool> alive = std::make_shared<bool>(true);
  Strip strip;
  UnloadController unload;
  Window window{this};
  Strip* GetTabStripModel() { return &strip; }
  Window* GetWindow() { return &window; }
  bool IsDeleteScheduled() const { return closed; }
  base::WeakPtr<BrowserWindowInterface> GetWeakPtr() { return {this, alive}; }
};
UnloadController* UnloadController::From(BrowserWindowInterface* browser) {
  browser->unload.browser = browser;
  return &browser->unload;
}
bool NeedsUnloadEvents(const Strip& strip) {
  for (const auto& tab : strip.tabs) if (tab.beforeunload || tab.unload) return true;
  return false;
}
bool UnloadController::RunBeforeUnloadForShutdown(bool skip_beforeunload, base::DoNothing) {
  if (state != State::kIdle || !NeedsUnloadEvents(browser->strip)) return false;
  for (const auto& tab : browser->strip.tabs) {
    if (tab.beforeunload && !skip_beforeunload) prompts.push_back(tab.name);
  }
  state = State::kBeforeUnloadConfirmed;
  return !skip_beforeunload;
}
void Window::Close() {
  UnloadController& unload = browser->unload;
  if (!unload.force_skip) {
    if (unload.state == UnloadController::State::kIdle) {
      for (const auto& tab : browser->strip.tabs) if (tab.beforeunload) prompts.push_back(tab.name);
    }
    for (const auto& tab : browser->strip.tabs) if (tab.unload) unloads.push_back(tab.name);
    unload.state = UnloadController::State::kUnloadCompleted;
  }
  for (const auto& tab : browser->strip.tabs) {
    if (!(browser->companion && unload.is_attempting_to_close_browser())) history.push_back(tab.name);
  }
  browser->strip.tabs.clear();
  browser->closed = true;
}
struct ShellHostView {
  std::vector<base::WeakPtr<BrowserWindowInterface>> companions_;
  bool member_active_ = true;
  void CloseCompanions();
};
'''

MAIN = r'''
bool Has(const std::vector<std::string>& list, const std::string& name) {
  for (const auto& entry : list) if (entry == name) return true;
  return false;
}
int main() {
  BrowserWindowInterface confirmed, unconfirmed, plain;
  confirmed.name = "confirmed";
  unconfirmed.name = "unconfirmed";
  plain.name = "plain";
  confirmed.strip.tabs = {{"confirmed-page", true, true}};
  confirmed.unload.state = UnloadController::State::kBeforeUnloadConfirmed;
  unconfirmed.strip.tabs = {{"unconfirmed-page", true, true}};
  plain.strip.tabs = {{"plain-page", false, false}, {"plain-other", false, false}};
  ShellHostView host;
  host.companions_ = {confirmed.GetWeakPtr(), unconfirmed.GetWeakPtr(), plain.GetWeakPtr()};
  host.CloseCompanions();
  assert(host.companions_.empty() && !host.member_active_);
  base::SingleThreadTaskRunner::GetCurrentDefault()->Drain();
  assert(confirmed.closed && unconfirmed.closed && plain.closed);
  assert(Has(unloads, "confirmed-page"));
  assert(Has(unloads, "unconfirmed-page"));
  assert(prompts.empty());
  assert(history.empty());
  return 0;
}
'''


class CompanionCloseTests(unittest.TestCase):
    def test_companions_close_through_unload_without_prompts_or_recently_closed_entries(self):
        compiler = shutil.which(os.environ.get('CXX', 'clang++')) or shutil.which('g++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        close = method(HOST.read_text(), 'void ShellHostView::CloseCompanions() {')
        with tempfile.TemporaryDirectory(prefix='ardia-companion-close-') as scratch:
            path = pathlib.Path(scratch)
            (path / 'main.cc').write_text(PRELUDE + close + MAIN)
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
                                     '-fsanitize=address,undefined', str(path / 'main.cc'), '-o', str(path / 'test')],
                                    capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(path / 'test')], capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
