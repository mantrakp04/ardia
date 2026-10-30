from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from test_renderer_contract import method


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / 'src/ardia/linux/ac_linux_host.cc'

STUBS = r'''
#include "ardia/linux/ac_linux_contract.h"
#include <cassert>
#include <deque>
#include <functional>
#include <map>
#include <string>
#include <string_view>
#include <tuple>
#include <vector>
#define FROM_HERE 0
struct GURL {
  std::string spec;
  bool is_empty() const { return spec.empty(); }
  bool IsAboutBlank() const { return spec == "about:blank"; }
};
namespace content {
struct WebContents {
  GURL url;
  GURL GetVisibleURL() const { return url; }
};
}
namespace base {
template <class T> struct WeakPtr {
  T* pointer = nullptr;
  T* get() const { return pointer; }
};
struct TimeDelta { int ms; };
inline TimeDelta Milliseconds(int ms) { return {ms}; }
inline std::deque<std::function<void()>>& Tasks() {
  static std::deque<std::function<void()>> tasks;
  return tasks;
}
struct TaskRunner {
  void PostDelayedTask(int, std::function<void()> task, TimeDelta delay) {
    assert(delay.ms == 25);
    Tasks().push_back(std::move(task));
  }
};
struct SingleThreadTaskRunner {
  static TaskRunner* GetCurrentDefault() { static TaskRunner runner; return &runner; }
};
template <class F, class O, class... A> std::function<void()> BindOnce(F fn, O* owner, A... args) {
  return [=] { (owner->*fn)(args...); };
}
}
struct TabStripModel {
  static constexpr int kNoTab = -1;
  std::vector<content::WebContents*> tabs;
  content::WebContents* active = nullptr;
  int GetIndexOfWebContents(content::WebContents* contents) const {
    for (size_t index = 0; index < tabs.size(); ++index) if (tabs[index] == contents) return static_cast<int>(index);
    return kNoTab;
  }
  content::WebContents* GetActiveWebContents() const { return active; }
};
struct Browser {
  TabStripModel model;
  TabStripModel* GetTabStripModel() { return &model; }
};
struct Shown { std::string module, event, url; bool active; };
struct ShellHostView {
  struct UnclaimedTab {
    base::WeakPtr<content::WebContents> contents;
    bool active = false;
  };
  std::map<int, UnclaimedTab> unclaimed_;
  Browser* browser_ = nullptr;
  bool listening = true;
  bool claimed = false;
  std::vector<content::WebContents*> offered;
  std::vector<Shown> shown;
  bool UnclaimedListening() const { return listening; }
  bool TabClaimed(content::WebContents*) const { return claimed; }
  ShellHostView* GetWeakPtr() { return this; }
  Browser* OwnerOf(content::WebContents* contents) const {
    return browser_ && contents && browser_->GetTabStripModel()->GetIndexOfWebContents(contents) >= 0 ? browser_ : nullptr;
  }
  struct Entry { std::string url; bool active; };
  Entry ClaimUnclaimedTab(content::WebContents* contents, bool active) {
    offered.push_back(contents);
    return {contents->GetVisibleURL().spec, active && browser_->GetTabStripModel()->GetActiveWebContents() == contents};
  }
  void Event(const char* module, const char* event, Entry entry) { shown.push_back({module, event, entry.url, entry.active}); }
  void AnnounceUnclaimedTab(int id, int tries);
};
namespace base { inline ShellHostView::Entry Value(ShellHostView::Entry entry) { return entry; } }
ARDIA_NATIVE
int Drain() {
  int ran = 0;
  while (!base::Tasks().empty()) {
    auto task = std::move(base::Tasks().front());
    base::Tasks().pop_front();
    task();
    ++ran;
  }
  return ran;
}
struct Window {
  Browser browser;
  content::WebContents tab{{"chrome-extension://fixture/opened.html#clicked"}};
  content::WebContents other{{"https://other.example/"}};
  ShellHostView host;
  Window(bool active = true) {
    browser.model.tabs = {&other, &tab};
    browser.model.active = &tab;
    host.browser_ = &browser;
    host.unclaimed_[7] = {{&tab}, active};
  }
};
int main() {
  using ardiacore::linux_contract::NextUnclaimedTabStep;
  using ardiacore::linux_contract::UnclaimedTabStep;
  assert(NextUnclaimedTabStep(false, false, true, false, 0) == UnclaimedTabStep::kDrop);
  assert(NextUnclaimedTabStep(true, true, true, false, 0) == UnclaimedTabStep::kDrop);
  assert(NextUnclaimedTabStep(true, false, false, false, 0) == UnclaimedTabStep::kPark);
  assert(NextUnclaimedTabStep(true, false, true, true, 19) == UnclaimedTabStep::kWait);
  assert(NextUnclaimedTabStep(true, false, false, true, 19) == UnclaimedTabStep::kWait);
  assert(NextUnclaimedTabStep(true, false, true, true, 20) == UnclaimedTabStep::kReport);
  assert(NextUnclaimedTabStep(true, false, false, true, 20) == UnclaimedTabStep::kPark);
  assert(NextUnclaimedTabStep(true, false, true, false, 0) == UnclaimedTabStep::kReport);

  {
    Window w;
    w.host.AnnounceUnclaimedTab(7, 0);
    assert(Drain() == 0);
    assert(w.host.shown.size() == 1);
    assert(w.host.shown[0].module == "ArdiaTabs" && w.host.shown[0].event == "unclaimed");
    assert(w.host.shown[0].url == "chrome-extension://fixture/opened.html#clicked" && w.host.shown[0].active);
    assert(w.host.offered.size() == 1 && w.host.offered[0] == &w.tab);
    assert(w.host.unclaimed_.empty());
    w.host.AnnounceUnclaimedTab(7, 0);
    assert(w.host.shown.size() == 1);
  }
  {
    Window w(false);
    w.host.AnnounceUnclaimedTab(7, 0);
    assert(w.host.shown.size() == 1 && !w.host.shown[0].active);
  }
  {
    Window w;
    w.browser.model.active = &w.other;
    w.host.AnnounceUnclaimedTab(7, 0);
    assert(w.host.shown.size() == 1 && !w.host.shown[0].active);
  }
  {
    Window w;
    w.host.listening = false;
    w.host.AnnounceUnclaimedTab(7, 0);
    assert(Drain() == 0 && w.host.shown.empty() && w.host.unclaimed_.size() == 1 && w.host.offered.empty());
  }
  {
    Window w;
    w.tab.url.spec = "about:blank";
    w.host.AnnounceUnclaimedTab(7, 0);
    assert(Drain() == 20);
    assert(w.host.shown.size() == 1 && w.host.shown[0].url == "about:blank");
  }
  {
    Window w;
    w.tab.url.spec = "";
    w.host.AnnounceUnclaimedTab(7, 0);
    base::Tasks().pop_front();
    w.tab.url.spec = "https://loaded.example/";
    w.host.AnnounceUnclaimedTab(7, 1);
    assert(Drain() == 0 && w.host.shown.at(0).url == "https://loaded.example/");
  }
  {
    Window w;
    w.host.listening = false;
    w.tab.url.spec = "about:blank";
    w.host.AnnounceUnclaimedTab(7, 0);
    assert(Drain() == 20 && w.host.shown.empty() && w.host.unclaimed_.size() == 1);
  }
  {
    Window w;
    w.host.claimed = true;
    w.host.AnnounceUnclaimedTab(7, 0);
    assert(Drain() == 0 && w.host.shown.empty() && w.host.unclaimed_.empty());
  }
  {
    Window w;
    w.browser.model.tabs = {&w.other};
    w.host.AnnounceUnclaimedTab(7, 0);
    assert(Drain() == 0 && w.host.shown.empty() && w.host.unclaimed_.empty());
  }
  {
    Window w;
    w.host.unclaimed_[7] = {{nullptr}, true};
    w.host.AnnounceUnclaimedTab(7, 0);
    assert(Drain() == 0 && w.host.shown.empty() && w.host.unclaimed_.empty());
  }
  {
    Window w;
    w.host.browser_ = nullptr;
    w.host.AnnounceUnclaimedTab(7, 0);
    assert(Drain() == 0 && w.host.shown.empty() && w.host.unclaimed_.empty());
  }
  {
    Window w;
    w.host.AnnounceUnclaimedTab(8, 0);
    assert(Drain() == 0 && w.host.shown.empty() && w.host.unclaimed_.size() == 1);
  }
}
'''


