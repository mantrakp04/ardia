#include "ardia/linux/ac_linux_pip_player.h"

#include <algorithm>
#include <utility>

#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "cc/layers/deadline_policy.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/ui/views/overlay/video_overlay_window_views.h"
#include "components/viz/common/frame_timing_details.h"
#include "content/public/browser/video_picture_in_picture_window_controller.h"
#include "content/public/browser/web_contents.h"
#include "media/base/video_util.h"
#include "third_party/blink/public/common/frame/user_activation_state.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/compositor/compositor.h"
#include "ui/compositor/layer.h"
#include "ui/compositor/layer_animation_element.h"
#include "ui/compositor/layer_animator.h"
#include "ui/compositor/layer_solid_color.h"
#include "ui/compositor/layer_surface.h"
#include "ui/compositor/scoped_layer_animation_settings.h"
#include "ui/gfx/animation/tween.h"
#include "ui/gfx/geometry/rounded_corners_f.h"
#include "ui/views/widget/widget.h"

namespace ardia::linux_pip {

namespace {

constexpr base::TimeDelta kCloseFade = base::Milliseconds(100);
constexpr base::TimeDelta kBackToTabFade = base::Milliseconds(70);
constexpr base::TimeDelta kHandoffDeadline = base::Seconds(1);

struct PendingIntent {
  base::WeakPtr<content::WebContents> contents;
  Intent intent;
  base::TimeTicks until;
};

std::vector<PendingIntent>& Intents() {
  static base::NoDestructor<std::vector<PendingIntent>> intents;
  return *intents;
}

std::vector<Player*>& Players() {
  static base::NoDestructor<std::vector<Player*>> players;
  return *players;
}

uint64_t NextGeneration() {
  static uint64_t generation = 0;
  return ++generation;
}

void Prune(content::WebContents* contents) {
  const base::TimeTicks now = base::TimeTicks::Now();
  std::erase_if(Intents(), [&](const PendingIntent& pending) {
    return !pending.contents || now >= pending.until ||
           pending.contents.get() == contents;
  });
}

const PendingIntent* Pending(content::WebContents* contents) {
  const base::TimeTicks now = base::TimeTicks::Now();
  for (const PendingIntent& pending : Intents()) {
    if (pending.contents && pending.contents.get() == contents &&
        now < pending.until) {
      return &pending;
    }
  }
  return nullptr;
}

}

void NoteIntent(content::WebContents* contents, Intent intent) {
  if (!contents) {
    return;
  }
  Prune(contents);
  Intents().push_back({contents->GetWeakPtr(), intent,
                       base::TimeTicks::Now() + blink::kActivationLifespan});
}

Intent TakeIntent(content::WebContents* contents) {
  const PendingIntent* pending = Pending(contents);
  const Intent intent = pending ? pending->intent : Intent::kExplicit;
  Prune(contents);
  return intent;
}

void ClearIntent(content::WebContents* contents) {
  const base::TimeTicks now = base::TimeTicks::Now();
  std::erase_if(Intents(), [](const PendingIntent& pending) { return !pending.contents; });
  for (PendingIntent& pending : Intents()) {
    if (pending.contents.get() == contents && now < pending.until &&
        pending.intent == Intent::kAutomatic) {
      pending.intent = Intent::kCancelled;
    }
  }
}

bool AutomaticIntentPending(content::WebContents* contents) {
  const PendingIntent* pending = Pending(contents);
  return pending && pending->intent != Intent::kExplicit;
}

Player::Player(content::VideoPictureInPictureWindowController* controller)
    : controller_(controller) {
  Players().push_back(this);
}

Player::~Player() {
  std::erase(Players(), this);
  handoff_timer_.Stop();
  if (Presenter* presenter = presenter_.get()) {
    presenter_.reset();
    presenter->HidePlayer(this, base::TimeDelta());
  }
}

bool Player::KeepsAfterSourceReturn(content::WebContents* contents) {
  return std::ranges::any_of(Players(), [contents](const Player* player) {
    return player->source() == contents && player->mode_ == Mode::kWindow &&
           player->popped_out_ && player->IsVisible();
  });
}

content::WebContents* Player::source() const {
  return controller_ ? controller_->GetWebContents() : nullptr;
}

bool Player::IsActive() const {
  return mode_ == Mode::kWindow && window_ && window_->IsActive();
}

void Player::Close() {
  handoff_timer_.Stop();
  ReleasePresenter(base::TimeDelta());
  mode_ = Mode::kIdle;
  visible_ = false;
  popped_out_ = false;
  if (window_) {
    window_->Close();
  }
}

void Player::ShowInactive() {
  generation_ = NextGeneration();
  hide_fade_ = kBackToTabFade;
  content::WebContents* contents = source();
  const Intent intent = contents ? TakeIntent(contents) : Intent::kExplicit;
  if (intent != Intent::kExplicit) {
    if (mode_ == Mode::kWindow && IsVisible()) {
      return;
    }
    Presenter* presenter =
        intent == Intent::kAutomatic ? FindPresenter(contents) : nullptr;
    if (presenter) {
      EnterInWindow(presenter);
      return;
    }
    handoff_timer_.Stop();
    ReleasePresenter(base::TimeDelta());
    if (window_ && window_->IsVisible()) {
      window_->Hide();
    }
    mode_ = Mode::kDeclined;
    visible_ = true;
    EndSessionSoon();
    return;
  }
  popped_out_ = popped_out_ || mode_ == Mode::kInWindow;
  EnterWindow(std::nullopt);
}

void Player::EnterInWindow(Presenter* presenter) {
  handoff_timer_.Stop();
  if (window_ && window_->IsVisible()) {
    window_->Hide();
  }
  Presenter* previous = presenter_.get();
  if (previous && previous != presenter) {
    presenter_.reset();
    previous->HidePlayer(this, base::TimeDelta());
  }
  presenter_ = presenter->PresenterWeakPtr();
  presented_generation_ = generation_;
  mode_ = Mode::kInWindow;
  visible_ = true;
  popped_out_ = false;
  if (bounds_.IsEmpty()) {
    bounds_ = presenter->DefaultPlayerScreenBounds(natural_size_);
  }
  presenter->ShowPlayer(this);
}

void Player::EnterWindow(std::optional<gfx::Rect> screen_bounds) {
  const bool handoff = mode_ == Mode::kInWindow && presenter_;
  if (!window_) {
    window_ = VideoOverlayWindowViews::Create(controller_);
  }
  ReplayInto(window_.get());
  if (screen_bounds && !screen_bounds->IsEmpty()) {
    window_->SetBounds(*screen_bounds);
  }
  mode_ = Mode::kWindow;
  visible_ = true;
  window_->ShowInactive();
  if (!handoff) {
    ReleasePresenter(base::TimeDelta());
    return;
  }
  const uint64_t generation = generation_;
  handoff_timer_.Start(FROM_HERE, kHandoffDeadline,
                       base::BindOnce(&Player::FinishHandoff,
                                      weak_factory_.GetWeakPtr(), generation));
  if (ui::Compositor* compositor = window_->GetCompositor()) {
    compositor->RequestSuccessfulPresentationTimeForNextFrame(base::BindOnce(
        [](base::WeakPtr<Player> player, uint64_t generation,
           const viz::FrameTimingDetails&) {
          if (player) {
            player->FinishHandoff(generation);
          }
        },
        weak_factory_.GetWeakPtr(), generation));
  }
}

void Player::FinishHandoff(uint64_t generation) {
  if (generation != generation_ || mode_ != Mode::kWindow) {
    return;
  }
  handoff_timer_.Stop();
  ReleasePresenter(base::TimeDelta());
}

void Player::ReplayInto(VideoOverlayWindowViews* window) {
  if (!natural_size_.IsEmpty()) {
    window->UpdateNaturalSize(natural_size_);
  }
  window->SetPlaybackState(playback_state_);
  window->SetPlayPauseButtonVisibility(play_pause_visible_);
  window->SetSkipAdButtonVisibility(skip_ad_visible_);
  window->SetNextTrackButtonVisibility(next_track_visible_);
  window->SetPreviousTrackButtonVisibility(previous_track_visible_);
  window->SetHidePictureInPictureButtonVisibility(hide_button_visible_);
  window->SetMicrophoneMuted(microphone_muted_);
  window->SetCameraState(camera_on_);
  window->SetMediaMuted(media_muted_);
  window->SetToggleMicrophoneButtonVisibility(toggle_microphone_visible_);
  window->SetToggleCameraButtonVisibility(toggle_camera_visible_);
  window->SetHangUpButtonVisibility(hang_up_visible_);
  window->SetNextSlideButtonVisibility(next_slide_visible_);
  window->SetPreviousSlideButtonVisibility(previous_slide_visible_);
  if (position_) {
    window->SetMediaPosition(*position_);
  }
  window->SetSourceTitle(source_title_);
  window->SetFaviconImages(favicon_images_);
  window->SetPlaybackControlsVisibility(playback_controls_visible_);
  if (immersive_options_) {
    window->SetImmersiveVideoOptions(*immersive_options_);
  }
  if (surface_id_.is_valid()) {
    window->SetSurfaceId(surface_id_);
  }
}

void Player::Hide() {
  handoff_timer_.Stop();
  const Mode previous = mode_;
  mode_ = Mode::kIdle;
  visible_ = false;
  popped_out_ = false;
  const base::TimeDelta fade = std::exchange(hide_fade_, kBackToTabFade);
  if (previous == Mode::kWindow && window_) {
    window_->Hide();
  }
  ReleasePresenter(previous == Mode::kInWindow ? fade : base::TimeDelta());
}

bool Player::IsVisible() const {
  if (mode_ == Mode::kWindow) {
    return window_ && window_->IsVisible();
  }
  return visible_;
}

gfx::Rect Player::GetBounds() {
  if (mode_ == Mode::kWindow && window_) {
    return window_->GetBounds();
  }
  return bounds_;
}

void Player::UpdateNaturalSize(const gfx::Size& natural_size) {
  natural_size_ = natural_size;
  if (mode_ == Mode::kWindow && window_) {
    window_->UpdateNaturalSize(natural_size);
  }
  if (Presenter* presenter = presenter_.get()) {
    presenter->PlayerChanged(this);
  }
}

void Player::SetPlaybackState(PlaybackState playback_state) {
  playback_state_ = playback_state;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetPlaybackState(playback_state);
  }
  if (Presenter* presenter = presenter_.get()) {
    presenter->PlayerChanged(this);
  }
}

