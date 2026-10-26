#ifndef ARDIA_CORE_AC_BROWSER_H_
#define ARDIA_CORE_AC_BROWSER_H_

#include <map>
#include <memory>
#include <optional>
#include <utility>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/observer_list.h"
#include "chrome/browser/ui/browser_web_contents_delegate/browser_web_contents_delegate.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/favicon/core/favicon_driver_observer.h"
#include "components/find_in_page/find_result_observer.h"
#include "components/zoom/zoom_controller.h"
#include "components/blocked_content/popup_blocker_tab_helper.h"
#include "components/blocked_content/url_list_manager.h"
#include "base/auto_reset.h"
#include "base/time/time.h"
#include "components/zoom/zoom_observer.h"
#include "components/web_modal/web_contents_modal_dialog_host.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_install_prompt_client.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "ui/views/widget/widget_observer.h"
#include "ui/base/window_open_disposition.h"
#include "ui/gfx/geometry/rect.h"
#include "url/gurl.h"

@class ArdiaCoreTab;
@class NSDictionary;
@class NSString;
@class ArdiaCoreWindow;
@class NSView;
@class NSWindow;

class Browser;
class BrowserWindow;
class Profile;

namespace extensions {
class InstallPromptData;
}

namespace views {
class Widget;
class WidgetDelegate;
}

namespace ardiacore {

class ACBrowserWindow;

const char* DispositionName(WindowOpenDisposition disposition);

class WindowHost : public TabStripModelObserver,
                   public views::WidgetObserver,
                   public web_modal::WebContentsModalDialogHost {
 public:
  WindowHost(ArdiaCoreWindow* owner, const gfx::Rect& bounds);
  WindowHost(const WindowHost&) = delete;
  WindowHost& operator=(const WindowHost&) = delete;
  ~WindowHost() override;

  NSWindow* ns_window() const;
  NSView* host_view() const { return host_view_; }
  views::Widget* widget() const { return widget_.get(); }
  ArdiaCoreWindow* owner() const { return owner_; }

  static const std::vector<WindowHost*>& All();
  static WindowHost* ForNSWindow(NSWindow* window);
  static WindowHost* ForBrowser(const BrowserWindowInterface* browser);

  Browser* BrowserFor(Profile* profile);
  Browser* ExistingBrowserFor(Profile* profile) const;
  std::vector<Browser*> browsers() const;
  void SetActiveProfile(Profile* profile);
  Profile* active_profile() const { return active_profile_; }
  void NoteHostActivated(Browser* browser);
  bool IsUsersWindow();
  void RequestActivation(Browser* browser);
  void OnWidgetActivationChanged(views::Widget* widget, bool active) override;
  bool IsActiveBrowser(const Browser* browser) const;
  void set_internal(bool internal) { internal_ = internal; }
  bool internal() const { return internal_; }
  bool closing() const { return close_state_ == CloseState::kClosing; }
  void Close();
  void CloseRequestedByUser();
  bool CanCloseWidget() const { return widget_close_allowed_; }
  void ShowInactive();

  void ConfirmCloseWithDownloads(int count, base::OnceCallback<void(bool)> callback);
  void NotifyCloseCancelled();
  void QuitCancelled();

  struct PendingOpen {
    std::optional<WindowOpenDisposition> disposition;
    base::WeakPtr<content::WebContents> source;
  };
  PendingOpen& pending_open() { return pending_open_; }

  BrowserWindow* HostChromeBrowser(Browser* browser);

  void AddBrowser(Browser* browser);
  void BrowserWindowDestroyed(ACBrowserWindow* window);
  void ActiveTabChanged(Browser* browser, content::WebContents* contents);
  void DevToolsDockChanged(content::WebContents* inspected,
                           content::WebContents* devtools);
  bool OfferPasswordSave(content::WebContents* contents);
  void FullscreenChanged(content::WebContents* contents, bool fullscreen);
  bool acted_fullscreen() const { return acted_fullscreen_; }
  void set_acted_fullscreen(bool acted) { acted_fullscreen_ = acted; }

  base::WeakPtr<WindowHost> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }

  void OnTabStripModelChanged(TabStripModel* tab_strip_model,
                              const TabStripModelChange& change,
                              const TabStripSelectionChange& selection) override;

  gfx::NativeView GetHostView() const override;
  gfx::Point GetDialogPosition(const gfx::Size& size) override;
  bool ShouldActivateDialog() const override;
  gfx::Size GetMaximumDialogSize() override;
  void AddObserver(web_modal::ModalDialogHostObserver* observer) override;
  void RemoveObserver(web_modal::ModalDialogHostObserver* observer) override;
  void NotifyPositionRequiresUpdate() override;
  void ScheduleDialogPositionUpdate();
  void OnWidgetBoundsChanged(views::Widget* widget,
                             const gfx::Rect& new_bounds) override;

 private:
  enum class CloseState { kOpen, kAsking, kClosing };
  void ContinueClose();
  void ContinueCloseAttempt(int attempt);
  void OnBeforeUnloadAnswered(bool proceed);
  void CancelClose();
  void CommitClose();
  void CloseWidget();
  int DownloadsCancelledByClose() const;

