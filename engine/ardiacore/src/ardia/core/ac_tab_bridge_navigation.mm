#include "ardia/core/ac_browser.h"

#import <AppKit/AppKit.h>

#include <algorithm>

#include "base/auto_reset.h"
#include "base/functional/bind.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/api/declarative_net_request/request_action.h"
#include "extensions/browser/api/web_request/web_request_info.h"
#include "extensions/browser/extensions_browser_client.h"
#include "extensions/common/constants.h"
#include "net/base/net_errors.h"
#include "third_party/blink/public/common/loader/resource_type_util.h"
#include "third_party/blink/public/mojom/loader/resource_load_info.mojom.h"
#include "ardia/core/ac_browser_internal.h"
#include "ardia/core/ac_hooks.h"
#import "ardia/core/ardiacore_internal.h"

namespace ardiacore {

void TabBridge::DidStartNavigation(content::NavigationHandle* handle) {
  base::AutoReset<int> notifying(&g_navigation_notifying,
                                 g_navigation_notifying + 1);
  if (handle->IsInPrimaryMainFrame() && !handle->IsSameDocument()) {
    rule_blocked_urls_.clear();
  }
  if (discarded_ && handle->IsInPrimaryMainFrame() &&
      !web_contents()->WasDiscarded()) {
    discarded_ = false;
    [tab_ notify:@selector(tabDidChangeDiscarded:)];
  }
}

void TabBridge::TitleWasSet(content::NavigationEntry* entry) {
  base::AutoReset<int> notifying(&g_navigation_notifying,
                                 g_navigation_notifying + 1);
  [tab_ notify:@selector(tabDidChangeTitle:)];
}

void TabBridge::DidStartLoading() {
  base::AutoReset<int> notifying(&g_navigation_notifying,
                                 g_navigation_notifying + 1);
  EnsureFaviconObserved();
  EnsurePopupsObserved();
  [tab_ notify:@selector(tabDidChangeLoading:)];
}

void TabBridge::DidStopLoading() {
  base::AutoReset<int> notifying(&g_navigation_notifying,
                                 g_navigation_notifying + 1);
  base::WeakPtr<TabBridge> alive = weak_factory_.GetWeakPtr();
  [tab_ notify:@selector(tabDidChangeLoading:)];
  if (alive) {
    CheckSecurity();
  }
}

void TabBridge::LoadProgressChanged(double progress) {
  base::AutoReset<int> notifying(&g_navigation_notifying,
                                 g_navigation_notifying + 1);
  [tab_ notify:@selector(tabDidChangeProgress:)];
}

namespace {

bool InPrimaryPage(content::RenderFrameHost* rfh) {
  return rfh && rfh->GetOutermostMainFrame()->IsInPrimaryMainFrame();
}

}

void TabBridge::ResourceLoadComplete(
    content::RenderFrameHost* render_frame_host,
    const content::GlobalRequestID& request_id,
    const GURL& original_url,
    const blink::mojom::ResourceLoadInfo& resource_load_info) {
  if (resource_load_info.net_error != net::ERR_BLOCKED_BY_CLIENT ||
      blink::IsRequestDestinationFrame(resource_load_info.request_destination) ||
      !InPrimaryPage(render_frame_host)) {
    return;
  }
  NoteBlockedByClient(resource_load_info.final_url, original_url);
}

void TabBridge::NoteRuleMatched(bool block, const GURL& url) {
  if (block) {
    if (rule_blocked_urls_.size() >= 4096) {
      rule_blocked_urls_.erase(rule_blocked_urls_.begin());
    }
    rule_blocked_urls_.push_back(url);
  }
  NoteBlocked(url);
}

void TabBridge::NoteBlockedByClient(const GURL& blocked_url, const GURL& url) {
  auto it = std::find(rule_blocked_urls_.begin(), rule_blocked_urls_.end(), blocked_url);
  if (it != rule_blocked_urls_.end()) {
    rule_blocked_urls_.erase(it);
    return;
  }
  NoteBlocked(url);
}

void InstallRuleMatchedHook() {
  g_ardia_dnr_rule_matched =
      [](content::BrowserContext* context, int tab_id,
         const extensions::declarative_net_request::RequestAction& action,
         const extensions::WebRequestInfo& request) {
        using Type = extensions::declarative_net_request::RequestAction::Type;
        const bool block = action.type == Type::BLOCK || action.type == Type::COLLAPSE;
        if ((!block && action.type != Type::REDIRECT) ||
            tab_id == extension_misc::kUnknownTabId) {
          return;
        }
        content::RenderFrameHost* frame =
            content::RenderFrameHost::FromID(request.global_id);
        if (frame && !InPrimaryPage(frame)) {
          return;
        }
        content::WebContents* contents = nullptr;
        if (!extensions::ExtensionsBrowserClient::Get()->IsValidTabId(
                context, tab_id, true, &contents) ||
            !contents) {
          return;
        }
        if (TabBridge* bridge = TabBridge::FromWebContents(contents)) {
          bridge->NoteRuleMatched(block, request.url);
        }
      };
}

void TabBridge::NoteBlocked(const GURL& url) {
  blocked_last_url_ = url;
  if (blocked_pending_++ == 0) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(&TabBridge::ReportBlocked, weak_factory_.GetWeakPtr()));
  }
}

