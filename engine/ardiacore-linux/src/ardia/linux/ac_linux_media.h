#ifndef ARDIA_LINUX_AC_LINUX_MEDIA_H_
#define ARDIA_LINUX_AC_LINUX_MEDIA_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/functional/callback.h"
#include "base/values.h"
#include "services/media_session/public/mojom/media_session.mojom.h"

namespace ardiacore {

struct LinuxNowPlaying {
  std::string title;
  std::string artist;
  std::string album;
  std::optional<std::string> artwork;
  std::string playback_state = "none";
  double position = 0;
  std::optional<double> duration;
  double playback_rate = 1;
  double timestamp = 0;
  bool has_video = false;
  std::vector<std::string> actions;
  bool controllable = false;
  bool operator==(const LinuxNowPlaying&) const = default;
};

struct LinuxMediaAccess {
  bool camera = false;
  bool microphone = false;
  bool screen = false;
  bool operator==(const LinuxMediaAccess&) const = default;
};

struct LinuxPictureInPicture {
  std::string kind = "video";
  bool active = false;
  bool operator==(const LinuxPictureInPicture&) const = default;
};

struct LinuxMediaState {
  bool audible = false;
  bool muted = false;
  std::optional<LinuxNowPlaying> now_playing;
  LinuxMediaAccess access;
  LinuxPictureInPicture picture_in_picture;
};

struct LinuxSessionSample {
  bool active = false;
  bool playing = false;
  bool controllable = false;
  bool has_video = false;
  std::u16string title;
  std::u16string artist;
  std::u16string album;
  std::vector<media_session::mojom::MediaSessionAction> actions;
  std::optional<std::string> artwork;
  std::optional<double> position;
  std::optional<double> duration;
  double playback_rate = 1;
  double now_ms = 0;
  bool page_video = false;
  bool page_video_playing = false;
  std::u16string page_title;
};

struct LinuxPageVideo {
  bool present = false;
  bool playing = false;
  void Join(bool has_video, bool video_playing) {
    present = present || has_video;
    playing = playing || (has_video && video_playing);
  }
};

std::optional<std::string_view> LinuxMediaSessionActionName(
    media_session::mojom::MediaSessionAction action);
std::optional<LinuxNowPlaying> LinuxNowPlayingFromSession(const LinuxSessionSample& sample);

base::DictValue LinuxMediaEventData(bool audible, bool muted);
base::DictValue LinuxNowPlayingEventData(const std::optional<LinuxNowPlaying>& state);
base::DictValue LinuxMediaAccessEventData(const LinuxMediaAccess& access);
base::DictValue LinuxPictureInPictureEventData(const LinuxPictureInPicture& state);

class LinuxMediaReporter {
 public:
  using Emit = base::RepeatingCallback<void(std::string, base::DictValue)>;
  explicit LinuxMediaReporter(Emit emit);
  LinuxMediaReporter(const LinuxMediaReporter&) = delete;
  LinuxMediaReporter& operator=(const LinuxMediaReporter&) = delete;
  bool SetAudio(bool audible, bool muted);
  bool SetNowPlaying(std::optional<LinuxNowPlaying> state);
  bool SetAccess(LinuxMediaAccess access);
  bool SetPictureInPicture(LinuxPictureInPicture state);
  const LinuxMediaState& state() const { return state_; }
  std::vector<std::pair<std::string, base::Value>> Snapshot() const;
  void Stop() { emit_.Reset(); }

 private:
  void Send(std::string name, base::DictValue data);
  Emit emit_;
  LinuxMediaState state_;
};

enum class LinuxMediaAction { kPlay, kPause, kToggle, kNext, kPrevious, kSeekBy, kSeekTo, kStop };

struct LinuxMediaCommand {
  LinuxMediaAction action;
  double seconds = 0;
};

std::optional<LinuxMediaCommand> ParseLinuxMediaCommand(const base::ListValue& args);

enum class LinuxSessionOperation { kResume, kSuspend, kNextTrack, kPreviousTrack, kSeek, kSeekTo, kStop };

struct LinuxSessionCall {
  LinuxSessionOperation operation;
  double seconds = 0;
};

LinuxSessionCall ResolveLinuxMediaCommand(const LinuxMediaCommand& command, bool playing);

struct LinuxControlPress {
  double click_at = 0;
  int control = 0;
};

std::optional<LinuxControlPress> ParseLinuxControlPress(const base::ListValue& args);

enum class LinuxPictureInPictureRoute { kAlreadyOpen, kNoActivation, kMediaSession, kElement };

LinuxPictureInPictureRoute RouteLinuxPictureInPicture(bool open, bool activation, bool has_video);

struct LinuxPictureInPicturePlayer {
  bool playing = false;
  int64_t area = 0;
  bool muted = false;
  bool main_frame = true;
};

std::optional<size_t> ChooseLinuxPictureInPicturePlayer(const std::vector<LinuxPictureInPicturePlayer>& players);

}

#endif