  __weak ArdiaCoreWindow* owner_;
  ArdiaCoreWindow* __strong owner_ref_;
  std::unique_ptr<views::WidgetDelegate> widget_delegate_;
  std::unique_ptr<views::Widget> widget_;
  NSView* __strong host_view_;
  std::map<Profile*, raw_ptr<Browser>> browsers_;
  raw_ptr<Profile> active_profile_ = nullptr;
  CloseState close_state_ = CloseState::kOpen;
  raw_ptr<Browser> asking_ = nullptr;
  int close_attempt_ = 0;
  bool widget_close_allowed_ = false;
  bool internal_ = false;
  bool acted_fullscreen_ = false;
  PendingOpen pending_open_;
  base::ObserverList<web_modal::ModalDialogHostObserver> modal_observers_;
  bool dialog_position_update_scheduled_ = false;
  base::WeakPtrFactory<WindowHost> weak_factory_{this};
};

bool IsNotifyingTabStrip();
bool IsNotifyingNavigation();
void InitialMainDocumentAccessed(content::WebContents* contents);

bool OnlyShowedBlank(content::WebContents* contents);
void CloseBlankTabsBeforeWindowCloses(Browser* browser);
void DeleteTabClosedByHost(content::WebContents* contents);

bool HostExtensionSidePanel(content::WebContents* contents,
                            const std::string& extension_id,
                            bool open);

bool HostExtensionActionPopup(content::WebContents* contents,
                              const std::string& extension_id);

bool HostExtensionActionShortcut(content::WebContents* contents,
                                 const std::string& extension_id);

bool HostReservesKey(NSString* key, NSString* unshifted_key, unsigned long modifiers);

bool HostExtensionInstallPrompt(
    Profile* profile,
    content::WebContents* parent,
    const extensions::InstallPromptData& prompt,
    extensions::ExtensionInstallPromptClient::DoneCallback* done_callback);
void ResolveExtensionInstallPrompt(const std::string& request_id, bool accepted);

void InstallRuleMatchedHook();

void StartMediaCaptureObserver();

void ConfirmQuitWithDownloads(int count, base::OnceCallback<void(bool)> callback);
void NotifyWindowsQuitCancelled();

class ACWebContentsDelegate : public BrowserWebContentsDelegate {
 public:
  ACWebContentsDelegate(BrowserWindowInterface* browser,
                        ExclusiveAccessManager& exclusive_access_manager,
                        chrome::BrowserCommandController& command_controller,
                        UnloadController& unload_controller,
                        web_app::AppBrowserController* app_browser_controller,
                        BrowserWindow& window,
                        DesktopBrowserWindowCapabilities& capabilities,
                        BrowserUiController& browser_ui_controller,
                        base::WeakPtr<WindowHost> host);
  ~ACWebContentsDelegate() override;

  content::WebContents* OpenURLFromTab(
      content::WebContents* source,
      const content::OpenURLParams& params,
      base::OnceCallback<void(content::NavigationHandle&)>
          navigation_handle_callback) override;
  void UpdateTargetURL(content::WebContents* source, const GURL& url) override;
  void RequestMediaAccessPermission(content::WebContents* web_contents,
                                    const content::MediaStreamRequest& request,
                                    content::MediaResponseCallback callback) override;
  void ActivateContents(content::WebContents* contents) override;
  void RendererUnresponsive(content::WebContents* source,
                            content::RenderWidgetHost* render_widget_host,
                            base::RepeatingClosure hang_monitor_restarter) override;
  void RendererResponsive(content::WebContents* source,
                          content::RenderWidgetHost* render_widget_host) override;
  void CloseContents(content::WebContents* source) override;
  content::WebContents* AddNewContents(
      content::WebContents* source,
      std::unique_ptr<content::WebContents> new_contents,
      const GURL& target_url,
      WindowOpenDisposition disposition,
      const blink::mojom::WindowFeatures& window_features,
      bool user_gesture,
      bool* was_blocked) override;

 private:
  base::WeakPtr<WindowHost> host_;
  raw_ptr<const BrowserWindowInterface> ours_;
};