class ExtensionOpenedTabsTests(unittest.TestCase):
    def setUp(self):
        self.source = HOST.read_text()

    def test_announcer_reports_through_a_live_tab_honouring_active(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        native = method(self.source, 'void ShellHostView::AnnounceUnclaimedTab(')
        with tempfile.TemporaryDirectory(prefix='ardia-opened-tabs-') as scratch:
            cpp = Path(scratch) / 'opened.cc'
            binary = Path(scratch) / 'opened'
            cpp.write_text(STUBS.replace('ARDIA_NATIVE', native))
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(ROOT / 'src'), str(cpp), '-o', str(binary)],
                                   capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stderr)
            ran = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(ran.returncode, 0, ran.stderr)

    def test_chrome_inserted_tabs_are_noted_but_ardia_inserts_are_not(self):
        changed = method(self.source, 'void ShellHostView::OnTabStripModelChanged(')
        self.assertIn('change.type() == TabStripModelChange::kInserted && !app_operation_ && !is_utility()', changed)
        self.assertIn('NoteUnclaimedTab(inserted.contents, inserted.contents == selection.new_contents)', changed)
        self.assertLess(changed.index('NoteUnclaimedTab('), changed.index('ReattachViewports()'))
        noted = method(self.source, 'void ShellHostView::NoteUnclaimedTab(')
        self.assertIn('TabClaimed(contents)) return;', noted)
        self.assertIn('unclaimed_[id] = {contents->GetWeakPtr(), active};', noted)
        self.assertIn('AnnounceUnclaimedTab, GetWeakPtr(), id, 0', noted)
        claimed = method(self.source, 'bool ShellHostView::TabClaimed(')
        self.assertIn('host->BindsTab(contents)', claimed)
        self.assertIn('offer->second.get() == contents', claimed)

    def test_tabs_present_when_a_window_attaches_are_noted_unless_blank_or_restored(self):
        initialize = method(self.source, 'void ShellHostView::Initialize(')
        self.assertIn('if ((!BlankTabUrl(url) || (ChromeMade() && url.IsAboutBlank())) && !RestoredTab(contents)) {', initialize)
        self.assertIn('NoteUnclaimedTab(contents, contents == model->GetActiveWebContents());', initialize)
        self.assertLess(initialize.index('NoteUnclaimedTab('), initialize.index('shell_->LoadInitialURL('))
        restored = method(self.source, 'bool RestoredTab(')
        self.assertIn('if (controller.GetEntryCount() > 1) return true;', restored)
        self.assertIn('controller.GetEntryAtIndex(index)->IsRestored()', restored)
        create = method(self.source, 'void ShellHostView::CreateTabIn(')
        self.assertIn('const bool blank = BlankTabUrl(initial);', create)
        self.assertIn('source->unclaimed_.erase(id);', create)
        self.assertIn('source->announced_.erase(id);', create)

    def test_the_shell_pulls_parked_tabs_once_it_listens_and_later_ones_arrive_as_events(self):
        self.assertIn('if (method == "ArdiaTabs.unclaimedTabs") return ListenForUnclaimedTabs(std::move(done));', self.source)
        listen = method(self.source, 'void ShellHostView::ListenForUnclaimedTabs(')
        self.assertIn('if (!browser_ || is_utility())', listen)
        self.assertLess(listen.index('unclaimed_listener_ = renderer_generation_;'), listen.index('for (int index'))
        self.assertIn('unclaimed_.erase(found);', listen)
        self.assertIn('if (!TabClaimed(contents)) tabs.Append(ClaimUnclaimedTab(contents, active));', listen)
        listening = method(self.source, 'bool ShellHostView::UnclaimedListening(')
        self.assertIn('handler_ && unclaimed_listener_ == renderer_generation_', listening)
        self.assertLess(listen.index('for (auto it = announced_.begin()'), listen.index('for (int index'))
        self.assertIn('bound |= contents && host->BindsTab(contents);', listen)
        self.assertIn('it = announced_.erase(it);', listen)
        self.assertIn('tabs.Append(ClaimUnclaimedTab(contents, false));', listen)
        claim = method(self.source, 'base::DictValue ShellHostView::ClaimUnclaimedTab(')
        self.assertIn('announced_[TabId(contents)] = contents->GetWeakPtr();', claim)
        self.assertLess(claim.index('OfferTab(contents);'), claim.index('return'))
        self.assertIn('active && owner && owner->GetTabStripModel()->GetActiveWebContents() == contents', claim)
        self.assertIn('owner == ActiveMember()', claim)
        self.assertIn('.Set("profile", ardiacore::LinuxProfileName(ProfileOf(contents->GetBrowserContext())).value_or(std::string()))', claim)
        self.assertIn('Event("ArdiaTabs", "unclaimed", base::Value(ClaimUnclaimedTab(contents, active)));', method(self.source, 'void ShellHostView::AnnounceUnclaimedTab('))

    def test_a_chrome_made_window_hands_its_tabs_to_its_shell_only_from_its_bootstrap(self):
        bootstrap = method(self.source, 'base::DictValue ShellHostView::Bootstrap(')
        self.assertIn('if (ChromeMade()) bootstrap.Set("chromeMade", true);', bootstrap)
        self.assertIn('if (base::ListValue adopt = UnclaimedTabsForShell(); !adopt.empty()) bootstrap.Set("adoptTabs", std::move(adopt));', bootstrap)
        self.assertIn('bool ChromeMade() const { return !startup_ && !requested_ && !is_utility() && private_window_.empty(); }', self.source)
        self.assertIn('requested_ = true;', method(self.source, '  void ConfigureWindow(RequestedWindow request) {'))
        self.assertIn('return browser_ && ChromeMade() && bindings_.empty();', method(self.source, 'bool ShellHostView::HandsTabsToShell('))
        offered = method(self.source, 'void ShellHostView::HandUnclaimedTabsToShell(')
        self.assertIn('if (!HandsTabsToShell()) return;', offered)
        self.assertIn('unclaimed_.erase(pending);', offered)
        self.assertIn('if (!TabClaimed(contents) && contents->GetBrowserContext() == page_profile()) OfferTab(contents);', offered)
        listed = method(self.source, 'base::ListValue ShellHostView::UnclaimedTabsForShell(')
        self.assertIn('if (!HandsTabsToShell()) return tabs;', listed)
        self.assertIn('bound |= host->BindsTab(contents);', listed)
        self.assertNotIn('OfferTab', listed)
        self.assertIn('if (AssetPath(url) == "host-bootstrap.js") host->HandUnclaimedTabsToShell();', self.source)


if __name__ == '__main__':
    unittest.main()
