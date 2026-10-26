#include "ardia/core/ac_browser_window.h"

#import <AppKit/AppKit.h>

#include <map>
#include <set>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/ui/unload_controller.h"
#include "chrome/browser/devtools/devtools_ui_controller.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/themes/theme_service.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window/public/browser_window_features.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_manager.h"
#include "chrome/browser/ui/exclusive_access/fullscreen_controller.h"
#include "chrome/browser/ui/find_bar/find_bar.h"
#include "chrome/browser/ui/views/exclusive_access/exclusive_access_bubble_views.h"
#include "chrome/browser/ui/views/eye_dropper/eye_dropper.h"
#include "chrome/browser/ui/views/frame/contents_container_view.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/eye_dropper.h"
#include "content/public/browser/eye_dropper_listener.h"
#import "ardia/core/ardiacore_internal.h"
#include "content/public/browser/web_contents.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_extension_shortcuts.h"
#include "ardia/core/ac_lifetime.h"
#include "ardia/core/ac_modal_dialog_host.h"
#include "ardia/core/ac_launch_switches.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/ui_base_features.h"
#include "ui/display/types/display_constants.h"
#include "ui/base/mojom/window_show_state.mojom.h"
#include "ui/color/color_provider_manager.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/native_theme/native_theme.h"
#include "ui/views/widget/widget.h"

namespace ardiacore {

namespace {

std::set<const BrowserWindow*>& LiveWindows() {
  static base::NoDestructor<std::set<const BrowserWindow*>> windows;
  return *windows;
}
std::map<const BrowserWindowInterface*, base::WeakPtr<WindowHost>>& Records() {
  static base::NoDestructor<
      std::map<const BrowserWindowInterface*, base::WeakPtr<WindowHost>>>
      records;
  return *records;
}

}

ACBrowserWindow* ACBrowserWindow::FromWindow(const BrowserWindow* window) {
  if (!window || !LiveWindows().contains(window)) {
    return nullptr;
  }
  return static_cast<ACBrowserWindow*>(const_cast<BrowserWindow*>(window));
}

void ACBrowserWindow::Register(const BrowserWindowInterface* browser) {
  Records()[browser] = host_;
}

bool ACBrowserWindow::IsOurs(const BrowserWindowInterface* browser) {
  return browser && Records().contains(browser);
}

WindowHost* ACBrowserWindow::HostOf(const BrowserWindowInterface* browser) {
  auto it = browser ? Records().find(browser) : Records().end();
  return it == Records().end() ? nullptr : it->second.get();
}

void ACBrowserWindow::Forget(const BrowserWindowInterface* browser) {
  Records().erase(browser);
}

ACBrowserWindow::ACBrowserWindow(base::WeakPtr<WindowHost> host)
    : host_(std::move(host)), location_bar_(std::make_unique<ACLocationBar>()) {
  LiveWindows().insert(this);
}

ACBrowserWindow::~ACBrowserWindow() {
  LiveWindows().erase(this);
  extension_shortcuts_.reset();
  DestroyAnyExclusiveAccessBubble();
  devtools_ui_controller_.reset();
  autofill_bubble_handler_registration_.reset();
  if (browser_) {
    browser_->GetFeatures().TearDownPreBrowserWindowDestruction();
  }
  if (host_) {
    host_->BrowserWindowDestroyed(this);
  }
}

void ACBrowserWindow::AttachBrowser(Browser* browser) {
  browser_ = browser;
  Register(browser);
  autofill_bubble_handler_registration_.emplace(
      browser->GetUnownedUserDataHost(), autofill_bubble_handler_);
  location_bar_->set_browser(browser);
  devtools_ui_controller_ = std::make_unique<DevtoolsUIController>(
      browser,
      std::vector<raw_ptr<ContentsContainerView, DanglingUntriaged>>());
  extension_shortcuts_ = std::make_unique<ExtensionShortcuts>(browser);
}

void ACBrowserWindow::DeleteBrowserWindow() {
  delete this;
}

bool ACBrowserWindow::IsActive() const {
  if (!host_ || !host_->widget()) {
    return false;
  }
  return host_->widget()->IsActive() && host_->IsActiveBrowser(browser_);
}

bool ACBrowserWindow::IsMaximized() const {
  return host_ && host_->widget() && host_->widget()->IsMaximized();
}

bool ACBrowserWindow::IsMinimized() const {
  return host_ && host_->widget() && host_->widget()->IsMinimized();
}

bool ACBrowserWindow::IsFullscreen() const {
  if (tab_fullscreen_ ||
      (host_ && (host_->acted_fullscreen() ||
                 (host_->widget() && host_->widget()->IsFullscreen())))) {
    return true;
  }
  ExclusiveAccessManager* manager =
      browser_ ? ExclusiveAccessManager::From(browser_) : nullptr;
  return manager && manager->fullscreen_controller()->IsTabFullscreen();
}

gfx::NativeWindow ACBrowserWindow::GetNativeWindow() const {
  return host_ && host_->widget() ? host_->widget()->GetNativeWindow()
                                  : gfx::NativeWindow();
}

gfx::Rect ACBrowserWindow::GetRestoredBounds() const {
  return host_ && host_->widget() ? host_->widget()->GetRestoredBounds()
                                  : gfx::Rect();
}

ui::mojom::WindowShowState ACBrowserWindow::GetRestoredState() const {
  return ui::mojom::WindowShowState::kNormal;
}

gfx::Rect ACBrowserWindow::GetBounds() const {
  return host_ && host_->widget() ? host_->widget()->GetWindowBoundsInScreen()
                                  : gfx::Rect();
}

namespace {

void RequestShow(WindowHost* host, bool active) {
  if (!host) {
    return;
  }
  ArdiaCoreWindow* owner = host->owner();
  id<ArdiaCoreWindowDelegate> delegate = owner.delegate;
  if ([delegate respondsToSelector:@selector(window:showRequestedActive:)]) {
    [delegate window:owner showRequestedActive:active];
  }
}

}

void ACBrowserWindow::Show() {
  RequestShow(host_.get(), true);
}

bool ACBrowserWindow::IsVisible() const {
  return host_ && host_->widget() && host_->widget()->IsVisible() &&
         host_->IsActiveBrowser(browser_);
}

void ACBrowserWindow::ShowInactive() {
  RequestShow(host_.get(), false);
}

void ACBrowserWindow::Close() {
  if (!browser_) {
    return;
  }
  Profile* profile = browser_->GetProfile();
  closed_by_chrome_ = host_ && !host_->closing() && !browser_shutdown::IsTryingToQuit() &&
                      !IsProfileDying(profile) && !IsProfileDeleting(profile);
  UnloadController* unload = UnloadController::From(browser_);
  if (unload) {
    if ((host_ && host_->closing()) || browser_shutdown::IsTryingToQuit()) {
      CloseBlankTabsBeforeWindowCloses(browser_);
    }
    unload->OnWindowClosing();
  }
}

void ACBrowserWindow::Activate() {
  if (host_ && browser_) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](base::WeakPtr<WindowHost> host,
                          base::WeakPtr<BrowserWindowInterface> browser) {
                         if (host && browser) {
                           host->RequestActivation(static_cast<Browser*>(browser.get()));
                         }
                       },
                       host_, browser_->GetWeakPtr()));
  }
}

