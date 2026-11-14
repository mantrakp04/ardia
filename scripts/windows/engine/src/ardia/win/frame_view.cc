#include "ardia/win/frame_view.h"

#include <windows.h>

#include "ui/base/metadata/metadata_impl_macros.h"

namespace ardia_win {

HostedFrameView::HostedFrameView(BrowserWidget* widget,
                                 BrowserView* browser_view)
    : BrowserFrameView(widget, browser_view) {}

HostedFrameView::~HostedFrameView() = default;

int HostedFrameView::GetTopInset(bool restored) const {
  return 0;
}

void HostedFrameView::UpdateThrobber(bool running) {}

gfx::Rect HostedFrameView::GetBoundsForClientView() const {
  return bounds();
}

gfx::Rect HostedFrameView::GetWindowBoundsForClientBounds(
    const gfx::Rect& client_bounds) const {
  return client_bounds;
}

int HostedFrameView::NonClientHitTest(const gfx::Point& point) {
  return HTCLIENT;
}

std::unique_ptr<BrowserFrameView> CreateHostedFrameView(
    BrowserWidget* widget,
    BrowserView* browser_view) {
  return std::make_unique<HostedFrameView>(widget, browser_view);
}

BEGIN_METADATA(HostedFrameView)
END_METADATA

}
