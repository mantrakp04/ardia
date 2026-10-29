import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
HOST = SOURCE / 'ardia/linux/ac_linux_host.cc'
FILES = [SOURCE / 'ardia/linux' / f'ac_linux_{name}.cc' for name in ['page_lease', 'security', 'history_zoom', 'theme', 'page_status', 'page_state']]
FIXTURE = ROOT / 'tests/fixtures/page_state.h'


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
#include "fixtures/page_state.h"
#include "ardia/linux/ac_linux_page_state.h"
#include <set>
#include <functional>
#include <string_view>

template<class T> struct raw_ptr {
  T* pointer = nullptr;
  raw_ptr(T* value = nullptr) : pointer(value) {}
  raw_ptr& operator=(T* value) { pointer = value; return *this; }
  operator T*() const { return pointer; }
  T* operator->() const { return pointer; }
  T* get() const { return pointer; }
};
namespace views { struct WebView { bool visible = true; content::WebContents* contents = nullptr; bool GetVisible() { return visible; } void SetVisible(bool value) { visible = value; } void SetWebContents(content::WebContents* value) { contents = value; } }; }
namespace base { template<class C, class V> bool Contains(const C& container, const V& value) { return std::find(container.begin(), container.end(), value) != container.end(); } }
std::map<const content::WebContents*, int>& Ids() { static std::map<const content::WebContents*, int> ids; return ids; }
int TabId(content::WebContents* contents) { auto found = Ids().find(contents); return found == Ids().end() ? 0 : found->second; }
uint64_t NextPageBindingGeneration() { static uint64_t generation = 0; return ++generation; }
std::string String(const base::DictValue& value, std::string_view key) { auto* text = value.FindString(key); return text ? *text : std::string(); }
namespace ardiacore::linux_contract { inline bool OwnsClaim(const std::string& owner, const std::string& claim) { return !owner.empty() && owner == claim; } }
class ShellHostView;
struct HostMessageHandler {};
namespace ardiacore { struct LinuxPageChannel { int detached = 0; static std::map<const content::WebContents*, LinuxPageChannel>& All() { static std::map<const content::WebContents*, LinuxPageChannel> all; return all; } static LinuxPageChannel* FromWebContents(content::WebContents* contents) { return &All()[contents]; } void Detach() { ++detached; } }; }
struct AutoPictureInPictureTabHelper {
  static AutoPictureInPictureTabHelper* FromWebContents(content::WebContents*) { return nullptr; }
  void OnTabActivatedChanged(bool) {}
};
class TabBinding : public content::WebContentsObserver {
 public:
  TabBinding(ShellHostView* owner, content::WebContents* contents, std::string key)
      : content::WebContentsObserver(contents), owner_(owner), contents_(contents), key_(std::move(key)) { StartMedia(); }
  ~TabBinding() override { RetirePage(); }
  const std::string& key() const { return key_; }
  std::string claim;
  uint64_t renderer_generation = 0;
  std::vector<int> replaced_ids;
  int cancelled_auto_pip_until = 0;
  int requested_auto_pip_until = 0;
  bool presented = false;
  bool presentation_applied = false;
  bool presentation_attached = false;
  bool presentation_departed = false;
  int remembered = 0;
  void RememberPendingAutoPictureInPicture() { ++remembered; }
  int command_resets = 0;
  void ResetPageCommands() { ++command_resets; }
  int media_starts = 0;
  void StartMedia() { media = contents_ ? std::make_unique<int>(++media_starts) : nullptr; }
  std::unique_ptr<int> media;
  bool frozen = false;
  bool discard_reported = false;
  int reveals = 0;
  void Reveal() { ++reveals; }
  std::vector<std::pair<std::string, base::Value>> SnapshotExtras() {
    std::vector<std::pair<std::string, base::Value>> events;
    if (media) events.emplace_back("media", base::Value(base::DictValue().Set("playing", false).Set("muted", false)));
    if (contents_ && contents_->discarded) {
      discard_reported = true;
      events.emplace_back("discarded", base::Value(base::DictValue().Set("url", contents_->entry.url.spec())));
    }
    return events;
  }
  std::unique_ptr<int> devtools_watch;
  bool devtools_had_focus = false;
  raw_ptr<views::WebView> devtools_viewport_ = nullptr;
  content::WebContents* contents() const { return contents_; }
  base::DictValue Navigation() const { return contents_ ? base::DictValue().Set("url", contents_->entry.url.spec()) : base::DictValue(); }
  ardiacore::LinuxPageState* page() const { return page_.get(); }
  uint64_t contents_generation() const { return contents_generation_; }
  void AttachPage(std::unique_ptr<ardiacore::LinuxPageState> page);
  void AttachPageChannel() {}
  void RetirePage();
  std::unique_ptr<ardiacore::LinuxPageState> TakePage();
  void ReportPresentation(std::string name, base::DictValue data);
  void ReportNavigation();
  void Rebind(content::WebContents* contents);
  void WebContentsDestroyed() override;
  base::WeakPtr<TabBinding> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }
  raw_ptr<ShellHostView> owner_;
  raw_ptr<content::WebContents> contents_;
  raw_ptr<views::WebView> viewport_ = nullptr;
  std::string key_;
  uint64_t contents_generation_ = 1;
  std::unique_ptr<ardiacore::LinuxPageState> page_;
  base::WeakPtrFactory<TabBinding> weak_factory_{this};
};
struct Sent { std::string module, id; base::DictValue payload; };
class ShellHostView {
 public:
  BrowserWindowInterface* browser_ = nullptr;
  content::WebContents* shell_contents = nullptr;
  views::Widget* widget = nullptr;
  HostMessageHandler handler;
  raw_ptr<HostMessageHandler> handler_ = &handler;
  uint64_t renderer_generation_ = 2;
  int id_ = 41;
  std::map<int, std::unique_ptr<TabBinding>> bindings_;
  std::map<int, bool> devtools_had_focus_;
  std::vector<Sent> sent;
  content::WebContents* shell() const { return shell_contents; }
  views::Widget* GetWidget() const { return widget; }
  bool OwnsHandler(HostMessageHandler* owner, uint64_t generation) const { return owner && owner == handler_.get() && generation == renderer_generation_; }
  void Event(std::string_view module, std::string_view id, base::Value payload) { sent.push_back({std::string(module), std::string(id), payload.GetDict().Clone()}); }
  TabBinding* Binding(int id) { auto found = bindings_.find(id); return found == bindings_.end() ? nullptr : found->second.get(); }
  base::WeakPtr<ShellHostView> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }
  std::unique_ptr<ardiacore::LinuxPageState> MountPage(TabBinding* binding);
  void ReplaceTabContents(content::WebContents* old_contents, content::WebContents* contents);
  TabBinding* ClaimedBinding(const base::DictValue& args);
  void SetPresentations(const base::DictValue& args, std::function<void(bool, base::Value)> done);
  int layouts = 0;
  void LayoutPane(TabBinding*) { ++layouts; }
  base::WeakPtrFactory<ShellHostView> weak_factory_{this};
};
'''

TESTS = r'''
std::string Text(const base::DictValue& value, const char* key) { auto* text = value.FindString(key); assert(text); return *text; }
double Number(const base::DictValue& value, const char* key) { auto number = value.FindDouble(key); assert(number); return *number; }
const base::DictValue& Event(const Sent& sent) { return *sent.payload.FindDict("event"); }

