#include "ardia/core/ac_browser.h"

#import <AppKit/AppKit.h>

#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_active_state_manager/browser_active_state_manager.h"
#include "chrome/browser/ui/browser_window/public/create_browser_window.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/interaction/browser_elements_views_impl.h"
#import "components/remote_cocoa/app_shim/bridged_content_view.h"
#include "content/public/browser/web_contents.h"
#include "ardia/core/ac_browser_internal.h"
#include "ardia/core/ac_browser_window.h"
#include "ardia/core/ac_extension_shortcuts.h"
#include "ardia/core/ac_modal_dialog_host.h"
#include "ardia/core/ac_video_upscaling.h"
#import "ardia/core/ardiacore_internal.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_delegate.h"
#include "ui/views/window/client_view.h"

namespace ardiacore {

std::vector<WindowHost*>& Hosts() {
  static base::NoDestructor<std::vector<WindowHost*>> hosts;
  return *hosts;
}

namespace {

class HostClientView : public views::ClientView {
 public:
  HostClientView(views::Widget* widget,
                 views::View* contents,
                 base::WeakPtr<WindowHost> host)
      : views::ClientView(widget, contents), host_(std::move(host)) {}

  views::CloseRequestResult OnWindowCloseRequested() override {
    if (!host_ || host_->CanCloseWidget()) {
      return views::CloseRequestResult::kCanClose;
    }
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&WindowHost::CloseRequestedByUser, host_));
    return views::CloseRequestResult::kCannotClose;
  }

 private:
  base::WeakPtr<WindowHost> host_;
};

}

const std::vector<WindowHost*>& WindowHost::All() {
  return Hosts();
}

WindowHost* WindowHost::ForNSWindow(NSWindow* window) {
  for (WindowHost* host : Hosts()) {
    if (window && host->ns_window() == window) {
      return host;
    }
  }
  return nullptr;
}

WindowHost* WindowHost::ForBrowser(const BrowserWindowInterface* browser) {
  return ACBrowserWindow::HostOf(browser);
}

WindowHost* WindowHost::ForContents(content::WebContents* contents) {
  return contents ? ForBrowser(GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(
                        contents))
                  : nullptr;
}

WindowHost::WindowHost(ArdiaCoreWindow* owner, const gfx::Rect& bounds)
    : owner_(owner), owner_ref_(owner) {
  Hosts().push_back(this);
  widget_delegate_ = std::make_unique<views::WidgetDelegate>();
  widget_delegate_->SetCanResize(true);
  widget_delegate_->SetCanMaximize(true);
  widget_delegate_->SetCanMinimize(true);
  widget_delegate_->SetTitle(u"Ardia");
  widget_delegate_->SetClientViewFactory(base::BindOnce(
      [](base::WeakPtr<WindowHost> host, views::Widget* widget,
         views::View* contents) -> std::unique_ptr<views::ClientView> {
        return std::make_unique<HostClientView>(widget, contents, host);
      },
      GetWeakPtr()));

  widget_ = std::make_unique<views::Widget>();
  views::Widget::InitParams params(
      views::Widget::InitParams::CLIENT_OWNS_WIDGET,
      views::Widget::InitParams::TYPE_WINDOW);
  params.delegate = widget_delegate_.get();
  params.bounds = bounds;
  params.name = "ArdiaCoreWindow";
  widget_->Init(std::move(params));
  widget_->AddObserver(this);

  NSWindow* window = ns_window();
  NSView* content = window.contentView;
  host_view_ = [[NSView alloc] initWithFrame:content.bounds];
  host_view_.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [content addSubview:host_view_];
  if ([content isKindOfClass:[BridgedContentView class]]) {
    static_cast<BridgedContentView*>(content).ardiaEmbeddedView =
        host_view_;
  }
  InstallExtensionShortcutDispatcher(window);
}

WindowHost::~WindowHost() {
  std::erase(Hosts(), this);
  for (auto& observer : modal_observers_) {
    observer.OnHostDestroying();
  }
  for ([[maybe_unused]] auto& observer : modal_observers_) {
    DialogHostObserverRemoved();
  }
  for (auto& [profile, browser] : browsers_) {
    browser->GetTabStripModel()->RemoveObserver(this);
    if (auto* elements = BrowserElementsViews::From(browser)) {
      elements->TearDown();
    }
  }
  browsers_.clear();
  widget_close_allowed_ = true;
  if (widget_) {
    widget_->RemoveObserver(this);
  }
  widget_.reset();
}

namespace {

void ActivateExclusively(Browser* browser) {
  if (browser->IsDeleteScheduled()) {
    return;
  }
  for (WindowHost* host : WindowHost::All()) {
    for (Browser* other : host->browsers()) {
      if (other != browser) {
        BrowserActiveStateManager::From(other)->DidBecomeInactive();
      }
    }
  }
  BrowserActiveStateManager* state = BrowserActiveStateManager::From(browser);
  if (GlobalBrowserCollection::GetInstance()->GetLastActiveBrowser() != browser ||
      ProfileManager::GetLastUsedProfileIfLoaded() != browser->GetProfile()) {
    state->DidBecomeInactive();
  }
  state->DidBecomeActive();
}

base::WeakPtr<WindowHost>& LastUsersWindow() {
  static base::NoDestructor<base::WeakPtr<WindowHost>> host;
  return *host;
}

}

