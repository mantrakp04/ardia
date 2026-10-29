#include <cassert>
#include <cstdio>
#include <memory>
#include <string>

#include "web_store_support.h"
#include "ardia/linux/ac_linux_web_store.h"

std::unique_ptr<extensions::UninstallDialogDelegate> (*g_ardia_linux_store_uninstall)(
    extensions::ManagementUninstallFunctionBase* function, const extensions::Extension* target_extension) = nullptr;

namespace {

const std::string kStore = "https://chromewebstore.google.com/detail/x/" + std::string(32, 'a');
const extensions::Extension kExtension(std::string(32, 'a'));

bool held = true;
bool confirming = false;

void Install() {
  ardiacore::InstallLinuxWebStore(base::RepeatingCallback<bool(content::WebContents*)>([](content::WebContents*) { return held; }),
                                  base::RepeatingCallback<bool(content::WebContents*)>([](content::WebContents*) { return confirming; }));
}

struct Bridge {
  content::WebContents* contents;
  std::string listening;
  std::string tab_url;
  int answers = 0;
  int superseded = 0;
  std::vector<std::string> removals;

  void Listen(std::string url) {
    listening = url;
    ardiacore::LinuxWebStoreRequest(contents, base::OnceCallback<void(bool, base::Value)>([this, url](bool ok, base::Value value) {
      assert(ok);
      ++answers;
      assert(answers < 100);
      if (value.is_dict() && value.GetDict().FindBool("superseded") == true) {
        ++superseded;
        return;
      }
      if (listening != url) return;
      if (value.is_string()) removals.push_back(value.GetString());
      if (tab_url == url) Listen(url);
    }));
  }
};

void CloseTab(Bridge& bridge, content::WebContents& contents) {
  bridge.tab_url.clear();
  contents.Destroy();
}

std::unique_ptr<extensions::ManagementUninstallFunctionBase> Uninstall(content::WebContents& contents) {
  auto function = std::make_unique<extensions::ManagementUninstallFunctionBase>();
  function->source = GURL(kStore);
  function->sender = &contents;
  function->uninstall_dialog_ = g_ardia_linux_store_uninstall(function.get(), &kExtension);
  return function;
}

void OverlappingListens() {
  content::WebContents contents;
  contents.frame.url = GURL(kStore);
  Bridge bridge{&contents, "", kStore, 0, 0, {}};
  bridge.Listen(kStore);
  bridge.Listen(kStore);
  bridge.Listen(kStore);
  assert(bridge.answers == 2 && bridge.superseded == 2);
  base::SequencedTaskRunner::GetCurrentDefault()->RunAll();
  assert(bridge.answers == 2);
  auto function = Uninstall(contents);
  assert(function->uninstall_dialog_);
  assert(bridge.answers == 3 && bridge.removals.size() == 1 && bridge.removals[0] == kExtension.id());
  extensions::ExtensionRegistry::Get(contents.GetBrowserContext())->Uninstall(contents.GetBrowserContext(), kExtension);
  assert(function->closes == 1 && function->closed_removed == true && !function->uninstall_dialog_);
  contents.ChangePrimaryPage();
  assert(bridge.answers == 4 && bridge.superseded == 2);
  assert(bridge.answers == 4);
  CloseTab(bridge, contents);
}

void SupersededWaitsStayQuietOnPageChange() {
  content::WebContents contents;
  contents.frame.url = GURL(kStore);
  Bridge bridge{&contents, "", kStore, 0, 0, {}};
  bridge.Listen(kStore);
  bridge.tab_url = kStore + "?next";
  bridge.Listen(kStore + "?next");
  assert(bridge.answers == 1 && bridge.superseded == 1);
  bridge.tab_url = "https://example.com/";
  contents.ChangePrimaryPage();
  assert(bridge.answers == 2 && bridge.superseded == 1);
  CloseTab(bridge, contents);
}

void ExpiryCountsFromTheConfirmation() {
  content::WebContents contents;
  contents.frame.url = GURL(kStore);
  Bridge bridge{&contents, "", kStore, 0, 0, {}};
  base::FakeNow() = 100;
  bridge.Listen(kStore);
  confirming = true;
  auto function = Uninstall(contents);
  assert(bridge.removals.size() == 1);
  base::AdvanceTo(160);
  assert(function->closes == 0);
  confirming = false;
  base::AdvanceTo(188);
  assert(function->closes == 0);
  base::AdvanceTo(192);
  assert(function->closes == 1 && function->closed_removed == false && function->closed_error == u"Ardia kept the extension");
  auto quick = Uninstall(contents);
  base::AdvanceTo(221);
  assert(quick->closes == 0);
  base::AdvanceTo(224);
  assert(quick->closes == 1 && quick->closed_removed == false);
  CloseTab(bridge, contents);
}

void OnlyStorePagesInArdiaTabs() {
  content::WebContents contents;
  contents.frame.url = GURL(kStore);
  auto other = std::make_unique<extensions::ManagementUninstallFunctionBase>();
  other->source = GURL("https://example.com/");
  other->sender = &contents;
  assert(!g_ardia_linux_store_uninstall(other.get(), &kExtension));
  other->source = GURL(kStore);
  other->calling_extension = &kExtension;
  assert(!g_ardia_linux_store_uninstall(other.get(), &kExtension));
  other->calling_extension = nullptr;
  held = false;
  assert(!g_ardia_linux_store_uninstall(other.get(), &kExtension));
  held = true;
  other->sender = nullptr;
  assert(!g_ardia_linux_store_uninstall(other.get(), &kExtension));
}

void RelabelOnlyOnStorePages() {
  content::WebContents contents;
  contents.frame.url = GURL("https://example.com/");
  Bridge bridge{&contents, "", "https://example.com/", 0, 0, {}};
  bridge.Listen("https://example.com/");
  assert(contents.frame.scripts.empty());
  contents.frame.url = GURL(kStore);
  bridge.Listen(kStore);
  assert(contents.frame.scripts.size() == 1 && contents.frame.scripts[0].second == ISOLATED_WORLD_ID_ARDIA_PAGE);
  assert(contents.frame.scripts[0].first.find(u"Add to Ardia") != std::u16string::npos);
  CloseTab(bridge, contents);
}

void ClosedTabsCancel() {
  auto contents = std::make_unique<content::WebContents>();
  contents->frame.url = GURL(kStore);
  Bridge bridge{contents.get(), "", kStore, 0, 0, {}};
  bridge.Listen(kStore);
  auto function = Uninstall(*contents);
  bridge.tab_url = "";
  contents->Destroy();
  assert(function->closes == 1 && function->closed_removed == false);
}

}

int main() {
  Install();
  OverlappingListens();
  SupersededWaitsStayQuietOnPageChange();
  ExpiryCountsFromTheConfirmation();
  OnlyStorePagesInArdiaTabs();
  RelabelOnlyOnStorePages();
  ClosedTabsCancel();
  std::puts("web store scenarios passed");
}