void Player::SetPlayPauseButtonVisibility(bool is_visible) {
  play_pause_visible_ = is_visible;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetPlayPauseButtonVisibility(is_visible);
  }
  if (Presenter* presenter = presenter_.get()) {
    presenter->PlayerChanged(this);
  }
}

void Player::SetSkipAdButtonVisibility(bool is_visible) {
  skip_ad_visible_ = is_visible;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetSkipAdButtonVisibility(is_visible);
  }
}

void Player::SetNextTrackButtonVisibility(bool is_visible) {
  next_track_visible_ = is_visible;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetNextTrackButtonVisibility(is_visible);
  }
}

void Player::SetPreviousTrackButtonVisibility(bool is_visible) {
  previous_track_visible_ = is_visible;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetPreviousTrackButtonVisibility(is_visible);
  }
}

void Player::SetHidePictureInPictureButtonVisibility(bool is_visible) {
  hide_button_visible_ = is_visible;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetHidePictureInPictureButtonVisibility(is_visible);
  }
}

void Player::SetMicrophoneMuted(bool muted) {
  microphone_muted_ = muted;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetMicrophoneMuted(muted);
  }
}

void Player::SetCameraState(bool turned_on) {
  camera_on_ = turned_on;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetCameraState(turned_on);
  }
}