struct World {
  Profile profile;
  views::Widget widget;
  BrowserWindowInterface browser{&profile};
  content::WebContents shell{&profile};
  std::unique_ptr<content::WebContents> first = std::make_unique<content::WebContents>(&profile);
  std::unique_ptr<content::WebContents> second = std::make_unique<content::WebContents>(&profile);
  zoom::ZoomController controller;
  ShellHostView host;
  TabBinding* binding = nullptr;
  World() {
    Ids()[first.get()] = 7;
    Ids()[second.get()] = 9;
    first->zoom = &controller;
    second->zoom = &controller;
    second->entry.url = GURL("https://discarded.test/");
    browser.strip.tabs.push_back(first.get());
    host.browser_ = &browser;
    host.shell_contents = &shell;
    host.widget = &widget;
    host.bindings_[7] = std::make_unique<TabBinding>(&host, first.get(), "key");
    binding = host.bindings_[7].get();
  }
  void Claim(const char* claim = "claim") {
    binding->claim = claim;
    binding->renderer_generation = host.renderer_generation_;
    binding->AttachPage(host.MountPage(binding));
    assert(binding->page() && binding->page()->CreationState());
  }
  void Swap() {
    browser.strip.tabs[0] = second.get();
    host.ReplaceTabContents(first.get(), second.get());
  }
  void Notify(content::WebContents& contents, std::function<void(content::WebContentsObserver*)> call) { contents.Notify(call); }
};

