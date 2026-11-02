#include "ardia/core/ac_browser_window.h"

#include "base/functional/bind.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_manager.h"
#include "chrome/browser/ui/exclusive_access/fullscreen_controller.h"
#include "chrome/browser/ui/views/exclusive_access/exclusive_access_bubble_views.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "ardia/core/ac_browser.h"
#include "ui/base/accelerators/accelerator.h"
#include "ui/events/event_constants.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/views/widget/widget.h"

namespace ardiacore {

ExclusiveAccessContext* ACBrowserWindow::GetExclusiveAccessContext() {
  return this;
}

Profile* ACBrowserWindow::GetProfile() {
  return browser_ ? browser_->GetProfile() : nullptr;
}

void ACBrowserWindow::EnterFullscreen(const url::Origin& origin,
                                      ExclusiveAccessBubbleType bubble_type,
                                      FullscreenTabParams fullscreen_tab_params) {
  tab_fullscreen_ = true;
  base::WeakPtr<ACBrowserWindow> self = weak_factory_.GetWeakPtr();
  ReportFullscreenTab();
  if (self) {
    PostWindowFullscreenStateChanged();
  }
}

void ACBrowserWindow::ExitFullscreen() {
  tab_fullscreen_ = false;
  ReportFullscreenTab();
}

void ACBrowserWindow::PostWindowFullscreenStateChanged() {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<ACBrowserWindow> window) {
                       ExclusiveAccessManager* manager =
                           window ? window->GetExclusiveAccessManager()
                                  : nullptr;
                       if (manager && window->tab_fullscreen_) {
                         manager->fullscreen_controller()
                             ->WindowFullscreenStateChanged();
                       }
                     },
                     weak_factory_.GetWeakPtr()));
}

void ACBrowserWindow::UpdateExclusiveAccessBubble(
    const ExclusiveAccessBubbleParams& params,
    ExclusiveAccessBubbleHideCallback first_hide_callback) {
  base::WeakPtr<ACBrowserWindow> self = weak_factory_.GetWeakPtr();
  ReportFullscreenTab();
  if (!self) {
    return;
  }
  const bool can_show = host_ && host_->widget() && browser_ &&
                        GetExclusiveAccessManager();
  const bool should_close_bubble =
      !can_show ||
      (!params.has_download && params.type == EXCLUSIVE_ACCESS_BUBBLE_TYPE_NONE);
  if (should_close_bubble) {
    if (first_hide_callback) {
      std::move(first_hide_callback)
          .Run(ExclusiveAccessBubbleHideReason::kNotShown);
    }
    if (!exclusive_access_bubble_ ||
        exclusive_access_bubble_destruction_task_id_) {
      return;
    }
    exclusive_access_bubble_->HideImmediately();
    exclusive_access_bubble_destruction_task_id_ =
        exclusive_access_bubble_task_tracker_.PostTask(
            base::SingleThreadTaskRunner::GetCurrentDefault().get(), FROM_HERE,
            base::BindOnce(&ACBrowserWindow::DestroyAnyExclusiveAccessBubble,
                           weak_factory_.GetWeakPtr()));
    return;
  }
  if (exclusive_access_bubble_) {
    if (exclusive_access_bubble_destruction_task_id_) {
      exclusive_access_bubble_task_tracker_.TryCancel(
          *exclusive_access_bubble_destruction_task_id_);
      exclusive_access_bubble_destruction_task_id_.reset();
    }
    exclusive_access_bubble_->Update(params, std::move(first_hide_callback));
    return;
  }
  exclusive_access_bubble_ = std::make_unique<ExclusiveAccessBubbleViews>(
      this, params, std::move(first_hide_callback));
}

void ACBrowserWindow::OnExclusiveAccessUserInput() {
  if (exclusive_access_bubble_) {
    exclusive_access_bubble_->OnUserInput();
  }
}

ExclusiveAccessManager* ACBrowserWindow::GetExclusiveAccessManager() {
  return browser_ ? ExclusiveAccessManager::From(browser_)
                  : nullptr;
}

ui::AcceleratorProvider* ACBrowserWindow::GetAcceleratorProvider() {
  return this;
}

bool ACBrowserWindow::GetAcceleratorForCommandId(
    int command_id,
    ui::Accelerator* accelerator) const {
  if (command_id != IDC_FULLSCREEN) {
    return false;
  }
  *accelerator =
      ui::Accelerator(ui::VKEY_F, ui::EF_CONTROL_DOWN | ui::EF_COMMAND_DOWN);
  return true;
}

gfx::NativeView ACBrowserWindow::GetBubbleParentView() const {
  return host_ && host_->widget() ? host_->widget()->GetNativeView()
                                  : gfx::NativeView();
}

gfx::Rect ACBrowserWindow::GetClientAreaBoundsInScreen() const {
  return host_ && host_->widget()
             ? host_->widget()->GetClientAreaBoundsInScreen()
             : gfx::Rect();
}

bool ACBrowserWindow::IsImmersiveModeEnabled() const {
  return false;
}

gfx::Rect ACBrowserWindow::GetTopContainerBoundsInScreen() {
  return gfx::Rect();
}

void ACBrowserWindow::RepositionExclusiveAccessBubble() {
  if (exclusive_access_bubble_) {
    exclusive_access_bubble_->RepositionIfVisible();
  }
}

void ACBrowserWindow::DestroyAnyExclusiveAccessBubble() {
  exclusive_access_bubble_.reset();
  exclusive_access_bubble_destruction_task_id_.reset();
}

void ACBrowserWindow::ReportFullscreenTab() {
  ExclusiveAccessManager* manager =
      browser_ ? ExclusiveAccessManager::From(browser_) : nullptr;
  FullscreenController* controller =
      manager ? manager->fullscreen_controller() : nullptr;
  content::WebContents* now = controller && controller->IsTabFullscreen()
                                  ? controller->exclusive_access_tab()
                                  : nullptr;
  content::WebContents* was = fullscreen_tab_.get();
  if (now == was) {
    return;
  }
  fullscreen_tab_ = now ? now->GetWeakPtr() : nullptr;
  if (!host_ || !browser_) {
    return;
  }
  base::WeakPtr<content::WebContents> entering = fullscreen_tab_;
  if (was) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](base::WeakPtr<content::WebContents> left) {
                         content::RenderWidgetHostView* view =
                             left ? left->GetRenderWidgetHostView() : nullptr;
                         if (view && !left->IsFullscreen()) {
                           view->GetRenderWidgetHost()
                               ->SynchronizeVisualProperties();
                         }
                       },
                       was->GetWeakPtr()));
    host_->FullscreenChanged(was, false);
  }
  if (content::WebContents* contents = entering.get();
      contents && contents == fullscreen_tab_.get() && host_) {
    host_->FullscreenChanged(contents, true);
  }
}

bool ACBrowserWindow::IsExclusiveAccessBubbleDisplayed() const {
  return exclusive_access_bubble_ && (exclusive_access_bubble_->IsShowing() ||
                                      exclusive_access_bubble_->IsVisible());
}

content::WebContents* ACBrowserWindow::GetWebContentsForExclusiveAccess() {
  return browser_ ? browser_->GetTabStripModel()->GetActiveWebContents()
                  : nullptr;
}

bool ACBrowserWindow::CanUserEnterFullscreen() const {
  return true;
}

bool ACBrowserWindow::CanUserExitFullscreen() const {
  return true;
}

std::string ACBrowserWindow::GetWorkspace() const {
  return std::string();
}

bool ACBrowserWindow::IsVisibleOnAllWorkspaces() const {
  return false;
}

}