void Player::SetMediaMuted(bool muted) {
  media_muted_ = muted;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetMediaMuted(muted);
  }
}

void Player::SetToggleMicrophoneButtonVisibility(bool is_visible) {
  toggle_microphone_visible_ = is_visible;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetToggleMicrophoneButtonVisibility(is_visible);
  }
}

void Player::SetToggleCameraButtonVisibility(bool is_visible) {
  toggle_camera_visible_ = is_visible;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetToggleCameraButtonVisibility(is_visible);
  }
}

void Player::SetHangUpButtonVisibility(bool is_visible) {
  hang_up_visible_ = is_visible;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetHangUpButtonVisibility(is_visible);
  }
}

void Player::SetNextSlideButtonVisibility(bool is_visible) {
  next_slide_visible_ = is_visible;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetNextSlideButtonVisibility(is_visible);
  }
}

void Player::SetPreviousSlideButtonVisibility(bool is_visible) {
  previous_slide_visible_ = is_visible;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetPreviousSlideButtonVisibility(is_visible);
  }
}

void Player::SetMediaPosition(const media_session::MediaPosition& position) {
  position_ = position;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetMediaPosition(position);
  }
  if (Presenter* presenter = presenter_.get()) {
    presenter->PlayerChanged(this);
  }
}

void Player::SetSourceTitle(const std::u16string& source_title) {
  source_title_ = source_title;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetSourceTitle(source_title);
  }
  if (Presenter* presenter = presenter_.get()) {
    presenter->PlayerChanged(this);
  }
}

