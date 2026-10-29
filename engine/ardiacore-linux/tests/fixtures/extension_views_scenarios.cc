#include "ardia/linux/ac_linux_extension_views.h"

#include <cassert>
#include <cstdio>
#include <string>
#include <vector>

using ardia::LinuxExtensionSurfaces;

namespace {

const std::string kId(32, 'a');
const std::string kOther(32, 'b');
const std::string kPopup = "chrome-extension://" + kId + "/popup.html";
const std::string kPanel = "chrome-extension://" + kId + "/panel.html";

struct Event {
  int id;
  std::string type;
  int width = 0;
};

struct Fixture {
  Profile profile;
  BrowserWindowInterface browser;
  views::View parent;
  std::vector<Event> events;
  std::unique_ptr<LinuxExtensionSurfaces> surfaces;

  Fixture() {
    parent.SetBoundsRect(gfx::Rect(0, 0, 1000, 800));
    extensions::ExtensionRegistry::Get(&profile)->Enable(kId);
    extensions::ExtensionRegistry::Get(&profile)->Enable(kOther);
    extensions::Factory() = {};
    extensions::Factory().context = &profile;
    surfaces = std::make_unique<LinuxExtensionSurfaces>(&browser, &parent, base::RepeatingCallback<void(int, base::DictValue)>(
        [this](int id, base::DictValue event) {
          Event seen{id, *event.FindString("type")};
          if (const base::DictValue* value = event.FindDict("value")) seen.width = *value->FindInt("width");
          events.push_back(seen);
        }));
  }

  struct Result {
    bool ok = false;
    base::Value value;
    std::string code() const { return value.is_dict() && value.GetDict().FindString("code") ? *value.GetDict().FindString("code") : ""; }
  };

  Result Invoke(const std::string& method, base::DictValue args, uint64_t generation = 1, double scale = 1) {
    Result result;
    bool replied = false;
    surfaces->Invoke(method, args, &profile, generation, scale,
                     base::OnceCallback<void(bool, base::Value)>([&](bool ok, base::Value value) {
                       replied = true;
                       result.ok = ok;
                       result.value = std::move(value);
                     }));
    assert(replied);
    return result;
  }

  int Create(const std::string& kind, const std::string& url, uint64_t generation = 1) {
    auto result = Invoke("extensionView.create", base::DictValue().Set("kind", kind).Set("url", url).Set("profile", ""), generation);
    assert(result.ok);
    return *result.value.GetDict().FindInt("id");
  }

