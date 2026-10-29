#include "ardia/core/ac_browser.h"

#import <AppKit/AppKit.h>

#include "base/auto_reset.h"
#include "base/containers/flat_map.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "components/favicon/content/content_favicon_driver.h"
#include "components/find_in_page/find_notification_details.h"
#include "components/find_in_page/find_tab_helper.h"
#include "components/sessions/content/session_tab_helper.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/result_codes.h"
#include "ardia/core/ac_browser_internal.h"
#include "ardia/core/ac_hooks.h"
#include "ardia/core/ac_page_channel.h"
#include "ardia/core/ac_tab_info.h"
#import "ardia/core/ardiacore_internal.h"
#include "ui/gfx/image/image.h"

namespace ardiacore {

namespace {

base::flat_map<int32_t, int32_t>& TemporaryTabIds() {
  static base::NoDestructor<base::flat_map<int32_t, int32_t>> ids;
  return *ids;
}

}

TabBridge::TabBridge(content::WebContents* contents)
    : content::WebContentsObserver(contents),
      content::WebContentsUserData<TabBridge>(*contents) {
  content::g_ardia_opacity_from_default_color = true;
  tab_ = [[ArdiaCoreTab alloc] initWithContents:contents];
  PageChannel::GetOrCreate(contents);
}

TabBridge::~TabBridge() = default;

TabBridge* TabBridge::GetOrCreate(content::WebContents* contents) {
  CreateForWebContents(contents);
  return FromWebContents(contents);
}

void TabBridge::EnsureFaviconObserved() {
  if (observing_favicon_) {
    return;
  }
  if (auto* driver =
          favicon::ContentFaviconDriver::FromWebContents(web_contents())) {
    driver->AddObserver(this);
    observing_favicon_ = true;
  }
}

void TabBridge::EnsureFindObserved() {
  if (find_helper_) {
    return;
  }
  find_helper_ = find_in_page::FindTabHelper::FromWebContents(web_contents());
  if (find_helper_) {
    find_helper_->AddObserver(this);
  }
}

void TabBridge::OnFindResultAvailable(content::WebContents* web_contents) {
  const find_in_page::FindNotificationDetails& result =
      find_helper_->find_result();
  ArdiaCoreTab* tab = tab_;
  id<ArdiaCoreTabDelegate> delegate = tab.delegate;
  if ([delegate respondsToSelector:@selector(tab:didFindMatches:active:final:)]) {
    [delegate tab:tab
        didFindMatches:result.number_of_matches()
                active:result.active_match_ordinal()
                 final:result.final_update()];
  }
}

void TabBridge::OnFindTabHelperDestroyed(find_in_page::FindTabHelper* helper) {
  helper->RemoveObserver(this);
  find_helper_ = nullptr;
}


constexpr base::TimeDelta kCloseStepDeadline = base::Seconds(2);

void TabBridge::CloseAfterUnloadHandlers(bool window_closing) {
  if (!closing_after_unload()) {
    close_step_ = CloseStep::kAwaitingBeforeUnload;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE,
      base::BindOnce(&TabBridge::EnforceCloseDeadline,
                     weak_factory_.GetWeakPtr(), false),
      kCloseStepDeadline);
  if (window_closing) {
    StartUnload();
    return;
  }
  web_contents()->DispatchBeforeUnload(true);
}

void TabBridge::StartUnload() {
  if (close_step_ == CloseStep::kUnloading) {
    return;
  }
  close_step_ = CloseStep::kUnloading;
  web_contents()->ClosePage();
}

void TabBridge::EnforceCloseDeadline(bool unload_given) {
  if (unload_given) {
    DeleteTabClosedByHost(web_contents());
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE,
      base::BindOnce(&TabBridge::EnforceCloseDeadline,
                     weak_factory_.GetWeakPtr(), true),
      kCloseStepDeadline);
  StartUnload();
}

void TabBridge::BeforeUnloadFired(bool proceed) {
  if (proceed) {
    if (close_step_ == CloseStep::kAwaitingBeforeUnload) {
      close_step_ = CloseStep::kUnloading;
    }
    return;
  }
  if (closing_after_unload()) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&TabBridge::StartUnload,
                                  weak_factory_.GetWeakPtr()));
    return;
  }
  close_step_ = CloseStep::kOpen;
}

