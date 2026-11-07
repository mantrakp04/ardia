#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <string>
#include <utility>

#include "ardia/linux/ac_linux_link_gesture.h"
#include "ardia/linux/ac_linux_page_evaluation.h"
#include "ardia/linux/ac_linux_page_messages.h"

using namespace ardiacore;

namespace {

void Expect(bool condition, const char* what) {
  if (!condition) {
    std::fprintf(stderr, "failed: %s\n", what);
    std::abort();
  }
}

base::Value Dict(base::DictValue dict) { return base::Value(std::move(dict)); }

void Kinds() {
  Expect(LinuxPageMessageKindOf("peek") == LinuxPageMessageKind::kPeek, "peek kind");
  Expect(LinuxPageMessageKindOf("scroll") == LinuxPageMessageKind::kScroll, "scroll kind");
  Expect(LinuxPageMessageKindOf("linkDrop") == LinuxPageMessageKind::kLinkDrop, "link drop kind");
  Expect(LinuxPageMessageKindOf("nowPlaying") == LinuxPageMessageKind::kNowPlaying, "now playing kind");
  for (const char* refused : {"notification", "notificationClose", "displayMedia", "NowPlaying", "pipTrace", "result", "LinkDrop", "evaluate", "config", "", "Peek"})
    Expect(!LinuxPageMessageKindOf(refused), refused);
  Expect(LinuxPageMessageEnvelopeFits("scroll", std::string(64 * 1024, 'x')), "64 KiB fits");
  Expect(!LinuxPageMessageEnvelopeFits("scroll", std::string(64 * 1024 + 1, 'x')), "oversized json refused");
  Expect(!LinuxPageMessageEnvelopeFits(std::string(33, 'k'), "{}"), "long kind refused");
  Expect(!LinuxPageMessageEnvelopeFits(std::string("sc\0ll", 5), "{}"), "nul kind refused");
  Expect(!LinuxPageMessageEnvelopeFits("", "{}"), "empty kind refused");
}

void Senders() {
  const LinuxPageSender main{true, true, true};
  const LinuxPageSender child{false, true, true};
  const LinuxPageSender cached{true, true, false};
  const LinuxPageSender prerender{true, false, true};
  for (auto kind : {LinuxPageMessageKind::kScroll, LinuxPageMessageKind::kSelection, LinuxPageMessageKind::kTheme, LinuxPageMessageKind::kLinkDrop}) {
    Expect(LinuxPageSenderAccepted(kind, main), "main frame owns tab-level messages");
    Expect(!LinuxPageSenderAccepted(kind, child), "an iframe cannot drive scroll, selection or tint");
  }
  Expect(LinuxPageSenderAccepted(LinuxPageMessageKind::kPeek, child), "iframes may request peek");
  Expect(LinuxPageSenderAccepted(LinuxPageMessageKind::kNowPlaying, main), "the main frame reports its video");
  Expect(LinuxPageSenderAccepted(LinuxPageMessageKind::kNowPlaying, child), "an iframe reports its own video");
  Expect(!LinuxPageSenderAccepted(LinuxPageMessageKind::kNowPlaying, cached), "a back-forward cached document reports nothing");
  Expect(!LinuxPageSenderAccepted(LinuxPageMessageKind::kNowPlaying, prerender), "a prerendered document reports nothing");
  Expect(!LinuxPageSenderAccepted(LinuxPageMessageKind::kPeek, cached), "back-forward cached documents are silent");
  Expect(!LinuxPageSenderAccepted(LinuxPageMessageKind::kScroll, prerender), "prerendered documents are silent");
}

void Normalization() {
  auto scroll = NormalizeLinuxPageMessage(LinuxPageMessageKind::kScroll, Dict(base::DictValue().Set("state", "down").Set("extra", "x")));
  Expect(scroll && *scroll->data.GetDict().FindString("state") == "down" && scroll->data.GetDict().size() == 1, "scroll keeps only state");
  Expect(!NormalizeLinuxPageMessage(LinuxPageMessageKind::kScroll, Dict(base::DictValue().Set("state", "sideways"))), "unknown scroll state");
  Expect(!NormalizeLinuxPageMessage(LinuxPageMessageKind::kScroll, base::Value()), "scroll needs a dictionary");

  auto video = NormalizeLinuxPageMessage(LinuxPageMessageKind::kNowPlaying, Dict(base::DictValue().Set("frame", "f")
      .Set("title", "Clip").Set("playbackState", "playing").Set("hasVideo", true).Set("controllable", false)
      .Set("actions", base::ListValue().Append("play"))));
  Expect(video && video->data.GetDict().FindBool("hasVideo") == true && video->data.GetDict().FindBool("playing") == true &&
         video->data.GetDict().size() == 2, "now playing keeps only whether a video is there and plays");
  auto paused_video = NormalizeLinuxPageMessage(LinuxPageMessageKind::kNowPlaying, Dict(base::DictValue()
      .Set("playbackState", "paused").Set("hasVideo", true)));
  Expect(paused_video && paused_video->data.GetDict().FindBool("playing") == false, "a paused video is not playing");
  auto audio = NormalizeLinuxPageMessage(LinuxPageMessageKind::kNowPlaying, Dict(base::DictValue()
      .Set("playbackState", "playing").Set("hasVideo", 1)));
  Expect(audio && audio->data.GetDict().FindBool("hasVideo") == false, "only a boolean true is a video");
  auto gone = NormalizeLinuxPageMessage(LinuxPageMessageKind::kNowPlaying, base::Value());
  Expect(gone && gone->data.is_none(), "null now playing clears the document's video");
  Expect(!NormalizeLinuxPageMessage(LinuxPageMessageKind::kNowPlaying, base::Value("playing")), "now playing needs a dictionary or null");

  auto clear = NormalizeLinuxPageMessage(LinuxPageMessageKind::kSelection, base::Value());
  Expect(clear && clear->data.is_none(), "null selection clears");
  auto selection = NormalizeLinuxPageMessage(LinuxPageMessageKind::kSelection, Dict(base::DictValue().Set("text", "hello")
      .Set("rect", base::DictValue().Set("x", 1.5).Set("y", 2).Set("width", 30).Set("height", 12)).Set("frame", "secret")));
  Expect(selection && *selection->data.GetDict().FindString("text") == "hello" && !selection->data.GetDict().Find("frame"), "selection copied");
  auto infinite = NormalizeLinuxPageMessage(LinuxPageMessageKind::kSelection, Dict(base::DictValue().Set("text", "x")
      .Set("rect", base::DictValue().Set("x", std::numeric_limits<double>::infinity()).Set("y", 0).Set("width", 1).Set("height", 1))));
  Expect(infinite && infinite->data.is_none(), "non-finite rectangle clears");
  auto long_text = NormalizeLinuxPageMessage(LinuxPageMessageKind::kSelection, Dict(base::DictValue().Set("text", std::string(4001, 'a'))
      .Set("rect", base::DictValue().Set("x", 0).Set("y", 0).Set("width", 1).Set("height", 1))));
  Expect(long_text && long_text->data.is_none(), "oversized selection clears");
  auto selection_of = [](std::string text) {
    return NormalizeLinuxPageMessage(LinuxPageMessageKind::kSelection, Dict(base::DictValue().Set("text", std::move(text))
        .Set("rect", base::DictValue().Set("x", 0).Set("y", 0).Set("width", 1).Set("height", 1))));
  };
  std::string cjk;
  for (int i = 0; i < 2000; ++i) cjk += "\xe6\x96\x87";
  Expect(!selection_of(cjk)->data.is_none(), "2000 CJK characters are 2000 UTF-16 units");
  std::string cjk_limit;
  for (int i = 0; i < 4000; ++i) cjk_limit += "\xe6\x96\x87";
  Expect(!selection_of(cjk_limit)->data.is_none(), "4000 CJK characters fit");
  Expect(selection_of(cjk_limit + "\xe6\x96\x87")->data.is_none(), "4001 CJK characters clear");
  std::string emoji;
  for (int i = 0; i < 2000; ++i) emoji += "\xf0\x9f\x98\x80";
  Expect(!selection_of(emoji)->data.is_none(), "2000 astral characters are 4000 UTF-16 units");
  Expect(selection_of(emoji + "a")->data.is_none(), "4001 UTF-16 units clear");

  auto theme = NormalizeLinuxPageMessage(LinuxPageMessageKind::kTheme, Dict(base::DictValue().Set("color", "#A1B2C3").Set("source", "header")));
  Expect(theme && *theme->data.GetDict().FindString("color") == "#a1b2c3", "theme lowercased");
  for (const char* color : {"red", "#abc", "#12345g", "#1234567", "url(javascript:1)", "#ABCDEF\"}"}) {
    auto refused = NormalizeLinuxPageMessage(LinuxPageMessageKind::kTheme, Dict(base::DictValue().Set("color", color).Set("source", "header")));
    Expect(refused && refused->data.is_none(), color);
  }
  auto source = NormalizeLinuxPageMessage(LinuxPageMessageKind::kTheme, Dict(base::DictValue().Set("color", "#000000").Set("source", "shell")));
  Expect(source && source->data.is_none(), "unknown theme source clears");

  auto peek = NormalizeLinuxPageMessage(LinuxPageMessageKind::kPeek, Dict(base::DictValue().Set("url", "HTTPS://Example.test/a").Set("key", "shift")
      .Set("origin", "HTTPS://Example.test").Set("x", 10).Set("y", 20).Set("moved", 1)));
  Expect(peek && *peek->data.GetDict().FindString("origin") == "https://example.test" && peek->data.GetDict().FindDouble("x"), "peek copied");
  for (const char* url : {"javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "chrome://ardia/", "ardia://settings", "http://", "https:/x"}) {
    Expect(!NormalizeLinuxPageMessage(LinuxPageMessageKind::kPeek, Dict(base::DictValue().Set("url", url).Set("key", "shift"))), url);
  }
  Expect(!NormalizeLinuxPageMessage(LinuxPageMessageKind::kPeek, Dict(base::DictValue().Set("url", "https://a.test/").Set("key", "ctrl"))), "unknown peek key");
  Expect(!NormalizeLinuxPageMessage(LinuxPageMessageKind::kPeek, Dict(base::DictValue().Set("url", "https://a.test/" + std::string(8192, 'a')).Set("key", "alt"))), "long url");

  base::Value deep = base::Value(base::DictValue());
  for (int i = 0; i < 6; ++i) deep = Dict(base::DictValue().Set("state", std::move(deep)));
  Expect(!NormalizeLinuxPageMessage(LinuxPageMessageKind::kScroll, deep), "deep payload refused");
  auto hello = NormalizeLinuxPageMessage(LinuxPageMessageKind::kHello, Dict(base::DictValue().Set("url", "https://evil.test/").Set("top", true)));
  Expect(hello && hello->data.GetDict().empty(), "hello carries nothing forward");
}

void Budget() {
  LinuxPageMessageBudget budget;
  int admitted = 0;
  for (int i = 0; i < 100; ++i) admitted += budget.Admit(10.0, 16);
  Expect(admitted == 64, "burst capped at 64 messages");
  Expect(!budget.muted(), "a single burst does not mute");
  Expect(budget.Admit(10.5, 16), "tokens refill over time");
  LinuxPageMessageBudget bytes;
  Expect(!bytes.Admit(0, 600 * 1024), "a message larger than the byte bucket is refused");
  Expect(bytes.Admit(0, 64 * 1024), "a full message fits");
  LinuxPageMessageBudget flood;
  for (int i = 0; i < 2000; ++i) flood.Admit(1.0, 16);
  Expect(flood.muted(), "a sustained flood mutes the document");
  Expect(!flood.Admit(100.0, 16), "muted stays muted");
  flood.Reset();
  Expect(!flood.muted() && flood.Admit(100.0, 16), "a new document starts with a fresh budget");
  LinuxPageMessageBudget backwards;
  Expect(backwards.Admit(5, 1), "first");
  for (int i = 0; i < 63; ++i) backwards.Admit(5, 1);
  Expect(!backwards.Admit(1, 1), "a clock going backwards does not refill");
}

void Options() {
  LinuxPageOptions options;
  Expect(options.peek == "shift" && options.EffectiveSplit() == "altShift", "defaults match macOS");
  Expect(options.ActionFor("shift") == std::optional<std::string>("peek"), "shift peeks");
  Expect(options.ActionFor("altShift") == std::optional<std::string>("split"), "alt-shift splits");
  Expect(!options.ActionFor("alt"), "alt does nothing by default");
  Expect(options.SetSplit("alt") && options.EffectiveSplit() == "alt" && options.ActionFor("alt") == std::optional<std::string>("split"), "alt split");
  Expect(options.SetPeek("alt") && options.EffectiveSplit() == "altShift", "alt peek takes alt back from split");
  Expect(options.SetPeek("bogus") && options.peek == "off" && !options.ActionFor("shift"), "unknown peek modifier turns peek off");
  Expect(!options.SetPeek("off"), "unchanged");
  auto main = options.PageConfig(true);
  auto child = options.PageConfig(false);
  Expect(main.FindBool("selectionPopover") && !child.Find("selectionPopover"), "selection popover only for the main frame");
  Expect(!main.Find("blockAutoplay") && !child.Find("blockAutoplay"), "autoplay allowed by default");
  Expect(options.PageConfig(true, true).FindBool("blockAutoplay") == true, "blocked autoplay reaches the main frame");
  Expect(options.PageConfig(false, true).FindBool("blockAutoplay") == true, "blocked autoplay reaches subframes");
  Expect(!options.PageConfig(true, true).Find("displayMediaPicker"), "Chromium's own capture picker stays");
}

LinuxLinkRequest Request(uintptr_t surface, const char* key, double now) {
  LinuxLinkRequest request;
  request.surface = surface;
  request.key = key;
  request.http = true;
  request.visible = true;
  request.now = now;
  return request;
}

void Gestures() {
  LinuxPageOptions options;
  LinuxLinkGestureGate gate;
  Expect(gate.Decide(Request(1, "shift", 0), options).refused == "no left mouse-up yet", "a page cannot peek without real input");
  gate.NoteRelease(1, kLinuxLinkShift, 1.0, LinuxLinkPoint{40, 50});
  auto peek = gate.Decide(Request(1, "shift", 1.2), options);
  Expect(peek.outcome == LinuxLinkOutcome::kPeek && peek.point && peek.point->x == 40, "real shift mouse-up peeks");
  auto again = gate.Decide(Request(1, "shift", 1.3), options);
  Expect(again.outcome == LinuxLinkOutcome::kNone && again.refused == "that mouse-up already opened a peek", "one peek per mouse-up");

  gate.NoteRelease(2, kLinuxLinkShift, 2.0, std::nullopt);
  auto other = gate.Decide(Request(1, "shift", 2.1), options);
  Expect(other.outcome == LinuxLinkOutcome::kNone && other.refused == "the mouse-up wasn't over this page", "background tab cannot use another tab's click");
  Expect(gate.Decide(Request(2, "shift", 2.2), options).outcome == LinuxLinkOutcome::kPeek, "the clicked tab can still peek");

  gate.NoteRelease(1, kLinuxLinkAlt | kLinuxLinkShift, 3.0, std::nullopt);
  Expect(gate.Decide(Request(1, "altShift", 3.1), options).outcome == LinuxLinkOutcome::kSplit, "alt-shift splits");

  gate.NoteRelease(1, 0, 4.0, std::nullopt);
  auto forged = gate.Decide(Request(1, "shift", 4.1), options);
  Expect(forged.outcome == LinuxLinkOutcome::kNone, "a plain click cannot be upgraded to a peek by the page");

  gate.NoteRelease(1, kLinuxLinkShift, 5.0, std::nullopt);
  gate.NotePress(1);
  Expect(gate.Decide(Request(1, "shift", 5.1), options).refused == "the mouse was pressed again since that mouse-up", "pressed since");

  gate.NoteRelease(1, kLinuxLinkShift, 6.0, std::nullopt);
  auto stale = gate.Decide(Request(1, "shift", 17.0), options);
  Expect(stale.refused == "the last mouse-up is too old" && stale.outcome == LinuxLinkOutcome::kWindow, "old shift-click falls back to a new window");

  gate.NoteRelease(1, kLinuxLinkShift, 20.0, std::nullopt);
  auto hidden = Request(1, "shift", 20.1);
  hidden.visible = false;
  Expect(gate.Decide(hidden, options).outcome == LinuxLinkOutcome::kWindow, "hidden page falls back like the click would");

  options.SetPeek("off");
  options.SetSplit("alt");
  gate.NoteRelease(1, kLinuxLinkAlt, 30.0, std::nullopt);
  Expect(gate.Decide(Request(1, "alt", 30.1), options).outcome == LinuxLinkOutcome::kSplit, "alt split when peek is off");
  options.SetSplit("altShift");
  gate.NoteRelease(1, kLinuxLinkAlt, 31.0, std::nullopt);
  auto same = Request(1, "alt", 31.1);
  same.same_origin = true;
  Expect(gate.Decide(same, options).outcome == LinuxLinkOutcome::kDownload, "same-origin alt-click downloads");
  gate.NoteRelease(1, kLinuxLinkAlt, 32.0, std::nullopt);
  Expect(gate.Decide(Request(1, "alt", 32.1), options).outcome == LinuxLinkOutcome::kBackground, "cross-origin alt-click opens in background");

  gate.NoteRelease(1, kLinuxLinkShift, 40.0, std::nullopt);
  gate.Forget(1);
  Expect(gate.Decide(Request(1, "shift", 40.1), LinuxPageOptions()).refused == "the mouse-up wasn't over this page", "destroyed surface forgets its release");
  gate.NoteRelease(3, kLinuxLinkShift, 41.0, std::nullopt);
  Expect(gate.Decide(Request(0, "shift", 41.1), LinuxPageOptions()).outcome == LinuxLinkOutcome::kNone, "unknown surface never matches");
}

void LinkDrops() {
  auto drop = NormalizeLinuxPageMessage(LinuxPageMessageKind::kLinkDrop, Dict(base::DictValue().Set("url", "https://ardia.test/a").Set("x", 1)));
  Expect(drop && *drop->data.GetDict().FindString("url") == "https://ardia.test/a" && drop->data.GetDict().size() == 1, "link drop rebuilt from its url");
  for (const char* url : {"javascript:alert(1)", "file:///etc/passwd", "chrome://ardia/", "data:text/html,x", ""})
    Expect(!NormalizeLinuxPageMessage(LinuxPageMessageKind::kLinkDrop, Dict(base::DictValue().Set("url", url))), url);
  Expect(!NormalizeLinuxPageMessage(LinuxPageMessageKind::kLinkDrop, Dict(base::DictValue().Set("url", "https://a.test/" + std::string(8192, 'a')))), "oversized link drop");
  Expect(!NormalizeLinuxPageMessage(LinuxPageMessageKind::kLinkDrop, base::Value("https://ardia.test/")), "link drop needs a dict");

  LinuxLinkGestureGate gate;
  Expect(gate.AcceptLinkDrop(1, true, 1.0) == "no drag from this page ended", "a page cannot drop without a real drag");
  Expect(gate.DragSource() == 0, "no press, no drag source");
  gate.NotePress(1);
  Expect(gate.DragSource() == 1, "the pressed page is the drag source");
  gate.NoteDrop(1);
  gate.NoteDragEnded(1, 2.0);
  Expect(gate.DragSource() == 0, "a drag end consumes the press");
  Expect(gate.AcceptLinkDrop(2, true, 2.1) == "the drag ended on another page", "another page cannot use the drop");
  Expect(gate.AcceptLinkDrop(1, false, 2.1) == "page not shown", "hidden pages cannot open a drop");
  Expect(gate.AcceptLinkDrop(1, true, 2.2).empty(), "a real drag that ended over the page opens");
  Expect(gate.AcceptLinkDrop(1, true, 2.3) == "that drag already opened a link", "one link per drag");

  gate.NotePress(1);
  gate.NoteDragEnded(1, 3.0);
  Expect(gate.AcceptLinkDrop(1, true, 3.1) == "the drag ended outside the page", "a drag with no drop on an Ardia page opens nothing");

  gate.NotePress(1);
  gate.NoteDrop(2);
  gate.NoteDragEnded(1, 3.5);
  Expect(gate.AcceptLinkDrop(1, true, 3.6) == "the drag ended outside the page", "a drop on another window's page opens nothing");

  gate.NotePress(1);
  gate.NoteDrop(1);
  gate.NoteDrop(0);
  gate.NoteDragEnded(1, 3.7);
  Expect(gate.AcceptLinkDrop(1, true, 3.8) == "the drag ended outside the page", "the last drop of the drag decides, and the shell is no page");

  gate.NoteDrop(1);
  gate.NotePress(1);
  gate.NoteDragEnded(1, 3.9);
  Expect(gate.AcceptLinkDrop(1, true, 3.95) == "the drag ended outside the page", "a drop before the drag's press does not count");

  gate.NotePress(1);
  gate.NoteDrop(1);
  gate.NoteDragEnded(1, 4.0);
  Expect(gate.AcceptLinkDrop(1, true, 4.0 + LinuxLinkGestureGate::kDropLifetime + 0.1) == "the drag ended too long ago", "stale drop");

  gate.NotePress(1);
  gate.NoteDrop(1);
  gate.NoteDragEnded(1, 10.0);
  gate.NotePress(1);
  Expect(gate.AcceptLinkDrop(1, true, 10.1) == "the mouse was pressed again since the drag ended", "pressed since the drop");

  gate.NotePress(1);
  gate.NoteRelease(1, 0, 20.0, std::nullopt);
  Expect(gate.DragSource() == 0, "a release that reached the page is a click, not a drag");
  gate.NoteDrop(1);
  gate.NoteDragEnded(1, 20.1);
  Expect(gate.AcceptLinkDrop(1, true, 20.2) == "the mouse was pressed again since the drag ended", "a drag end without a pending press is ignored");
  gate.NotePress(1);
  gate.NoteDrop(1);
  gate.NoteDragEnded(0, 21.0);
  Expect(!gate.AcceptLinkDrop(1, true, 21.1).empty() && gate.DragSource() == 1, "an unknown source never matches");

  gate.NotePress(1);
  gate.NoteRelease(1, kLinuxLinkShift, 50.0, LinuxLinkPoint{4, 4}, true);
  Expect(gate.DragSource() == 1, "the release that ends a drag keeps the drag source");
  gate.NoteDrop(1);
  gate.NoteDragEnded(1, 50.1);
  Expect(gate.AcceptLinkDrop(1, true, 50.2).empty(), "a drag the platform ended with a release still opens its link");
  Expect(gate.Decide(Request(1, "shift", 50.3), LinuxPageOptions()).outcome == LinuxLinkOutcome::kNone,
         "the release that ends a drag is no click");

  gate.NotePress(5);
  gate.NoteDrop(5);
  gate.NoteDragEnded(5, 30.0);
  gate.Forget(5);
  Expect(gate.AcceptLinkDrop(5, true, 30.1) == "no drag from this page ended", "destroyed surface forgets its drop");
}

void DragOver() {
  LinuxDragOver own_page;
  Expect(!own_page.Over(), "no drag yet");
  own_page.Entered();
  own_page.Entered();
  const uint64_t release = own_page.Exited();
  Expect(own_page.Over(), "a refused drop on its own page: the leave and the drag end come in one batch, before the exit settles");
  own_page.Settle(release);
  Expect(!own_page.Over(), "once the exit settles the pointer has left");

  LinuxDragOver outside;
  outside.Entered();
  outside.Settle(outside.Exited());
  Expect(!outside.Over(), "a drag that left the page before it ended was not over it");

  LinuxDragOver returned;
  returned.Entered();
  const uint64_t left = returned.Exited();
  returned.Entered();
  returned.Settle(left);
  Expect(returned.Over(), "a stale exit doesn't undo coming back");

  LinuxDragOver never;
  never.Settle(never.Exited());
  Expect(!never.Over(), "an exit without an entry is never over");

  LinuxDragOver performed;
  performed.Entered();
  performed.Reset();
  Expect(!performed.Over(), "a new press forgets an earlier drag whose drop was performed without an exit");
  const uint64_t stale = performed.Exited();
  performed.Reset();
  performed.Entered();
  performed.Settle(stale);
  Expect(performed.Over(), "an exit from before the press doesn't undo the new drag");
}

void Activity() {
  LinuxInputActivity activity;
  Expect(activity.Note(10.0), "first input is announced");
  Expect(!activity.Note(10.2), "inputs inside the interval are folded");
  Expect(!activity.Note(10.0 + LinuxInputActivity::kInterval - 0.01), "still folded");
  Expect(activity.Note(10.0 + LinuxInputActivity::kInterval), "announced again after the interval");
  Expect(activity.Note(5.0), "a clock that went backwards announces");
  Expect(!activity.Note(5.1), "and folds again");
}

std::string FakeDigest(std::string_view text) { return "d" + std::to_string(text.size()) + ":" + std::string(text.substr(0, 4)); }

constexpr LinuxPageOperation kOperations[] = {
    {"exact", 12, "d12:post", LinuxPageOperationArgs::kNone},
    {"replace", 7, "d7:(fn)", LinuxPageOperationArgs::kReplace},
};

std::optional<base::Value> ParseThree(std::string_view json) {
  if (json == "[\"a\", \"b\", true]") return base::Value(base::ListValue().Append("a").Append("b").Append(true));
  if (json == "[\"</script>\\u2028\", \"\\\"\", false]")
    return base::Value(base::ListValue().Append("</script>\xe2\x80\xa8").Append("\"").Append(false));
  if (json == "[\"a\", 1, true]") return base::Value(base::ListValue().Append("a").Append(1).Append(true));
  return std::nullopt;
}

void Evaluation() {
  Expect(MatchLinuxPageOperation("post('x', 1)", FakeDigest, kOperations)->operation->name == "exact", "exact match");
  Expect(!MatchLinuxPageOperation("post('x', 2) ", FakeDigest, kOperations), "length mismatch");
  Expect(!MatchLinuxPageOperation("alert(document.cookie)", FakeDigest, kOperations), "arbitrary code refused");
  Expect(!MatchLinuxPageOperation("", FakeDigest, kOperations), "empty refused");
  Expect(!MatchLinuxPageOperation(std::string(65 * 1024, 'p'), FakeDigest, kOperations), "oversized refused");

  auto script = LinuxPageEvaluationScript("(fn)()(\"a\", \"b\", true)", FakeDigest, ParseThree, kOperations);
  Expect(script && script->find("(fn)()(\"a\", \"b\", true)") != std::string::npos, "replace arguments rebuilt");
  auto escaped = LinuxPageEvaluationScript("(fn)()(\"</script>\\u2028\", \"\\\"\", false)", FakeDigest, ParseThree, kOperations);
  Expect(escaped && escaped->find("\\u003c/script\\u003e\\u2028") != std::string::npos && escaped->find("\"\\\"\"") != std::string::npos,
         "arguments re-escaped by the host");
  Expect(!LinuxPageEvaluationScript("(fn)()(\"a\", 1, true)", FakeDigest, ParseThree, kOperations), "argument types enforced");
  Expect(!LinuxPageEvaluationScript("(fn)()(\"a\"), alert(1), (\"b\", true)", FakeDigest, ParseThree, kOperations), "injected arguments refused");
  Expect(!LinuxPageEvaluationScript("(fn)()(\"a\", \"b\", true)x", FakeDigest, ParseThree, kOperations), "suffix enforced");

  auto wrapped = LinuxPageEvaluationScript("post('x', 1)", FakeDigest, ParseThree, kOperations);
  Expect(wrapped && wrapped->starts_with("(() => {") && wrapped->find("const post =") != std::string::npos &&
         wrapped->ends_with("})()"), "wrapper supplies post");
  Expect(LinuxPageEvaluationResult(base::Value("{\"a\":1}")) == std::optional<std::string>("{\"a\":1}"), "string result");
  Expect(!LinuxPageEvaluationResult(base::Value(1)), "non-string result");
  Expect(!LinuxPageEvaluationResult(base::Value(std::string(4 * 1024 * 1024 + 1, 'x'))), "oversized result");
  Expect(LinuxJavaScriptString("a\nb\\") == "\"a\\u000ab\\\\\"", "control characters escaped");
}

}

void NowPlayingReports() {
  Expect(kLinuxNowPlayingBytesMax == 1280 * 1024, "a page's now playing report may be as large as on macOS");
  Expect(LinuxNowPlayingReport(false, true, "playing") == "null", "no state is null");
  Expect(LinuxNowPlayingReport(true, true, "playing") == R"({"hasVideo":true,"playbackState":"playing"})", "a playing video");
  Expect(LinuxNowPlayingReport(true, false, "paused") == R"({"hasVideo":false,"playbackState":"paused"})", "paused audio");
  Expect(LinuxNowPlayingReport(true, true, "none") == R"({"hasVideo":true,"playbackState":"none"})", "no session state");
  Expect(LinuxNowPlayingReport(true, true, "\"},\"x\":\"") == R"({"hasVideo":true,"playbackState":"none"})", "unknown states are none");
  Expect(LinuxNowPlayingReport(true, true, "playing").size() < 64, "the reduced report is tiny");
}

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const std::string name = argv[1];
  if (name == "kinds") Kinds();
  else if (name == "senders") Senders();
  else if (name == "normalization") Normalization();
  else if (name == "budget") Budget();
  else if (name == "options") Options();
  else if (name == "gestures") Gestures();
  else if (name == "evaluation") Evaluation();
  else if (name == "link-drops") LinkDrops();
  else if (name == "drag-over") DragOver();
  else if (name == "activity") Activity();
  else if (name == "now-playing-reports") NowPlayingReports();
  else return 2;
  return 0;
}