void Player::SetFaviconImages(
    const std::vector<media_session::MediaImage>& images) {
  favicon_images_ = images;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetFaviconImages(images);
  }
}

void Player::SetSurfaceId(const viz::SurfaceId& surface_id) {
  surface_id_ = surface_id;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetSurfaceId(surface_id);
  }
  if (Presenter* presenter = presenter_.get()) {
    presenter->PlayerSurfaceChanged(this);
  }
}

void Player::SetPlaybackControlsVisibility(bool is_visible) {
  playback_controls_visible_ = is_visible;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetPlaybackControlsVisibility(is_visible);
  }
}

void Player::SetImmersiveVideoOptions(const content::ImmersiveOptions& options) {
  immersive_options_ = options;
  if (mode_ == Mode::kWindow && window_) {
    window_->SetImmersiveVideoOptions(options);
  }
}

void Player::SetInWindowScreenBounds(const gfx::Rect& bounds) {
  if (mode_ != Mode::kInWindow || bounds.IsEmpty()) {
    return;
  }
  const bool resized = bounds.size() != bounds_.size();
  bounds_ = bounds;
  if (resized && controller_) {
    controller_->UpdateLayerBounds();
  }
}

void Player::TogglePlayPause() {
  if (mode_ != Mode::kInWindow || !controller_) {
    return;
  }
  playback_state_ = controller_->TogglePlayPause() ? kPlaying : kPaused;
  if (Presenter* presenter = presenter_.get()) {
    presenter->PlayerChanged(this);
  }
}

void Player::SeekTo(base::TimeDelta position) {
  if (mode_ != Mode::kInWindow || !controller_) {
    return;
  }
  base::TimeDelta target = std::max(base::TimeDelta(), position);
  if (position_ && !position_->duration().is_max() &&
      position_->duration().is_positive()) {
    target = std::min(target, position_->duration());
  }
  controller_->SeekTo(target);
}

void Player::SeekBy(base::TimeDelta delta) {
  if (position_) {
    SeekTo(position_->GetPosition() + delta);
  }
}

bool Player::CurrentPictureInPicture() const {
  auto* manager = PictureInPictureWindowManager::GetInstance();
  return source() && manager->GetWebContents() == source() &&
         !manager->GetChildWebContents();
}

void Player::BackToTab() {
  if (mode_ != Mode::kInWindow || !CurrentPictureInPicture()) {
    return;
  }
  hide_fade_ = kBackToTabFade;
  ClearIntent(source());
  PictureInPictureWindowManager::GetInstance()->ExitPictureInPictureViaWindowUi(
      PictureInPictureWindowManager::UiBehavior::kCloseWindowAndFocusOpener);
}

void Player::CloseFromPlayer() {
  if (mode_ != Mode::kInWindow || !CurrentPictureInPicture()) {
    return;
  }
  hide_fade_ = kCloseFade;
  ClearIntent(source());
  PictureInPictureWindowManager::GetInstance()->ExitPictureInPictureViaWindowUi(
      PictureInPictureWindowManager::UiBehavior::kCloseWindowOnly);
}

void Player::PopOut(std::optional<gfx::Rect> screen_bounds) {
  if (mode_ != Mode::kInWindow || !controller_) {
    return;
  }
  popped_out_ = true;
  EnterWindow(screen_bounds);
  if (controller_ && IsVisible()) {
    controller_->UpdateLayerBounds();
  }
}

void Player::PresenterGone(Presenter* presenter) {
  if (presenter_.get() != presenter) {
    return;
  }
  presenter_.reset();
  if (mode_ == Mode::kInWindow) {
    EndSessionSoon();
  }
}

void Player::ReleasePresenter(base::TimeDelta fade) {
  if (Presenter* presenter = presenter_.get()) {
    presenter_.reset();
    presenter->HidePlayer(this, fade);
  }
}

void Player::EndSessionSoon() {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&Player::EndSession, weak_factory_.GetWeakPtr(),
                                generation_));
}

