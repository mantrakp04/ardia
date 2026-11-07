// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_cli_visible_tabs.h"

#include <cstdint>
#include <map>
#include <string>
#include <utility>

#include "ardia/core/ac_content_hooks.h"
#include "ardia/core/ac_launch_switches.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/location.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "chrome/browser/ardia/ac_cli_token_policy.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/devtools_agent_host_client.h"
#include "content/public/browser/web_contents.h"
#include "ui/gfx/geometry/size.h"

namespace ardia {

namespace {

constexpr char kRemoteDebuggerClient[] = "RemoteDebugger";
constexpr char kPortClientsKeepTabsVisible[] = "cdpTabsVisible";
constexpr bool kStayHidden = false;
constexpr bool kStayAwake = false;
constexpr bool kIsActivity = false;

struct VisibleHold {
  uint64_t id = 0;
  base::WeakPtr<content::WebContents> contents;
  base::ScopedClosureRunner capture;
};

std::map<const void*, VisibleHold>& Holds() {
  static base::NoDestructor<std::map<const void*, VisibleHold>> holds;
  return *holds;
}

uint64_t NextHoldId() {
  static uint64_t last = 0;
  return ++last;
}

bool KeepsTabsVisible(content::DevToolsAgentHostClient* root_client) {
  if (!root_client ||
      root_client->GetTypeForMetrics() != kRemoteDebuggerClient) {
    return false;
  }
  return IsTokenClient(root_client) ||
         ardiacore::TestFlag(kPortClientsKeepTabsVisible);
}

bool IsTabTarget(content::DevToolsAgentHost* host) {
  const std::string type = host->GetType();
  return type == content::DevToolsAgentHost::kTypePage ||
         type == content::DevToolsAgentHost::kTypeFrame ||
         type == content::DevToolsAgentHost::kTypeTab;
}

void StartHold(const void* session, uint64_t id) {
  auto it = Holds().find(session);
  if (it == Holds().end() || it->second.id != id) {
    return;
  }
  content::WebContents* contents = it->second.contents.get();
  if (!contents || contents->IsBeingDestroyed()) {
    Holds().erase(it);
    return;
  }
  base::ScopedClosureRunner capture = contents->IncrementCapturerCount(
      gfx::Size(), kStayHidden, kStayAwake, kIsActivity);
  it = Holds().find(session);
  if (it != Holds().end() && it->second.id == id) {
    it->second.capture = std::move(capture);
  }
}

void SessionAttached(content::DevToolsAgentHostClient* root_client,
                     content::DevToolsAgentHost* host,
                     const void* session) {
  if (!session || !host || !IsTabTarget(host) ||
      !KeepsTabsVisible(root_client)) {
    return;
  }
  content::WebContents* contents = host->GetWebContents();
  if (!contents || contents->IsBeingDestroyed()) {
    return;
  }
  const uint64_t id = NextHoldId();
  Holds().insert_or_assign(
      session, VisibleHold{id, contents->GetWeakPtr(), {}});
  content::GetUIThreadTaskRunner({})->PostTask(
      FROM_HERE, base::BindOnce(&StartHold, session, id));
}

void SessionDetached(const void* session) {
  auto node = Holds().extract(session);
  if (node.empty() || !node.mapped().capture) {
    return;
  }
  content::GetUIThreadTaskRunner({})->PostTask(
      FROM_HERE,
      base::DoNothingWithBoundArgs(std::move(node.mapped().capture)));
}

}

void InstallCliVisibleTabs() {
  g_ardia_devtools_session_attached = &SessionAttached;
  g_ardia_devtools_session_detached = &SessionDetached;
}

}