bool WindowHost::IsUsersWindow() {
  if (internal_ || !widget_) {
    return false;
  }
  if (widget_->IsActive()) {
    return true;
  }
  for (WindowHost* host : Hosts()) {
    if (host->widget() && host->widget()->IsActive()) {
      return false;
    }
  }
  if (!LastUsersWindow()) {
    LastUsersWindow() = GetWeakPtr();
  }
  return LastUsersWindow().get() == this;
}

void WindowHost::NoteHostActivated(Browser* browser) {
  if (!IsActiveBrowser(browser) || !IsUsersWindow()) {
    return;
  }
  if (GlobalBrowserCollection::GetInstance()->GetLastActiveBrowser() == browser &&
      ProfileManager::GetLastUsedProfileIfLoaded() == browser->GetProfile()) {
    return;
  }
  ActivateExclusively(browser);
}

void WindowHost::RequestActivation(Browser* browser) {
  if (internal_ || !widget_ || !widget_->IsVisible() ||
      ExistingBrowserFor(browser->GetProfile()) != browser) {
    return;
  }
  if (!NSApp.isActive) {
    return;
  }
  if (IsActiveBrowser(browser)) {
    [ns_window() makeKeyAndOrderFront:nil];
    return;
  }
  content::WebContents* contents = browser->GetTabStripModel()->GetActiveWebContents();
  ArdiaCoreTab* tab = contents ? TabBridge::GetOrCreate(contents)->tab() : nil;
  id<ArdiaCoreTabDelegate> delegate = tab.delegate;
  if ([delegate respondsToSelector:@selector(tab:requestsActivation:)]) {
    [delegate tab:tab requestsActivation:@"window"];
  }
}

void WindowHost::OnWidgetActivationChanged(views::Widget* widget, bool active) {
  if (active && !internal_) {
    LastUsersWindow() = GetWeakPtr();
  }
  Browser* browser = !internal_ && active_profile_ ? ExistingBrowserFor(active_profile_) : nullptr;
  if (!browser) {
    return;
  }
  if (active) {
    ActivateExclusively(browser);
  } else {
    BrowserActiveStateManager::From(browser)->DidBecomeInactive();
  }
}

NSWindow* WindowHost::ns_window() const {
  return widget_ ? widget_->GetNativeWindow().GetNativeNSWindow() : nil;
}

Browser* WindowHost::ExistingBrowserFor(Profile* profile) const {
  auto it = browsers_.find(profile);
  return it == browsers_.end() ? nullptr : it->second.get();
}

std::vector<Browser*> WindowHost::browsers() const {
  std::vector<Browser*> list;
  for (const auto& [profile, browser] : browsers_) {
    list.push_back(browser.get());
  }
  return list;
}

Browser* WindowHost::BrowserFor(Profile* profile) {
  if (!profile || IsProfileDying(profile)) {
    return nullptr;
  }
  if (Browser* browser = ExistingBrowserFor(profile)) {
    return browser;
  }
  if (IsProfileDeleting(profile)) {
    return nullptr;
  }
  if (close_state_ != CloseState::kOpen || !widget_ || widget_close_allowed_ ||
      browser_shutdown::IsTryingToQuit() ||
      GetBrowserWindowCreationStatusForProfile(*profile) !=
          BrowserWindowInterface::CreationStatus::kOk) {
    return nullptr;
  }
  auto* window = new ACBrowserWindow(GetWeakPtr());
  BrowserWindowCreateParams params(BrowserWindowInterface::TYPE_NORMAL,
                                   *profile, true);
  params.window = window;
  params.omit_from_session_restore = true;
  params.should_trigger_session_restore = false;
  Browser* browser = static_cast<Browser*>(CreateBrowserWindow(std::move(params)));
  window->AttachBrowser(browser);
  AddBrowser(browser);
  return browser;
}

BrowserWindow* WindowHost::HostChromeBrowser(Browser* browser) {
  Profile* profile = browser->GetProfile();
  if (ACBrowserWindow::IsOurs(browser) || close_state_ != CloseState::kOpen ||
      widget_close_allowed_ || ExistingBrowserFor(profile)) {
    return nullptr;
  }
  auto* window = new ACBrowserWindow(GetWeakPtr());
  window->AttachBrowser(browser);
  AddBrowser(browser);
  return window;
}

void WindowHost::AddBrowser(Browser* browser) {
  Profile* profile = browser->GetProfile();
  browsers_[profile] = browser;
  if (auto* elements = BrowserElements::From(browser)) {
    if (auto* views_elements = elements->AsA<BrowserElementsViewsImpl>()) {
      views_elements->Init(widget_->GetRootView());
    }
  }
  browser->GetTabStripModel()->AddObserver(this);
  if (!active_profile_) {
    SetActiveProfile(profile);
  }
}

void WindowHost::SetActiveProfile(Profile* profile) {
  if (active_profile_ == profile) {
    return;
  }
  Browser* old_browser =
      active_profile_ ? ExistingBrowserFor(active_profile_) : nullptr;
  active_profile_ = profile;
  VideoUpscalingInputsChanged();
  if (old_browser) {
    BrowserActiveStateManager::From(old_browser)->DidBecomeInactive();
  }
  if (Browser* browser = ExistingBrowserFor(profile)) {
    NoteHostActivated(browser);
  }
}

bool WindowHost::IsActiveBrowser(const Browser* browser) const {
  return browser && active_profile_ &&
         ExistingBrowserFor(active_profile_) == browser;
}

void WindowHost::ShowInactive() {
  if (widget_ && !widget_close_allowed_ && !widget_->IsVisible()) {
    widget_->ShowInactive();
  }
}

}