void ACBrowserWindow::SetBounds(const gfx::Rect& bounds) {
  if (host_ && host_->widget()) {
    host_->widget()->SetBounds(bounds);
  }
}

ui::ZOrderLevel ACBrowserWindow::GetZOrderLevel() const {
  return ui::ZOrderLevel::kNormal;
}

bool ACBrowserWindow::IsOnCurrentWorkspace() const {
  return host_ && !host_->internal();
}

bool ACBrowserWindow::IsVisibleOnScreen() const {
  return IsVisible();
}

bool ACBrowserWindow::DoBrowserControlsShrinkRendererSize(
    const content::WebContents* contents) const {
  return false;
}

ui::NativeTheme* ACBrowserWindow::GetNativeTheme() {
  return ui::NativeTheme::GetInstanceForNativeUi();
}

const ui::ThemeProvider* ACBrowserWindow::GetThemeProvider() const {
  return browser_ ? &ThemeService::GetThemeProviderForProfile(
                        browser_->GetProfile())
                  : nullptr;
}

const ui::ColorProvider* ACBrowserWindow::GetColorProvider() const {
  if (host_ && host_->widget()) {
    return host_->widget()->GetColorProvider();
  }
  return ui::ColorProviderManager::Get().GetColorProviderFor(
      ui::ColorProviderKey());
}

int ACBrowserWindow::GetTopControlsHeight() const {
  return 0;
}

std::vector<StatusBubble*> ACBrowserWindow::GetStatusBubbles() {
  return {};
}

void ACBrowserWindow::OnActiveTabChanged(content::WebContents* old_contents,
                                         content::WebContents* new_contents,
                                         int index,
                                         int reason) {
  if (host_ && browser_) {
    host_->ActiveTabChanged(browser_, new_contents);
  }
}

