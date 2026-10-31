#include "ardia/linux/ac_linux_window_caption.h"

#include "ui/aura/client/aura_constants.h"
#include "ui/aura/client/screen_position_client.h"
#include "ui/aura/env.h"
#include "ui/aura/window.h"
#include "ui/aura/window_tree_host.h"
#include "ui/base/hit_test.h"
#include "ui/display/screen.h"
#include "ui/linux/linux_ui.h"
#include "ui/ozone/public/ozone_platform.h"
#include "ui/platform_window/wm/wm_move_resize_handler.h"
#include "ui/views/widget/desktop_aura/desktop_window_tree_host_platform.h"
#include "ui/views/widget/widget.h"

namespace ardia::linux_window {

namespace {

views::DesktopWindowTreeHostPlatform* DesktopHost(views::Widget* widget) {
  aura::Window* window = widget ? widget->GetNativeWindow() : nullptr;
  aura::WindowTreeHost* host = window ? window->GetHost() : nullptr;
  return host ? views::DesktopWindowTreeHostPlatform::GetHostForWidget(host->GetAcceleratedWidget())
              : nullptr;
}

}

bool StartCaptionMove(views::Widget* widget) {
  views::DesktopWindowTreeHostPlatform* desktop = DesktopHost(widget);
  if (!desktop || widget->IsFullscreen() || !aura::Env::GetInstance()->IsMouseButtonDown()) return false;
  ui::PlatformWindow* platform = desktop->platform_window();
  ui::WmMoveResizeHandler* handler = platform ? ui::GetWmMoveResizeHandler(*platform) : nullptr;
  if (!handler) return false;
  aura::Window* root = desktop->window();
  gfx::Point location = aura::Env::GetInstance()->last_mouse_location();
  if (auto* screen = aura::client::GetScreenPositionClient(root)) screen->ConvertPointFromScreen(root, &location);
  desktop->ConvertDIPToScreenInPixels(&location);
  handler->DispatchHostWindowDragMovement(HTCAPTION, location);
  return true;
}

bool CaptionDoubleClick(views::Widget* widget) {
  views::DesktopWindowTreeHostPlatform* desktop = DesktopHost(widget);
  if (!desktop) return false;
  auto* linux_ui = ui::LinuxUi::instance();
  const auto action = linux_ui
      ? linux_ui->GetWindowFrameAction(ui::LinuxUi::WindowFrameActionSource::kDoubleClick)
      : ui::LinuxUi::WindowFrameAction::kToggleMaximize;
  switch (action) {
    case ui::LinuxUi::WindowFrameAction::kNone:
      return true;
    case ui::LinuxUi::WindowFrameAction::kLower:
      desktop->LowerWindow();
      return true;
    case ui::LinuxUi::WindowFrameAction::kMinimize:
      widget->Minimize();
      return true;
    case ui::LinuxUi::WindowFrameAction::kToggleMaximize:
      if (!(widget->GetNativeWindow()->GetProperty(aura::client::kResizeBehaviorKey) &
            aura::client::kResizeBehaviorCanMaximize)) return false;
      if (widget->IsMaximized()) {
        widget->Restore();
      } else {
        widget->Maximize();
      }
      return true;
    case ui::LinuxUi::WindowFrameAction::kMenu:
      if (!ui::OzonePlatform::GetInstance()->GetPlatformRuntimeProperties().supports_server_window_menus) return false;
      desktop->ShowWindowControlsMenu(display::Screen::Get()->GetCursorScreenPoint());
      return true;
  }
  return false;
}

}
