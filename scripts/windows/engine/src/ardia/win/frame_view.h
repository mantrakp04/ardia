#ifndef ARDIA_WIN_FRAME_VIEW_H_
#define ARDIA_WIN_FRAME_VIEW_H_

#include <memory>

#include "chrome/browser/ui/views/frame/browser_frame_view.h"
#include "ui/base/metadata/metadata_header_macros.h"

namespace ardia_win {

class HostedFrameView : public BrowserFrameView {
  METADATA_HEADER(HostedFrameView, BrowserFrameView)

 public:
  HostedFrameView(BrowserWidget* widget, BrowserView* browser_view);
  HostedFrameView(const HostedFrameView&) = delete;
  HostedFrameView& operator=(const HostedFrameView&) = delete;
  ~HostedFrameView() override;

  int GetTopInset(bool restored) const override;
  void UpdateThrobber(bool running) override;
  gfx::Rect GetBoundsForClientView() const override;
  gfx::Rect GetWindowBoundsForClientBounds(
      const gfx::Rect& client_bounds) const override;
  int NonClientHitTest(const gfx::Point& point) override;
};

std::unique_ptr<BrowserFrameView> CreateHostedFrameView(
    BrowserWidget* widget,
    BrowserView* browser_view);

}

#endif
