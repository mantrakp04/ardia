#ifndef ARDIA_WIN_TAB_STATE_H_
#define ARDIA_WIN_TAB_STATE_H_

#include <string>
#include <string_view>

#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/values.h"
#include "components/favicon/core/favicon_driver.h"
#include "components/favicon/core/favicon_driver_observer.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "url/gurl.h"

namespace ardia_win {

class TabState : public content::WebContentsObserver,
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
  void set_opened_blank() { opened_blank_ = true; }
  bool OnlyShowedOpeningBlank() const;
  static GURL CommittedPageURL(content::WebContents* contents);

  void Send(std::string_view name, base::DictValue data);
  void NoteNavigation();

  void DidStartNavigation(content::NavigationHandle* handle) override;
  void DidFinishNavigation(content::NavigationHandle* handle) override;
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

  void OnFaviconUpdated(favicon::FaviconDriver* favicon_driver,
                        NotificationIconType notification_icon_type,
                        const GURL& icon_url,
                        bool icon_url_changed,
                        const gfx::Image& image) override;

 private:
  friend class content::WebContentsUserData<TabState>;
  explicit TabState(content::WebContents* contents);

  void SendNavigation();
  void SendMedia();

  std::string key_;
  bool closed_by_host_ = false;
  bool opened_blank_ = false;
  bool navigation_pending_ = false;
  int http_status_ = 0;
  base::ScopedObservation<favicon::FaviconDriver,
                          favicon::FaviconDriverObserver>
      favicon_observation_{this};
  base::WeakPtrFactory<TabState> weak_factory_{this};
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}

#endif
