#ifndef ARDIA_LINUX_AC_LINUX_PIP_PLAYER_H_
#define ARDIA_LINUX_AC_LINUX_PIP_PLAYER_H_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "components/viz/common/surfaces/surface_id.h"
#include "content/public/browser/overlay_window.h"
#include "services/media_session/public/cpp/media_image.h"
#include "services/media_session/public/cpp/media_position.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/compositor/compositor_observer.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"
#include "ui/views/view.h"

class VideoOverlayWindowViews;

namespace content {
class VideoPictureInPictureWindowController;
class WebContents;
}

namespace ui {
class Compositor;
}

namespace ardia::linux_pip {

enum class Intent { kExplicit, kAutomatic, kCancelled };

void NoteIntent(content::WebContents* contents, Intent intent);
Intent TakeIntent(content::WebContents* contents);
void ClearIntent(content::WebContents* contents);
bool AutomaticIntentPending(content::WebContents* contents);

class Player;

class Presenter {
 public:
  virtual bool PresentsPlayerFor(content::WebContents* source) const = 0;
  virtual void ShowPlayer(Player* player) = 0;
  virtual void PlayerChanged(Player* player) = 0;
  virtual void PlayerSurfaceChanged(Player* player) = 0;
  virtual void HidePlayer(Player* player, base::TimeDelta fade) = 0;
  virtual gfx::Rect DefaultPlayerScreenBounds(const gfx::Size& natural_size) const = 0;
  virtual base::WeakPtr<Presenter> PresenterWeakPtr() = 0;

 protected:
  virtual ~Presenter() = default;
};

Presenter* FindPresenter(content::WebContents* source);

class Player : public content::VideoOverlayWindow {
 public:
  explicit Player(content::VideoPictureInPictureWindowController* controller);
  Player(const Player&) = delete;
  Player& operator=(const Player&) = delete;
  ~Player() override;

  static bool KeepsAfterSourceReturn(content::WebContents* contents);

  bool IsActive() const override;
  void Close() override;
  void ShowInactive() override;
  void Hide() override;
  bool IsVisible() const override;
  gfx::Rect GetBounds() override;
  void UpdateNaturalSize(const gfx::Size& natural_size) override;
  void SetPlaybackState(PlaybackState playback_state) override;
  void SetPlayPauseButtonVisibility(bool is_visible) override;
  void SetSkipAdButtonVisibility(bool is_visible) override;
  void SetNextTrackButtonVisibility(bool is_visible) override;
  void SetPreviousTrackButtonVisibility(bool is_visible) override;
  void SetHidePictureInPictureButtonVisibility(bool is_visible) override;
  void SetMicrophoneMuted(bool muted) override;
  void SetCameraState(bool turned_on) override;
  void SetMediaMuted(bool muted) override;
  void SetToggleMicrophoneButtonVisibility(bool is_visible) override;
  void SetToggleCameraButtonVisibility(bool is_visible) override;
  void SetHangUpButtonVisibility(bool is_visible) override;
  void SetNextSlideButtonVisibility(bool is_visible) override;
  void SetPreviousSlideButtonVisibility(bool is_visible) override;
  void SetMediaPosition(const media_session::MediaPosition& position) override;
  void SetSourceTitle(const std::u16string& source_title) override;
  void SetFaviconImages(
      const std::vector<media_session::MediaImage>& images) override;
  void SetSurfaceId(const viz::SurfaceId& surface_id) override;
  void SetPlaybackControlsVisibility(bool is_visible) override;
  void SetImmersiveVideoOptions(const content::ImmersiveOptions& options) override;

  uint64_t generation() const { return generation_; }
  uint64_t presented_generation() const { return presented_generation_; }
  bool in_window() const { return mode_ == Mode::kInWindow; }
  content::WebContents* source() const;
  const gfx::Size& natural_size() const { return natural_size_; }
  PlaybackState playback_state() const { return playback_state_; }
  const std::optional<media_session::MediaPosition>& position() const {
    return position_;
  }
  const std::u16string& source_title() const { return source_title_; }
  bool play_pause_visible() const { return play_pause_visible_; }
  const viz::SurfaceId& surface_id() const { return surface_id_; }

