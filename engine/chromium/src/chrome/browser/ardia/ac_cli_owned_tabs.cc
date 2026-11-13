// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_cli_owned_tabs.h"

#include <map>
#include <memory>
#include <string>
#include <utility>

#include "ardia/core/ac_content_hooks.h"
#include "ardia/core/ac_host_visibility.h"
#include "base/functional/bind.h"
#include "base/location.h"
#include "base/no_destructor.h"
#include "base/task/sequenced_task_runner.h"
#include "chrome/browser/ardia/ac_cli_token_policy.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"

namespace ardia {
namespace {

class OwnedTab : public content::WebContentsObserver {
 public:
  OwnedTab(std::string target_id, content::WebContents* contents)
      : content::WebContentsObserver(contents),
        target_id_(std::move(target_id)) {}

  const std::string& target_id() const { return target_id_; }
  bool emulated() const { return emulated_; }
  void set_emulated() { emulated_ = true; }

  void WebContentsDestroyed() override {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ForgetCliOwnedTarget, target_id_));
  }

 private:
  const std::string target_id_;
  bool emulated_ = false;
};

std::map<std::string, std::unique_ptr<OwnedTab>>& OwnedTabs() {
  static base::NoDestructor<std::map<std::string, std::unique_ptr<OwnedTab>>>
      tabs;
  return *tabs;
}

bool TabCameIntoView(content::WebContents* contents) {
  std::string owned;
  bool emulated = false;
  for (const auto& [target_id, tab] : OwnedTabs()) {
    if (tab->web_contents() == contents) {
      owned = target_id;
      emulated = tab->emulated();
      break;
    }
  }
  if (owned.empty() || !emulated) {
    return false;
  }
  ClearCliViewportOverride(owned);
  return true;
}

}

void NoteCliOwnedTarget(const std::string& target_id) {
  static const bool watching =
      (ardiacore::WatchTabsInShownSlot(&TabCameIntoView), true);
  content::DevToolsAgentHost* host =
      content::ArdiaDevToolsAgentHostForId(target_id);
  content::WebContents* contents = host ? host->GetWebContents() : nullptr;
  if (!watching || !contents || OwnedTabs().contains(target_id)) {
    return;
  }
  OwnedTabs()[target_id] = std::make_unique<OwnedTab>(target_id, contents);
}

void NoteCliViewportOverride(const std::string& target_id) {
  auto it = OwnedTabs().find(target_id);
  if (it != OwnedTabs().end()) {
    it->second->set_emulated();
  }
}

void ForgetCliOwnedTarget(const std::string& target_id) {
  OwnedTabs().erase(target_id);
}

CliTabOwner CliOwnerOfTarget(const std::string& target_id) {
  auto it = OwnedTabs().find(target_id);
  if (it == OwnedTabs().end() || !it->second->web_contents()) {
    return CliTabOwner::kNobody;
  }
  return ardiacore::TabWasInShownSlot(it->second->web_contents())
             ? CliTabOwner::kUser
             : CliTabOwner::kCommand;
}

}