void TabBridge::ReportWillClose() {
  if (close_step_ != CloseStep::kOpen || will_close_reported_) {
    return;
  }
  will_close_reported_ = true;
  [tab_ notify:@selector(tabWillClose:)];
}

namespace {
const char* TerminationName(base::TerminationStatus status) {
  switch (status) {
    case base::TERMINATION_STATUS_NORMAL_TERMINATION:
      return "normal";
    case base::TERMINATION_STATUS_ABNORMAL_TERMINATION:
      return "abnormal";
    case base::TERMINATION_STATUS_PROCESS_WAS_KILLED:
      return "killed";
    case base::TERMINATION_STATUS_PROCESS_CRASHED:
      return "crashed";
    case base::TERMINATION_STATUS_OOM:
      return "oom";
    case base::TERMINATION_STATUS_LAUNCH_FAILED:
      return "launchFailed";
    case base::TERMINATION_STATUS_EVICTED_FOR_MEMORY:
      return "evicted";
    default:
      return "other";
  }
}
}

void TabBridge::PrimaryMainFrameRenderProcessGone(
    base::TerminationStatus status) {
  ScopedNotifying notifying(ScopedNotifying::Kind::kNavigation);
  if (status == base::TERMINATION_STATUS_NORMAL_TERMINATION ||
      status == base::TERMINATION_STATUS_STILL_RUNNING) {
    return;
  }
  ArdiaCoreTab* tab = tab_;
  id<ArdiaCoreTabDelegate> delegate = tab.delegate;
  if ([delegate respondsToSelector:@selector(tab:rendererGone:code:)]) {
    [delegate tab:tab
        rendererGone:@(TerminationName(status))
                code:web_contents()->GetCrashedErrorCode()];
  }
}

void TabBridge::CheckSecurity() {
  NSDictionary* info = SecurityInfoFor(web_contents());
  if ([info isEqualToDictionary:security_]) {
    return;
  }
  security_ = info;
  [tab_ notify:@selector(tabDidChangeSecurity:)];
}

void TabBridge::DidChangeVisibleSecurityState() {
  ScopedNotifying notifying(ScopedNotifying::Kind::kNavigation);
  CheckSecurity();
}

void TabBridge::OnVisibilityChanged(content::Visibility visibility) {
  if (visibility == content::Visibility::VISIBLE) {
    frozen_ = false;
  }
}

void TabBridge::OnPageScaleFactorChanged(float page_scale_factor) {
  pinch_scale_ = page_scale_factor;
  [tab_ notify:@selector(tabDidChangeZoom:)];
}

void TabBridge::EnsureZoomObserved() {
  if (zoom_) {
    return;
  }
  zoom_ = zoom::ZoomController::FromWebContents(web_contents());
  if (zoom_) {
    zoom_->AddObserver(this);
  }
}

void TabBridge::OnZoomChanged(
    const zoom::ZoomController::ZoomChangedEventData& data) {
  if (data.web_contents == web_contents()) {
    [tab_ notify:@selector(tabDidChangeZoom:)];
  }
}

void TabBridge::OnZoomControllerDestroyed(zoom::ZoomController* zoom_controller) {
  zoom_controller->RemoveObserver(this);
  zoom_ = nullptr;
}

void TabBridge::DidChangeThemeColor() {
  [tab_ notify:@selector(tabDidChangeThemeColor:)];
}

void TabBridge::SetUnresponsive(content::RenderWidgetHost* host,
                                base::RepeatingClosure restarter) {
  if (host) {
    unresponsive_ = std::make_pair(host->GetProcess()->GetDeprecatedID(),
                                   host->GetRoutingID());
  }
  hang_monitor_restarter_ = std::move(restarter);
  [tab_ notify:@selector(tabBecameUnresponsive:)];
}

void TabBridge::SetResponsive(content::RenderWidgetHost* host) {
  if (!unresponsive_ ||
      (host && *unresponsive_ != std::make_pair(host->GetProcess()->GetDeprecatedID(),
                                                host->GetRoutingID()))) {
    return;
  }
  unresponsive_.reset();
  hang_monitor_restarter_.Reset();
  [tab_ notify:@selector(tabBecameResponsive:)];
}

