from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class AutoPictureInPictureTests(unittest.TestCase):
    def test_presentation_batches_validate_before_mutation_and_return_before_departure(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        source = (Path(__file__).resolve().parents[1] / 'src/ardia/linux/ac_linux_host.cc').read_text()
        start = source.index('void ShellHostView::SetPresentations(')
        end = source.index('\nvoid ShellHostView::StripCommand(', start)
        method = source[start:end]
        claim_start = source.index('TabBinding* ShellHostView::ClaimedBinding(')
        claim_end = source.index('\nbool ShellHostView::CloseTab(', claim_start)
        claim_method = source[claim_start:claim_end]
        shown_start = source.index('  int TabShown(')
        shown_brace = source.index('{', shown_start)
        shown_end = shown_brace + 1
        shown_depth = 1
        while shown_depth:
            shown_depth += (source[shown_end] == '{') - (source[shown_end] == '}')
            shown_end += 1
        shown = source[shown_start:shown_end]
        prelude = r'''
#include "ardia/linux/ac_linux_contract.h"
#include <cassert>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <variant>
#include <vector>
namespace base {
template<class T> class WeakPtr {
 public:
  WeakPtr(T* value = nullptr) : value_(value) {}
  T* get() const { return value_; }
  T* operator->() const { return value_; }
  explicit operator bool() const { return value_ != nullptr; }
 private:
  T* value_;
};
template<class T> class OnceCallback;
template<class... A> class OnceCallback<void(A...)> {
 public:
  OnceCallback(std::function<void(A...)> fn) : fn_(std::move(fn)) {}
  void Run(A... args) { fn_(std::forward<A>(args)...); }
 private:
  std::function<void(A...)> fn_;
};
struct DictValue;
struct Value {
  std::shared_ptr<DictValue> dict;
  Value() = default;
  Value(const char*) {}
  explicit Value(DictValue value);
  const DictValue* GetIfDict() const { return dict.get(); }
  const DictValue& GetDict() const { assert(dict); return *dict; }
};
using ListValue = std::vector<Value>;
struct DictValue {
  std::map<std::string, std::string> strings;
  std::map<std::string, int> ints;
  std::map<std::string, bool> bools;
  std::map<std::string, ListValue> lists;
  std::optional<int> FindInt(const char* key) const {
    auto found = ints.find(key);
    return found == ints.end() ? std::nullopt : std::optional(found->second);
  }
  std::optional<bool> FindBool(const char* key) const {
    auto found = bools.find(key);
    return found == bools.end() ? std::nullopt : std::optional(found->second);
  }
  const ListValue* FindList(const char* key) const {
    auto found = lists.find(key);
    return found == lists.end() ? nullptr : &found->second;
  }
};
Value::Value(DictValue value) : dict(std::make_shared<DictValue>(std::move(value))) {}
}
std::string String(const base::DictValue& value, const char* key) {
  const auto found = value.strings.find(key);
  return found == value.strings.end() ? "" : found->second;
}
namespace content {
struct WebContents {
  int id;
  base::WeakPtr<WebContents> GetWeakPtr() { return this; }
};
}
std::vector<std::pair<int, bool>> events;
struct AutoPictureInPictureTabHelper {
  content::WebContents* contents;
  static AutoPictureInPictureTabHelper* FromWebContents(content::WebContents* contents) {
    static AutoPictureInPictureTabHelper helper;
    helper.contents = contents;
    return &helper;
  }
  void OnTabActivatedChanged(bool visible) { events.emplace_back(contents->id, visible); }
};
namespace base { template<class C, class V> bool Contains(const C& container, const V& value) { for (const auto& item : container) if (item == value) return true; return false; } }
struct TabBinding {
  content::WebContents value;
  std::string claim = "current";
  int renderer_generation = 1;
  bool presented = false;
  bool presentation_applied = false;
  bool presentation_attached = false;
  bool presentation_departed = false;
  int cancelled_auto_pip_until = 0;
  std::vector<int> replaced_ids;
  void RememberPendingAutoPictureInPicture() {}
  content::WebContents* contents() { return &value; }
  int reveals = 0;
  void Reveal() { ++reveals; }
  base::WeakPtr<TabBinding> GetWeakPtr() { return this; }
};
struct ShellHostView {
  bool handler_ = true;
  int renderer_generation_ = 1;
  std::map<int, std::unique_ptr<TabBinding>> bindings_;
  TabBinding* Binding(int id) {
    const auto found = bindings_.find(id);
    return found == bindings_.end() ? nullptr : found->second.get();
  }
  TabBinding* ClaimedBinding(const base::DictValue& args);
  ARDIA_SHOWN_METHOD
  void SetPresentations(const base::DictValue&, base::OnceCallback<void(bool, base::Value)>);
};
'''
        main = r'''
int main() {
  ShellHostView host;
  for (int id : {1, 2}) host.bindings_[id] = std::make_unique<TabBinding>(TabBinding{{id}});
  assert(host.TabShown(host.Binding(1)->contents()) == 2);
  auto item = [](int id, bool visible) {
    base::DictValue value;
    value.ints["id"] = id;
    value.strings["claim"] = "current";
    value.bools["visible"] = visible;
    return base::Value(std::move(value));
  };
  auto send = [&](base::ListValue tabs) {
    base::DictValue args;
    args.lists["tabs"] = std::move(tabs);
    bool called = false;
    bool success = false;
    host.SetPresentations(args, std::function<void(bool, base::Value)>([&](bool ok, base::Value) {
      called = true;
      success = ok;
    }));
    assert(called);
    return success;
  };
  assert(send({item(1, true), item(2, false)}));
  assert(host.TabShown(host.Binding(1)->contents()) == 1);
  assert(host.TabShown(host.Binding(2)->contents()) == 2);
  assert((events == std::vector<std::pair<int, bool>>{{1, true}}));
  events.clear();
  assert(send({item(1, false), item(2, true)}));
  assert(host.TabShown(host.Binding(1)->contents()) == 0);
  assert((events == std::vector<std::pair<int, bool>>{{2, true}, {1, false}}));
  events.clear();
  assert(send({item(1, false), item(2, true)}));
  assert(events.empty());
  assert(send({item(1, true), item(2, true)}));
  assert((events == std::vector<std::pair<int, bool>>{{1, true}}));
  events.clear();
  assert(!send({item(1, false), item(99, true)}));
  assert(host.Binding(1)->presented);
  assert(events.empty());
  assert(!send({item(1, false), base::Value()}));
  assert(host.Binding(1)->presented);
  auto stale = item(1, false);
  stale.dict->strings["claim"] = "stale";
  assert(!send({item(2, false), stale}));
  assert(host.Binding(2)->presented);
  assert(host.Binding(1)->presented);
  assert(events.empty());
  assert(send({item(1, false), item(1, true)}));
  assert(events.empty());
  assert(send({}));
  assert(events.empty());
  auto* released = host.Binding(1);
  released->presented = false;
  released->presentation_applied = false;
  released->presentation_attached = false;
  released->presentation_departed = false;
  assert(host.TabShown(released->contents()) == 2);
  assert(send({item(1, false)}));
  assert(host.TabShown(released->contents()) == 2);
  assert(events.empty());
  assert(send({item(1, true)}));
  assert(send({item(1, false)}));
  assert(host.TabShown(released->contents()) == 0);
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-auto-pip-test-') as scratch:
            scratch = Path(scratch)
            cpp = scratch / 'auto_pip.cc'
            cpp.write_text(prelude.replace('ARDIA_SHOWN_METHOD', shown) + claim_method + method + main)
            binary = scratch / 'auto_pip'
            subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', '-I', str(Path(__file__).resolve().parents[1] / 'src'), str(cpp), '-o', str(binary)], check=True, capture_output=True)
            subprocess.run([str(binary)], check=True)


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
