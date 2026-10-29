import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
HOST = SOURCE / 'ardia/linux/ac_linux_host.cc'
FILES = [SOURCE / 'ardia/linux/ac_linux_tab_policy.cc']
FIXTURE = ROOT / 'tests/fixtures/media.h'


def body(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


PRELUDE = r'''
#include "fixtures/media.h"
#include "ardia/linux/ac_linux_tab_policy.h"

namespace mojom { enum class LifecycleUnitDiscardReason { EXTERNAL }; }
struct FakeMedia {
  ardiacore::LinuxTabProtection protection{false, false, false, false, false, false, false};
  std::vector<bool> asked;
  ardiacore::LinuxTabProtection Protection(bool visible) { asked.push_back(visible); auto p = protection; if (visible) p.visible = true; return p; }
};
class TabBinding;
namespace resource_coordinator {
struct TabLifecycleUnitExternal {
  static TabLifecycleUnitExternal* current;
  content::WebContents* contents = nullptr;
  TabBinding* observer = nullptr;
  bool drop = false;
  bool destroy = false;
  int discards = 0;
  static TabLifecycleUnitExternal* FromWebContents(content::WebContents* value) { return current && current->contents == value ? current : nullptr; }
  bool DiscardTab(::mojom::LifecycleUnitDiscardReason);
};
TabLifecycleUnitExternal* TabLifecycleUnitExternal::current = nullptr;
}
class TabBinding {
 public:
  explicit TabBinding(content::WebContents* contents) : contents_(contents) {}
  content::WebContents* contents() const { return contents_; }
  std::unique_ptr<FakeMedia> media = std::make_unique<FakeMedia>();
  bool frozen = false;
  bool discard_reported = false;
  bool presented = false;
  bool pane_visible = false;
  std::vector<std::pair<std::string, base::DictValue>> sent;
  void ReportPresentation(std::string name, base::DictValue data) { sent.emplace_back(std::move(name), std::move(data)); }
  base::WeakPtr<TabBinding> GetWeakPtr() { return weak_.GetWeakPtr(); }
  void WasDiscarded();
  void DidStartNavigation(content::NavigationHandle* handle);
  void Reveal();
  std::string_view Discard(const ardiacore::LinuxDiscardRequest& request);
  bool SetFrozen(bool value);
  content::WebContents* contents_;
  base::WeakPtrFactory<TabBinding> weak_{this};
};
bool resource_coordinator::TabLifecycleUnitExternal::DiscardTab(::mojom::LifecycleUnitDiscardReason) {
  ++discards;
  if (!drop) contents->discarded = true;
  if (observer) observer->WasDiscarded();
  return !drop;
}
'''

TESTS = r'''
struct World {
  Profile profile;
  content::WebContents page{&profile};
  TabBinding binding{&page};
  resource_coordinator::TabLifecycleUnitExternal unit;
  World() {
    page.entry.url = GURL("https://idle.test/two");
    unit.contents = &page;
    unit.observer = &binding;
    resource_coordinator::TabLifecycleUnitExternal::current = &unit;
  }
};

void Discards() {
  World w;
  assert(w.binding.Discard({}) == "discarded" && w.unit.discards == 1);
  assert(w.binding.sent.size() == 1 && w.binding.sent[0].first == "discarded" && *w.binding.sent[0].second.FindString("url") == "https://idle.test/two");
  assert(w.binding.Discard({}) == "already" && w.unit.discards == 1 && w.binding.sent.size() == 1);
  w.binding.WasDiscarded();
  assert(w.binding.sent.size() == 1);
  content::NavigationHandle reload;
  w.page.discarded = false;
  w.binding.DidStartNavigation(&reload);
  assert(w.binding.sent.size() == 2 && w.binding.sent[1].first == "ready" && !w.binding.discard_reported);
  w.binding.DidStartNavigation(&reload);
  assert(w.binding.sent.size() == 2);
  assert(w.binding.Discard({true}) == "unsupported" && w.unit.discards == 1);
}

void Dropped() {
  World w;
  w.unit.drop = true;
  assert(w.binding.Discard({}) == "refused" && w.unit.discards == 1);
  assert(w.binding.sent.empty() && !w.binding.discard_reported);
  content::NavigationHandle navigation;
  w.binding.DidStartNavigation(&navigation);
  assert(w.binding.sent.empty());
  w.unit.drop = false;
  assert(w.binding.Discard({}) == "discarded" && w.binding.sent.size() == 1);
}

void Protected() {
  World w;
  w.binding.media->protection.audible = true;
  assert(w.binding.Discard({}) == "refused" && w.unit.discards == 0);
  assert(!w.binding.SetFrozen(true) && w.page.freezes.empty() && !w.binding.frozen);
  w.binding.media->protection.audible = false;
  w.binding.media->protection.dirty_input = std::nullopt;
  assert(w.binding.Discard({}) == "refused" && !w.binding.SetFrozen(true));
  w.binding.media->protection.dirty_input = false;
  w.binding.pane_visible = true;
  assert(w.binding.Discard({}) == "refused" && w.binding.media->asked.back());
  w.binding.pane_visible = false;
  w.binding.media.reset();
  assert(w.binding.Discard({}) == "refused" && !w.binding.SetFrozen(true) && w.unit.discards == 0);
  World missing;
  resource_coordinator::TabLifecycleUnitExternal::current = nullptr;
  assert(missing.binding.Discard({}) == "refused" && missing.binding.sent.empty());
  TabBinding gone(nullptr);
  assert(gone.Discard({}) == "refused" && !gone.SetFrozen(false));
}

void Freezing() {
  World w;
  assert(w.binding.SetFrozen(true) && w.binding.frozen && w.page.freezes == std::vector<bool>{true});
  w.page.visibility = content::Visibility::VISIBLE;
  w.binding.Reveal();
  assert(!w.binding.frozen && w.page.freezes.size() == 1);
  w.page.visibility = content::Visibility::HIDDEN;
  assert(w.binding.SetFrozen(true) && w.page.freezes.size() == 2);
  w.binding.Reveal();
  assert(!w.binding.frozen && w.page.freezes.back() == false);
  assert(w.binding.SetFrozen(true));
  w.page.visibility = content::Visibility::VISIBLE;
  assert(w.binding.SetFrozen(false) && !w.binding.frozen && w.page.freezes.back() == true);
  w.page.visibility = content::Visibility::OCCLUDED;
  assert(w.binding.SetFrozen(false) && w.page.freezes.back() == false);
}

void Wakes() {
  World w;
  w.binding.Reveal();
  assert(w.page.controller.loads == 0);
  w.page.discarded = true;
  w.binding.Reveal();
  assert(w.page.controller.loads == 1);
  w.page.discarded = false;
  w.page.controller.needs_reload = true;
  w.binding.Reveal();
  assert(w.page.controller.loads == 2);
}

int main(int argc, char** argv) {
  assert(argc == 2);
  std::string mode = argv[1];
  if (mode == "discards") Discards();
  else if (mode == "dropped") Dropped();
  else if (mode == "protected") Protected();
  else if (mode == "freezing") Freezing();
  else if (mode == "wakes") Wakes();
  else return 2;
}
'''


class TabGlueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-tab-glue-')
        directory = Path(cls.directory.name)
        for source in FILES + [p.with_suffix('.h') for p in FILES]:
            for include in re.findall(r'#include "([^"]+)"', source.read_text()):
                if include.startswith('ardia/'):
                    continue
                header = directory / include
                header.parent.mkdir(parents=True, exist_ok=True)
                header.write_text(f'#include "{FIXTURE}"\n')
        host = HOST.read_text()
        methods = [body(host, 'std::string DiscardedUrl(')]
        methods += [body(host, 'void TabBinding::' + name + '(') for name in ['WasDiscarded', 'DidStartNavigation', 'Reveal']]
        methods.append(body(host, 'std::string_view TabBinding::Discard('))
        methods.append(body(host, 'bool TabBinding::SetFrozen('))
        test = directory / 'glue.cc'
        test.write_text(PRELUDE + '\n'.join(methods) + TESTS)
        cls.binary = directory / 'glue'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-no-pie', '-I', str(directory), '-I', str(SOURCE), '-I', str(ROOT / 'tests'), *map(str, FILES), str(test), '-o', str(cls.binary)], check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        subprocess.run([str(self.binary), name], check=True, text=True, timeout=10,
                       env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_discard_reports_once_and_wakes_with_ready(self):
        self.run_case('discards')

    def test_a_dropped_discard_reports_nothing_for_a_live_tab(self):
        self.run_case('dropped')

    def test_protected_unknown_visible_and_unowned_tabs_are_refused(self):
        self.run_case('protected')

    def test_unfreezing_never_calls_set_page_frozen_on_a_visible_tab(self):
        self.run_case('freezing')

    def test_reveal_reloads_discarded_or_stale_tabs(self):
        self.run_case('wakes')


if __name__ == '__main__':
    unittest.main()
