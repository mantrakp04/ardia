from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from test_renderer_contract import method


ROOT = Path(__file__).resolve().parents[1]


class LaunchClaimsTests(unittest.TestCase):
    def test_launch_decision_is_offer_bound_and_consumed_once(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        source = (ROOT / 'src/ardia/linux/ac_linux_host.cc').read_text()
        signature = 'void ShellHostView::ClaimLaunchTab('
        if signature in source:
            native = method(source, signature)
            state = 'ardiacore::linux_contract::LaunchDecision launch_decision_;'
            offered = r'''
  ShellHostView offered;
  offered.launch_decision_.Offer({"launch", "https://offered.test", "default", 17});
  assert(call(offered, "launch", "https://offered.test", "default"));
  assert(offered.adopted == 17);
  assert(offered.creates == 0);
  assert(!call(offered, "launch", "https://offered.test", "default"));
  ShellHostView mismatch;
  mismatch.launch_decision_.Offer({"launch", "https://offered.test", "default", 18});
  assert(!call(mismatch, "other", "https://offered.test", "default"));
  assert(!call(mismatch, "launch", "https://offered.test", "default"));
  assert(mismatch.adopted == 0);
  ShellHostView skipped;
  skipped.launch_decision_.Offer({"launch", "https://offered.test", "default", 19});
  assert(call(skipped, "", "", ""));
  assert(!call(skipped, "launch", "https://offered.test", "default"));
  assert(skipped.adopted == 0);
  ShellHostView wrong_url;
  wrong_url.launch_decision_.Offer({"launch", "https://offered.test", "default", 18});
  assert(!call(wrong_url, "launch", "https://wrong.test", "default"));
  ShellHostView wrong_profile;
  wrong_profile.launch_decision_.Offer({"launch", "https://offered.test", "default", 18});
  assert(!call(wrong_profile, "launch", "https://offered.test", "private"));
  ShellHostView isolated;
  isolated.hosted = "p-work";
  isolated.launch_decision_.Offer({"launch", "https://offered.test", "default", 21});
  assert(!call(isolated, "launch", "https://offered.test", "default"));
  assert(isolated.adopted == 0);
  ShellHostView isolated_own;
  isolated_own.hosted = "p-work";
  isolated_own.launch_decision_.Offer({"launch", "https://offered.test", "p-work", 22});
  assert(call(isolated_own, "launch", "https://offered.test", "p-work"));
  assert(isolated_own.adopted == 22);
'''
        else:
            branch = method(source, '  if (method == "ArdiaTabs.claimLaunchTab")')
            native = 'void ShellHostView::ClaimLaunchTab(const base::ListValue& values, base::OnceCallback<void(bool, base::Value)> done) ' + branch[branch.index('{'):]
            state = ''
            offered = ''
        code = r'''
#include "ardia/linux/ac_linux_contract.h"
#include <cassert>
#include <functional>
#include <map>
#include <string>
#include <tuple>
#include <utility>
#include <vector>
namespace base {
struct Value {
  std::string text;
  Value() = default;
  Value(const char* value) : text(value) {}
  Value(std::string value) : text(std::move(value)) {}
  bool is_string() const { return true; }
  const std::string& GetString() const { return text; }
};
using ListValue = std::vector<Value>;
struct DictValue {
  std::map<std::string, std::string> strings;
  DictValue& Set(const char* key, std::string value) { strings[key] = std::move(value); return *this; }
};
template<class T> struct OnceCallback;
template<class... A> struct OnceCallback<void(A...)> {
  std::function<void(A...)> fn;
  template<class F> OnceCallback(F value) : fn(std::move(value)) {}
  void Run(A... args) { fn(std::forward<A>(args)...); }
};
template<class T> using WeakPtr = T*;
template<class F, class... A> auto BindOnce(F fn, A... args) {
  return [fn, args = std::make_tuple(std::move(args)...)](auto... rest) mutable {
    return std::apply([&](auto&... bound) { return fn(std::move(bound)..., std::move(rest)...); }, args);
  };
}
}
std::string ArgumentString(const base::ListValue& values, size_t index) {
  return index < values.size() ? values[index].GetString() : "";
}
bool DefaultProfileId(std::string_view profile) { return profile.empty() || profile == "default"; }
struct Binding { std::string claim; };
struct ShellHostView {
  int creates = 0;
  int adopted = 0;
  std::string hosted = "default";
  Binding binding;
  bool HostsProfile(std::string_view profile) const { return profile == hosted || (hosted == "default" && profile.empty()); }
  ARDIA_STATE
  ShellHostView* GetWeakPtr() { return this; }
  Binding* BindingForKey(const std::string&) { return &binding; }
  void CreateTab(const base::DictValue&, base::OnceCallback<void(bool, base::Value)> done) {
    ++creates;
    binding.claim = "launch";
    done.Run(true, {});
  }
  bool AdoptLaunchOffer(int tab, std::string_view, std::string_view) { adopted = tab; return true; }
  void ClaimLaunchTab(const base::ListValue&, base::OnceCallback<void(bool, base::Value)>);
};
ARDIA_NATIVE
int main() {
  const auto call = [](ShellHostView& host, const char* key, const char* url, const char* profile) {
    bool success = false;
    host.ClaimLaunchTab({key, url, profile}, [&](bool ok, base::Value) { success = ok; });
    return success;
  };
  ShellHostView empty;
  assert(call(empty, "", "", ""));
  assert(!call(empty, "arbitrary", "https://arbitrary.test", "default"));
  assert(empty.creates == 0);
  ShellHostView absent;
  assert(!call(absent, "arbitrary", "https://arbitrary.test", "default"));
  assert(absent.creates == 0);
  ARDIA_OFFERED
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-launch-claim-') as scratch:
            cpp = Path(scratch) / 'launch.cc'
            binary = Path(scratch) / 'launch'
            cpp.write_text(code.replace('ARDIA_STATE', state).replace('ARDIA_NATIVE', native).replace('ARDIA_OFFERED', offered))
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(ROOT / 'src'), str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_native_adoption_reuses_only_the_offered_owned_contents(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        source = (ROOT / 'src/ardia/linux/ac_linux_host.cc').read_text()
        native = method(source, 'bool ShellHostView::AdoptLaunchOffer(')
        code = r'''
#include <cassert>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
struct GURL {
  std::string value;
  explicit GURL(std::string_view url) : value(url) {}
  bool operator!=(const GURL& other) const { return value != other.value; }
};
struct Contents {
  int id;
  void* context;
  GURL url;
  void* GetBrowserContext() { return context; }
  const GURL& GetVisibleURL() { return url; }
};
int TabId(Contents* contents) { return contents->id; }
struct Model {
  std::vector<Contents*> tabs;
  int count() { return static_cast<int>(tabs.size()); }
  Contents* GetWebContentsAt(int index) { return tabs[index]; }
};
struct Browser {
  Model model;
  Model* GetTabStripModel() { return &model; }
};
struct TabBinding {
  Contents* value;
  std::string key_;
  int renderer_generation = 0;
  TabBinding(void*, Contents* contents, std::string key) : value(contents), key_(std::move(key)) {}
};
struct ShellHostView {
  Browser* browser_;
  void* profile_;
  int renderer_generation_ = 1;
  int transactions = 0;
  std::map<int, std::unique_ptr<TabBinding>> bindings_;
  void* page_profile() { return profile_; }
  TabBinding* Binding(int id) { const auto found = bindings_.find(id); return found == bindings_.end() ? nullptr : found->second.get(); }
  TabBinding* BindingForKey(std::string_view key) {
    for (const auto& [id, binding] : bindings_) if (binding->key_ == key) return binding.get();
    return nullptr;
  }
  void QueueTransaction(int) { ++transactions; }
  bool AdoptLaunchOffer(int, std::string_view, std::string_view);
};
ARDIA_NATIVE
int main() {
  int profile = 0;
  int other_profile = 0;
  Contents offered{17, &profile, GURL("https://offered.test")};
  Contents foreign{18, &other_profile, GURL("https://offered.test")};
  Browser browser;
  browser.model.tabs = {&offered, &foreign};
  ShellHostView host{};
  host.browser_ = &browser;
  host.profile_ = &profile;
  assert(!host.AdoptLaunchOffer(17, "launch", "https://wrong.test"));
  assert(!host.AdoptLaunchOffer(18, "launch", "https://offered.test"));
  assert(!host.AdoptLaunchOffer(99, "launch", "https://offered.test"));
  assert(host.bindings_.empty());
  assert(host.AdoptLaunchOffer(17, "launch", "https://offered.test"));
  assert(host.Binding(17)->value == &offered);
  assert(host.Binding(17)->key_ == "launch");
  assert(host.Binding(17)->renderer_generation == host.renderer_generation_);
  assert(!host.AdoptLaunchOffer(17, "launch", "https://offered.test"));
  assert(!host.AdoptLaunchOffer(17, "different", "https://offered.test"));
  assert(host.transactions == 1);
  assert(browser.model.count() == 2);
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-launch-adoption-') as scratch:
            cpp = Path(scratch) / 'adoption.cc'
            binary = Path(scratch) / 'adoption'
            cpp.write_text(code.replace('ARDIA_NATIVE', native))
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