void Order() {
  World w;
  w.Claim();
  assert(w.first->observers.front() == w.binding);
  w.browser.strip.tabs.clear();
  w.first.reset();
  assert(w.host.sent.size() == 1);
  assert(Text(w.host.sent[0].payload, "type") == "pageEvent" && Text(Event(w.host.sent[0]), "name") == "windowClose");
  assert(w.host.sent[0].id == "7" && Text(w.host.sent[0].payload, "claim") == "claim");
  assert(!w.binding->contents() && !w.binding->page());
  World unclaimed;
  unclaimed.browser.strip.tabs.clear();
  unclaimed.first.reset();
  assert(unclaimed.host.sent.empty());
}

void Reclaim() {
  World w;
  w.Claim();
  const auto old_generation = Text(*w.binding->page()->CreationState()->FindDict("lease"), "bindingGeneration");
  auto stale = w.binding->page()->Capture();
  w.host.sent.clear();
  const int detached = ardiacore::LinuxPageChannel::All()[w.first.get()].detached;
  w.Swap();
  assert(ardiacore::LinuxPageChannel::All()[w.first.get()].detached > detached);
  assert(w.host.Binding(9) == w.binding && !w.host.Binding(7) && w.binding->contents() == w.second.get());
  assert(w.second->observers.front() == w.binding);
  assert(w.host.sent.size() == 1);
  const auto& notice = w.host.sent[0];
  assert(notice.module == "ArdiaWebView" && notice.id == "7");
  assert(Text(notice.payload, "type") == "pageLifecycle" && Text(notice.payload, "action") == "rebind");
  assert(Text(notice.payload, "bindingGeneration") == old_generation && Text(notice.payload, "claim") == "claim");
  const auto creation = notice.payload.FindDict("creation")->Clone();
  assert(Number(creation, "browserId") == 9 && Number(creation, "chromeTabId") == 9);
  assert(Text(*creation.FindDict("state"), "url") == "https://discarded.test/");
  const auto lease = creation.FindDict("lease")->Clone();
  assert(Text(lease, "claim") == "claim" && Text(lease, "bindingGeneration") != old_generation && Text(lease, "rendererGeneration") == "2");
  const auto& snapshot = *creation.FindDict("snapshot");
  assert(Number(snapshot, "watermark") == Number(lease, "sequence"));
  assert(Text(snapshot.Find("events")->GetList()[0].GetDict(), "name") == "navigation");
  assert(!stale->Valid() && !ardiacore::EmitLinuxPageEvent(*stale, "find", base::Value()));
  w.host.sent.clear();
  w.first.reset();
  assert(w.host.sent.empty());
  assert(w.binding->page()->EmitNavigation() && w.host.sent.back().id == "9" && Text(w.host.sent.back().payload, "bindingGeneration") == Text(lease, "bindingGeneration"));
  auto old_command = base::DictValue().Set("id", 7).Set("claim", "claim");
  auto new_command = base::DictValue().Set("id", 9).Set("claim", "claim");
  auto foreign = base::DictValue().Set("id", 7).Set("claim", "other");
  assert(w.host.ClaimedBinding(old_command) == w.binding && w.host.ClaimedBinding(new_command) == w.binding && !w.host.ClaimedBinding(foreign));
  assert(w.binding->page()->ZoomStep(base::ListValue().Append(1)) && w.controller.level == 1);
  assert(w.binding->command_resets == 1);
  w.browser.strip.tabs.clear();
  w.second.reset();
  assert(Text(Event(w.host.sent.back()), "name") == "windowClose" && w.host.sent.back().id == "9");
}

