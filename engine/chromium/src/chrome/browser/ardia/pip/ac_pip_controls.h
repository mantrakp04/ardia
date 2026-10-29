// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_PIP_AC_PIP_CONTROLS_H_
#define CHROME_BROWSER_ARDIA_PIP_AC_PIP_CONTROLS_H_

#include <optional>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/timer/timer.h"
#include "chrome/browser/ui/views/overlay/back_to_tab_button.h"
#include "chrome/browser/ui/views/overlay/close_image_button.h"
#include "chrome/browser/ui/views/overlay/overlay_controls_fade_animation.h"
#include "chrome/browser/ui/views/overlay/playback_image_button.h"
#include "services/media_session/public/cpp/media_position.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/view.h"

namespace gfx {
class Canvas;
}

inline constexpr int kArdiaPipButtonMargin = 12;
inline constexpr int kArdiaPipButtonSize = 28;

void SetArdiaPipButtonDrawnNatively(views::View* button, bool natively);

class ArdiaBackToTabButton : public OverlayWindowBackToTabButton {
  METADATA_HEADER(ArdiaBackToTabButton, OverlayWindowBackToTabButton)

 public:
  explicit ArdiaBackToTabButton(PressedCallback callback);
  ArdiaBackToTabButton(const ArdiaBackToTabButton&) = delete;
  ArdiaBackToTabButton& operator=(const ArdiaBackToTabButton&) = delete;
  ~ArdiaBackToTabButton() override;

  void Place(const gfx::Size& window_size);

 protected:
  void OnPaintBackground(gfx::Canvas* canvas) override;
  void PaintButtonContents(gfx::Canvas* canvas) override;
};

class ArdiaCloseButton : public CloseImageButton {
  METADATA_HEADER(ArdiaCloseButton, CloseImageButton)

 public:
  static constexpr int kWidth = 29;

  explicit ArdiaCloseButton(PressedCallback callback);
  ArdiaCloseButton(const ArdiaCloseButton&) = delete;
  ArdiaCloseButton& operator=(const ArdiaCloseButton&) = delete;
  ~ArdiaCloseButton() override;

  void Place(const gfx::Size& window_size);

 protected:
  void OnPaintBackground(gfx::Canvas* canvas) override;
  void PaintButtonContents(gfx::Canvas* canvas) override;
};

class ArdiaPlaybackButton : public PlaybackImageButton {
  METADATA_HEADER(ArdiaPlaybackButton, PlaybackImageButton)

 public:
  explicit ArdiaPlaybackButton(PressedCallback callback);
  ArdiaPlaybackButton(const ArdiaPlaybackButton&) = delete;
  ArdiaPlaybackButton& operator=(const ArdiaPlaybackButton&) = delete;
  ~ArdiaPlaybackButton() override;

 protected:
  void OnPaintBackground(gfx::Canvas* canvas) override;
  void PaintButtonContents(gfx::Canvas* canvas) override;
};

class ArdiaProgressBar : public views::View {
  METADATA_HEADER(ArdiaProgressBar, views::View)

 public:
  static constexpr int kSlopX = 4;
  static constexpr int kSlopY = 6;
  static constexpr float kBarHeight = 5;

  explicit ArdiaProgressBar(base::RepeatingCallback<void(double)> seek);
  ArdiaProgressBar(const ArdiaProgressBar&) = delete;
  ArdiaProgressBar& operator=(const ArdiaProgressBar&) = delete;
  ~ArdiaProgressBar() override;

  void SetMediaPosition(const media_session::MediaPosition& position);

  void Place(const gfx::Size& window_size);

  void OnPaint(gfx::Canvas* canvas) override;
  bool OnMousePressed(const ui::MouseEvent& event) override;
  bool OnMouseDragged(const ui::MouseEvent& event) override;
  void OnMouseReleased(const ui::MouseEvent& event) override;
  void OnMouseCaptureLost() override;
  ui::Cursor GetCursor(const ui::MouseEvent& event) override;

 private:
  double FractionAt(int x) const;
  void RepaintIfDrawn();

  base::RepeatingCallback<void(double)> seek_;
  media_session::MediaPosition position_;
  std::optional<double> drag_fraction_;
  bool dragging_ = false;
  base::RepeatingTimer timer_;
};

class ArdiaControlsFadeAnimation : public OverlayControlsFadeAnimation {
 public:
  ArdiaControlsFadeAnimation(
      const std::vector<raw_ptr<views::View>>& controls,
      Type type,
      base::RepeatingClosure on_step);
  ArdiaControlsFadeAnimation(const ArdiaControlsFadeAnimation&) =
      delete;
  ArdiaControlsFadeAnimation& operator=(
      const ArdiaControlsFadeAnimation&) = delete;
  ~ArdiaControlsFadeAnimation() override;

  void AnimateToState(double state) override;

 private:
  base::RepeatingClosure on_step_;
};

#endif