gfx::Size ACBrowserWindow::GetContentsSize() const {
  if (!host_ || !host_->host_view()) {
    return gfx::Size();
  }
  NSSize size = host_->host_view().bounds.size;
  return gfx::Size(size.width, size.height);
}

autofill::AutofillBubbleHandler* ACBrowserWindow::GetAutofillBubbleHandler() {
  return &autofill_bubble_handler_;
}

LocationBar* ACBrowserWindow::GetLocationBar() const {
  return location_bar_.get();
}

bool ACBrowserWindow::UpdateToolbarSecurityState() {
  return false;
}

bool ACBrowserWindow::IsTabStripEditable() const {
  return true;
}

bool ACBrowserWindow::IsToolbarVisible() const {
  return false;
}

bool ACBrowserWindow::IsToolbarShowing() const {
  return false;
}

bool ACBrowserWindow::IsLocationBarVisible() const {
  return false;
}

ShowTranslateBubbleResult ACBrowserWindow::ShowTranslateBubble(
    content::WebContents* contents,
    translate::TranslateStep step,
    const std::string& source_language,
    const std::string& target_language,
    translate::TranslateErrors error_type,
    bool is_user_gesture) {
  return ShowTranslateBubbleResult::kBrowserWindowNotValid;
}

DownloadBubbleUIController* ACBrowserWindow::GetDownloadBubbleUIController() {
  return nullptr;
}

void ACBrowserWindow::ConfirmBrowserCloseWithPendingDownloads(
    int download_count,
    DownloadCloseType dialog_type,
    base::OnceCallback<void(bool)> callback) {
  if (host_ && !host_->closing() && !IsQuitting()) {
    host_->ConfirmCloseWithDownloads(download_count, std::move(callback));
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(std::move(callback), true));
}

std::unique_ptr<FindBar> ACBrowserWindow::CreateFindBar() {
  return std::make_unique<ACFindBar>();
}

web_modal::WebContentsModalDialogHost*
ACBrowserWindow::GetWebContentsModalDialogHost() {
  return host_.get();
}

web_modal::WebContentsModalDialogHost*
ACBrowserWindow::GetWebContentsModalDialogHostFor(
    content::WebContents* web_contents) {
  if (web_contents && tabs::TabInterface::MaybeGetFromContents(web_contents)) {
    return ACTabDialogHost::GetOrCreateForWebContents(web_contents);
  }
  return host_.get();
}

void ACBrowserWindow::ShowEmojiPanel() {
  base::WeakPtr<ACBrowserWindow> self = weak_factory_.GetWeakPtr();
  if (content::WebContents* contents =
          browser_ ? browser_->GetTabStripModel()->GetActiveWebContents()
                   : nullptr) {
    if (!contents->ForSecurityDropFullscreen(display::kInvalidDisplayId) ||
        !self) {
      return;
    }
  }
  if (host_ && host_->widget()) {
    host_->widget()->ShowEmojiPanel();
    return;
  }
  [NSApp orderFrontCharacterPalette:nil];
}

namespace {

class BackgroundEyeDropper : public content::EyeDropper {
 public:
  explicit BackgroundEyeDropper(content::EyeDropperListener* listener)
      : listener_(listener) {
    LOG(WARNING) << "[ardiacore] eye dropper (background run: picks #123456)";
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&BackgroundEyeDropper::Pick,
                                  weak_factory_.GetWeakPtr()));
  }

 private:
  void Pick() { listener_->ColorSelected(SkColorSetRGB(0x12, 0x34, 0x56)); }

  raw_ptr<content::EyeDropperListener> listener_;
  base::WeakPtrFactory<BackgroundEyeDropper> weak_factory_{this};
};

}

std::unique_ptr<content::EyeDropper> ACBrowserWindow::OpenEyeDropper(
    content::RenderFrameHost* frame,
    content::EyeDropperListener* listener) {
  if (BackgroundInstance() && listener) {
    return features::IsEyeDropperEnabled()
               ? std::make_unique<BackgroundEyeDropper>(listener)
               : nullptr;
  }
  return ShowEyeDropper(frame, listener);
}

bool ACBrowserWindow::IsUnframedModeEnabled() const {
  return false;
}

bool ACBrowserWindow::GetCanResize() {
  return true;
}

ui::mojom::WindowShowState ACBrowserWindow::GetWindowShowState() const {
  if (IsMinimized()) {
    return ui::mojom::WindowShowState::kMinimized;
  }
  if (IsFullscreen()) {
    return ui::mojom::WindowShowState::kFullscreen;
  }
  return ui::mojom::WindowShowState::kNormal;
}

BrowserView* ACBrowserWindow::AsBrowserView() {
  return nullptr;
}

}