void TabBridge::ResolveUnresponsive(bool terminate) {
  content::RenderWidgetHost* host =
      unresponsive_ ? content::RenderWidgetHost::FromID(unresponsive_->first,
                                                         unresponsive_->second)
                    : nullptr;
  base::RepeatingClosure restarter = std::move(hang_monitor_restarter_);
  hang_monitor_restarter_.Reset();
  if (terminate) {
    unresponsive_.reset();
    if (host && host->GetProcess()->IsInitializedAndNotDead()) {
      host->GetProcess()->Shutdown(content::RESULT_CODE_HUNG);
    }
  } else if (restarter) {
    restarter.Run();
  }
}

void TabBridge::WasDiscarded() {
  discarded_ = true;
  [tab_ notify:@selector(tabDidChangeDiscarded:)];
}

void TabBridge::OnWebContentsFocused(
    content::RenderWidgetHost* render_widget_host) {
  if (host_focusing_) {
    return;
  }
  [tab_ notify:@selector(tabDidGainFocus:)];
}

void TabBridge::EnsurePopupsObserved() {
  if (popups_) {
    return;
  }
  popups_ = blocked_content::PopupBlockerTabHelper::FromWebContents(web_contents());
  if (popups_) {
    popups_->manager()->AddObserver(this);
  }
}

void TabBridge::BlockedUrlAdded(int32_t popup_id, const GURL& url) {
  NSDictionary* popup = @{
    @"id" : [NSString stringWithFormat:@"%d", popup_id],
    @"url" : base::SysUTF8ToNSString(url.spec()),
    @"origin" : OriginOf(web_contents()->GetLastCommittedURL()) ?: @"",
  };
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<TabBridge> bridge, int32_t popup_id,
                        NSDictionary* popup) {
                       if (!bridge || !bridge->popups_ ||
                           !bridge->popups_->GetBlockedPopupRequests().contains(
                               popup_id)) {
                         return;
                       }
                       ArdiaCoreTab* tab = bridge->tab_;
                       id<ArdiaCoreTabDelegate> delegate = tab.delegate;
                       if ([delegate respondsToSelector:@selector(tab:didBlockPopup:)]) {
                         [delegate tab:tab didBlockPopup:popup];
                       }
                     },
                     weak_factory_.GetWeakPtr(), popup_id, popup));
}

void TabBridge::OnAudioStateChanged(bool audible) {
  [tab_ notify:@selector(tabDidChangeAudio:)];
}

void TabBridge::DidUpdateAudioMutingState(bool muted) {
  [tab_ notify:@selector(tabDidChangeAudio:)];
}

void TabBridge::WebContentsDestroyed() {
  if (popups_) {
    popups_->manager()->RemoveObserver(this);
    popups_ = nullptr;
  }
  if (zoom_) {
    zoom_->RemoveObserver(this);
    zoom_ = nullptr;
  }
  if (find_helper_) {
    find_helper_->RemoveObserver(this);
    find_helper_ = nullptr;
  }
  if (observing_favicon_) {
    if (auto* driver =
            favicon::ContentFaviconDriver::FromWebContents(web_contents())) {
      driver->RemoveObserver(this);
    }
    observing_favicon_ = false;
  }
  SetTemporary(false);
  [tab_ contentsDestroyed];
}

void TabBridge::SetTemporary(bool temporary) {
  if (temporary_id_) {
    TemporaryTabIds().erase(temporary_id_);
    temporary_id_ = 0;
  }
  const int32_t id = sessions::SessionTabHelper::IdForTab(web_contents()).id();
  if (temporary && id > 0) {
    temporary_id_ = id;
    TemporaryTabIds()[id] = temporary_source_id_;
  }
}

void TabBridge::SetTemporarySource(int32_t source_id) {
  temporary_source_id_ = source_id > 0 ? source_id : 0;
  if (temporary_id_) {
    TemporaryTabIds()[temporary_id_] = temporary_source_id_;
  }
}

bool IsTemporaryTabId(int32_t session_id, int32_t* source_id) {
  auto it = TemporaryTabIds().find(session_id);
  if (session_id <= 0 || it == TemporaryTabIds().end()) {
    return false;
  }
  if (source_id) {
    *source_id = it->second;
  }
  return true;
}

void TabBridge::OnFaviconUpdated(favicon::FaviconDriver* favicon_driver,
                                 NotificationIconType notification_icon_type,
                                 const GURL& icon_url,
                                 bool icon_url_changed,
                                 const gfx::Image& image) {
  favicon_url_ = icon_url;
  [tab_ notify:@selector(tabDidChangeFavicon:)];
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(TabBridge);

}