class TabBridge : public content::WebContentsObserver,
                  public zoom::ZoomObserver,
                  public blocked_content::UrlListManager::Observer,
                  public favicon::FaviconDriverObserver,
                  public find_in_page::FindResultObserver,
                  public content::WebContentsUserData<TabBridge> {
 public:
  ~TabBridge() override;

  static TabBridge* GetOrCreate(content::WebContents* contents);
  ArdiaCoreTab* tab() const { return tab_; }
  void set_open(WindowOpenDisposition d, content::WebContents* source) {
    open_disposition_ = d;
    open_source_ = source ? source->GetWeakPtr() : nullptr;
  }
  std::optional<WindowOpenDisposition> TakeOpenDisposition();
  content::WebContents* open_source() const { return open_source_.get(); }
  void set_popup_features(NSDictionary* features) { popup_features_ = features; }
  NSDictionary* popup_features() const { return popup_features_; }
  void EnsureFaviconObserved();
  void EnsureFindObserved();
  void EnsureZoomObserved();
  void EnsurePopupsObserved();
  [[nodiscard]] base::AutoReset<bool> HostFocuses() {
    return base::AutoReset<bool>(&host_focusing_, true);
  }

  void SetUnresponsive(content::RenderWidgetHost* host, base::RepeatingClosure restarter);
  void SetResponsive(content::RenderWidgetHost* host);
  void ResolveUnresponsive(bool terminate);
  bool frozen() const { return frozen_; }
  void set_frozen(bool frozen) { frozen_ = frozen; }
  void MediaAccessChanged();

  void BlockedUrlAdded(int32_t popup_id, const GURL& url) override;
  float pinch_scale() const { return pinch_scale_; }

  void NoteRuleMatched(bool block, const GURL& url);

  void set_closed_by_host() { closed_by_host_ = true; }
  void CloseAfterUnloadHandlers(bool window_closing);
  void StartUnload();
  void EnforceCloseDeadline(bool unload_given);
  bool closing_after_unload() const { return closing_after_unload_; }
  void SetTemporary(bool temporary);
  void SetTemporarySource(int32_t source_id);
  bool temporary() const { return temporary_id_ != 0; }
  void set_made_ahead() { made_ahead_ = true; }
  bool made_ahead() const { return made_ahead_; }
  void ReportWillClose();
  const GURL& favicon_url() const { return favicon_url_; }

  void PrimaryMainFrameRenderProcessGone(base::TerminationStatus status) override;
  void DidChangeVisibleSecurityState() override;
  void WasDiscarded() override;
  void DidStartNavigation(content::NavigationHandle* handle) override;
  void ResourceLoadComplete(
      content::RenderFrameHost* render_frame_host,
      const content::GlobalRequestID& request_id,
      const GURL& original_url,
      const blink::mojom::ResourceLoadInfo& resource_load_info) override;
  void OnPageScaleFactorChanged(float page_scale_factor) override;
  void OnVisibilityChanged(content::Visibility visibility) override;

  void OnZoomChanged(const zoom::ZoomController::ZoomChangedEventData& data) override;
  void OnZoomControllerDestroyed(zoom::ZoomController* zoom_controller) override;

  void CheckSecurity();
  void BeforeUnloadFired(bool proceed) override;
  void DidChangeThemeColor() override;
  void OnWebContentsFocused(content::RenderWidgetHost* render_widget_host) override;
  void OnAudioStateChanged(bool audible) override;
  void DidUpdateAudioMutingState(bool muted) override;
  void TitleWasSet(content::NavigationEntry* entry) override;
  void DidStartLoading() override;
  void DidStopLoading() override;
  void LoadProgressChanged(double progress) override;
  void DidFinishNavigation(content::NavigationHandle* handle) override;
  void NavigationEntryCommitted(
      const content::LoadCommittedDetails& load_details) override;
  void NavigationListPruned(
      const content::PrunedDetails& pruned_details) override;
  void NavigationEntriesDeleted() override;
  void WebContentsDestroyed() override;

  void OnFindResultAvailable(content::WebContents* web_contents) override;
  void OnFindTabHelperDestroyed(find_in_page::FindTabHelper* helper) override;

  void OnFaviconUpdated(favicon::FaviconDriver* favicon_driver,
                        NotificationIconType notification_icon_type,
                        const GURL& icon_url,
                        bool icon_url_changed,
                        const gfx::Image& image) override;

 private:
  friend class content::WebContentsUserData<TabBridge>;
  explicit TabBridge(content::WebContents* contents);

  ArdiaCoreTab* __strong tab_;
  GURL favicon_url_;
  NSDictionary* __strong security_;
  raw_ptr<zoom::ZoomController> zoom_ = nullptr;
  raw_ptr<blocked_content::PopupBlockerTabHelper> popups_ = nullptr;
  bool host_focusing_ = false;
  bool discarded_ = false;
  bool frozen_ = false;
  NSDictionary* __strong media_access_;
  std::optional<std::pair<int, int>> unresponsive_;
  base::RepeatingClosure hang_monitor_restarter_;
  base::WeakPtrFactory<TabBridge> weak_factory_{this};
  float pinch_scale_ = 1;
  bool closed_by_host_ = false;
  bool closing_after_unload_ = false;
  bool unload_started_ = false;
  int32_t temporary_id_ = 0;
  int32_t temporary_source_id_ = 0;
  bool made_ahead_ = false;
  void NoteBlocked(const GURL& url);
  void ReportBlocked();
  void NoteBlockedByClient(const GURL& blocked_url, const GURL& url);
  std::vector<GURL> rule_blocked_urls_;
  int blocked_pending_ = 0;
  GURL blocked_last_url_;
  bool will_close_reported_ = false;
  std::optional<WindowOpenDisposition> open_disposition_;
  base::WeakPtr<content::WebContents> open_source_;
  NSDictionary* __strong popup_features_ = nil;
  bool observing_favicon_ = false;
  raw_ptr<find_in_page::FindTabHelper> find_helper_ = nullptr;
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

bool IsTemporaryTabId(int32_t session_id, int32_t* source_id);

}

#endif
