#include "fixtures/media.h"
#include "ardia/linux/ac_linux_media.h"
#include "ardia/linux/ac_linux_tab_policy.h"

#include <limits>

using namespace ardiacore;
using Action = media_session::mojom::MediaSessionAction;

namespace {

template <class... T> base::ListValue Args(T&&... values) {
  base::ListValue out;
  (out.Append(std::forward<T>(values)), ...);
  return out;
}
const std::string& Text(const base::DictValue& value, const char* key) { auto* s = value.FindString(key); assert(s); return *s; }

LinuxSessionSample Sample() {
  LinuxSessionSample sample;
  sample.active = true;
  sample.playing = true;
  sample.controllable = true;
  sample.has_video = true;
  sample.title = u"Track";
  sample.artist = u"Artist";
  sample.album = u"Album";
  sample.actions = {Action::kPlay, Action::kPause, Action::kNextTrack, Action::kPlay, Action::kScrubTo, Action::kSaveVideoFrame};
  sample.artwork = "https://media.ardia.test/art.png";
  sample.position = 12.5;
  sample.duration = 200;
  sample.playback_rate = 1.5;
  sample.now_ms = 1700000000000.0;
  return sample;
}

void Mapping() {
  auto playing = LinuxNowPlayingFromSession(Sample());
  assert(playing && playing->playback_state == "playing" && playing->title == "Track" && playing->album == "Album");
  assert(playing->position == 12.5 && playing->duration == 200 && playing->playback_rate == 1.5 && playing->timestamp == 1700000000000.0);
  assert((playing->actions == std::vector<std::string>{"play", "pause", "nexttrack"}) && playing->has_video && playing->controllable);
  assert(playing->artwork == "https://media.ardia.test/art.png");
  auto inactive = Sample();
  inactive.active = false;
  assert(!LinuxNowPlayingFromSession(inactive));
  auto paused = Sample();
  paused.playing = false;
  paused.duration = 0;
  paused.position = -4;
  paused.artwork = "javascript:alert(1)";
  auto mapped = LinuxNowPlayingFromSession(paused);
  assert(mapped->playback_state == "paused" && !mapped->duration && mapped->position == 0 && !mapped->artwork);
  auto clamped = Sample();
  clamped.position = 500;
  clamped.playback_rate = std::numeric_limits<double>::infinity();
  clamped.artwork = "data:image/png;base64,AAAA";
  mapped = LinuxNowPlayingFromSession(clamped);
  assert(mapped->position == 200 && mapped->playback_rate == 1 && mapped->artwork == "data:image/png;base64,AAAA");
  auto huge = Sample();
  huge.title = std::u16string(1023, u'a') + u"\U0001F3B5";
  huge.artwork = "https://" + std::string(1 << 20, 'a');
  mapped = LinuxNowPlayingFromSession(huge);
  assert(mapped->title == std::string(1023, 'a') && !mapped->artwork);
  auto many = Sample();
  many.actions.clear();
  for (int i = 0; i < 100; ++i) many.actions.push_back(static_cast<Action>(i % 22));
  assert(LinuxNowPlayingFromSession(many)->actions.size() <= 32);
  assert(LinuxMediaSessionActionName(Action::kPreviousTrack) == "previoustrack" && !LinuxMediaSessionActionName(Action::kRaise));
}

void PageVideo() {
  LinuxSessionSample muted;
  muted.page_video = true;
  muted.page_video_playing = true;
  muted.page_title = u"Clips";
  muted.now_ms = 1700000000000.0;
  auto video = LinuxNowPlayingFromSession(muted);
  assert(video && video->has_video && !video->controllable && video->playback_state == "playing");
  assert(video->title == "Clips" && video->actions.empty() && !video->duration && video->timestamp == 1700000000000.0);
  muted.page_video_playing = false;
  auto paused = LinuxNowPlayingFromSession(muted);
  assert(paused && paused->has_video && !paused->controllable && paused->playback_state == "paused");
  muted.page_video = false;
  assert(!LinuxNowPlayingFromSession(muted));
  auto audio = Sample();
  audio.has_video = false;
  audio.page_video = true;
  audio.page_title = u"Clips";
  auto joined = LinuxNowPlayingFromSession(audio);
  assert(joined && joined->has_video && joined->controllable && joined->title == "Track");
  audio.page_video = false;
  assert(!LinuxNowPlayingFromSession(audio)->has_video);
}

void PageVideos() {
  LinuxPageVideo page;
  assert(!page.present && !page.playing);
  page.Join(false, true);
  assert(!page.present && !page.playing);
  page.Join(true, false);
  assert(page.present && !page.playing);
  page.Join(false, true);
  assert(page.present && !page.playing);
  page.Join(true, true);
  assert(page.present && page.playing);
  page.Join(true, false);
  assert(page.present && page.playing);
}

void Events() {
  auto media = LinuxMediaEventData(true, false);
  assert(media.FindBool("playing") == true && media.FindBool("muted") == false && media.size() == 2);
  auto none = LinuxNowPlayingEventData(std::nullopt);
  assert(none.Find("state") && none.Find("state")->is_none());
  auto playing = LinuxNowPlayingEventData(LinuxNowPlayingFromSession(Sample()));
  const auto& state = *playing.FindDict("state");
  for (const char* key : {"title", "artist", "album", "artwork", "playbackState", "position", "duration", "playbackRate", "timestamp", "hasVideo", "actions", "controllable"})
    assert(state.Find(key));
  assert(state.size() == 12 && Text(state, "playbackState") == "playing" && state.FindList("actions")->size() == 3);
  auto paused = Sample();
  paused.duration = std::nullopt;
  paused.artwork = std::nullopt;
  auto paused_event = LinuxNowPlayingEventData(LinuxNowPlayingFromSession(paused));
  const auto& no_duration = *paused_event.FindDict("state");
  assert(no_duration.Find("duration")->is_none() && no_duration.Find("artwork")->is_none());
  auto access = LinuxMediaAccessEventData({true, false, true});
  assert(access.FindBool("camera") == true && access.FindBool("microphone") == false && access.FindBool("screen") == true);
  auto pip = LinuxPictureInPictureEventData({"bogus", true});
  assert(Text(pip, "kind") == "video" && pip.FindBool("active") == true);
}

void Reporter() {
  std::vector<std::pair<std::string, base::DictValue>> sent;
  LinuxMediaReporter reporter([&](std::string name, base::DictValue data) { sent.emplace_back(std::move(name), std::move(data)); });
  assert(!reporter.SetAudio(false, false) && sent.empty());
  assert(reporter.SetAudio(true, false) && sent.back().first == "media" && sent.back().second.FindBool("playing") == true);
  assert(!reporter.SetAudio(true, false) && sent.size() == 1);
  assert(reporter.SetAudio(true, true) && sent.size() == 2);
  assert(reporter.SetNowPlaying(LinuxNowPlayingFromSession(Sample())) && sent.back().first == "nowPlaying");
  assert(!reporter.SetNowPlaying(LinuxNowPlayingFromSession(Sample())) && sent.size() == 3);
  assert(reporter.SetNowPlaying(std::nullopt) && sent.back().second.Find("state")->is_none());
  assert(!reporter.SetAccess({}) && reporter.SetAccess({false, true, false}) && sent.back().first == "mediaAccess");
  assert(!reporter.SetPictureInPicture({"video", false}) && sent.size() == 5);
  assert(reporter.SetPictureInPicture({"document", true}) && Text(sent.back().second, "kind") == "document");
  assert(reporter.SetPictureInPicture({"video", false}) && Text(sent.back().second, "kind") == "document" && sent.back().second.FindBool("active") == false);
  assert(!reporter.SetPictureInPicture({"video", false}));
  assert(reporter.SetPictureInPicture({"video", true}));
  auto snapshot = reporter.Snapshot();
  assert(snapshot.size() == 4 && snapshot[0].first == "media" && snapshot[1].first == "nowPlaying" && snapshot[2].first == "mediaAccess" && snapshot[3].first == "pictureInPicture");
  assert(snapshot[0].second.GetDict().FindBool("muted") == true && snapshot[1].second.GetDict().Find("state")->is_none());
  assert(snapshot[2].second.GetDict().FindBool("microphone") == true && snapshot[3].second.GetDict().FindBool("active") == true);
  const auto before = sent.size();
  reporter.Stop();
  assert(reporter.SetAudio(false, false) && sent.size() == before && !reporter.state().audible);
  std::vector<std::string> ticks;
  LinuxMediaReporter clock([&](std::string name, base::DictValue) { ticks.push_back(name); });
  auto sample = Sample();
  assert(clock.SetNowPlaying(LinuxNowPlayingFromSession(sample)) && ticks.size() == 1);
  sample.now_ms += 2000;
  sample.position = *sample.position + 3.0;
  assert(!clock.SetNowPlaying(LinuxNowPlayingFromSession(sample)) && ticks.size() == 1);
  sample.now_ms += 1000;
  sample.position = 150;
  assert(clock.SetNowPlaying(LinuxNowPlayingFromSession(sample)) && ticks.size() == 2);
  sample.playing = false;
  sample.now_ms += 5000;
  assert(clock.SetNowPlaying(LinuxNowPlayingFromSession(sample)) && ticks.size() == 3);
  sample.now_ms += 5000;
  assert(!clock.SetNowPlaying(LinuxNowPlayingFromSession(sample)) && ticks.size() == 3);
  sample.title = u"Next";
  assert(clock.SetNowPlaying(LinuxNowPlayingFromSession(sample)) && ticks.size() == 4);
  auto owned = std::make_unique<LinuxMediaReporter>(LinuxMediaReporter::Emit());
  owned = std::make_unique<LinuxMediaReporter>([&owned](std::string, base::DictValue) { owned.reset(); });
  assert(owned->SetAudio(true, false) && !owned);
}

void Commands() {
  auto play = ParseLinuxMediaCommand(Args("play"));
  assert(play && play->action == LinuxMediaAction::kPlay);
  assert(ParseLinuxMediaCommand(Args("toggle", base::Value())));
  assert(ParseLinuxMediaCommand(Args("next", 0.0)));
  auto seek = ParseLinuxMediaCommand(Args("seekBy", -15.0));
  assert(seek && seek->action == LinuxMediaAction::kSeekBy && seek->seconds == -15);
  auto to = ParseLinuxMediaCommand(Args("seekTo", 30));
  assert(to && to->seconds == 30);
  assert(!ParseLinuxMediaCommand(Args()) && !ParseLinuxMediaCommand(Args("seekBy")) && !ParseLinuxMediaCommand(Args("seekTo", -1.0)));
  assert(!ParseLinuxMediaCommand(Args("seekBy", std::numeric_limits<double>::quiet_NaN())) && !ParseLinuxMediaCommand(Args("seekBy", 1e12)));
  assert(!ParseLinuxMediaCommand(Args("rewind")) && !ParseLinuxMediaCommand(Args(1)) && !ParseLinuxMediaCommand(Args("play", "x")));
  assert(!ParseLinuxMediaCommand(Args("play", 1, 2)));
  assert(ResolveLinuxMediaCommand({LinuxMediaAction::kToggle}, true).operation == LinuxSessionOperation::kSuspend);
  assert(ResolveLinuxMediaCommand({LinuxMediaAction::kToggle}, false).operation == LinuxSessionOperation::kResume);
  assert(ResolveLinuxMediaCommand({LinuxMediaAction::kPrevious}, true).operation == LinuxSessionOperation::kPreviousTrack);
  auto call = ResolveLinuxMediaCommand(*seek, true);
  assert(call.operation == LinuxSessionOperation::kSeek && call.seconds == -15);
  assert(ResolveLinuxMediaCommand(*to, false).operation == LinuxSessionOperation::kSeekTo);
  assert(ResolveLinuxMediaCommand({LinuxMediaAction::kStop}, true).operation == LinuxSessionOperation::kStop);
}

void PictureInPicture() {
  auto empty = ParseLinuxControlPress(Args());
  assert(empty && empty->click_at == 0 && empty->control == 0);
  auto press = ParseLinuxControlPress(Args(base::DictValue().Set("clickAt", 1234.5).Set("control", 7)));
  assert(press && press->click_at == 1234.5 && press->control == 7);
  assert(!ParseLinuxControlPress(Args(base::DictValue().Set("clickAt", -1))));
  assert(!ParseLinuxControlPress(Args(base::DictValue().Set("control", 1.5))));
  assert(!ParseLinuxControlPress(Args("press")) && !ParseLinuxControlPress(Args(base::DictValue(), base::DictValue())));
  assert(RouteLinuxPictureInPicture(true, false, false) == LinuxPictureInPictureRoute::kAlreadyOpen);
  assert(RouteLinuxPictureInPicture(false, false, true) == LinuxPictureInPictureRoute::kNoActivation);
  assert(RouteLinuxPictureInPicture(false, true, false) == LinuxPictureInPictureRoute::kElement);
  assert(RouteLinuxPictureInPicture(false, false, false) == LinuxPictureInPictureRoute::kNoActivation);
  assert(RouteLinuxPictureInPicture(false, true, true) == LinuxPictureInPictureRoute::kMediaSession);
}

LinuxTabProtection Idle() {
  return {false, false, false, false, false, false, false};
}

void PictureInPictureChoice() {
  auto p = [](bool playing, int64_t area, bool muted = true, bool main_frame = true) {
    LinuxPictureInPicturePlayer player;
    player.playing = playing;
    player.area = area;
    player.muted = muted;
    player.main_frame = main_frame;
    return player;
  };
  assert(!ChooseLinuxPictureInPicturePlayer({}));
  assert(ChooseLinuxPictureInPicturePlayer({p(false, 100)}) == 0u);
  assert(ChooseLinuxPictureInPicturePlayer({p(false, 900), p(true, 100), p(true, 400)}) == 2u);
  assert(ChooseLinuxPictureInPicturePlayer({p(true, 0), p(false, 1000)}) == 0u);
  assert(ChooseLinuxPictureInPicturePlayer({p(false, 300), p(false, 300), p(false, 200)}) == 0u);
  assert(ChooseLinuxPictureInPicturePlayer({p(false, 0), p(false, 0)}) == 0u);
  assert(ChooseLinuxPictureInPicturePlayer({p(true, 900, true, false), p(false, 100, true, true)}) == 1u);
  assert(ChooseLinuxPictureInPicturePlayer({p(true, 900, true, true), p(false, 100, false, false)}) == 1u);
  assert(ChooseLinuxPictureInPicturePlayer({p(false, 900, false, false), p(false, 100, false, true)}) == 1u);
  assert(ChooseLinuxPictureInPicturePlayer({p(false, 100, false, true), p(true, 100, false, true)}) == 1u);
}

void Protection() {
  assert(!LinuxProtectionReason(Idle()));
  const std::pair<std::optional<bool> LinuxTabProtection::*, const char*> fields[] = {
      {&LinuxTabProtection::visible, "visible"}, {&LinuxTabProtection::audible, "playing audio"},
      {&LinuxTabProtection::playing, "playing media"}, {&LinuxTabProtection::capturing, "capturing"},
      {&LinuxTabProtection::picture_in_picture, "picture in picture"},
      {&LinuxTabProtection::pending_prompt, "pending prompt"}, {&LinuxTabProtection::dirty_input, "unsaved input"}};
  for (const auto& [field, reason] : fields) {
    auto busy = Idle();
    busy.*field = true;
    assert(LinuxProtectionReason(busy) == std::string(reason));
    assert(DecideLinuxDiscard(true, false, {}, busy) == LinuxDiscardDecision::kRefused && !LinuxMayFreeze(busy));
    auto unknown = Idle();
    unknown.*field = std::nullopt;
    assert(LinuxProtectionReason(unknown) == "unknown " + std::string(reason));
    assert(DecideLinuxDiscard(true, false, {}, unknown) == LinuxDiscardDecision::kRefused && !LinuxMayFreeze(unknown));
  }
  assert(LinuxProtectionReason(LinuxTabProtection{}) == "unknown visible");
  assert(DecideLinuxDiscard(true, false, {}, Idle()) == LinuxDiscardDecision::kDiscard && LinuxMayFreeze(Idle()));
  assert(DecideLinuxDiscard(true, true, {}, Idle()) == LinuxDiscardDecision::kAlready);
  assert(DecideLinuxDiscard(false, false, {}, Idle()) == LinuxDiscardDecision::kRefused);
  assert(DecideLinuxDiscard(true, false, {true}, Idle()) == LinuxDiscardDecision::kUnsupported);
  assert(LinuxDiscardOutcome(LinuxDiscardDecision::kDiscard, true) == "discarded" && LinuxDiscardOutcome(LinuxDiscardDecision::kDiscard, false) == "refused");
  assert(LinuxDiscardOutcome(LinuxDiscardDecision::kAlready, false) == "already" && LinuxDiscardOutcome(LinuxDiscardDecision::kUnsupported, false) == "unsupported");
  assert(ParseLinuxDiscardRequest(Args()) && !ParseLinuxDiscardRequest(Args())->unload);
  assert(ParseLinuxDiscardRequest(Args(base::DictValue().Set("unload", true)))->unload);
  assert(!ParseLinuxDiscardRequest(Args(base::DictValue().Set("force", true))) && !ParseLinuxDiscardRequest(Args(true)));
  assert(ParseLinuxFrozen(Args(true)) == true && ParseLinuxFrozen(Args(false)) == false && !ParseLinuxFrozen(Args()) && !ParseLinuxFrozen(Args(1)));
  assert(LinuxUnsavedInput(false, false, false) == false);
  assert(LinuxUnsavedInput(true, std::nullopt, std::nullopt) == true && LinuxUnsavedInput(false, std::nullopt, true) == true);
  assert(!LinuxUnsavedInput(false, std::nullopt, false) && !LinuxUnsavedInput(std::nullopt, false, false));
  assert(LinuxEditedInput(false, false) == false && LinuxEditedInput(true, false) == true && LinuxEditedInput(false, true) == true);
  assert(LinuxEditedInput(std::nullopt, true) == true && !LinuxEditedInput(std::nullopt, false) && !LinuxEditedInput(false, std::nullopt));
}

void Power() {
  LinuxPowerSample absent;
  absent.physical_memory = 16ull << 30;
  absent.available_memory = 8ull << 30;
  auto state = LinuxSystemState(absent);
  assert(state.FindBool("onBattery") == false && state.Find("batteryLevel")->is_none() && Text(state, "power") == "unavailable");
  assert(Text(state, "battery") == "unavailable" && Text(state, "memoryPressure") == "normal" && state.FindDouble("physicalMemory") == double(16ull << 30));
  assert(state.FindBool("lowPowerMode") == false);
  LinuxPowerSample battery = absent;
  battery.upower = true;
  battery.on_battery = true;
  battery.device_type = kLinuxUPowerBattery;
  battery.is_present = true;
  battery.percentage = 47.4;
  battery.power_profile = "power-saver";
  state = LinuxSystemState(battery);
  assert(state.FindBool("onBattery") == true && state.FindDouble("batteryLevel") == 0.47 && Text(state, "battery") == "present");
  assert(state.FindBool("lowPowerMode") == true && Text(state, "power") == "upower");
  LinuxPowerSample mains = battery;
  mains.on_battery = false;
  mains.device_type = 1;
  mains.power_profile = "balanced";
  state = LinuxSystemState(mains);
  assert(state.FindBool("onBattery") == false && state.Find("batteryLevel")->is_none() && Text(state, "battery") == "absent" && state.FindBool("lowPowerMode") == false);
  LinuxPowerSample odd = battery;
  odd.percentage = 180;
  assert(LinuxSystemState(odd).FindDouble("batteryLevel") == 1.0);
  odd.is_present = false;
  assert(LinuxSystemState(odd).Find("batteryLevel")->is_none());
  LinuxPowerSample gone = battery;
  gone.upower = false;
  assert(LinuxSystemState(gone).FindBool("onBattery") == false && LinuxSystemState(gone).Find("batteryLevel")->is_none());
  assert(LinuxMemoryPressure(1000, 40) == "critical" && LinuxMemoryPressure(1000, 90) == "warning" && LinuxMemoryPressure(1000, 100) == "normal");
  assert(LinuxMemoryPressure(0, 0) == "normal" && LinuxMemoryPressure(10, 20) == "normal");
  assert(Text(LinuxSystemState(absent), "memorySignal") == "meminfo");
  LinuxPowerSample stalled = absent;
  stalled.available_memory = 40ull << 20;
  stalled.memory_level = "warning";
  stalled.memory_signal = "psi";
  state = LinuxSystemState(stalled);
  assert(Text(state, "memoryPressure") == "warning" && Text(state, "memorySignal") == "psi");
  stalled.memory_level = "normal";
  assert(Text(LinuxSystemState(stalled), "memoryPressure") == "normal");
}

void PowerTracker() {
  LinuxPowerTracker tracker;
  assert(!tracker.Ready() && !tracker.Take());
  LinuxPowerSample battery;
  battery.upower = true;
  battery.on_battery = false;
  battery.device_type = kLinuxUPowerBattery;
  battery.is_present = true;
  battery.percentage = 80;
  battery.physical_memory = 1;
  tracker.SetPower(battery);
  assert(!tracker.Ready() && !tracker.Take());
  tracker.SetMemory(16ull << 30, 8ull << 30);
  assert(!tracker.Ready() && !tracker.Take());
  tracker.PowerAnswered();
  assert(tracker.Ready());
  auto first = tracker.Take();
  assert(first && first->FindBool("onBattery") == false && first->FindDouble("batteryLevel") == 0.8);
  assert(first->FindDouble("physicalMemory") == double(16ull << 30) && Text(*first, "memoryPressure") == "normal");
  assert(!tracker.Take() && tracker.state() && *tracker.state() == *first);
  battery.on_battery = true;
  tracker.SetPower(battery);
  auto unplugged = tracker.Take();
  assert(unplugged && unplugged->FindBool("onBattery") == true && unplugged->FindDouble("physicalMemory") == double(16ull << 30));
  tracker.SetPower(battery);
  assert(!tracker.Take());
  tracker.SetMemory(16ull << 30, 8ull << 30);
  assert(!tracker.Take());
  tracker.SetMemory(1000, 40);
  auto pressure = tracker.Take();
  assert(pressure && Text(*pressure, "memoryPressure") == "critical");
  battery.power_profile = "power-saver";
  tracker.SetPower(battery);
  assert(tracker.Take()->FindBool("lowPowerMode") == true);
  tracker.SetPower(LinuxPowerSample());
  auto gone = tracker.Take();
  assert(gone && Text(*gone, "power") == "unavailable" && gone->FindBool("onBattery") == false && Text(*gone, "memoryPressure") == "critical");
  tracker.SetMemory(1000, 40, "normal", "psi");
  auto relieved = tracker.Take();
  assert(relieved && Text(*relieved, "memoryPressure") == "normal" && Text(*relieved, "memorySignal") == "psi");
  tracker.SetPower(battery);
  auto replugged = tracker.Take();
  assert(replugged && Text(*replugged, "memoryPressure") == "normal" && Text(*replugged, "memorySignal") == "psi");
  tracker.SetMemory(1000, 40, "critical", "psi");
  assert(Text(*tracker.Take(), "memoryPressure") == "critical");
}

}

int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string mode = argv[1];
  if (mode == "mapping") Mapping();
  else if (mode == "page-video") PageVideo();
  else if (mode == "page-videos") PageVideos();
  else if (mode == "events") Events();
  else if (mode == "reporter") Reporter();
  else if (mode == "commands") Commands();
  else if (mode == "pip") PictureInPicture();
  else if (mode == "pip-choice") PictureInPictureChoice();
  else if (mode == "protection") Protection();
  else if (mode == "power-tracker") PowerTracker();
  else if (mode == "power") Power();
  else return 2;
}