void Player::EndSession(uint64_t generation) {
  if (generation != generation_ || !visible_ ||
      (mode_ != Mode::kInWindow && mode_ != Mode::kDeclined)) {
    return;
  }
  if (CurrentPictureInPicture()) {
    PictureInPictureWindowManager::GetInstance()->ExitPictureInPicture();
    return;
  }
  if (controller_) {
    controller_->Close(false);
  }
}

PlayerView::PlayerView() {
  SetPaintToLayer(ui::LAYER_SOLID_COLOR);
  layer()->AsSolidColor()->SetColor(SkColors::kBlack);
  layer()->SetRoundedCornerRadius(gfx::RoundedCornersF(kCornerRadius));
  layer()->SetIsFastRoundedCorner(true);
  layer()->SetMasksToBounds(true);
  auto video = std::make_unique<views::View>();
  video->SetPaintToLayer(ui::LAYER_SURFACE);
  video->layer()->AsSurface()->SetFallbackBackgroundColor(SkColors::kBlack);
  video_ = AddChildView(std::move(video));
}

PlayerView::~PlayerView() {
  Unregister();
}

void PlayerView::SetSurface(const viz::SurfaceId& surface_id) {
  if (!surface_id.is_valid()) {
    return;
  }
  surface_id_ = surface_id;
  Register();
  LayoutVideo();
  video_->layer()->AsSurface()->SetShowSurface(
      surface_id_, video_->size(), cc::DeadlinePolicy::UseDefaultDeadline(),
      true);
}

void PlayerView::SetNaturalSize(const gfx::Size& natural_size) {
  if (natural_size_ == natural_size) {
    return;
  }
  natural_size_ = natural_size;
  LayoutVideo();
}

void PlayerView::Reveal() {
  fade_timer_.Stop();
  layer()->GetAnimator()->StopAnimatingProperty(
      ui::LayerAnimationElement::OPACITY);
  layer()->SetOpacity(1.0f);
}

void PlayerView::FadeOut(base::TimeDelta fade, base::OnceClosure done) {
  if (!fade.is_positive()) {
    fade_timer_.Stop();
    std::move(done).Run();
    return;
  }
  ui::ScopedLayerAnimationSettings animation(layer()->GetAnimator());
  animation.SetTransitionDuration(fade);
  animation.SetTweenType(gfx::Tween::EASE_OUT);
  animation.SetPreemptionStrategy(
      ui::LayerAnimator::IMMEDIATELY_ANIMATE_TO_NEW_TARGET);
  layer()->SetOpacity(0.0f);
  fade_timer_.Start(FROM_HERE, fade, std::move(done));
}

void PlayerView::OnBoundsChanged(const gfx::Rect& previous_bounds) {
  LayoutVideo();
}

void PlayerView::AddedToWidget() {
  Register();
}

void PlayerView::RemovedFromWidget() {
  Unregister();
}

bool PlayerView::GetCanProcessEventsWithinSubtree() const {
  return false;
}

void PlayerView::Register() {
  if (!surface_id_.is_valid() || !GetWidget()) {
    return;
  }
  ui::Compositor* compositor = GetWidget()->GetCompositor();
  if (!compositor) {
    return;
  }
  if (compositor_ == compositor && registered_ &&
      *registered_ == surface_id_.frame_sink_id()) {
    return;
  }
  Unregister();
  compositor->AddChildFrameSink(surface_id_.frame_sink_id());
  compositor->AddObserver(this);
  compositor_ = compositor;
  registered_ = surface_id_.frame_sink_id();
}

void PlayerView::Unregister() {
  if (!compositor_) {
    return;
  }
  ui::Compositor* compositor = std::exchange(compositor_, nullptr);
  compositor->RemoveObserver(this);
  if (registered_) {
    compositor->RemoveChildFrameSink(*registered_);
    registered_.reset();
  }
}

void PlayerView::OnCompositingShuttingDown(ui::Compositor* compositor) {
  if (compositor == compositor_) {
    Unregister();
  }
}

void PlayerView::LayoutVideo() {
  gfx::Rect video = GetLocalBounds();
  if (!natural_size_.IsEmpty() && !video.IsEmpty()) {
    const gfx::Rect letterbox =
        media::ComputeLetterboxRegion(video, natural_size_);
    if (!letterbox.IsEmpty()) {
      video = letterbox;
    }
  }
  video_->SetBoundsRect(video);
  if (surface_id_.is_valid()) {
    video_->layer()->AsSurface()->SetSurfaceSize(video.size());
  }
}

BEGIN_METADATA(PlayerView)
END_METADATA

}
