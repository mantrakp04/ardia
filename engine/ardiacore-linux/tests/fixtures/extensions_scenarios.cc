#include "ardia/linux/ac_linux_extensions.h"

#include <cassert>
#include <cstdio>
#include <initializer_list>
#include <string>

using namespace ardia::linux_extensions;

namespace {

const std::string kId(32, 'a');
const std::string kOther(32, 'b');

base::Value Strings(std::initializer_list<const char*> values) {
  base::ListValue list;
  for (const char* value : values) list.Append(base::Value(value));
  return base::Value(std::move(list));
}

base::DictValue Dict() { return base::DictValue(); }

void Requests() {
  assert(ValidExtensionId(kId) && !ValidExtensionId("abc") && !ValidExtensionId(std::string(32, 'q')));
  assert(ValidFolderPath("/home/me/ext") && ValidFolderPath("/"));
  assert(!ValidFolderPath("relative") && !ValidFolderPath("/a/../b") && !ValidFolderPath("/a/./b") &&
         !ValidFolderPath("/a//b") && !ValidFolderPath("/a/") && !ValidFolderPath(std::string("/a\0b", 4)) &&
         !ValidFolderPath("/" + std::string(kMaxPathBytes, 'x')));
  assert(LinuxHandles("extensions.list") && LinuxHandles("search.engines") && !LinuxHandles("downloads.list"));
  assert(UsesWindowProfile("extensions.actionStates") && UsesWindowProfile("extensions.sidePanelUrl") &&
         UsesWindowProfile("extensions.resolveInstallPrompt") && !UsesWindowProfile("extensions.list") &&
         !UsesWindowProfile("extensions.uninstall"));
  assert(PrivateWindowRoute("extensions.actionStates", false) == PrivateRoute::kWindow);
  assert(PrivateWindowRoute("extensions.sidePanelUrl", false) == PrivateRoute::kWindow);
  assert(PrivateWindowRoute("extensions.watchActions", false) == PrivateRoute::kOriginal);
  assert(PrivateWindowRoute("extensions.list", false) == PrivateRoute::kOriginal);
  assert(PrivateWindowRoute("extensions.list", true) == PrivateRoute::kEnding);
  for (const char* refused : {"extensions.uninstall", "extensions.setEnabled", "extensions.install",
                              "extensions.configure", "extensions.resolveInstallPrompt", "extensions.syncApply",
                              "extensions.inspectUnpacked", "extensions.chooseFolder", "search.engines", ""}) {
    assert(PrivateWindowRoute(refused, false) == PrivateRoute::kRefused);
    assert(PrivateWindowRoute(refused, true) == PrivateRoute::kRefused);
  }
  assert(PrivateWindowRoute("extensions.actionStates", true) == PrivateRoute::kEnding);
  assert(PrivateWindowRoute("extensions.watchActions", true) == PrivateRoute::kEnding);
  assert(ValidateRequest("extensions.list", Dict()).empty());
  assert(!ValidateRequest("extensions.list", Dict().Set("x", base::Value(1))).empty());
  assert(ValidateRequest("search.engines", Dict()).empty());
  assert(ValidateRequest("extensions.install", Dict().Set("path", "/tmp/ext")).empty());
  assert(!ValidateRequest("extensions.install", Dict().Set("path", "tmp/ext")).empty());
  assert(!ValidateRequest("extensions.installCrx", Dict().Set("path", "/tmp/x.crx").Set("extra", base::Value(true))).empty());
  assert(ValidateRequest("extensions.inspectUnpacked", Dict().Set("path", "/tmp/ext")).empty());
  assert(ValidateRequest("extensions.setEnabled", Dict().Set("id", kId).Set("enabled", base::Value(false))).empty());
  assert(!ValidateRequest("extensions.setEnabled", Dict().Set("id", kId).Set("enabled", "false")).empty());
  assert(!ValidateRequest("extensions.uninstall", Dict().Set("id", "not-an-id")).empty());
  assert(ValidateRequest("extensions.reload", Dict().Set("id", kId)).empty());
  assert(ValidateRequest("extensions.resolveInstallPrompt", Dict().Set("requestId", "install1").Set("accepted", base::Value(true))).empty());
  assert(!ValidateRequest("extensions.resolveInstallPrompt", Dict().Set("requestId", "").Set("accepted", base::Value(true))).empty());
  assert(!ValidateRequest("extensions.resolveInstallPrompt", Dict().Set("requestId", std::string(kMaxRequestId + 1, 'x')).Set("accepted", base::Value(true))).empty());
  assert(ValidateRequest("extensions.actionStates", Dict().Set("tabId", "tab-1").Set("ids", Strings({kId.c_str()}))).empty());
  assert(!ValidateRequest("extensions.actionStates", Dict().Set("tabId", "tab-1").Set("ids", Strings({"bad"}))).empty());
  base::ListValue many;
  for (size_t i = 0; i <= kMaxActionIds; ++i) many.Append(base::Value(kId));
  assert(!ValidateRequest("extensions.actionStates", Dict().Set("tabId", "tab-1").Set("ids", base::Value(std::move(many)))).empty());
  assert(!ValidateRequest("extensions.actionStates", Dict().Set("tabId", "").Set("ids", Strings({}))).empty());
  assert(ValidateRequest("extensions.sidePanelUrl", Dict().Set("tabId", "t").Set("extensionId", kId)).empty());
  assert(!ValidateRequest("extensions.sidePanelUrl", Dict().Set("tabId", "t")).empty());
  assert(ValidateRequest("extensions.chooseFolder", Dict()).empty());
  assert(ValidateRequest("extensions.syncApply", Dict().Set("anything", base::Value(1))).empty());
  assert(!ValidateRequest("extensions.forwardAnything", Dict()).empty());
  assert(!ValidateRequest("extensions.executeScript", Dict()).empty());

  auto configured = Configuration(Dict().Set("id", kId).Set("options", Dict().Set("pinned", base::Value(true)).Set("siteAccess", "onClick")));
  assert(configured && configured->size() == 3 && configured->FindString("siteAccess") && *configured->FindString("id") == kId);
  assert(ValidateRequest("extensions.configure", Dict().Set("id", kId).Set("options", Dict().Set("fileAccess", base::Value(false)))).empty());
  assert(!Configuration(Dict().Set("id", kId).Set("options", Dict())));
  assert(!Configuration(Dict().Set("id", kId).Set("options", Dict().Set("future", base::Value(true)))));
  assert(!Configuration(Dict().Set("id", kId).Set("options", Dict().Set("pinned", "true"))));
  assert(!Configuration(Dict().Set("id", kId).Set("options", Dict().Set("siteAccess", "everywhere"))));
  assert(!Configuration(Dict().Set("id", "extension").Set("options", Dict().Set("pinned", base::Value(true)))));
}

void Manifests() {
  base::DictValue icons = Dict().Set("16", "i16.png").Set("48", "i48.png").Set("128", "i128.png").Set("x", "bad.png");
  base::Value icon_value(icons.Clone());
  assert(*IconPath(&icon_value, 128) == "i128.png");
  assert(*IconPath(&icon_value, 32) == "i48.png");
  assert(*IconPath(&icon_value, 200) == "i128.png");
  base::Value single("one.png");
  assert(*IconPath(&single, 32) == "one.png");
  assert(!IconPath(nullptr, 32));

  base::ListValue scripts;
  scripts.Append(base::Value(Dict().Set("matches", Strings({"https://a.example/*", "https://b.example/*"}))));
  base::DictValue mv3 = Dict()
      .Set("name", "Fixture").Set("short_name", "Fix").Set("version", "1.2").Set("description", "Test")
      .Set("manifest_version", base::Value(3)).Set("icons", icons.Clone())
      .Set("permissions", Strings({"storage", "tabs", "https://perm.example/*"}))
      .Set("optional_permissions", Strings({"bookmarks"}))
      .Set("host_permissions", Strings({"https://a.example/*", "<all_urls>"}))
      .Set("content_scripts", base::Value(std::move(scripts)))
      .Set("action", Dict().Set("default_popup", "popup.html").Set("default_title", "Click").Set("default_icon", Dict().Set("32", "a32.png")))
      .Set("options_ui", Dict().Set("page", "options.html"))
      .Set("side_panel", Dict().Set("default_path", "panel.html"))
      .Set("incognito", "split").Set("homepage_url", "https://home.example");
  const ManifestFacts facts = ReadManifest(mv3);
  assert(facts.name == "Fixture" && *facts.short_name == "Fix" && facts.version == "1.2" && facts.manifest_version == 3);
  assert(*facts.icon_path == "i128.png");
  assert((facts.permissions == std::vector<std::string>{"storage", "tabs"}));
  assert((facts.host_permissions == std::vector<std::string>{"https://perm.example/*", "https://a.example/*", "<all_urls>", "https://b.example/*"}));
  assert((facts.optional_permissions == std::vector<std::string>{"bookmarks"}));
  assert(facts.has_action && *facts.popup == "popup.html" && *facts.action_title == "Click" && *facts.action_icon_path == "a32.png");
  assert(*facts.options_page == "options.html" && *facts.side_panel == "panel.html" && facts.incognito_split);
  assert(*facts.homepage == "https://home.example");

  const ManifestFacts mv2 = ReadManifest(Dict().Set("name", "Old").Set("browser_action", Dict().Set("default_icon", "b.png").Set("default_popup", ""))
                                             .Set("options_page", "opts.html"));
  assert(mv2.has_action && !mv2.popup && *mv2.action_icon_path == "b.png" && *mv2.options_page == "opts.html" && mv2.manifest_version == 2);
  const ManifestFacts page = ReadManifest(Dict().Set("page_action", Dict()).Set("icons", icons.Clone()));
  assert(page.has_action && *page.action_icon_path == "i48.png");
  const ManifestFacts none = ReadManifest(Dict().Set("name", "Bare").Set("incognito", "spanning"));
  assert(!none.has_action && !none.popup && !none.side_panel && !none.incognito_split && !none.action_icon_path);

  assert(*ResourcePath("/popup.html") == "popup.html" && *ResourcePath("./icons//a.png") == "icons/a.png");
  assert(!ResourcePath("../secret") && !ResourcePath("a/../../b") && !ResourcePath("") && !ResourcePath("a\\b"));
  assert(ImageMimeType("a.PNG") == "image/png" && ImageMimeType("x.svg") == "image/svg+xml" && ImageMimeType("x.txt").empty() &&
         ImageMimeType("dir.png/file").empty());
  assert(Base64("Man") == "TWFu" && Base64("Ma") == "TWE=" && Base64("M") == "TQ==" && Base64("").empty());
  assert(DataUrl("i.png", "Man") == "data:image/png;base64,TWFu");
  assert(DataUrl("i.txt", "Man").empty() && DataUrl("i.png", "").empty() && DataUrl("i.png", std::string(kMaxIconBytes + 1, 'x')).empty());

  base::DictValue package = Package(facts, kId, "/tmp/ext", "data:image/png;base64,AA==");
  assert(*package.FindString("id") == kId && *package.FindString("path") == "/tmp/ext" && *package.FindString("popup") == "popup.html");
  assert(package.Find("hostPermissions")->GetList().size() == 4 && package.Find("manifestVersion")->GetInt() == 3);
  base::DictValue anonymous = Package(none, "", "/tmp/bare", "");
  assert(!anonymous.contains("id") && anonymous.Find("icon")->is_none() && anonymous.Find("popup")->is_none() &&
         anonymous.Find("sidePanel")->is_none() && anonymous.Find("shortName")->is_none());
}

void Listing() {
  base::ListValue raw;
  raw.Append(base::Value(Dict().Set("id", kId).Set("name", "A").Set("location", "FROM_STORE").Set("path", base::Value())));
  raw.Append(base::Value(Dict().Set("id", kOther).Set("name", "B").Set("location", "UNPACKED").Set("path", "/tmp/b")));
  base::Value reply(Dict().Set("extensions", base::Value(std::move(raw))));
  auto entries = Entries(reply);
  assert(entries && entries->size() == 2);
  base::ListValue bad_entries;
  bad_entries.Append(base::Value(Dict().Set("id", "nope")));
  assert(!Entries(base::Value(Dict().Set("extensions", base::Value(std::move(bad_entries))))));
  base::ListValue not_dicts;
  not_dicts.Append(base::Value(1));
  assert(!Entries(base::Value(Dict().Set("extensions", base::Value(std::move(not_dicts))))));
  assert(!Entries(base::Value(Dict())) && !Entries(base::Value(1)));

  ManifestFacts facts;
  facts.has_action = true;
  facts.popup = "popup.html";
  facts.side_panel = "panel.html";
  facts.incognito_split = true;
  base::DictValue store = DecorateEntry((*entries)[0].GetDict(), &facts, "data:image/png;base64,AA==");
  assert(store.Find("hasAction")->GetBool() && *store.FindString("popup") == "popup.html" && *store.FindString("sidePanel") == "panel.html");
  assert(*store.FindString("actionIcon") == "data:image/png;base64,AA==" && store.Find("incognitoSplit")->GetBool());
  assert(store.Find("fromWebStore")->GetBool() && *store.FindString("webStoreUrl") == "https://chromewebstore.google.com/detail/" + kId);
  assert(store.Find("siteAccess")->is_none() && store.Find("optionsUrl")->is_none() && store.Find("homepageUrl")->is_none());
  base::DictValue unpacked = DecorateEntry((*entries)[1].GetDict(), nullptr, "");
  assert(!unpacked.contains("hasAction") && !unpacked.contains("actionIcon") && !unpacked.Find("incognitoSplit")->GetBool());
  assert(!unpacked.Find("fromWebStore")->GetBool() && unpacked.Find("webStoreUrl")->is_none() && *unpacked.FindString("path") == "/tmp/b");

  base::ListValue engines;
  engines.Append(base::Value(Dict().Set("name", "Ext").Set("keyword", "ex").Set("url", "https://s.example/?q=%s").Set("suggestionsUrl", "")
                                    .Set("default", base::Value(false)).Set("isOmniboxExtension", base::Value(false))
                                    .Set("extension", Dict().Set("id", kId).Set("name", "Search Ext"))));
  engines.Append(base::Value(Dict().Set("name", "Forged").Set("url", base::Value(5)).Set("extension", Dict().Set("id", "../x"))));
  engines.Append(base::Value("not an engine"));
  auto mapped = SearchEngines(base::Value(Dict().Set("engines", base::Value(std::move(engines)))));
  assert(mapped);
  const auto& list = mapped->FindDict("list")->Find("engines")->GetList();
  assert(list.size() == 2);
  assert(*list[0].GetDict().FindDict("extension")->FindString("id") == kId);
  assert(!list[1].GetDict().contains("extension") && *list[1].GetDict().FindString("url") == "" && !list[1].GetDict().Find("default")->GetBool());
  assert(!SearchEngines(base::Value(Dict())) && !SearchEngines(base::Value(Dict().Set("engines", "x"))));
}

void Changes() {
  auto installed = ChangeFor("extensions.install", Dict().Set("path", "/x"), base::Value(Dict().Set("id", kId)));
  assert(installed && installed->id == kId && installed->event == "installed");
  assert(ChangeFor("extensions.installCrx", Dict(), base::Value(Dict().Set("id", kOther)))->event == "installed");
  assert(!ChangeFor("extensions.install", Dict(), base::Value(Dict().Set("id", "bad"))));
  assert(ChangeFor("extensions.setEnabled", Dict().Set("id", kId).Set("enabled", base::Value(false)), base::Value(Dict()))->event == "disabled");
  assert(ChangeFor("extensions.setEnabled", Dict().Set("id", kId).Set("enabled", base::Value(true)), base::Value(Dict()))->event == "enabled");
  assert(ChangeFor("extensions.uninstall", Dict().Set("id", kId), base::Value(Dict()))->event == "uninstalled");
  assert(ChangeFor("extensions.reload", Dict().Set("id", kId), base::Value(Dict()))->event == "reloaded");
  assert(ChangeFor("extensions.configure", Dict().Set("id", kId), base::Value(Dict()))->event == "configured");
  assert(!ChangeFor("extensions.list", Dict(), base::Value(Dict())));
  assert(ReloadsExtensionFolder("extensions.reload", Dict().Set("id", kId)));
  assert(ReloadsExtensionFolder("extensions.configure", Dict().Set("id", kId).Set("options", Dict().Set("incognito", base::Value(true)))));
  assert(ReloadsExtensionFolder("extensions.configure", Dict().Set("id", kId).Set("options", Dict().Set("incognito", base::Value(false)))));
  assert(ReloadsExtensionFolder("extensions.configure", Dict().Set("id", kId).Set("options", Dict().Set("fileAccess", base::Value(true)))));
  assert(ReloadsExtensionFolder("extensions.configure", Dict().Set("id", kId).Set("options", Dict().Set("pinned", base::Value(true)).Set("incognito", base::Value(true)))));
  assert(!ReloadsExtensionFolder("extensions.configure", Dict().Set("id", kId).Set("options", Dict().Set("pinned", base::Value(true)))));
  assert(!ReloadsExtensionFolder("extensions.configure", Dict().Set("id", kId).Set("options", Dict().Set("siteAccess", "onClick"))));
  assert(!ReloadsExtensionFolder("extensions.configure", Dict().Set("id", kId).Set("options", Dict().Set("incognito", "yes"))));
  for (const char* other : {"extensions.setEnabled", "extensions.uninstall", "extensions.install", "extensions.list"}) {
    assert(!ReloadsExtensionFolder(other, Dict().Set("id", kId)));
  }
  assert(!ChangeFor("extensions.watchActions", Dict().Set("id", kId), base::Value(Dict())));
  assert(*ChangeEvent(Change{kId, "reloaded"}, "").FindString("profile") == "");
  base::DictValue event = ChangeEvent(Change{kId, "reloaded"}, "work");
  assert(*event.FindString("profile") == "work" && *event.FindString("id") == kId && *event.FindString("event") == "reloaded");

  assert(PromptTypeName(kPromptInstall) == "install" && PromptTypeName(kPromptReEnable) == "re-enable" &&
         PromptTypeName(kPromptPermissions) == "permissions" && PromptTypeName(kPromptExternal) == "external" &&
         PromptTypeName(kPromptRemote) == "remote" && PromptTypeName(kPromptRepair) == "repair" && PromptTypeName(13) == "other");
  assert(!HexColor(0x00ff0000) && *HexColor(0xff102030) == "#102030" && *HexColor(0x80abcdef) == "#abcdef");
  assert(DisplayBadge("<<hidden") == "" && DisplayBadge("12") == "12");
  ActionFacts action;
  action.title = "T";
  action.badge = "3";
  action.badge_color = 0xffff0000;
  action.popup = "chrome-extension://" + kId + "/popup.html";
  action.enabled = true;
  base::DictValue state = ActionState(action);
  assert(*state.FindString("badgeText") == "3" && *state.FindString("badgeColor") == "#ff0000" && state.Find("badgeTextColor")->is_none());
  assert(state.Find("enabled")->GetBool() && *state.FindString("icon") == "" && *state.FindString("title") == "T");
}

void Surfaces() {
  const std::string popup = "chrome-extension://" + kId + "/popup.html";
  assert(*ExtensionUrlHost(popup) == kId && *ExtensionUrlHost("chrome-extension://" + kId) == kId);
  assert(!ExtensionUrlHost("https://" + kId + "/x") && !ExtensionUrlHost("chrome-extension://" + kId + "x/p") &&
         !ExtensionUrlHost("chrome-extension://short/p") && !ExtensionUrlHost("chrome-extension://" + kId + "/" + std::string(kMaxSurfaceUrl, 'x')));
  SurfaceRequest request;
  assert(ValidateSurfaceRequest(Dict().Set("kind", "popup").Set("url", popup).Set("profile", ""), &request).empty());
  assert(request.kind == SurfaceKind::kPopup && request.extension_id == kId && request.url == popup);
  assert(ValidateSurfaceRequest(Dict().Set("kind", "sidePanel").Set("url", "chrome-extension://" + kOther + "/p.html").Set("profile", "default"), &request).empty());
  assert(request.kind == SurfaceKind::kSidePanel && request.extension_id == kOther);
  assert(!ValidateSurfaceRequest(Dict().Set("kind", "tab").Set("url", popup).Set("profile", ""), &request).empty());
  assert(!ValidateSurfaceRequest(Dict().Set("kind", "popup").Set("url", "https://evil.example/").Set("profile", ""), &request).empty());
  assert(!ValidateSurfaceRequest(Dict().Set("kind", "popup").Set("url", popup), &request).empty());
  assert(!ValidateSurfaceRequest(Dict().Set("kind", "popup").Set("url", popup).Set("profile", "").Set("tabId", "x"), &request).empty());

  SurfaceBook book;
  auto a = book.Open(SurfaceKind::kPopup, kId, 1);
  auto b = book.Open(SurfaceKind::kSidePanel, kOther, 1);
  auto c = book.Open(SurfaceKind::kSidePanel, kId, 2);
  auto d = book.Open(SurfaceKind::kPopup, kOther, 2);
  assert(a && b && c && d && *a == 1 && *d == 4 && book.size() == kMaxSurfacesPerWindow);
  assert(!book.Open(SurfaceKind::kPopup, kId, 2));
  assert(!book.Open(SurfaceKind::kPopup, "bad", 2));
  assert(book.Owns(*a, 1) && !book.Owns(*a, 2) && book.Find(*b)->kind == SurfaceKind::kSidePanel);
  assert((book.CloseExtension(kId) == std::vector<int>{1, 3}) && book.size() == 2);
  assert((book.CloseOlderThan(2) == std::vector<int>{2}) && book.size() == 1 && book.Owns(4, 2));
  auto e = book.Open(SurfaceKind::kPopup, kId, 2);
  assert(e && *e == 5);
  assert(book.Close(5) && !book.Close(5));
  assert((book.CloseAll() == std::vector<int>{4}) && book.size() == 0);
}

void Prompts() {
  PromptLedger<int> ledger;
  std::vector<std::string> ids;
  for (int i = 0; i < static_cast<int>(kMaxPendingPrompts); ++i) {
    auto id = ledger.Add("", i % 2 + 1, Dict().Set("id", kId), i);
    assert(id);
    ids.push_back(*id);
  }
  assert(!ledger.Add("", 1, Dict(), 99));
  assert(*ledger.Find(ids[0])->payload.FindString("requestId") == ids[0]);
  assert(ledger.Check(ids[0], 1, "") == PromptResolve::kResolved);
  assert(ledger.Check(ids[0], 2, "") == PromptResolve::kWrongWindow);
  assert(ledger.Check(ids[0], 1, "other") == PromptResolve::kWrongProfile);
  assert(ledger.Check("install999", 1, "") == PromptResolve::kUnknown);
  assert(*ledger.Take(ids[0]) == 0 && !ledger.Take(ids[0]));
  assert(ledger.OfWindow(1).size() == 3 && ledger.OfWindow(2).size() == 4);
  assert(ledger.Move(ids[1], 1) && ledger.OfWindow(1).size() == 4 && !ledger.Move("install999", 1));
  assert(ledger.Add("", 3, Dict(), 7));
  auto all = ledger.TakeAll();
  assert(all.size() == kMaxPendingPrompts && ledger.size() == 0);

  PendingPopup<int> pending;
  assert(!pending.Expect(kId, 100, 1));
  auto previous = pending.Expect(kOther, 101, 2);
  assert(previous && *previous == 1 && pending.extension_id() == kOther);
  assert(!pending.Match(kId, 102));
  assert(!pending.Expire(101 + kPopupWaitSeconds));
  auto matched = pending.Match(kOther, 102);
  assert(matched && *matched == 2 && !pending.pending());
  pending.Expect(kId, 200, 3);
  assert(!pending.Match(kId, 200 + kPopupWaitSeconds + 1));
  auto expired = pending.Expire(200 + kPopupWaitSeconds + 1);
  assert(expired && *expired == 3 && !pending.Fail());
}

}

int main() {
  Requests();
  Manifests();
  Listing();
  Changes();
  Surfaces();
  Prompts();
  std::printf("extensions scenarios passed\n");
  for (const char* capability : kSurfaceCapabilities) std::printf("capability %s\n", capability);
}
