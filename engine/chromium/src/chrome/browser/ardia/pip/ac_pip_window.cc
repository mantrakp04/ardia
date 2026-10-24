// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/pip/ac_pip_window.h"

#include <algorithm>
#include <optional>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "chrome/browser/ardia/pip/ac_pip_controls.h"
#include "chrome/browser/ardia/pip/ac_pip_mac.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_widget_fade_animator.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/ui/color/chrome_color_id.h"
#include "chrome/browser/ui/views/overlay/constants.h"
#include "chrome/browser/ui/views/overlay/minimize_button.h"
#include "chrome/browser/ui/views/overlay/overlay_window_live_caption_button.h"
#include "chrome/browser/ui/views/overlay/simple_overlay_window_image_button.h"
#include "chrome/browser/ui/views/overlay/toggle_mute_button.h"
#include "ui/display/display.h"
#include "ui/display/screen.h"
#include "ui/gfx/font_list.h"
#include "ui/gfx/geometry/resize_utils.h"
#include "ui/gfx/text_constants.h"
#include "ui/views/animation/ink_drop.h"
#include "ui/views/background.h"
#include "ui/views/controls/image_view.h"
#include "ui/views/controls/label.h"

namespace {

constexpr base::TimeDelta kCloseFade = base::Milliseconds(100);
constexpr base::TimeDelta kHideFade = base::Milliseconds(70);
constexpr int kSeekButtonSize = 40;
constexpr int kSeekButtonCenterOffset = 76;

void StyleSeekButton(SimpleOverlayWindowImageButton* button) {
  views::InkDrop::Get(button)->SetMode(views::InkDropHost::InkDropMode::OFF);
  button->SetSize({kSeekButtonSize, kSeekButtonSize});
}

template <typename T, typename U>
T* ReplaceView(raw_ptr<U>& view, std::unique_ptr<T> replacement) {
  U* old_view = std::exchange(view, nullptr);
  views::View* parent = old_view->parent();
  const size_t index = parent->GetIndexOf(old_view).value();
  parent->RemoveChildViewT(old_view);
  return parent->AddChildViewAt(std::move(replacement), index);
}

}

ArdiaVideoOverlayWindow::ArdiaVideoOverlayWindow(
    content::VideoPictureInPictureWindowController* controller)
    : VideoOverlayWindowViews(controller), ac_hide_fade_(kHideFade) {
  hide_controls_timer_.Start(
      FROM_HERE, hide_controls_timer_.GetCurrentDelay(),
      base::BindRepeating(
          &ArdiaVideoOverlayWindow::HideIdleControlsUnlessPointerOnControl,
          base::Unretained(this)));
  hide_controls_timer_.Stop();
}

ArdiaVideoOverlayWindow::~ArdiaVideoOverlayWindow() = default;

void ArdiaVideoOverlayWindow::SetUpViews() {
  VideoOverlayWindowViews::SetUpViews();

  controls_scrim_view_->SetBackground(
      views::CreateSolidBackground(SkColorSetA(SK_ColorBLACK, 0x5A)));
  controls_top_scrim_view_->SetBackground(nullptr);
  controls_bottom_scrim_view_->SetBackground(nullptr);

  origin_->SetFontList(gfx::FontList().DeriveWithSizeDelta(
      13 - gfx::FontList().GetFontSize()));
  origin_->SetEnabledColor(kColorPipWindowForeground);
  origin_->SetHorizontalAlignment(gfx::ALIGN_CENTER);

  back_to_tab_button_ = ReplaceView(
      back_to_tab_button_,
      std::make_unique<ArdiaBackToTabButton>(base::BindRepeating([] {
        PictureInPictureWindowManager::GetInstance()
            ->ExitPictureInPictureViaWindowUi(
                PictureInPictureWindowManager::UiBehavior::
                    kCloseWindowAndFocusOpener);
      })));
  close_controls_view_ = ReplaceView(
      close_controls_view_,
      std::make_unique<ArdiaCloseButton>(base::BindRepeating(
          &ArdiaVideoOverlayWindow::OnCloseButtonPressed,
          base::Unretained(this))));
  auto play_pause = std::make_unique<ArdiaPlaybackButton>(
      base::BindRepeating(&VideoOverlayWindowViews::TogglePlayPause,
                          base::Unretained(this)));
  play_pause->SetSize({kCenterButtonSize, kCenterButtonSize});
  play_pause_controls_view_ =
      ReplaceView(play_pause_controls_view_, std::move(play_pause));
  StyleSeekButton(replay_10_seconds_button_.get());
  StyleSeekButton(forward_10_seconds_button_.get());

  ac_progress_bar_ = playback_controls_container_view_->AddChildViewAt(
      std::make_unique<ArdiaProgressBar>(base::BindRepeating(
          &VideoOverlayWindowViews::SeekForProgressBarInteraction,
          base::Unretained(this))),
      playback_controls_container_view_->GetIndexOf(progress_view_).value() +
          1);
}

