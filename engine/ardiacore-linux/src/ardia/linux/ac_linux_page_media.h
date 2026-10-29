#ifndef ARDIA_LINUX_AC_LINUX_PAGE_MEDIA_H_
#define ARDIA_LINUX_AC_LINUX_PAGE_MEDIA_H_

#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_media.h"
#include "ardia/linux/ac_linux_tab_policy.h"
#include "base/callback_list.h"
#include "base/containers/flat_map.h"
#include "base/functional/callback.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"
#include "base/values.h"
#include "chrome/browser/media/webrtc/media_stream_capture_indicator.h"
#include "content/public/browser/media_player_id.h"
#include "content/public/browser/web_contents_observer.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "services/media_session/public/cpp/media_image.h"
#include "services/media_session/public/cpp/media_metadata.h"
#include "ui/gfx/geometry/size.h"
#include "services/media_session/public/cpp/media_position.h"
#include "services/media_session/public/mojom/media_session.mojom.h"

namespace content {
class MediaSession;
class WebContents;
}

namespace ardiacore {

class LinuxPageMedia : public content::WebContentsObserver,
                       public media_session::mojom::MediaSessionObserver,
                       public MediaStreamCaptureIndicator::Observer {
 public:
  using Done = base::OnceCallback<void(bool, base::Value)>;
  LinuxPageMedia(content::WebContents* contents, LinuxMediaReporter::Emit emit);
  ~LinuxPageMedia() override;
  LinuxPageMedia(const LinuxPageMedia&) = delete;
  LinuxPageMedia& operator=(const LinuxPageMedia&) = delete;

  static bool Handles(std::string_view command);
  void Dispatch(const std::string& command, const base::ListValue& args, bool activation, Done done);
  std::vector<std::pair<std::string, base::Value>> Snapshot() const { return reporter_.Snapshot(); }
  void NotePictureInPicture(bool active, std::string kind);
  bool InPictureInPicture() const;
  const LinuxMediaState& state() const { return reporter_.state(); }
  bool SessionPlaying() const { return session_.active && session_.playing; }
  LinuxTabProtection Protection(bool visible) const;
  std::optional<bool> UnsavedInput() const;
  std::optional<bool> EditedInput() const;

 private:
  void OnAudioStateChanged(bool audible) override;
  void DidUpdateAudioMutingState(bool muted) override;
  void MediaPictureInPictureChanged(bool active) override;
  void TitleWasSet(content::NavigationEntry* entry) override;
  void PrimaryPageChanged(content::Page& page) override;
  void RenderFrameDeleted(content::RenderFrameHost* frame) override;
  void DidFinishNavigation(content::NavigationHandle* navigation) override;
  void MediaResized(const gfx::Size& size, const content::MediaPlayerId& id) override;
  void MediaDestroyed(const content::MediaPlayerId& id) override;
  void MediaSessionCreated(content::MediaSession* session) override;
  void WebContentsDestroyed() override;

  void MediaSessionInfoChanged(media_session::mojom::MediaSessionInfoPtr info) override;
  void MediaSessionMetadataChanged(const std::optional<media_session::MediaMetadata>& metadata) override;
  void MediaSessionActionsChanged(const std::vector<media_session::mojom::MediaSessionAction>& actions) override;
  void MediaSessionImagesChanged(
      const base::flat_map<media_session::mojom::MediaSessionImageType,
                           std::vector<media_session::MediaImage>>& images) override;
  void MediaSessionPositionChanged(const std::optional<media_session::MediaPosition>& position) override;

  void OnIsCapturingVideoChanged(content::WebContents* contents, bool) override { CaptureChanged(contents); }
  void OnIsCapturingAudioChanged(content::WebContents* contents, bool) override { CaptureChanged(contents); }
  void OnIsBeingMirroredChanged(content::WebContents* contents, bool) override { CaptureChanged(contents); }
  void OnIsCapturingTabChanged(content::WebContents* contents, bool) override { CaptureChanged(contents); }
  void OnIsCapturingWindowChanged(content::WebContents* contents, bool) override { CaptureChanged(contents); }
  void OnIsCapturingDisplayChanged(content::WebContents* contents, bool) override { CaptureChanged(contents); }

  void ObserveSession(content::MediaSession* session);
  void CaptureChanged(content::WebContents* contents);
  LinuxMediaAccess Access() const;
  LinuxPageVideo PageVideo() const;
  void UpdateNowPlaying();
  void MediaCommand(const base::ListValue& args, Done done);
  void RequestPictureInPicture(const base::ListValue& args, bool activation, Done done);
  void FinishPictureInPicture();
  void ExitPictureInPicture();

  LinuxMediaReporter reporter_;
  LinuxSessionSample session_;
  std::optional<media_session::MediaPosition> position_;
  scoped_refptr<MediaStreamCaptureIndicator> indicator_;
  mojo::Receiver<media_session::mojom::MediaSessionObserver> receiver_{this};
  Done pending_picture_in_picture_;
  base::OneShotTimer picture_in_picture_timer_;
  base::flat_map<content::MediaPlayerId, gfx::Size> video_sizes_;
  base::CallbackListSubscription page_videos_;
  base::WeakPtrFactory<LinuxPageMedia> weak_factory_{this};
};

}

#endif