  void SetInWindowScreenBounds(const gfx::Rect& bounds);
  void TogglePlayPause();
  void SeekTo(base::TimeDelta position);
  void SeekBy(base::TimeDelta delta);
  void BackToTab();
  void CloseFromPlayer();
  void PopOut(std::optional<gfx::Rect> screen_bounds);
  void PresenterGone(Presenter* presenter);
  base::WeakPtr<Player> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }

 private:
  enum class Mode { kIdle, kInWindow, kWindow, kDeclined };

  void EnterInWindow(Presenter* presenter);
  void EnterWindow(std::optional<gfx::Rect> screen_bounds);
  void ReplayInto(VideoOverlayWindowViews* window);
  void FinishHandoff(uint64_t generation);
  void ReleasePresenter(base::TimeDelta fade);
  void EndSessionSoon();
  void EndSession(uint64_t generation);
  bool CurrentPictureInPicture() const;

  raw_ptr<content::VideoPictureInPictureWindowController> controller_;
  std::unique_ptr<VideoOverlayWindowViews> window_;
  base::WeakPtr<Presenter> presenter_;
  Mode mode_ = Mode::kIdle;
  bool visible_ = false;
  bool popped_out_ = false;
  uint64_t generation_ = 0;
  uint64_t presented_generation_ = 0;
  gfx::Rect bounds_;
  base::TimeDelta hide_fade_;
  gfx::Size natural_size_;
  PlaybackState playback_state_ = kPaused;
  std::optional<media_session::MediaPosition> position_;
  std::u16string source_title_;
  std::vector<media_session::MediaImage> favicon_images_;
  viz::SurfaceId surface_id_;
  bool play_pause_visible_ = true;
  bool skip_ad_visible_ = false;
  bool next_track_visible_ = false;
  bool previous_track_visible_ = false;
  bool hide_button_visible_ = false;
  bool microphone_muted_ = false;
  bool camera_on_ = false;
  bool media_muted_ = false;
  bool toggle_microphone_visible_ = false;
  bool toggle_camera_visible_ = false;
  bool hang_up_visible_ = false;
  bool next_slide_visible_ = false;
  bool previous_slide_visible_ = false;
  bool playback_controls_visible_ = true;
  std::optional<content::ImmersiveOptions> immersive_options_;
  base::OneShotTimer handoff_timer_;
  base::WeakPtrFactory<Player> weak_factory_{this};
};

class PlayerView : public views::View, public ui::CompositorObserver {
  METADATA_HEADER(PlayerView, views::View)

 public:
  static constexpr float kCornerRadius = 6;

  PlayerView();
  PlayerView(const PlayerView&) = delete;
  PlayerView& operator=(const PlayerView&) = delete;
  ~PlayerView() override;

  void SetSurface(const viz::SurfaceId& surface_id);
  void SetNaturalSize(const gfx::Size& natural_size);
  void Reveal();
  void FadeOut(base::TimeDelta fade, base::OnceClosure done);
  bool fading() const { return fade_timer_.IsRunning(); }

  void OnBoundsChanged(const gfx::Rect& previous_bounds) override;
  void AddedToWidget() override;
  void RemovedFromWidget() override;
  bool GetCanProcessEventsWithinSubtree() const override;

 private:
  void Register();
  void Unregister();
  void LayoutVideo();
  void OnCompositingShuttingDown(ui::Compositor* compositor) override;

  raw_ptr<views::View> video_ = nullptr;
  viz::SurfaceId surface_id_;
  gfx::Size natural_size_;
  raw_ptr<ui::Compositor> compositor_ = nullptr;
  std::optional<viz::FrameSinkId> registered_;
  base::OneShotTimer fade_timer_;
};

}

#endif
