#ifndef ARDIA_WIN_TAB_EVENTS_H_
#define ARDIA_WIN_TAB_EVENTS_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "base/callback_list.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"
#include "components/blocked_content/popup_blocker_tab_helper.h"
#include "components/blocked_content/url_list_manager.h"
#include "components/find_in_page/find_result_observer.h"
#include "components/zoom/zoom_controller.h"
#include "components/zoom/zoom_observer.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "url/gurl.h"

namespace content {
class RenderWidgetHost;
}

namespace ardia_win {

class TabEvents : public content::WebContentsObserver,
                  public zoom::ZoomObserver,
                  public blocked_content::UrlListManager::Observer,
                  public find_in_page::FindResultObserver,
                  public content::WebContentsUserData<TabEvents> {
 public:
  TabEvents(const TabEvents&) = delete;
  TabEvents& operator=(const TabEvents&) = delete;
  ~TabEvents() override;

  static void Attach(content::WebContents* contents);
  static base::DictValue MediaState(content::WebContents* contents);
  static base::DictValue SecurityInfo(content::WebContents* contents);
  static double ZoomFactor(content::WebContents* contents);

  bool frozen() const { return frozen_; }
  void set_frozen(bool frozen) { frozen_ = frozen; }
  void SendZoom(bool user);
  void TargetURLChanged(const GURL& url);
  void RendererUnresponsive(content::RenderWidgetHost* host,
                            base::RepeatingClosure restarter);
  void RendererResponsive(content::RenderWidgetHost* host);
  void ResolveUnresponsive(bool terminate);

  void DidStartNavigation(content::NavigationHandle* handle) override;
  void DidFinishNavigation(content::NavigationHandle* handle) override;
  void DidStartLoading() override;
  void DidStopLoading() override;
  void DidChangeVisibleSecurityState() override;
  void WasDiscarded() override;
  void OnPageScaleFactorChanged(float page_scale_factor) override;
  void OnVisibilityChanged(content::Visibility visibility) override;
  void DidToggleFullscreenModeForTab(bool entered_fullscreen,
                                     bool will_cause_resize) override;
  void WebContentsDestroyed() override;

  void OnZoomChanged(
      const zoom::ZoomController::ZoomChangedEventData& data) override;
  void OnZoomControllerDestroyed(
      zoom::ZoomController* zoom_controller) override;

  void BlockedUrlAdded(int32_t popup_id, const GURL& url) override;

  void OnFindResultAvailable(content::WebContents* web_contents) override;
  void OnFindTabHelperDestroyed(find_in_page::FindTabHelper* helper) override;

 private:
  friend class content::WebContentsUserData<TabEvents>;
  explicit TabEvents(content::WebContents* contents);

  void Observe();
  bool Listened() const;
  void Send(std::string_view name, base::DictValue data);
  void CheckSecurity();
  void SendBlockedPopup(int32_t popup_id, base::DictValue popup);
  void OnRecentlyAudibleChanged(bool was_recently_audible);

  raw_ptr<find_in_page::FindTabHelper> find_helper_ = nullptr;
  raw_ptr<zoom::ZoomController> zoom_ = nullptr;
  raw_ptr<blocked_content::PopupBlockerTabHelper> popups_ = nullptr;
  base::CallbackListSubscription audible_subscription_;
  std::string security_;
  std::optional<std::pair<int, int>> unresponsive_;
  base::RepeatingClosure hang_monitor_restarter_;
  float pinch_scale_ = 1;
  bool discarded_ = false;
  bool frozen_ = false;
  bool fullscreen_ = false;
  base::WeakPtrFactory<TabEvents> weak_factory_{this};
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}

#endif