void PendingSwap() {
  World w;
  w.Claim();
  content::NavigationHandle pending;
  w.Notify(*w.first, [&](auto* o) { o->DidStartNavigation(&pending); });
  assert(Text(w.host.sent.back().payload, "reason") == "provisional");
  w.second->controller.pending = &w.second->entry;
  w.host.sent.clear();
  w.Swap();
  assert(w.host.sent.size() == 1 && Text(w.host.sent[0].payload, "action") == "rebind");
  const auto& events = w.host.sent[0].payload.FindDict("creation")->FindDict("snapshot")->Find("events")->GetList();
  assert(events[0].GetDict().FindDict("data")->Find("themeColor")->is_none());
  assert(Text(*events[1].GetDict().FindDict("data"), "level") == "none");
  assert(!w.binding->page()->Capture() && w.binding->page()->EmitNavigation());
  w.Notify(*w.second, [&](auto* o) { o->DidFinishNavigation(&pending); });
  assert(w.binding->page()->Capture());
}

void UnclaimedSwap() {
  World w;
  w.Swap();
  assert(w.host.sent.empty() && w.host.Binding(9) == w.binding && !w.binding->page());
  w.Claim("later");
  assert(w.binding->page()->EmitNavigation() && w.host.sent.back().id == "9");
  World retired;
  retired.Claim();
  retired.host.renderer_generation_ = 3;
  retired.host.sent.clear();
  retired.Swap();
  assert(retired.host.sent.empty() && !retired.binding->page() && retired.host.Binding(9) == retired.binding);
  World collision;
  collision.Claim();
  collision.host.bindings_[9] = std::make_unique<TabBinding>(&collision.host, nullptr, "other");
  collision.host.sent.clear();
  collision.Swap();
  assert(collision.binding->contents() == collision.first.get() && collision.binding->page() && collision.host.Binding(7) == collision.binding);
}

bool Present(World& w, int id, const char* claim, bool visible) {
  bool ok = false;
  auto args = base::DictValue().Set("tabs", base::ListValue().Append(base::DictValue().Set("id", id).Set("claim", claim).Set("visible", visible)));
  w.host.SetPresentations(args, [&](bool success, base::Value) { ok = success; });
  return ok;
}

void Presentations() {
  World w;
  w.Claim();
  w.Swap();
  assert(Present(w, 7, "claim", true) && w.binding->presented && w.binding->presentation_attached && w.binding->remembered == 1);
  assert(Present(w, 9, "claim", false) && !w.binding->presented);
  assert(!Present(w, 7, "other", true) && !w.binding->presented);
  assert(!Present(w, 8, "claim", true));
}

void TwoDiscards() {
  World w;
  w.Claim();
  w.Swap();
  auto third = std::make_unique<content::WebContents>(&w.profile);
  Ids()[third.get()] = 11;
  third->zoom = &w.controller;
  w.browser.strip.tabs[0] = third.get();
  w.host.sent.clear();
  w.host.ReplaceTabContents(w.second.get(), third.get());
  assert(w.host.Binding(11) == w.binding && w.host.sent.size() == 1 && w.host.sent[0].id == "9");
  for (int id : {7, 9, 11}) assert(w.host.ClaimedBinding(base::DictValue().Set("id", id).Set("claim", "claim")) == w.binding);
  assert(Present(w, 7, "claim", true) && w.binding->presented);
  w.browser.strip.tabs.clear();
  third.reset();
}

void FailedRemount() {
  World w;
  w.Claim();
  w.shell.frame.live = false;
  w.host.sent.clear();
  w.Swap();
  assert(w.host.sent.size() == 1 && w.host.sent[0].id == "7");
  assert(Text(w.host.sent[0].payload, "type") == "pageEvent" && Text(Event(w.host.sent[0]), "name") == "windowClose");
  assert(w.binding->claim.empty() && !w.binding->page() && w.host.Binding(9) == w.binding);
  assert(!w.host.ClaimedBinding(base::DictValue().Set("id", 9).Set("claim", "claim")));
}

