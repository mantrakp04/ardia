#include "ardia/linux/ac_linux_page_media.h"

#include "ardia/linux/ac_linux_content_hooks.h"
#include "ardia/linux/ac_linux_page_channel.h"

#include <algorithm>

#include "base/functional/bind.h"
#include "base/location.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "ui/gfx/geometry/size.h"
#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "components/performance_manager/public/graph/page_node.h"
#include "components/performance_manager/public/performance_manager.h"
#include "components/permissions/permission_request_manager.h"
#include "components/web_modal/web_contents_modal_dialog_manager.h"
#include "content/public/browser/media_player_id.h"
#include "content/public/browser/media_session.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/page.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "third_party/blink/public/mojom/frame/sudden_termination_disabler_type.mojom.h"

namespace ardiacore {
namespace {

constexpr base::TimeDelta kPictureInPictureWait = base::Milliseconds(1500);

bool HasVideo(const media_session::mojom::MediaSessionInfo& info) {
  if (!info.audio_video_states) return false;
  return std::ranges::any_of(*info.audio_video_states, [](auto state) {
    return state == media_session::mojom::MediaAudioVideoState::kAudioVideo ||
           state == media_session::mojom::MediaAudioVideoState::kVideoOnly;
  });
}

}

LinuxPageMedia::LinuxPageMedia(content::WebContents* contents, LinuxMediaReporter::Emit emit)
    : content::WebContentsObserver(contents),
      reporter_(std::move(emit)),
      indicator_(MediaCaptureDevicesDispatcher::GetInstance()->GetMediaStreamCaptureIndicator()) {
  indicator_->AddObserver(this);
  reporter_.SetAudio(contents->IsCurrentlyAudible(), contents->IsAudioMuted());
  reporter_.SetAccess(Access());
  if (InPictureInPicture())
    reporter_.SetPictureInPicture({contents->HasPictureInPictureDocument() ? "document" : "video", true});
  page_videos_ = LinuxPageChannel::GetOrCreate(contents)->AddPageVideoListener(
      base::BindRepeating(&LinuxPageMedia::UpdateNowPlaying, base::Unretained(this)));
  ObserveSession(content::MediaSession::GetIfExists(contents));
  if (PageVideo().present) UpdateNowPlaying();
}

LinuxPageMedia::~LinuxPageMedia() {
  reporter_.Stop();
  indicator_->RemoveObserver(this);
  picture_in_picture_timer_.Stop();
  if (pending_picture_in_picture_) std::move(pending_picture_in_picture_).Run(true, base::Value(false));
}

bool LinuxPageMedia::Handles(std::string_view command) {
  return command == "mediaCommand" || command == "requestPictureInPicture" ||
         command == "takeControlPress" || command == "exitPictureInPicture" ||
         command == "pictureInPictureState";
}

void LinuxPageMedia::Dispatch(const std::string& command, const base::ListValue& args,
                              bool activation, Done done) {
  if (command == "mediaCommand") return MediaCommand(args, std::move(done));
  if (command == "requestPictureInPicture") return RequestPictureInPicture(args, activation, std::move(done));
  if (command == "takeControlPress") {
    if (!ParseLinuxControlPress(args)) return std::move(done).Run(false, base::Value("takeControlPress requires a control press"));
    return std::move(done).Run(true, base::Value(activation));
  }
  if (command == "exitPictureInPicture") {
    if (!args.empty()) return std::move(done).Run(false, base::Value("exitPictureInPicture takes no arguments"));
    ExitPictureInPicture();
    return std::move(done).Run(true, base::Value());
  }
  if (command == "pictureInPictureState") {
    if (!args.empty()) return std::move(done).Run(false, base::Value("pictureInPictureState takes no arguments"));
    return std::move(done).Run(true, base::Value(InPictureInPicture()));
  }
  std::move(done).Run(false, base::Value("Unsupported media command: " + command));
}

void LinuxPageMedia::ObserveSession(content::MediaSession* session) {
  if (!session || receiver_.is_bound()) return;
  session->AddObserver(receiver_.BindNewPipeAndPassRemote());
}

void LinuxPageMedia::MediaSessionCreated(content::MediaSession* session) {
  ObserveSession(session);
}

void LinuxPageMedia::WebContentsDestroyed() {
  reporter_.Stop();
  receiver_.reset();
  picture_in_picture_timer_.Stop();
  if (pending_picture_in_picture_) std::move(pending_picture_in_picture_).Run(true, base::Value(false));
}

void LinuxPageMedia::OnAudioStateChanged(bool audible) {
  if (web_contents()) reporter_.SetAudio(audible, web_contents()->IsAudioMuted());
}

void LinuxPageMedia::DidUpdateAudioMutingState(bool muted) {
  if (web_contents()) reporter_.SetAudio(web_contents()->IsCurrentlyAudible(), muted);
}

void LinuxPageMedia::MediaPictureInPictureChanged(bool active) {
  if (active) FinishPictureInPicture();
}

void LinuxPageMedia::NotePictureInPicture(bool active, std::string kind) {
  reporter_.SetPictureInPicture({std::move(kind), active});
  if (active) FinishPictureInPicture();
}

bool LinuxPageMedia::InPictureInPicture() const {
  content::WebContents* contents = web_contents();
  if (!contents) return false;
  return contents->HasPictureInPictureVideo() || contents->HasPictureInPictureDocument() ||
         PictureInPictureWindowManager::GetInstance()->GetWebContents() == contents;
}

void LinuxPageMedia::MediaSessionInfoChanged(media_session::mojom::MediaSessionInfoPtr info) {
  if (!info) return;
  session_.active = info->state != media_session::mojom::MediaSessionInfo::SessionState::kInactive;
  session_.playing = info->playback_state == media_session::mojom::MediaPlaybackState::kPlaying;
  session_.controllable = info->is_controllable;
  session_.has_video = HasVideo(*info);
  UpdateNowPlaying();
}

void LinuxPageMedia::MediaSessionMetadataChanged(
    const std::optional<media_session::MediaMetadata>& metadata) {
  session_.title = metadata ? metadata->title : std::u16string();
  session_.artist = metadata ? metadata->artist : std::u16string();
  session_.album = metadata ? metadata->album : std::u16string();
  UpdateNowPlaying();
}

void LinuxPageMedia::MediaSessionActionsChanged(
    const std::vector<media_session::mojom::MediaSessionAction>& actions) {
  session_.actions = actions;
  UpdateNowPlaying();
}

void LinuxPageMedia::MediaSessionImagesChanged(
    const base::flat_map<media_session::mojom::MediaSessionImageType,
                         std::vector<media_session::MediaImage>>& images) {
  session_.artwork.reset();
  const auto artwork = images.find(media_session::mojom::MediaSessionImageType::kArtwork);
  if (artwork != images.end() && !artwork->second.empty() && artwork->second.front().src.is_valid())
    session_.artwork = artwork->second.front().src.spec();
  UpdateNowPlaying();
}

void LinuxPageMedia::MediaSessionPositionChanged(
    const std::optional<media_session::MediaPosition>& position) {
  position_ = position;
  UpdateNowPlaying();
}

void LinuxPageMedia::UpdateNowPlaying() {
  if (position_) {
    session_.position = position_->GetPositionAtTime(base::TimeTicks::Now()).InSecondsF();
    const base::TimeDelta duration = position_->duration();
    session_.duration = duration.is_max() || duration.is_zero() ? std::nullopt
                                                                : std::optional<double>(duration.InSecondsF());
    session_.playback_rate = position_->playback_rate();
  } else {
    session_.position.reset();
    session_.duration.reset();
    session_.playback_rate = 1;
  }
  session_.now_ms = base::Time::Now().InMillisecondsFSinceUnixEpoch();
  const LinuxPageVideo video = PageVideo();
  session_.page_video = video.present;
  session_.page_video_playing = video.playing;
  session_.page_title = video.present && web_contents() ? web_contents()->GetTitle() : std::u16string();
  reporter_.SetNowPlaying(LinuxNowPlayingFromSession(session_));
}

LinuxPageVideo LinuxPageMedia::PageVideo() const {
  LinuxPageVideo video;
  content::WebContents* contents = web_contents();
  if (!contents) return video;
  contents->GetPrimaryMainFrame()->ForEachRenderFrameHost([&video](content::RenderFrameHost* frame) {
    if (!frame->GetPage().IsPrimary() || !frame->IsRenderFrameLive()) return;
    if (const auto* report = LinuxPageDocumentVideo::GetForCurrentDocument(frame))
      video.Join(report->has_video, report->playing);
  });
  return video;
}

LinuxMediaAccess LinuxPageMedia::Access() const {
  content::WebContents* contents = web_contents();
  if (!contents) return {};
  return {indicator_->IsCapturingVideo(contents), indicator_->IsCapturingAudio(contents),
          indicator_->IsCapturingTab(contents) || indicator_->IsCapturingWindow(contents) ||
              indicator_->IsCapturingDisplay(contents)};
}

void LinuxPageMedia::CaptureChanged(content::WebContents* contents) {
  if (contents && contents == web_contents()) reporter_.SetAccess(Access());
}

void LinuxPageMedia::MediaCommand(const base::ListValue& args, Done done) {
  const auto command = ParseLinuxMediaCommand(args);
  if (!command) return std::move(done).Run(false, base::Value("mediaCommand requires a known action and finite seconds"));
  content::MediaSession* session = web_contents() ? content::MediaSession::GetIfExists(web_contents()) : nullptr;
  if (!session) return std::move(done).Run(true, base::Value());
  const LinuxSessionCall call = ResolveLinuxMediaCommand(*command, SessionPlaying());
  using SuspendType = media_session::mojom::MediaSession::SuspendType;
  switch (call.operation) {
    case LinuxSessionOperation::kResume: session->Resume(SuspendType::kUI); break;
    case LinuxSessionOperation::kSuspend: session->Suspend(SuspendType::kUI); break;
    case LinuxSessionOperation::kStop: session->Stop(SuspendType::kUI); break;
    case LinuxSessionOperation::kNextTrack: session->NextTrack(); break;
    case LinuxSessionOperation::kPreviousTrack: session->PreviousTrack(); break;
    case LinuxSessionOperation::kSeek: session->Seek(base::Seconds(call.seconds)); break;
    case LinuxSessionOperation::kSeekTo: session->SeekTo(base::Seconds(call.seconds)); break;
  }
  std::move(done).Run(true, base::Value());
}

void LinuxPageMedia::RequestPictureInPicture(const base::ListValue& args, bool activation, Done done) {
  if (!ParseLinuxControlPress(args)) {
    return std::move(done).Run(false, base::Value("requestPictureInPicture requires a control press"));
  }
  content::WebContents* contents = web_contents();
  const LinuxPictureInPictureRoute route =
      RouteLinuxPictureInPicture(InPictureInPicture(), activation, session_.active && session_.has_video);
  content::MediaSession* session = content::MediaSession::GetIfExists(contents);
  std::optional<content::MediaPlayerId> player;
  switch (route) {
    case LinuxPictureInPictureRoute::kAlreadyOpen: return std::move(done).Run(true, base::Value(true));
    case LinuxPictureInPictureRoute::kNoActivation: return std::move(done).Run(true, base::Value(false));
    case LinuxPictureInPictureRoute::kMediaSession:
      if (!session) return std::move(done).Run(true, base::Value(false));
      break;
    case LinuxPictureInPictureRoute::kElement: {
      const auto candidates = contents ? content::ArdiaLinuxPictureInPictureCandidates(contents)
                                       : std::vector<content::ArdiaLinuxPictureInPictureCandidate>();
      std::vector<LinuxPictureInPicturePlayer> players;
      for (const auto& candidate : candidates) {
        const auto size = video_sizes_.find(candidate.id);
        players.push_back({candidate.playing,
                           size == video_sizes_.end() ? 0 : int64_t{size->second.width()} * size->second.height(),
                           candidate.muted,
                           candidate.id.frame_routing_id == contents->GetPrimaryMainFrame()->GetGlobalId()});
      }
      const auto chosen = ChooseLinuxPictureInPicturePlayer(players);
      if (!chosen) return std::move(done).Run(true, base::Value(false));
      player = candidates[*chosen].id;
      break;
    }
  }
  if (pending_picture_in_picture_) std::move(pending_picture_in_picture_).Run(true, base::Value(false));
  pending_picture_in_picture_ = std::move(done);
  picture_in_picture_timer_.Start(FROM_HERE, kPictureInPictureWait,
      base::BindOnce(&LinuxPageMedia::FinishPictureInPicture, weak_factory_.GetWeakPtr()));
  if (route == LinuxPictureInPictureRoute::kMediaSession) return session->EnterPictureInPicture();
  if (!content::ArdiaLinuxRequestPictureInPicture(contents, *player)) FinishPictureInPicture();
}

void LinuxPageMedia::TitleWasSet(content::NavigationEntry*) {
  if (session_.page_video) UpdateNowPlaying();
}

void LinuxPageMedia::PrimaryPageChanged(content::Page&) {
  if (session_.page_video || PageVideo().present) UpdateNowPlaying();
}

void LinuxPageMedia::RenderFrameDeleted(content::RenderFrameHost*) {
  if (session_.page_video) UpdateNowPlaying();
}

void LinuxPageMedia::DidFinishNavigation(content::NavigationHandle* navigation) {
  if (session_.page_video && navigation->HasCommitted() && !navigation->IsSameDocument()) UpdateNowPlaying();
}

void LinuxPageMedia::MediaResized(const gfx::Size& size, const content::MediaPlayerId& id) {
  video_sizes_[id] = size;
}

void LinuxPageMedia::MediaDestroyed(const content::MediaPlayerId& id) {
  video_sizes_.erase(id);
}

void LinuxPageMedia::FinishPictureInPicture() {
  picture_in_picture_timer_.Stop();
  if (!pending_picture_in_picture_) return;
  std::move(pending_picture_in_picture_).Run(true, base::Value(InPictureInPicture()));
}

void LinuxPageMedia::ExitPictureInPicture() {
  if (!web_contents()) return;
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce([](base::WeakPtr<content::WebContents> contents) {
        PictureInPictureWindowManager* manager = PictureInPictureWindowManager::GetInstance();
        if (contents && manager->GetWebContents() == contents.get()) manager->ExitPictureInPicture();
      }, web_contents()->GetWeakPtr()));
}