void ArdiaVideoOverlayWindow::OnUpdateControlsBounds() {
  VideoOverlayWindowViews::OnUpdateControlsBounds();

  const gfx::Size size = GetBounds().size();
  constexpr int kMargin = kArdiaPipButtonMargin;
  constexpr int kButton = kArdiaPipButtonSize;

  title_view_->SetBoundsRect({0, 0, size.width(), kMargin + kButton});
  favicon_view_->SetVisible(false);
  constexpr int kOriginX = kMargin + kButton + 8;
  origin_->SetBoundsRect({kOriginX, kMargin - 1,
                          std::max(0, size.width() - 2 * kOriginX), kButton});

  minimize_button_->SetVisible(false);
  static_cast<ArdiaBackToTabButton*>(back_to_tab_button_.get())
      ->Place(size);
  static_cast<ArdiaCloseButton*>(close_controls_view_.get())->Place(size);

  if (vc_controls_container_view_->GetVisible()) {
    return;
  }

  const gfx::Point center(size.width() / 2, (size.height() + 1) / 2);
  play_pause_controls_view_->SetPosition(
      {center.x() - kCenterButtonSize / 2, center.y() - kCenterButtonSize / 2});
  replay_10_seconds_button_->SetPosition(
      {center.x() - kSeekButtonCenterOffset - kSeekButtonSize / 2,
       center.y() - kSeekButtonSize / 2});
  forward_10_seconds_button_->SetPosition(
      {center.x() + kSeekButtonCenterOffset - kSeekButtonSize / 2,
       center.y() - kSeekButtonSize / 2});
  ac_progress_bar_->Place(size);
  ac_progress_bar_->SetVisible(!is_live_);
  progress_view_->SetVisible(false);
  timestamp_->SetVisible(false);
  live_status_->SetVisible(false);
  live_caption_button_->SetVisible(false);
  if (toggle_mute_button_) {
    toggle_mute_button_->SetVisible(false);
  }
  previous_track_controls_view_->SetVisible(false);
  next_track_controls_view_->SetVisible(false);
}

void ArdiaVideoOverlayWindow::UpdateControlsVisibility(
    bool is_visible,
    bool should_animate) {
  force_title_and_scrim_visible_ =
      !IsOverlayViewShown() && force_controls_visible_.value_or(is_visible);

  const OverlayControlsFadeAnimation* title_fade =
      title_and_top_scrim_fade_animation_.get();
  const OverlayControlsFadeAnimation* controls_fade = fade_animation_.get();
  VideoOverlayWindowViews::UpdateControlsVisibility(is_visible,
                                                    should_animate);

  if (title_and_top_scrim_fade_animation_ &&
      title_and_top_scrim_fade_animation_.get() != title_fade) {
    title_and_top_scrim_fade_animation_ =
        std::make_unique<ArdiaControlsFadeAnimation>(
            std::vector<raw_ptr<views::View>>{title_view_,
                                              controls_top_scrim_view_},
            title_and_top_scrim_fade_animation_->type());
    title_and_top_scrim_fade_animation_->Start();
  }
  if (fade_animation_ && fade_animation_.get() != controls_fade) {
    fade_animation_ = std::make_unique<ArdiaControlsFadeAnimation>(
        std::vector<raw_ptr<views::View>>{controls_container_view_,
                                          controls_scrim_view_,
                                          controls_bottom_scrim_view_},
        fade_animation_->type());
    fade_animation_->Start();
  }
}

gfx::Rect ArdiaVideoOverlayWindow::GetProgressViewBounds() {
  return ac_progress_bar_->GetVisible() ? ac_progress_bar_->GetMirroredBounds()
                                        : gfx::Rect();
}

void ArdiaVideoOverlayWindow::SetMediaPosition(
    const media_session::MediaPosition& position) {
  VideoOverlayWindowViews::SetMediaPosition(position);
  ac_progress_bar_->SetMediaPosition(position);
}