void StatusMigration() {
  World w;
  blocked_content::PopupBlockerTabHelper first_popups, second_popups;
  w.first->popups = &first_popups;
  w.second->popups = &second_popups;
  w.Claim();
  auto* old_status = w.binding->page()->status();
  assert(old_status && old_status->TargetURL(GURL("https://example.test/hover")));
  assert(Text(Event(w.host.sent.back()), "name") == "status");
  first_popups.Block(3, GURL("https://pop.test/3"));
  assert(Text(Event(w.host.sent.back()), "name") == "popupBlocked" && first_popups.manager()->observers.size() == 1);
  w.host.sent.clear();
  w.Swap();
  assert(w.host.sent.size() == 1 && Text(w.host.sent[0].payload, "action") == "rebind");
  assert(first_popups.manager()->observers.empty() && second_popups.manager()->observers.size() == 1);
  const auto& snapshot = *w.host.sent[0].payload.FindDict("creation")->FindDict("snapshot");
  size_t popups = 0;
  for (const auto& item : snapshot.Find("events")->GetList()) {
    const auto& event = item.GetDict();
    if (Text(event, "name") == "popupBlocked") ++popups;
    if (Text(event, "name") == "status") assert(Text(event.Find("data")->GetDict(), "text").empty());
  }
  assert(popups == 0);
  w.host.sent.clear();
  w.first->Notify([](auto* o) { o->DidToggleFullscreenModeForTab(true, true); });
  first_popups.Block(4, GURL("https://pop.test/4"));
  assert(w.host.sent.empty());
  auto* status = w.binding->page()->status();
  assert(status && status->TargetURL(GURL("https://discarded.test/link")));
  assert(w.host.sent.size() == 1 && w.host.sent[0].id == "9" && Text(Event(w.host.sent[0]), "name") == "status");
  w.binding->RetirePage();
  assert(!w.binding->page() && second_popups.manager()->observers.empty());
  w.host.sent.clear();
  w.second->Notify([](auto* o) { o->DidToggleFullscreenModeForTab(false, true); });
  second_popups.Block(5, GURL("https://pop.test/5"));
  assert(w.host.sent.empty());
  w.browser.strip.tabs.clear();
}

const base::DictValue* Named(const base::ListValue& events, const char* name) {
  for (const auto& event : events) if (Text(event.GetDict(), "name") == name) return event.GetDict().FindDict("data");
  return nullptr;
}

void MediaProducer() {
  World w;
  assert(w.binding->media && *w.binding->media == 1);
  w.Claim();
  const auto creation = *w.binding->page()->CreationState();
  const auto& events = creation.FindDict("snapshot")->Find("events")->GetList();
  assert(Text(events[0].GetDict(), "name") == "navigation" && Named(events, "media") && !Named(events, "discarded"));
  w.browser.strip.tabs.clear();
  w.first.reset();
  assert(!w.binding->media && !w.binding->contents());
}

void DiscardedRebind() {
  World w;
  w.Claim();
  w.second->discarded = true;
  w.binding->frozen = true;
  w.host.sent.clear();
  w.Swap();
  assert(w.host.sent.size() == 1 && Text(w.host.sent[0].payload, "action") == "rebind");
  const auto& events = w.host.sent[0].payload.FindDict("creation")->FindDict("snapshot")->Find("events")->GetList();
  const auto* discarded = Named(events, "discarded");
  assert(discarded && Text(*discarded, "url") == "https://discarded.test/" && Named(events, "media"));
  assert(w.binding->discard_reported && !w.binding->frozen && w.binding->media && *w.binding->media == 2);
  w.second->discarded = false;
  const auto again = *w.binding->page()->CreationState();
  assert(!Named(again.FindDict("snapshot")->Find("events")->GetList(), "discarded"));
}

