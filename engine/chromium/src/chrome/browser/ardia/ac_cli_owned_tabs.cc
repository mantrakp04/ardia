// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_cli_owned_tabs.h"

#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "ardia/core/ac_content_hooks.h"
#include "ardia/core/ac_host_visibility.h"
#include "base/functional/bind.h"
#include "base/location.h"
#include "base/no_destructor.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"

namespace ardia {
namespace {

constexpr base::TimeDelta kOrphanCloseDelay = base::Seconds(5);

class OwnedTab : public content::WebContentsObserver {
 public:
  OwnedTab(std::string target_id,
           content::WebContents* contents,
           const void* owner)
      : content::WebContentsObserver(contents),
        target_id_(std::move(target_id)),
        owner_(owner) {}

  const void* owner() const { return owner_; }
  int generation() const { return generation_; }
  void set_owner(const void* owner) {
    owner_ = owner;
    ++generation_;
  }

  void WebContentsDestroyed() override {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ForgetCliOwnedTarget, target_id_));
  }

 private:
  const std::string target_id_;
  const void* owner_;
  int generation_ = 0;
};

std::map<std::string, std::unique_ptr<OwnedTab>>& OwnedTabs() {
  static base::NoDestructor<std::map<std::string, std::unique_ptr<OwnedTab>>>
      tabs;
  return *tabs;
}

void CloseIfOrphanedOffscreen(const std::string& target_id, int generation) {
  auto it = OwnedTabs().find(target_id);
  content::WebContents* contents =
      it == OwnedTabs().end() ? nullptr : it->second->web_contents();
  if (!contents || it->second->owner() ||
      it->second->generation() != generation ||
      !ardiacore::InAutomationWindow(contents)) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  TabStripModel* model = browser ? browser->GetTabStripModel() : nullptr;
  const int index =
      model ? model->GetIndexOfWebContents(contents) : TabStripModel::kNoTab;
  if (index != TabStripModel::kNoTab) {
    model->DetachAndDeleteWebContentsAt(index);
  }
}

}

void NoteCliOwnedTarget(const std::string& target_id, const void* owner) {
  content::DevToolsAgentHost* host =
      content::ArdiaDevToolsAgentHostForId(target_id);
  content::WebContents* contents = host ? host->GetWebContents() : nullptr;
  if (!contents || OwnedTabs().contains(target_id)) {
    return;
  }
  OwnedTabs()[target_id] =
      std::make_unique<OwnedTab>(target_id, contents, owner);
}

void ClaimCliOwnedTarget(const std::string& target_id, const void* owner) {
  auto it = OwnedTabs().find(target_id);
  if (it != OwnedTabs().end()) {
    it->second->set_owner(owner);
  }
}

void ReleaseCliOwnedTargets(const void* owner) {
  std::vector<std::pair<std::string, int>> released;
  for (const auto& [target_id, tab] : OwnedTabs()) {
    if (tab->owner() == owner) {
      tab->set_owner(nullptr);
      released.emplace_back(target_id, tab->generation());
    }
  }
  for (const auto& [target_id, generation] : released) {
    base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&CloseIfOrphanedOffscreen, target_id, generation),
        kOrphanCloseDelay);
  }
}

void ForgetCliOwnedTarget(const std::string& target_id) {
  OwnedTabs().erase(target_id);
}

bool IsCliOwnedTab(content::WebContents* contents) {
  if (!contents) {
    return false;
  }
  for (const auto& [target_id, tab] : OwnedTabs()) {
    if (tab->web_contents() == contents) {
      return true;
    }
  }
  return false;
}

std::string CliEmulationRefusal(const std::string& target_id) {
  auto it = OwnedTabs().find(target_id);
  content::WebContents* contents =
      it == OwnedTabs().end() ? nullptr : it->second->web_contents();
  if (!contents) {
    return "on a tab the ardia command didn't open";
  }
  if (!ardiacore::InAutomationWindow(contents) ||
      ardiacore::TabWasInShownSlot(contents)) {
    return "on a tab that isn't off-screen";
  }
  return std::string();
}

}