gfx::Rect ArdiaVideoOverlayWindow::CalculateAndUpdateWindowBounds() {
  std::optional<gfx::Rect> saved;
  if (!has_been_shown_) {
    saved = LoadArdiaPictureInPictureBounds();
  }
  if (saved) {
    const gfx::Rect work_area =
        display::Screen::Get()->GetDisplayMatching(*saved).work_area();
    UpdateMaxSize(work_area);
    gfx::Rect rect = *saved;
    gfx::Size size = rect.size();
    size.SetToMin(max_size_);
    size.SetToMax(GetMinimumSize());
    rect.set_size(size);
    if (!natural_size_.IsEmpty()) {
      const gfx::Point center = rect.CenterPoint();
      const bool left = center.x() < work_area.CenterPoint().x();
      const bool top = center.y() < work_area.CenterPoint().y();
      const gfx::ResizeEdge edge =
          top ? (left ? gfx::ResizeEdge::kBottomRight
                      : gfx::ResizeEdge::kBottomLeft)
              : (left ? gfx::ResizeEdge::kTopRight
                      : gfx::ResizeEdge::kTopLeft);
      gfx::SizeRectToAspectRatio(
          edge,
          static_cast<float>(natural_size_.width()) / natural_size_.height(),
          GetMinimumSize(), max_size_, &rect);
      UpdateLayerBoundsWithLetterboxing(rect.size());
    }
    rect.AdjustToFit(work_area);
    return rect;
  }
  return VideoOverlayWindowViews::CalculateAndUpdateWindowBounds();
}

void ArdiaVideoOverlayWindow::ShowInactive() {
  ac_hide_timer_.Stop();
  ResetArdiaPictureInPictureFade(GetNativeWindow());
  SetVisibilityChangedAnimationsEnabled(false);
  SetOpacity(1.0f);
  views::Widget::ShowInactive();
  VideoOverlayWindowViews::ShowInactive();
  if (fade_animator_) {
    fade_animator_->CancelAndReset();
  }
  SetOpacity(1.0f);
}

void ArdiaVideoOverlayWindow::Hide() {
  RemoveOverlayViewIfExists();
  if (fade_animator_) {
    fade_animator_->CancelAndReset();
  }
  const base::TimeDelta fade = std::exchange(ac_hide_fade_, kHideFade);
  if (views::Widget::IsVisible() && fade.is_positive()) {
    if (!ac_hide_timer_.IsRunning()) {
      FadeOutArdiaPictureInPicture(GetNativeWindow(), fade);
      ac_hide_timer_.Start(
          FROM_HERE, fade,
          base::BindOnce(&ArdiaVideoOverlayWindow::FinishHide,
                         base::Unretained(this)));
    }
  } else {
    ac_hide_timer_.Stop();
    views::Widget::Hide();
  }
  MaybeUnregisterFrameSinkHierarchy();
  PictureInPictureWindowManager::GetInstance()->OnPictureInPictureWindowHidden(
      this);
}

void ArdiaVideoOverlayWindow::FinishHide() {
  views::Widget::Hide();
}

void ArdiaVideoOverlayWindow::OnCloseButtonPressed() {
  ac_hide_fade_ = kCloseFade;
  PictureInPictureWindowManager::GetInstance()->ExitPictureInPictureViaWindowUi(
      PictureInPictureWindowManager::UiBehavior::kCloseWindowOnly);
}

void ArdiaVideoOverlayWindow::HideIdleControlsUnlessPointerOnControl() {
  const gfx::Point pointer = display::Screen::Get()->GetCursorScreenPoint() -
                             GetBounds().OffsetFromOrigin();
  const views::View* controls[] = {
      back_to_tab_button_.get(),        close_controls_view_.get(),
      play_pause_controls_view_.get(),  replay_10_seconds_button_.get(),
      forward_10_seconds_button_.get(), ac_progress_bar_.get()};
  for (const views::View* control : controls) {
    if (control->GetVisible() &&
        control->GetMirroredBounds().Contains(pointer)) {
      return;
    }
  }
  UpdateControlsVisibility(false, true);
}

void ArdiaVideoOverlayWindow::OnNativeWidgetDestroyed() {
  views::Widget::OnNativeWidgetDestroyed();
  const bool should_pause_video = false;
  controller_->OnWindowDestroyed(should_pause_video);
}

void ArdiaVideoOverlayWindow::OnNativeWidgetMove() {
  VideoOverlayWindowViews::OnNativeWidgetMove();
  MaybeSaveBounds();
}

void ArdiaVideoOverlayWindow::OnNativeWidgetSizeChanged(
    const gfx::Size& new_size) {
  VideoOverlayWindowViews::OnNativeWidgetSizeChanged(new_size);
  MaybeSaveBounds();
}

void ArdiaVideoOverlayWindow::MaybeSaveBounds() {
  if (has_been_shown_ && !is_tucking_forced_ && views::Widget::IsVisible() &&
      !ac_hide_timer_.IsRunning()) {
    SaveArdiaPictureInPictureBounds(GetBounds());
  }
}

std::unique_ptr<VideoOverlayWindowViews> NewArdiaVideoOverlayWindow(
    content::VideoPictureInPictureWindowController* controller) {
  return std::make_unique<ArdiaVideoOverlayWindow>(controller);
}