void Reveals() {
  World w;
  w.Claim();
  assert(Present(w, 7, "claim", true) && w.binding->reveals == 1);
  assert(Present(w, 7, "claim", true) && w.binding->reveals == 1);
  assert(Present(w, 7, "claim", false) && w.binding->reveals == 1);
  assert(Present(w, 7, "claim", true) && w.binding->reveals == 2);
}

int main(int argc, char** argv) {
  assert(argc == 2);
  std::string mode = argv[1];
  if (mode == "order") Order();
  else if (mode == "reclaim") Reclaim();
  else if (mode == "pending") PendingSwap();
  else if (mode == "unclaimed") UnclaimedSwap();
  else if (mode == "presentations") Presentations();
  else if (mode == "two-discards") TwoDiscards();
  else if (mode == "failed-remount") FailedRemount();
  else if (mode == "status-migration") StatusMigration();
  else if (mode == "media-producer") MediaProducer();
  else if (mode == "discarded-rebind") DiscardedRebind();
  else if (mode == "reveals") Reveals();
  else return 2;
}
'''


class PageHostJoinTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-page-host-join-')
        directory = Path(cls.directory.name)
        for source in FILES + [p.with_suffix('.h') for p in FILES]:
            for include in re.findall(r'#include "([^"]+)"', source.read_text()):
                if include.startswith('ardia/'):
                    continue
                header = directory / include
                header.parent.mkdir(parents=True, exist_ok=True)
                header.write_text(f'#include "{FIXTURE}"\n')
        host = HOST.read_text()
        methods = [body(host, 'void TabBinding::' + name + '(') for name in ['AttachPage', 'RetirePage', 'ReportPresentation', 'ReportNavigation', 'Rebind', 'WebContentsDestroyed']]
        methods.append(body(host, 'std::unique_ptr<ardiacore::LinuxPageState> TabBinding::TakePage('))
        methods.append(body(host, 'std::unique_ptr<ardiacore::LinuxPageState> ShellHostView::MountPage('))
        methods.append(body(host, 'void ShellHostView::ReplaceTabContents('))
        methods.append(body(host, 'TabBinding* ShellHostView::ClaimedBinding('))
        methods.append(body(host, 'void ShellHostView::SetPresentations(').replace(
            'base::OnceCallback<void(bool, base::Value)> done', 'std::function<void(bool, base::Value)> done').replace('std::move(done).Run(', 'done('))
        test = directory / 'join.cc'
        test.write_text(PRELUDE + '\n'.join(methods) + TESTS)
        cls.binary = directory / 'join'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-no-pie', '-I', str(directory), '-I', str(SOURCE), '-I', str(ROOT / 'tests'), *map(str, FILES), str(test), '-o', str(cls.binary)], check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        subprocess.run([str(self.binary), name], check=True, text=True, timeout=10,
                       env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_binding_observes_before_lease_so_window_close_uses_the_live_lease(self):
        self.run_case('order')

    def test_discard_swap_rekeys_remounts_and_sends_rebind_notice(self):
        self.run_case('reclaim')

    def test_swap_during_pending_navigation_sends_cleared_snapshot(self):
        self.run_case('pending')

    def test_unclaimed_retired_and_colliding_swaps(self):
        self.run_case('unclaimed')

    def test_presentations_with_the_pre_discard_id_reuse_the_validated_binding(self):
        self.run_case('presentations')

    def test_successive_discards_keep_earlier_ids_resolving(self):
        self.run_case('two-discards')

    def test_failed_remount_releases_the_claim_and_closes_through_the_old_lease(self):
        self.run_case('failed-remount')

    def test_page_status_producers_stop_at_discard_migration_and_transfer(self):
        self.run_case('status-migration')

    def test_mounted_pages_snapshot_media_state_and_destruction_drops_it(self):
        self.run_case('media-producer')

    def test_discard_swap_sends_discarded_in_the_rebind_snapshot(self):
        self.run_case('discarded-rebind')

    def test_presenting_a_tab_reveals_it_once_per_transition(self):
        self.run_case('reveals')


if __name__ == '__main__':
    unittest.main()