void TabBridge::ReportBlocked() {
  const int count = blocked_pending_;
  NSString* url = base::SysUTF8ToNSString(blocked_last_url_.spec());
  blocked_pending_ = 0;
  blocked_last_url_ = GURL();
  ArdiaCoreTab* tab = tab_;
  id<ArdiaCoreTabDelegate> delegate = tab.delegate;
  if (count > 0 &&
      [delegate respondsToSelector:@selector(tab:didBlockRequests:lastURL:)]) {
    [delegate tab:tab didBlockRequests:count lastURL:url];
  }
}

void TabBridge::DidFinishNavigation(content::NavigationHandle* handle) {
  base::AutoReset<int> notifying(&g_navigation_notifying,
                                 g_navigation_notifying + 1);
  EnsureFaviconObserved();
  EnsureZoomObserved();
  if (made_ahead_ && handle->IsInPrimaryMainFrame() && handle->HasCommitted() &&
      !handle->GetURL().IsAboutBlank()) {
    made_ahead_ = false;
  }
  base::WeakPtr<TabBridge> alive = weak_factory_.GetWeakPtr();
  if (handle->GetNetErrorCode() == net::ERR_BLOCKED_BY_CLIENT &&
      (handle->IsInMainFrame()
           ? handle->IsInPrimaryMainFrame()
           : InPrimaryPage(handle->GetParentFrameOrOuterDocument()))) {
    NoteBlockedByClient(handle->GetURL(), handle->GetURL());
  }
  if (handle->IsInPrimaryMainFrame() && handle->IsDownload()) {
    ArdiaCoreTab* tab = tab_;
    id<ArdiaCoreTabDelegate> delegate = tab.delegate;
    if ([delegate respondsToSelector:@selector(tab:navigationBecameDownload:)]) {
      [delegate tab:tab
          navigationBecameDownload:base::SysUTF8ToNSString(handle->GetURL().spec())];
    }
    if (!alive) {
      return;
    }
  }
  if (handle->IsInPrimaryMainFrame() && handle->HasCommitted() &&
      !handle->IsSameDocument()) {
    [tab_ notify:@selector(tabDidCommitDocument:)];
    if (!alive) {
      return;
    }
  }
  if (handle->IsInPrimaryMainFrame() && handle->HasCommitted()) {
    CheckSecurity();
  }
  if (!alive) {
    return;
  }
  [tab_ notify:@selector(tabDidChangeURL:)];
  const int error = handle->GetNetErrorCode();
  if (alive && handle->IsInPrimaryMainFrame() && error != net::OK &&
      error != net::ERR_ABORTED) {
    ArdiaCoreTab* tab = tab_;
    id<ArdiaCoreTabDelegate> delegate = tab.delegate;
    if ([delegate respondsToSelector:@selector(tab:didFailLoad:code:description:)]) {
      [delegate tab:tab
          didFailLoad:base::SysUTF8ToNSString(handle->GetURL().spec())
                 code:error
          description:base::SysUTF8ToNSString(net::ErrorToShortString(error))];
    }
  }
}

void TabBridge::NavigationEntryCommitted(
    const content::LoadCommittedDetails& load_details) {
  base::AutoReset<int> notifying(&g_navigation_notifying,
                                 g_navigation_notifying + 1);
  [tab_ notify:@selector(tabDidChangeNavigationState:)];
}

void TabBridge::NavigationListPruned(
    const content::PrunedDetails& pruned_details) {
  base::AutoReset<int> notifying(&g_navigation_notifying,
                                 g_navigation_notifying + 1);
  [tab_ notify:@selector(tabDidChangeNavigationState:)];
}

void TabBridge::NavigationEntriesDeleted() {
  base::AutoReset<int> notifying(&g_navigation_notifying,
                                 g_navigation_notifying + 1);
  [tab_ notify:@selector(tabDidChangeNavigationState:)];
}

}
