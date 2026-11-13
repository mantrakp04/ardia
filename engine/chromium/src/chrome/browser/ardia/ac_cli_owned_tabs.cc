// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_cli_owned_tabs.h"

#include <map>
#include <memory>
#include <string>
#include <utility>

#include "ardia/core/ac_content_hooks.h"
#include "base/functional/bind.h"
#include "base/location.h"
#include "base/memory/raw_ptr.h"
#include "base/no_destructor.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/ardia/ac_cli_token_policy.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/sessions/core/session_id.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/render_widget_host_observer.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "third_party/blink/public/common/input/web_input_event.h"

namespace ardia {
namespace {

constexpr base::TimeDelta kCommandShows = base::Seconds(30);

int WindowOf(content::WebContents* contents) {
  BrowserWindowInterface* browser =
      contents
          ? GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents)
          : nullptr;
  return browser ? browser->GetSessionID().id() : -1;
}

bool IsActiveInItsWindow(content::WebContents* contents) {
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  TabStripModel* tabs = browser ? browser->GetTabStripModel() : nullptr;
  return tabs && tabs->GetActiveWebContents() == contents;
}

bool IsUsersInput(const blink::WebInputEvent& event) {
  if (event.GetModifiers() & blink::WebInputEvent::kFromDebugger) {
    return false;
  }
  switch (event.GetType()) {
    case blink::WebInputEvent::Type::kMouseDown:
    case blink::WebInputEvent::Type::kRawKeyDown:
    case blink::WebInputEvent::Type::kKeyDown:
    case blink::WebInputEvent::Type::kGestureTapDown:
      return true;
    default:
      return false;
  }
}

class OwnedTab : public content::WebContentsObserver,
                 public content::RenderWidgetHost::InputEventObserver,
                 public content::RenderWidgetHostObserver {
 public:
  OwnedTab(std::string target_id, content::WebContents* contents)
      : content::WebContentsObserver(contents),
        target_id_(std::move(target_id)),
        window_(WindowOf(contents)) {
    Watch(contents->GetPrimaryMainFrame()->GetRenderWidgetHost());
  }

  ~OwnedTab() override { Watch(nullptr); }

  bool taken() const { return taken_; }

  void ExpectActivation() {
    shown_by_command_until_ = base::TimeTicks::Now() + kCommandShows;
  }

  void ShownToUser() {
    const bool by_command = base::TimeTicks::Now() <= shown_by_command_until_;
    shown_by_command_until_ = base::TimeTicks();
    if (!by_command) {
      Take();
    }
  }

  void Moved() {
    if (web_contents() && WindowOf(web_contents()) != window_) {
      Take();
    }
  }

  void Take() {
    if (taken_) {
      return;
    }
    taken_ = true;
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ClearCliViewportOverride, target_id_));
  }

  void RenderFrameHostChanged(content::RenderFrameHost* old_host,
                              content::RenderFrameHost* new_host) override {
    if (new_host && new_host->IsInPrimaryMainFrame()) {
      Watch(new_host->GetRenderWidgetHost());
    }
  }

  void WebContentsDestroyed() override {
    Watch(nullptr);
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ForgetCliOwnedTarget, target_id_));
  }

  void OnInputEvent(const content::RenderWidgetHost& host,
                    const blink::WebInputEvent& event,
                    InputEventSource source) override {
    if (IsUsersInput(event)) {
      Take();
    }
  }

  void RenderWidgetHostDestroyed(content::RenderWidgetHost* host) override {
    if (host == widget_) {
      widget_ = nullptr;
    }
  }

 private:
  void Watch(content::RenderWidgetHost* widget) {
    if (widget == widget_) {
      return;
    }
    if (widget_) {
      widget_->RemoveInputEventObserver(this);
      widget_->RemoveObserver(this);
    }
    widget_ = widget;
    if (widget_) {
      widget_->AddInputEventObserver(this);
      widget_->AddObserver(this);
    }
  }

  const std::string target_id_;
  const int window_;
  raw_ptr<content::RenderWidgetHost> widget_ = nullptr;
  base::TimeTicks shown_by_command_until_;
  bool taken_ = false;
};

std::map<std::string, std::unique_ptr<OwnedTab>>& OwnedTabs() {
  static base::NoDestructor<std::map<std::string, std::unique_ptr<OwnedTab>>>
      tabs;
  return *tabs;
}

OwnedTab* OwnedTabOf(content::WebContents* contents) {
  if (!contents) {
    return nullptr;
  }
  for (const auto& [target_id, tab] : OwnedTabs()) {
    if (tab->web_contents() == contents) {
      return tab.get();
    }
  }
  return nullptr;
}

}

void NoteCliOwnedTarget(const std::string& target_id) {
  content::DevToolsAgentHost* host =
      content::ArdiaDevToolsAgentHostForId(target_id);
  content::WebContents* contents = host ? host->GetWebContents() : nullptr;
  if (!contents || OwnedTabs().contains(target_id)) {
    return;
  }
  auto tab = std::make_unique<OwnedTab>(target_id, contents);
  if (IsActiveInItsWindow(contents)) {
    tab->ExpectActivation();
  }
  OwnedTabs()[target_id] = std::move(tab);
}

void ForgetCliOwnedTarget(const std::string& target_id) {
  OwnedTabs().erase(target_id);
}

CliTabOwner CliOwnerOfTarget(const std::string& target_id) {
  auto it = OwnedTabs().find(target_id);
  if (it == OwnedTabs().end() || !it->second->web_contents()) {
    return CliTabOwner::kNobody;
  }
  return it->second->taken() ? CliTabOwner::kUser : CliTabOwner::kCommand;
}

void ExpectCliActivation(const std::string& target_id) {
  auto it = OwnedTabs().find(target_id);
  if (it != OwnedTabs().end()) {
    it->second->ExpectActivation();
  }
}

void CliTabShownToUser(content::WebContents* contents) {
  if (OwnedTab* tab = OwnedTabOf(contents)) {
    tab->ShownToUser();
  }
}

void CliTabPinChanged(content::WebContents* contents) {
  if (OwnedTab* tab = OwnedTabOf(contents)) {
    tab->Take();
  }
}

void CliTabsMoved() {
  for (const auto& [target_id, tab] : OwnedTabs()) {
    tab->Moved();
  }
}

}
