#include "ardia/core/ac_browser.h"

#import <AppKit/AppKit.h>

#include "base/auto_reset.h"
#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/unload_controller.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/web_contents.h"
#include "ardia/core/ac_browser_window.h"
#include "ardia/core/ac_contents_background.h"
#include "ardia/core/ac_desktop_capture.h"
#include "ardia/core/ac_fake_media.h"
#include "ardia/core/ac_page_channel.h"
#import "ardia/core/ardiacore_internal.h"
#include "ui/gfx/geometry/rect.h"
#include "url/url_constants.h"

namespace ardiacore {

ACWebContentsDelegate::ACWebContentsDelegate(
    BrowserWindowInterface* browser,
    ExclusiveAccessManager& exclusive_access_manager,
    chrome::BrowserCommandController& command_controller,
    UnloadController& unload_controller,
    web_app::AppBrowserController* app_browser_controller,
    BrowserWindow& window,
    DesktopBrowserWindowCapabilities& capabilities,
    BrowserUiController& browser_ui_controller,
    base::WeakPtr<WindowHost> host)
    : BrowserWebContentsDelegate(browser,
                                 exclusive_access_manager,
                                 command_controller,
                                 unload_controller,
                                 app_browser_controller,
                                 window,
                                 capabilities,
                                 browser_ui_controller),
      host_(std::move(host)),
      ours_(browser) {}

ACWebContentsDelegate::~ACWebContentsDelegate() {
  ACBrowserWindow::Forget(ours_);
}

namespace {
bool IsWindowDisposition(WindowOpenDisposition d) {
  return d == WindowOpenDisposition::NEW_POPUP ||
         d == WindowOpenDisposition::NEW_WINDOW;
}
bool IsNewTabDisposition(WindowOpenDisposition d) {
  return IsWindowDisposition(d) ||
         d == WindowOpenDisposition::NEW_FOREGROUND_TAB ||
         d == WindowOpenDisposition::NEW_BACKGROUND_TAB ||
         d == WindowOpenDisposition::NEW_SPLIT_VIEW;
}
}

content::WebContents* ACWebContentsDelegate::OpenURLFromTab(
    content::WebContents* source,
    const content::OpenURLParams& params,
    base::OnceCallback<void(content::NavigationHandle&)>
        navigation_handle_callback) {
  if (source && params.url.SchemeIs(url::kJavaScriptScheme)) {
    EndAheadBlank(source);
  }
  if (IsAppURL(params.url)) {
    if (source && IsWebUIURL(source->GetLastCommittedURL())) {
      ReportAppURLRequest(source, params.url, params.user_gesture);
    }
    return nullptr;
  }
  WindowHost* host = host_.get();
  if (!host || !IsNewTabDisposition(params.disposition)) {
    return BrowserWebContentsDelegate::OpenURLFromTab(
        source, params, std::move(navigation_handle_callback));
  }
  content::OpenURLParams tab_params(params);
  WindowHost::PendingOpen open{params.disposition,
                              source ? source->GetWeakPtr() : nullptr};
  base::AutoReset<WindowHost::PendingOpen> pending(&host->pending_open(),
                                                   std::move(open));
  if (IsWindowDisposition(params.disposition)) {
    tab_params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
  } else if (params.disposition == WindowOpenDisposition::NEW_SPLIT_VIEW) {
    tab_params.disposition = WindowOpenDisposition::NEW_BACKGROUND_TAB;
  }
  return BrowserWebContentsDelegate::OpenURLFromTab(
      source, tab_params, std::move(navigation_handle_callback));
}

content::WebContents* ACWebContentsDelegate::AddNewContents(
    content::WebContents* source,
    std::unique_ptr<content::WebContents> new_contents,
    const GURL& target_url,
    WindowOpenDisposition disposition,
    const blink::mojom::WindowFeatures& window_features,
    bool user_gesture,
    bool* was_blocked) {
  if (IsAppURL(target_url)) {
    if (source && IsWebUIURL(source->GetLastCommittedURL())) {
      ReportAppURLRequest(source, target_url, user_gesture);
    }
    return nullptr;
  }
  if (host_ && new_contents) {
    TabBridge* bridge = TabBridge::GetOrCreate(new_contents.get());
    bridge->set_open(disposition, source);
    if (disposition == WindowOpenDisposition::NEW_POPUP) {
      NSMutableDictionary* features = [NSMutableDictionary dictionary];
      const gfx::Rect& bounds = window_features.bounds;
      if (window_features.has_x) {
        features[@"x"] = @(bounds.x());
      }
      if (window_features.has_y) {
        features[@"y"] = @(bounds.y());
      }
      if (window_features.has_width) {
        features[@"width"] = @(bounds.width());
      }
      if (window_features.has_height) {
        features[@"height"] = @(bounds.height());
      }
      bridge->set_popup_features(features);
    }
    if (IsWindowDisposition(disposition)) {
      disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
    }
  }
  return BrowserWebContentsDelegate::AddNewContents(
      source, std::move(new_contents), target_url, disposition,
      window_features, user_gesture, was_blocked);
}

void ACWebContentsDelegate::UpdateTargetURL(content::WebContents* source,
                                            const GURL& url) {
  BrowserWebContentsDelegate::UpdateTargetURL(source, url);
  ArdiaCoreTab* tab = TabBridge::GetOrCreate(source)->tab();
  id<ArdiaCoreTabDelegate> delegate = tab.delegate;
  if ([delegate respondsToSelector:@selector(tab:didChangeStatusText:)]) {
    [delegate tab:tab didChangeStatusText:base::SysUTF8ToNSString(url.spec())];
  }
}

void ACWebContentsDelegate::RequestMediaAccessPermission(
    content::WebContents* web_contents,
    const content::MediaStreamRequest& request,
    content::MediaResponseCallback callback) {
  content::MediaStreamRequest granted(request);
  ApplyDesktopCaptureGrant(web_contents, granted);
  KeepAudioCaptureFake(granted);
  BrowserWebContentsDelegate::RequestMediaAccessPermission(web_contents, granted,
                                                           std::move(callback));
}

void ACWebContentsDelegate::ActivateContents(content::WebContents* contents) {
  ArdiaCoreTab* tab = TabBridge::GetOrCreate(contents)->tab();
  id<ArdiaCoreTabDelegate> delegate = tab.delegate;
  if (![delegate respondsToSelector:@selector(tab:requestsActivation:)]) {
    BrowserWebContentsDelegate::ActivateContents(contents);
    return;
  }
  const bool pip =
      PictureInPictureWindowManager::GetInstance()->GetWebContents() == contents;
  [delegate tab:tab requestsActivation:pip ? @"pictureInPicture" : @"page"];
}

void ACWebContentsDelegate::RendererUnresponsive(
    content::WebContents* source,
    content::RenderWidgetHost* render_widget_host,
    base::RepeatingClosure hang_monitor_restarter) {
  TabBridge::GetOrCreate(source)->SetUnresponsive(
      render_widget_host, std::move(hang_monitor_restarter));
}

void ACWebContentsDelegate::RendererResponsive(
    content::WebContents* source,
    content::RenderWidgetHost* render_widget_host) {
  TabBridge::GetOrCreate(source)->SetResponsive(render_widget_host);
}

void ACWebContentsDelegate::CloseContents(content::WebContents* source) {
  TabBridge* bridge = source ? TabBridge::FromWebContents(source) : nullptr;
  if (!bridge || !bridge->closing_after_unload()) {
    BrowserWebContentsDelegate::CloseContents(source);
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(source);
  if (!browser || !UnloadController::From(browser)->CanCloseContents(source)) {
    return;
  }
  DeleteTabClosedByHost(source);
}

}