LinuxTabProtection LinuxPageMedia::Protection(bool visible) const {
  LinuxTabProtection protection;
  content::WebContents* contents = web_contents();
  if (!contents) return protection;
  protection.visible = visible || contents->GetVisibility() == content::Visibility::VISIBLE;
  protection.audible = contents->IsCurrentlyAudible();
  protection.playing = SessionPlaying();
  protection.capturing = indicator_->IsCapturingUserMedia(contents) || indicator_->IsBeingMirrored(contents) ||
                         indicator_->IsCapturingTab(contents) || indicator_->IsCapturingWindow(contents) ||
                         indicator_->IsCapturingDisplay(contents) || contents->IsBeingCaptured();
  protection.picture_in_picture = InPictureInPicture();
  auto* dialogs = web_modal::WebContentsModalDialogManager::FromWebContents(contents);
  auto* permissions = permissions::PermissionRequestManager::FromWebContents(contents);
  if (dialogs && permissions) {
    protection.pending_prompt = dialogs->IsDialogActive() || permissions->IsRequestInProgress() ||
                                permissions->has_pending_requests();
  }
  protection.dirty_input = UnsavedInput();
  return protection;
}

std::optional<bool> LinuxPageMedia::UnsavedInput() const {
  content::WebContents* contents = web_contents();
  if (!contents) return std::nullopt;
  bool before_unload = false;
  contents->GetPrimaryMainFrame()->ForEachRenderFrameHost([&before_unload](content::RenderFrameHost* frame) {
    before_unload |= frame->GetSuddenTerminationDisablerState(
        blink::mojom::SuddenTerminationDisablerType::kBeforeUnloadHandler);
  });
  if (!performance_manager::PerformanceManager::IsAvailable()) return LinuxUnsavedInput(before_unload, std::nullopt, std::nullopt);
  const base::WeakPtr<performance_manager::PageNode> page =
      performance_manager::PerformanceManager::GetPrimaryPageNodeForWebContents(contents);
  if (!page) return LinuxUnsavedInput(before_unload, std::nullopt, std::nullopt);
  return LinuxUnsavedInput(before_unload, page->HadFormInteraction(), page->HadUserEdits());
}

std::optional<bool> LinuxPageMedia::EditedInput() const {
  content::WebContents* contents = web_contents();
  if (!contents || !performance_manager::PerformanceManager::IsAvailable()) return std::nullopt;
  const base::WeakPtr<performance_manager::PageNode> page =
      performance_manager::PerformanceManager::GetPrimaryPageNodeForWebContents(contents);
  if (!page) return std::nullopt;
  return LinuxEditedInput(page->HadFormInteraction(), page->HadUserEdits());
}

}
