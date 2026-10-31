from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


class ContractTests(unittest.TestCase):
    def test_allowlist_only_targets_existing_nonsecret_services(self):
        root = Path(__file__).resolve().parents[3]
        source = (root / 'engine/ardiacore-linux/src/ardia/linux/ac_linux_contract.h').read_text()
        services = set(re.findall(r'^AC_(?:ENGINE|PROFILE|ARGS)_CALL\((ac_\w+)\b',  '\n'.join(path.read_text() for path in (root / 'engine/chromium/src/chrome/browser/ardia').glob('*.cc')), re.MULTILINE))
        routes = re.findall(r'\{"([\w.]+)", "(ac_\w+)", "(\w*)"\}', source)
        self.assertGreater(len(routes), 30)
        self.assertEqual(len(routes), len({name for name, _, _ in routes}))
        for name, service, _ in routes:
            self.assertIn(service, services, name)
            self.assertNotIn(service, {'ac_passwords_add', 'ac_passwords_update', 'ac_autofill_save_card', 'ac_autofill_import'})
        self.assertIn(('downloads.pause', 'ac_downloads_command', 'null'), routes)
        self.assertIn(('engine.tasks', 'ac_tasks_list', 'tasks'), routes)
        self.assertIn(('history.query', 'ac_history_query', ''), routes)

    def test_native_claim_and_routing_authority(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        root = Path(__file__).resolve().parents[1] / 'src'
        source = (root / 'ardia/linux/ac_linux_host.cc').read_text()
        start = source.index('TabBinding* ShellHostView::ClaimedBinding(')
        end = source.index('\nbool ShellHostView::CloseTab(', start)
        guard = source[start:end]
        code = r'''
#include "ardia/linux/ac_linux_contract.h"
#include <cassert>
#include <map>
#include <memory>
#include <vector>
#include <optional>
#include <string>
namespace base {
struct DictValue {
  std::map<std::string, int> ints;
  std::map<std::string, std::string> strings;
  std::optional<int> FindInt(const char* key) const {
    auto it = ints.find(key);
    return it == ints.end() ? std::nullopt : std::optional(it->second);
  }
};
}
std::string String(const base::DictValue& args, const char* key) {
  auto it = args.strings.find(key);
  return it == args.strings.end() ? "" : it->second;
}
namespace base { template<class C, class V> bool Contains(const C& container, const V& value) { for (const auto& item : container) if (item == value) return true; return false; } }
struct TabBinding {
  int* value;
  std::string claim;
  int renderer_generation = 1;
  std::vector<int> replaced_ids;
  int* contents() { return value; }
};
struct ShellHostView {
  bool handler_ = true;
  int renderer_generation_ = 1;
  std::map<int, std::unique_ptr<TabBinding>> bindings_;
  TabBinding* Binding(int id) { auto it = bindings_.find(id); return it == bindings_.end() ? nullptr : it->second.get(); }
  TabBinding* ClaimedBinding(const base::DictValue&);
};
ARDIA_NATIVE_GUARD
using namespace ardiacore::linux_contract;
int main() {
  int contents = 7;
  ShellHostView owner;
  ShellHostView other;
  owner.bindings_[7] = std::make_unique<TabBinding>(TabBinding{&contents, "current", 1, {}});
  TabBinding& binding = *owner.bindings_[7];
  base::DictValue request;
  request.ints["id"] = 7;
  request.strings["claim"] = "current";
  assert(owner.ClaimedBinding(request) == &binding);
  assert(!other.ClaimedBinding(request));
  binding.claim = "replacement";
  assert(!owner.ClaimedBinding(request));
  request.strings["claim"] = "replacement";
  assert(owner.ClaimedBinding(request) == &binding);
  base::DictValue replaced;
  replaced.ints["id"] = 5;
  replaced.strings["claim"] = "replacement";
  assert(!owner.ClaimedBinding(replaced));
  binding.replaced_ids = {3, 5};
  assert(owner.ClaimedBinding(replaced) == &binding);
  replaced.strings["claim"] = "stale";
  assert(!owner.ClaimedBinding(replaced));
  replaced.ints["id"] = 0;
  binding.replaced_ids.clear();
  replaced.strings["claim"] = "replacement";
  assert(!owner.ClaimedBinding(replaced));
  binding.claim.clear();
  assert(!owner.ClaimedBinding(request));
  binding.claim = "replacement";
  binding.value = nullptr;
  assert(!owner.ClaimedBinding(request));
  assert(CanReclaim("", ""));
  assert(CanReclaim("current", "current"));
  assert(!CanReclaim("current", ""));
  assert(!CanReclaim("current", "stale"));
  assert(!OwnsClaim("", ""));
  assert(!OwnsClaim("current", "stale"));
  assert(OwnsClaim("current", "current"));
  assert(CanTransfer(true, false, true));
  assert(!CanTransfer(false, false, true));
  assert(!CanTransfer(true, true, true));
  assert(!CanTransfer(true, false, false));
  assert(FindRoute("history.query"));
  assert(FindRoute("downloads.settings"));
  assert(!FindRoute("ac_history_query"));
  assert(!FindRoute("passwords.save"));
  assert(!FindRoute("autofill.saveCard"));
  assert(!FindRoute("future.call"));
  assert(EventName("history.changed") == "history.changed");
  assert(EventName("tabs.strip").empty());
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-linux-contract-') as scratch:
            cpp = Path(scratch) / 'contract.cc'
            binary = Path(scratch) / 'contract'
            cpp.write_text(code.replace("ARDIA_NATIVE_GUARD", guard))
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(root), str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
