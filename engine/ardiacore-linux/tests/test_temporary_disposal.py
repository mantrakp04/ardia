from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from test_renderer_contract import method


ROOT = Path(__file__).resolve().parents[1]


class TemporaryDisposalTests(unittest.TestCase):
    def test_force_disposal_survives_unload_cancellation_and_native_reentrancy(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        source = (ROOT / 'src/ardia/linux/ac_linux_host.cc').read_text()
        native = method(source, 'bool ShellHostView::DisposeTemporary(') + '\n' + method(source, 'bool ShellHostView::CloseTab(')
        code = r'''
#include <cassert>
#include <functional>
#include <map>
#include <memory>
#include <utility>
#include <vector>
namespace base {
template<class T> struct WeakPtr {
  T* value;
  std::weak_ptr<int> life;
  explicit operator bool() const { return !life.expired(); }
  T* operator->() const { assert(!life.expired()); return value; }
};
}
enum class TabRemovedReason { kDeleted, kInsertedIntoOtherTabStrip };
namespace TabCloseTypes { constexpr int CLOSE_USER_GESTURE = 1; constexpr int CLOSE_CREATE_HISTORICAL_TAB = 2; }
struct State {
  bool live = true;
  int late_callbacks = 0;
  int observed_destructions = 0;
};
struct Contents {
  std::shared_ptr<State> state;
  std::function<void()> observer;
  ~Contents() { state->live = false; if (observer) observer(); }
};
struct Model {
  std::vector<std::unique_ptr<Contents>> tabs;
  std::function<void()> during_detach;
  std::vector<std::function<void()>> delayed;
  int attempts = 0;
  int detachments = 0;
  int GetIndexOfWebContents(Contents* contents) {
    for (size_t index = 0; index < tabs.size(); ++index) if (tabs[index].get() == contents) return static_cast<int>(index);
    return -1;
  }
  void CloseWebContentsAt(int index, int) {
    ++attempts;
    std::weak_ptr<State> pending = tabs[index]->state;
    delayed.push_back([pending] { const auto state = pending.lock(); if (state && state->live) ++state->late_callbacks; });
  }
  std::unique_ptr<Contents> Remove(int index, TabRemovedReason reason) {
    ++detachments;
    auto owned = std::move(tabs[index]);
    tabs.erase(tabs.begin() + index);
    auto hook = std::move(during_detach);
    if (hook) hook();
    if (reason == TabRemovedReason::kDeleted) owned.reset();
    return owned;
  }
  std::unique_ptr<Contents> DetachWebContentsAtForInsertion(int index, TabRemovedReason reason) {
    auto owned = Remove(index, reason);
    assert(owned);
    return owned;
  }
  void DetachAndDeleteWebContentsAt(int index) {
    auto owned = Remove(index, TabRemovedReason::kDeleted);
    assert(!owned);
  }
};
struct Browser { Model model; Model* GetTabStripModel() { return &model; } };
struct TabBinding {
  bool temporary = false;
  Contents* value;
  std::shared_ptr<int> life = std::make_shared<int>(0);
  TabBinding(Contents* contents, bool is_temporary) : temporary(is_temporary), value(contents) {
    std::weak_ptr<int> alive = life;
    auto state = contents->state;
    contents->observer = [this, alive, state] {
      if (alive.expired()) return;
      value = nullptr;
      ++state->observed_destructions;
    };
  }
  Contents* contents() { return value; }
};
struct ShellHostView {
  Browser* browser_ = nullptr;
  bool app_operation_ = false;
  std::map<int, std::unique_ptr<TabBinding>> bindings_;
  std::shared_ptr<int> life = std::make_shared<int>(0);
  std::function<void()> during_queue;
  ~ShellHostView() { life.reset(); }
  base::WeakPtr<ShellHostView> GetWeakPtr() { return {this, life}; }
  void QueueTransaction(int) { auto hook = std::move(during_queue); if (hook) hook(); }
  bool DisposeTemporary(TabBinding*);
  bool CloseTab(TabBinding*);
};
ARDIA_NATIVE
TabBinding* Add(ShellHostView& host, int id, const std::shared_ptr<State>& state, bool temporary = true) {
  auto contents = std::make_unique<Contents>();
  contents->state = state;
  auto binding = std::make_unique<TabBinding>(contents.get(), temporary);
  auto* result = binding.get();
  host.bindings_[id] = std::move(binding);
  host.browser_->model.tabs.push_back(std::move(contents));
  return result;
}
void CanceledAndDeferredClose() {
  Browser browser;
  ShellHostView host;
  host.browser_ = &browser;
  auto temporary = std::make_shared<State>();
  auto ordinary = std::make_shared<State>();
  auto* target = Add(host, 7, temporary);
  auto* kept = Add(host, 8, ordinary, false);
  assert(host.CloseTab(target));
  assert(temporary->live);
  assert(host.DisposeTemporary(target));
  assert(!temporary->live);
  assert(!target->contents());
  assert(browser.model.attempts == 1);
  assert(browser.model.detachments == 1);
  for (const auto& pending : browser.model.delayed) pending();
  assert(temporary->late_callbacks == 0);
  assert(temporary->observed_destructions == 1);
  assert(!host.DisposeTemporary(kept));
  assert(ordinary->live);
  assert(host.CloseTab(kept));
  assert(ordinary->live);
  assert(browser.model.attempts == 2);
}
void ReentrantDisposal() {
  Browser browser;
  ShellHostView host;
  host.browser_ = &browser;
  auto a = std::make_shared<State>();
  auto b = std::make_shared<State>();
  auto* first = Add(host, 7, a);
  auto* second = Add(host, 8, b);
  browser.model.during_detach = [&] { assert(host.DisposeTemporary(second)); };
  assert(host.DisposeTemporary(first));
  assert(!a->live && !b->live);
  assert(a->observed_destructions == 1 && b->observed_destructions == 1);
  assert(browser.model.tabs.empty());
}
void OwnerDestruction(bool destroy_browser, bool destroy_at_queue) {
  auto browser = std::make_unique<Browser>();
  auto host = std::make_unique<ShellHostView>();
  host->browser_ = browser.get();
  auto state = std::make_shared<State>();
  auto* target = Add(*host, 7, state);
  auto hook = [&] {
    host.reset();
    if (destroy_browser) browser.reset();
    assert(state->live != destroy_at_queue);
  };
  if (destroy_at_queue) host->during_queue = hook;
  else browser->model.during_detach = hook;
  assert(host->DisposeTemporary(target));
  assert(!state->live);
  assert(!host);
  assert(state->observed_destructions == (destroy_at_queue ? 1 : 0));
}
int main() {
  CanceledAndDeferredClose();
  ReentrantDisposal();
  OwnerDestruction(false, false);
  OwnerDestruction(true, false);
  OwnerDestruction(true, true);
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-temporary-disposal-') as scratch:
            cpp = Path(scratch) / 'temporary.cc'
            binary = Path(scratch) / 'temporary'
            cpp.write_text(code.replace('ARDIA_NATIVE', native))
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
