#include "ardia/linux/ac_linux_media.h"

#include <algorithm>
#include <cmath>
#include <tuple>

#include "base/strings/utf_string_conversions.h"

namespace ardiacore {
namespace {

using Action = media_session::mojom::MediaSessionAction;

constexpr size_t kTextLimit = 1024;
constexpr size_t kArtworkLimit = 1 << 20;
constexpr size_t kActionLimit = 32;
constexpr double kSeekLimit = 366.0 * 24 * 60 * 60;

std::string BoundedText(const std::u16string& text) {
  std::u16string bounded = text.substr(0, kTextLimit);
  if (!bounded.empty() && bounded.back() >= 0xD800 && bounded.back() <= 0xDBFF) bounded.pop_back();
  return base::UTF16ToUTF8(bounded);
}

bool Finite(const base::Value& value) {
  return (value.is_int() || value.is_double()) && std::isfinite(value.GetDouble());
}

bool SameNowPlaying(const std::optional<LinuxNowPlaying>& before, const std::optional<LinuxNowPlaying>& after) {
  if (!before || !after) return !before && !after;
  LinuxNowPlaying anchored = *after;
  anchored.position = before->position;
  anchored.timestamp = before->timestamp;
  if (!(anchored == *before)) return false;
  const double elapsed = before->playback_state == "playing"
      ? (after->timestamp - before->timestamp) / 1000 * before->playback_rate : 0;
  double expected = std::max(0.0, before->position + elapsed);
  if (before->duration) expected = std::min(expected, *before->duration);
  return std::abs(expected - after->position) < 0.5;
}

bool AllowedArtwork(const std::string& url) {
  if (url.empty() || url.size() > kArtworkLimit) return false;
  return url.starts_with("https://") || url.starts_with("http://") || url.starts_with("data:image/");
}

}

std::optional<std::string_view> LinuxMediaSessionActionName(Action action) {
  switch (action) {
    case Action::kPlay: return "play";
    case Action::kPause: return "pause";
    case Action::kPreviousTrack: return "previoustrack";
    case Action::kNextTrack: return "nexttrack";
    case Action::kSeekBackward: return "seekbackward";
    case Action::kSeekForward: return "seekforward";
    case Action::kSkipAd: return "skipad";
    case Action::kStop: return "stop";
    case Action::kSeekTo: return "seekto";
    case Action::kEnterPictureInPicture: return "enterpictureinpicture";
    case Action::kExitPictureInPicture: return "exitpictureinpicture";
    case Action::kToggleMicrophone: return "togglemicrophone";
    case Action::kToggleCamera: return "togglecamera";
    case Action::kHangUp: return "hangup";
    case Action::kPreviousSlide: return "previousslide";
    case Action::kNextSlide: return "nextslide";
    case Action::kEnterAutoPictureInPicture: return "enterautopictureinpicture";
    default: return std::nullopt;
  }
}

std::optional<LinuxNowPlaying> LinuxNowPlayingFromSession(const LinuxSessionSample& sample) {
  if (!sample.active && !sample.page_video) return std::nullopt;
  LinuxNowPlaying state;
  state.timestamp = std::isfinite(sample.now_ms) ? sample.now_ms : 0;
  if (!sample.active) {
    state.title = BoundedText(sample.page_title);
    state.playback_state = sample.page_video_playing ? "playing" : "paused";
    state.has_video = true;
    return state;
  }
  state.title = BoundedText(sample.title);
  state.artist = BoundedText(sample.artist);
  state.album = BoundedText(sample.album);
  if (sample.artwork && AllowedArtwork(*sample.artwork)) state.artwork = sample.artwork;
  state.playback_state = sample.playing ? "playing" : "paused";
  if (sample.position && std::isfinite(*sample.position)) state.position = std::max(0.0, *sample.position);
  if (sample.duration && std::isfinite(*sample.duration) && *sample.duration > 0) {
    state.duration = sample.duration;
    state.position = std::min(state.position, *sample.duration);
  }
  state.playback_rate = std::isfinite(sample.playback_rate) ? sample.playback_rate : 1;
  state.has_video = sample.has_video || sample.page_video;
  for (const Action action : sample.actions) {
    if (state.actions.size() >= kActionLimit) break;
    const auto name = LinuxMediaSessionActionName(action);
    if (name && std::find(state.actions.begin(), state.actions.end(), *name) == state.actions.end())
      state.actions.emplace_back(*name);
  }
  state.controllable = sample.controllable;
  return state;
}

base::DictValue LinuxMediaEventData(bool audible, bool muted) {
  return base::DictValue().Set("playing", audible).Set("muted", muted);
}

base::DictValue LinuxNowPlayingEventData(const std::optional<LinuxNowPlaying>& state) {
  if (!state) return base::DictValue().Set("state", base::Value());
  base::ListValue actions;
  for (const auto& action : state->actions) actions.Append(action);
  return base::DictValue().Set("state", base::DictValue()
      .Set("title", state->title)
      .Set("artist", state->artist)
      .Set("album", state->album)
      .Set("artwork", state->artwork ? base::Value(*state->artwork) : base::Value())
      .Set("playbackState", state->playback_state)
      .Set("position", state->position)
      .Set("duration", state->duration ? base::Value(*state->duration) : base::Value())
      .Set("playbackRate", state->playback_rate)
      .Set("timestamp", state->timestamp)
      .Set("hasVideo", state->has_video)
      .Set("actions", std::move(actions))
      .Set("controllable", state->controllable));
}

base::DictValue LinuxMediaAccessEventData(const LinuxMediaAccess& access) {
  return base::DictValue().Set("camera", access.camera).Set("microphone", access.microphone)
      .Set("screen", access.screen);
}

base::DictValue LinuxPictureInPictureEventData(const LinuxPictureInPicture& state) {
  return base::DictValue().Set("kind", state.kind == "document" ? "document" : "video")
      .Set("active", state.active);
}

LinuxMediaReporter::LinuxMediaReporter(Emit emit) : emit_(std::move(emit)) {}

void LinuxMediaReporter::Send(std::string name, base::DictValue data) {
  if (!emit_) return;
  auto emit = emit_;
  emit.Run(std::move(name), std::move(data));
}

bool LinuxMediaReporter::SetAudio(bool audible, bool muted) {
  if (state_.audible == audible && state_.muted == muted) return false;
  state_.audible = audible;
  state_.muted = muted;
  Send("media", LinuxMediaEventData(audible, muted));
  return true;
}

bool LinuxMediaReporter::SetNowPlaying(std::optional<LinuxNowPlaying> state) {
  if (SameNowPlaying(state_.now_playing, state)) return false;
  state_.now_playing = std::move(state);
  Send("nowPlaying", LinuxNowPlayingEventData(state_.now_playing));
  return true;
}

bool LinuxMediaReporter::SetAccess(LinuxMediaAccess access) {
  if (state_.access == access) return false;
  state_.access = access;
  Send("mediaAccess", LinuxMediaAccessEventData(access));
  return true;
}

bool LinuxMediaReporter::SetPictureInPicture(LinuxPictureInPicture state) {
  if (state.kind != "document") state.kind = "video";
  if (!state.active) {
    if (!state_.picture_in_picture.active) return false;
    state.kind = state_.picture_in_picture.kind;
  }
  if (state_.picture_in_picture == state) return false;
  state_.picture_in_picture = state;
  Send("pictureInPicture", LinuxPictureInPictureEventData(state));
  return true;
}

std::vector<std::pair<std::string, base::Value>> LinuxMediaReporter::Snapshot() const {
  std::vector<std::pair<std::string, base::Value>> events;
  events.emplace_back("media", base::Value(LinuxMediaEventData(state_.audible, state_.muted)));
  events.emplace_back("nowPlaying", base::Value(LinuxNowPlayingEventData(state_.now_playing)));
  events.emplace_back("mediaAccess", base::Value(LinuxMediaAccessEventData(state_.access)));
  events.emplace_back("pictureInPicture",
                      base::Value(LinuxPictureInPictureEventData(state_.picture_in_picture)));
  return events;
}

std::optional<LinuxMediaCommand> ParseLinuxMediaCommand(const base::ListValue& args) {
  if (args.size() < 1 || args.size() > 2 || !args[0].is_string()) return std::nullopt;
  const std::string& name = args[0].GetString();
  std::optional<LinuxMediaAction> action;
  if (name == "play") action = LinuxMediaAction::kPlay;
  else if (name == "pause") action = LinuxMediaAction::kPause;
  else if (name == "toggle") action = LinuxMediaAction::kToggle;
  else if (name == "next") action = LinuxMediaAction::kNext;
  else if (name == "previous") action = LinuxMediaAction::kPrevious;
  else if (name == "seekBy") action = LinuxMediaAction::kSeekBy;
  else if (name == "seekTo") action = LinuxMediaAction::kSeekTo;
  else if (name == "stop") action = LinuxMediaAction::kStop;
  if (!action) return std::nullopt;
  const bool seeks = *action == LinuxMediaAction::kSeekBy || *action == LinuxMediaAction::kSeekTo;
  if (args.size() == 2 && !args[1].is_none() && !Finite(args[1])) return std::nullopt;
  if (!seeks) return LinuxMediaCommand{*action, 0};
  if (args.size() != 2 || !Finite(args[1])) return std::nullopt;
  const double seconds = args[1].GetDouble();
  if (std::abs(seconds) > kSeekLimit) return std::nullopt;
  if (*action == LinuxMediaAction::kSeekTo && seconds < 0) return std::nullopt;
  return LinuxMediaCommand{*action, seconds};
}

LinuxSessionCall ResolveLinuxMediaCommand(const LinuxMediaCommand& command, bool playing) {
  switch (command.action) {
    case LinuxMediaAction::kPlay: return {LinuxSessionOperation::kResume};
    case LinuxMediaAction::kPause: return {LinuxSessionOperation::kSuspend};
    case LinuxMediaAction::kToggle:
      return {playing ? LinuxSessionOperation::kSuspend : LinuxSessionOperation::kResume};
    case LinuxMediaAction::kNext: return {LinuxSessionOperation::kNextTrack};
    case LinuxMediaAction::kPrevious: return {LinuxSessionOperation::kPreviousTrack};
    case LinuxMediaAction::kSeekBy: return {LinuxSessionOperation::kSeek, command.seconds};
    case LinuxMediaAction::kSeekTo: return {LinuxSessionOperation::kSeekTo, command.seconds};
    case LinuxMediaAction::kStop: return {LinuxSessionOperation::kStop};
  }
  return {LinuxSessionOperation::kSuspend};
}

std::optional<LinuxControlPress> ParseLinuxControlPress(const base::ListValue& args) {
  if (args.size() > 1) return std::nullopt;
  if (args.size() == 0 || args[0].is_none()) return LinuxControlPress{};
  const base::DictValue* press = args[0].GetIfDict();
  if (!press) return std::nullopt;
  LinuxControlPress result;
  if (const base::Value* click = press->Find("clickAt")) {
    if (!Finite(*click) || click->GetDouble() < 0) return std::nullopt;
    result.click_at = click->GetDouble();
  }
  if (const base::Value* control = press->Find("control")) {
    if (!Finite(*control) || control->GetDouble() < 0 || control->GetDouble() > 2147483647.0 ||
        control->GetDouble() != std::floor(control->GetDouble())) return std::nullopt;
    result.control = static_cast<int>(control->GetDouble());
  }
  return result;
}

LinuxPictureInPictureRoute RouteLinuxPictureInPicture(bool open, bool activation, bool has_video) {
  if (open) return LinuxPictureInPictureRoute::kAlreadyOpen;
  if (!activation) return LinuxPictureInPictureRoute::kNoActivation;
  if (!has_video) return LinuxPictureInPictureRoute::kElement;
  return LinuxPictureInPictureRoute::kMediaSession;
}

std::optional<size_t> ChooseLinuxPictureInPicturePlayer(const std::vector<LinuxPictureInPicturePlayer>& players) {
  std::optional<size_t> best;
  for (size_t index = 0; index < players.size(); ++index) {
    if (!best) {
      best = index;
      continue;
    }
    const auto& player = players[index];
    const auto& chosen = players[*best];
    const auto rank = [](const LinuxPictureInPicturePlayer& p) { return std::tuple(!p.muted, p.main_frame, p.playing, p.area); };
    if (rank(player) > rank(chosen)) best = index;
  }
  return best;
}

}