  int Count(const std::string& type, int id) const {
    int count = 0;
    for (const auto& event : events) count += event.type == type && event.id == id;
    return count;
  }
};

std::optional<int> Find(const views::View& parent, content::WebContents* contents) {
  int index = 0;
  for (auto* child : parent.children()) {
    auto* web = dynamic_cast<views::WebView*>(child);
    if (web && web->web_contents() == contents) return index;
    ++index;
  }
  return std::nullopt;
}

void OpenPlaceRelease() {
  Fixture f;
  auto* tab = f.parent.AddChildView(std::make_unique<views::View>());
  const int id = f.Create("popup", kPopup);
  auto* host = extensions::Factory().host;
  assert(extensions::Factory().kind == "popup" && extensions::Factory().url == kPopup && extensions::Factory().browser == &f.browser);
  assert(host->renderers == 1 && f.Count("ready", id) == 1 && extensions::LiveHosts() == 1);
  auto index = Find(f.parent, host->host_contents());
  assert(index && *index == 1 && !f.parent.children()[1]->GetVisible());
  f.parent.ReorderChildView(tab, 2);
  auto viewport = base::DictValue().Set("id", id).Set("visible", true)
      .Set("rect", base::DictValue().Set("x", base::Value(100.0)).Set("y", base::Value(50.0)).Set("width", base::Value(300.0)).Set("height", base::Value(1000.0)));
  assert(f.Invoke("extensionView.viewport", viewport.Clone(), 1, 2).ok);
  index = Find(f.parent, host->host_contents());
  auto* view = f.parent.children()[*index];
  assert(*index == 1 && view->GetVisible() && view->bounds() == gfx::Rect(200, 100, 600, 700));
  auto offscreen = viewport.Clone();
  offscreen.Set("rect", base::DictValue().Set("x", base::Value(2000.0)).Set("y", base::Value(0.0)).Set("width", base::Value(10.0)).Set("height", base::Value(10.0)));
  assert(f.Invoke("extensionView.viewport", std::move(offscreen)).ok && !view->GetVisible());
  auto bad = viewport.Clone();
  bad.Set("rect", base::DictValue().Set("x", base::Value(NAN)).Set("y", base::Value(0.0)).Set("width", base::Value(1.0)).Set("height", base::Value(1.0)));
  assert(f.Invoke("extensionView.viewport", std::move(bad)).code() == "ERR_EXTENSION_VIEW_REQUEST");
  assert(f.Invoke("extensionView.viewport", viewport.Clone()).ok);
  assert(f.Invoke("extensionView.command", base::DictValue().Set("id", id).Set("command", "focus")).ok);
  assert(host->host_contents()->focuses == 1 && view->focus_requests == 1);
  assert(f.Invoke("extensionView.command", base::DictValue().Set("id", id).Set("command", "evaluate")).code() ==
         "ERR_PAGE_EVALUATION_REFUSED");
  assert(f.Invoke("extensionView.command", base::DictValue().Set("id", id).Set("command", "loadUrl")).code() == "ERR_UNKNOWN_COMMAND");
  assert(f.Invoke("extensionView.release", base::DictValue().Set("id", id)).ok);
  assert(extensions::LiveHosts() == 0 && f.parent.children().size() == 1 && f.Count("windowClose", id) == 0);
  assert(f.Invoke("extensionView.release", base::DictValue().Set("id", id)).ok);
  assert(f.Invoke("extensionView.command", base::DictValue().Set("id", id).Set("command", "focus")).code() == "ERR_EXTENSION_VIEW_STALE");
}

void Rejections() {
  Fixture f;
  assert(f.Invoke("extensionView.create", base::DictValue().Set("kind", "popup").Set("url", "https://example.com/").Set("profile", "")).code() == "ERR_EXTENSION_VIEW_REQUEST");
  assert(f.Invoke("extensionView.create", base::DictValue().Set("kind", "popup").Set("url", "chrome-extension://" + std::string(32, 'c') + "/p.html").Set("profile", "")).code() == "ERR_EXTENSION_UNAVAILABLE");
  assert(f.Invoke("extensionView.create", base::DictValue().Set("kind", "popup").Set("url", kPopup).Set("profile", "work")).code() == "ERR_PROFILE_WINDOW");
  f.profile.off_the_record = true;
  assert(f.Invoke("extensionView.create", base::DictValue().Set("kind", "popup").Set("url", kPopup).Set("profile", "work")).code() == "ERR_PROFILE_WINDOW");
  assert(f.Invoke("extensionView.create", base::DictValue().Set("kind", "popup").Set("url", kPopup).Set("profile", "incognito:w1@")).code() == "ERR_EXTENSION_PRIVATE");
  assert(extensions::LiveHosts() == 0);
  f.profile.shutdown_started = true;
  assert(f.Invoke("extensionView.create", base::DictValue().Set("kind", "popup").Set("url", kPopup).Set("profile", "incognito:w1@")).code() == "ERR_PROFILE_ENDING");
  f.profile.shutdown_started = false;
  f.profile.incognito_enabled.insert(std::string(32, 'a'));
  auto private_popup = f.Invoke("extensionView.create", base::DictValue().Set("kind", "popup").Set("url", kPopup).Set("profile", "incognito:w1@"));
  assert(private_popup.ok && extensions::LiveHosts() == 1);
  assert(f.Invoke("extensionView.release", base::DictValue().Set("id", *private_popup.value.GetDict().FindInt("id"))).ok);
  assert(extensions::LiveHosts() == 0);
  f.profile.incognito_enabled.clear();
  f.profile.off_the_record = false;
  extensions::Factory().fail = true;
  assert(f.Invoke("extensionView.create", base::DictValue().Set("kind", "sidePanel").Set("url", kPanel).Set("profile", "")).code() == "ERR_EXTENSION_UNAVAILABLE");
  extensions::Factory().fail = false;
  for (int i = 0; i < 4; ++i) f.Create("sidePanel", kPanel);
  assert(f.Invoke("extensionView.create", base::DictValue().Set("kind", "popup").Set("url", kPopup).Set("profile", "")).code() == "ERR_EXTENSION_VIEW_LIMIT");
  assert(f.Invoke("extensionView.unknown", base::DictValue()).code() == "ERR_UNKNOWN_CALL");
  f.surfaces.reset();
  assert(extensions::LiveHosts() == 0 && f.parent.children().empty());
}

void ClosedByPageOrChrome() {
  Fixture f;
  const int closing = f.Create("popup", kPopup);
  extensions::Factory().host->Close();
  extensions::Factory().host->Close();
  assert(f.surfaces->size() == 1);
  base::RunPostedTasks();
  assert(f.surfaces->size() == 0 && f.Count("windowClose", closing) == 1 && extensions::LiveHosts() == 0);

  const int crashed = f.Create("sidePanel", kPanel);
  extensions::ExtensionHostRegistry::Get(&f.profile)->Gone(&f.profile, extensions::Factory().host);
  base::RunPostedTasks();
  assert(f.Count("windowClose", crashed) == 1 && f.surfaces->size() == 0);

  const int unloaded = f.Create("sidePanel", kPanel);
  const int other = f.Create("popup", "chrome-extension://" + kOther + "/p.html");
  extensions::ExtensionRegistry::Get(&f.profile)->Unload(&f.profile, kId);
  base::RunPostedTasks();
  assert(f.Count("windowClose", unloaded) == 1 && f.Count("windowClose", other) == 0 && f.surfaces->size() == 1);
  extensions::ExtensionRegistry::Get(&f.profile)->Enable(kId);

  const int released = f.Create("popup", kPopup);
  extensions::Factory().host->Close();
  assert(f.Invoke("extensionView.release", base::DictValue().Set("id", released)).ok);
  base::RunPostedTasks();
  assert(f.Count("windowClose", released) == 0);
}

void AutoResize() {
  Fixture f;
  const int popup = f.Create("popup", kPopup);
  auto* host = extensions::Factory().host;
  auto* contents = host->host_contents();
  auto* view = static_cast<extensions::ExtensionViewHost*>(host)->view();
  view->RenderFrameCreated(contents->GetPrimaryMainFrame());
  auto& rwhv = contents->GetPrimaryMainFrame()->view;
  assert(rwhv.auto_resizes == 1 && rwhv.auto_min == gfx::Size(25, 25) && rwhv.auto_max == gfx::Size(800, 600));
  view->ResizeDueToAutoResize(contents, gfx::Size(320, 240));
  view->ResizeDueToAutoResize(contents, gfx::Size(320, 240));
  view->ResizeDueToAutoResize(contents, gfx::Size(330, 240));
  assert(f.Count("preferredSize", popup) == 2 && f.events.back().width == 330);
  const int navigations = f.Count("navigation", popup);
  host->FinishLoad(true);
  assert(f.Count("navigation", popup) == navigations + 1);

  const int panel = f.Create("sidePanel", kPanel);
  auto* panel_host = extensions::Factory().host;
  auto* panel_view = static_cast<extensions::ExtensionViewHost*>(panel_host)->view();
  panel_view->RenderFrameCreated(panel_host->host_contents()->GetPrimaryMainFrame());
  panel_view->ResizeDueToAutoResize(panel_host->host_contents(), gfx::Size(10, 10));
  assert(panel_host->host_contents()->GetPrimaryMainFrame()->view.auto_resizes == 0 && f.Count("preferredSize", panel) == 0);
  for (auto* observer : std::vector<content::WebContentsObserver*>(panel_host->host_contents()->observers)) observer->DidStopLoading();
  assert(f.Count("navigation", panel) == 1);
}

void RendererAndWindowRetirement() {
  Fixture f;
  const int old_popup = f.Create("popup", kPopup, 1);
  const int fresh = f.Create("sidePanel", kPanel, 2);
  assert(f.Invoke("extensionView.command", base::DictValue().Set("id", old_popup).Set("command", "focus"), 2).code() == "ERR_EXTENSION_VIEW_STALE");
  assert(f.Invoke("extensionView.release", base::DictValue().Set("id", old_popup), 2).ok && f.surfaces->size() == 2);
  f.surfaces->RetireOlderThan(2);
  assert(f.surfaces->size() == 1 && f.Count("windowClose", old_popup) == 0 && extensions::LiveHosts() == 1);
  extensions::Factory().host->Close();
  f.surfaces.reset();
  base::RunPostedTasks();
  assert(f.Count("windowClose", fresh) == 0 && extensions::LiveHosts() == 0 && f.parent.children().empty());
}

void ApiPopups() {
  Fixture f;
  std::vector<extensions::ExtensionHost*> shown;
  auto expect = [&](const std::string& id) {
    f.surfaces->ExpectPopup(id, ShowPopupCallback([&](extensions::ExtensionHost* host) { shown.push_back(host); }));
  };
  expect(kId);
  const int popup = f.Create("popup", kPopup);
  assert(shown.empty());
  extensions::Factory().host->FinishLoad(true);
  assert(shown.size() == 1 && shown[0] == extensions::Factory().host);
  assert(f.Invoke("extensionView.release", base::DictValue().Set("id", popup)).ok);

  expect(kId);
  f.Create("popup", kPopup);
  extensions::Factory().host->FinishLoad(false);
  assert(shown.size() == 2 && shown[1] == nullptr);

  expect(kId);
  const int closed = f.Create("popup", kPopup);
  assert(f.Invoke("extensionView.release", base::DictValue().Set("id", closed)).ok);
  assert(shown.size() == 3 && shown[2] == nullptr);

  expect(kId);
  expect(kOther);
  base::RunPostedTasks();
  assert(shown.size() == 4 && shown[3] == nullptr);
  f.Create("popup", kPopup);
  assert(shown.size() == 4);
  base::FakeNow() += 11;
  f.Create("popup", "chrome-extension://" + kOther + "/p.html");
  extensions::Factory().host->FinishLoad(true);
  assert(shown.size() == 4);
  auto expired = f.surfaces->TakePendingPopup();
  assert(expired);
  std::move(*expired).Run(nullptr);
  assert(shown.size() == 5);

  expect(kOther);
  f.surfaces.reset();
  base::RunPostedTasks();
  assert(shown.size() == 6 && shown[5] == nullptr);
}

void NullApiPopupCallbacks() {
  Fixture f;
  f.surfaces->ExpectPopup(kId, ShowPopupCallback());
  f.surfaces->ExpectPopup(kOther, ShowPopupCallback());
  base::RunPostedTasks();
  base::FakeNow() += 11;
  for (auto* timer : std::vector<base::OneShotTimer*>(base::LiveTimers())) timer->Fire();
  base::RunPostedTasks();
  f.surfaces->ExpectPopup(kId, ShowPopupCallback());
  const int popup = f.Create("popup", kPopup);
  extensions::Factory().host->FinishLoad(true);
  assert(f.Invoke("extensionView.release", base::DictValue().Set("id", popup)).ok);
  f.surfaces->ExpectPopup(kOther, ShowPopupCallback());
  f.surfaces.reset();
  base::RunPostedTasks();
}

}

int main() {
  OpenPlaceRelease();
  Rejections();
  ClosedByPageOrChrome();
  AutoResize();
  RendererAndWindowRetirement();
  ApiPopups();
  NullApiPopupCallbacks();
  std::printf("extension views scenarios passed\n");
}
