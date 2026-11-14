#ifndef ARDIA_WIN_TAB_STATE_H_
#define ARDIA_WIN_TAB_STATE_H_

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/values.h"
#include "components/favicon/core/favicon_driver.h"
#include "components/favicon/core/favicon_driver_observer.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/render_widget_host_observer.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"
#include "url/gurl.h"

namespace ardia_win {

class TabState : public content::WebContentsObserver,
                 public content::RenderWidgetHost::InputEventObserver,
                 public content::RenderWidgetHostObserver,
                 public favicon::FaviconDriverObserver,
                 public content::WebContentsUserData<TabState> {
 public:
  TabState(const TabState&) = delete;
  TabState& operator=(const TabState&) = delete;
  ~TabState() override;

  static TabState* Bind(content::WebContents* contents, std::string key);
  static int IdOf(content::WebContents* contents);

  const std::string& key() const { return key_; }
  bool closed_by_host() const { return closed_by_host_; }
  void set_closed_by_host() { closed_by_host_ = true; }
  void WatchOpeningBlank(int64_t navigation_id);
  bool OnlyShowedOpeningBlank() const;
  static GURL CommittedPageURL(content::WebContents* contents);

  void Send(std::string_view name, base::DictValue data);
  void NoteNavigation();

  void DidStartNavigation(content::NavigationHandle* handle) override;
  void DidFinishNavigation(content::NavigationHandle* handle) override;
  void DidOpenRequestedURL(content::WebContents* new_contents,
                           content::RenderFrameHost* source_render_frame_host,
                           const GURL& url,
                           const content::Referrer& referrer,
                           WindowOpenDisposition disposition,
                           ui::PageTransition transition,
                           bool started_from_context_menu,
                           bool renderer_initiated) override;
  void DidStartLoading() override;
  void DidStopLoading() override;
  void LoadProgressChanged(double progress) override;
  void TitleWasSet(content::NavigationEntry* entry) override;
  void DidChangeThemeColor() override;
  void NavigationListPruned(
      const content::PrunedDetails& pruned_details) override;
  void NavigationEntriesDeleted() override;
  void OnAudioStateChanged(bool audible) override;
  void DidUpdateAudioMutingState(bool muted) override;
  void OnWebContentsFocused(
      content::RenderWidgetHost* render_widget_host) override;
  void PrimaryMainFrameRenderProcessGone(
      base::TerminationStatus status) override;
  void WebContentsDestroyed() override;
  void RenderFrameCreated(content::RenderFrameHost* frame) override;
  void RenderFrameHostChanged(content::RenderFrameHost* old_host,
                              content::RenderFrameHost* new_host) override;

  void OnInputEventAck(const content::RenderWidgetHost& widget,
                       blink::mojom::InputEventResultSource source,
                       blink::mojom::InputEventResultState state,
                       const blink::WebInputEvent& event) override;
  void RenderWidgetHostDestroyed(
      content::RenderWidgetHost* widget_host) override;

  void OnFaviconUpdated(favicon::FaviconDriver* favicon_driver,
                        NotificationIconType notification_icon_type,
                        const GURL& icon_url,
                        bool icon_url_changed,
                        const gfx::Image& image) override;

 private:
  friend class content::WebContentsUserData<TabState>;
  explicit TabState(content::WebContents* contents);

  void SendNavigation();
  void WatchKeys();
  void WatchKeysOf(content::RenderFrameHost* frame);
  void StopWatchingKeys();
  void SendMedia();

  std::string key_;
  bool closed_by_host_ = false;
  bool IsOpeningBlank(const content::NavigationEntry* entry) const;

  int64_t opening_navigation_id_ = 0;
  int opening_entry_id_ = 0;
  bool left_by_download_ = false;
  bool navigation_pending_ = false;
  int http_status_ = 0;
  std::vector<raw_ptr<content::RenderWidgetHost>> keys_widgets_;
  base::ScopedObservation<favicon::FaviconDriver,
                          favicon::FaviconDriverObserver>
      favicon_observation_{this};
  base::WeakPtrFactory<TabState> weak_factory_{this};
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}

#endif
