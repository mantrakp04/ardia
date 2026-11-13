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
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace ardia {
namespace {

class OwnedTab : public content::WebContentsObserver {
 public:
  OwnedTab(std::string target_id, content::WebContents* contents)
      : content::WebContentsObserver(contents),
        target_id_(std::move(target_id)) {}

  const std::string& target_id() const { return target_id_; }

  void WebContentsDestroyed() override {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ForgetCliOwnedTarget, target_id_));
  }

 private:
  const std::string target_id_;
};

std::map<std::string, std::unique_ptr<OwnedTab>>& OwnedTabs() {
  static base::NoDestructor<std::map<std::string, std::unique_ptr<OwnedTab>>>
      tabs;
  return *tabs;
}

gfx::Size ViewSizeOf(content::WebContents* contents) {
  content::RenderWidgetHostView* view = contents->GetRenderWidgetHostView();
  return view ? view->GetViewBounds().size() : gfx::Size();
}

bool TabCameIntoView(content::WebContents* contents) {
  std::string owned;
  for (const auto& [target_id, tab] : OwnedTabs()) {
    if (tab->web_contents() == contents) {
      owned = target_id;
      break;
    }
  }
  if (owned.empty()) {
    return false;
  }
  const gfx::Size before = ViewSizeOf(contents);
  ClearCliViewportOverride(owned);
  return ViewSizeOf(contents) != before;
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
