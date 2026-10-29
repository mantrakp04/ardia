#include "ardia/linux/ac_linux_page_messages.h"

#include <algorithm>
#include <cmath>
#include <initializer_list>
#include <iterator>
#include <utility>

namespace ardiacore {

namespace {

constexpr std::string_view kLinkKeys[] = {"alt", "shift", "altShift", "altMeta"};

bool OneOf(std::string_view value, std::initializer_list<std::string_view> allowed) {
  return std::find(allowed.begin(), allowed.end(), value) != allowed.end();
}

size_t Utf16Length(std::string_view text) {
  size_t units = 0;
  for (unsigned char c : text) {
    if ((c & 0xc0) == 0x80) continue;
    units += c >= 0xf0 ? 2 : 1;
  }
  return units;
}

const std::string* BoundedString(const base::DictValue& dict, std::string_view key, size_t limit) {
  const std::string* value = dict.FindString(key);
  return value && value->size() <= limit && value->find('\0') == std::string::npos ? value : nullptr;
}

std::optional<double> Finite(const base::DictValue& dict, std::string_view key) {
  auto value = dict.FindDouble(key);
  return value && std::isfinite(*value) ? value : std::nullopt;
}

bool HexColor(std::string_view color) {
  return color.size() == 7 && color[0] == '#' && std::all_of(color.begin() + 1, color.end(), [](char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
  });
}

std::string Lower(std::string_view text) {
  std::string out(text);
  std::transform(out.begin(), out.end(), out.begin(), [](char c) {
    return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c;
  });
  return out;
}

std::optional<LinuxPageMessage> Message(LinuxPageMessageKind kind, base::Value data) {
  return LinuxPageMessage{kind, std::move(data)};
}

std::optional<LinuxPageMessage> Peek(const base::DictValue& dict) {
  const std::string* url = BoundedString(dict, "url", kLinuxPageUrlMax);
  const std::string* key = BoundedString(dict, "key", 8);
  if (!url || !IsLinuxPageHttpUrl(*url) || !key ||
      std::find(std::begin(kLinkKeys), std::end(kLinkKeys), *key) == std::end(kLinkKeys)) {
    return std::nullopt;
  }
  base::DictValue data;
  data.Set("url", *url);
  data.Set("key", *key);
  if (const std::string* origin = BoundedString(dict, "origin", 1024)) data.Set("origin", Lower(*origin));
  auto x = Finite(dict, "x");
  auto y = Finite(dict, "y");
  if (x && y) {
    data.Set("x", *x);
    data.Set("y", *y);
  }
  return Message(LinuxPageMessageKind::kPeek, base::Value(std::move(data)));
}

base::Value Selection(const base::Value& value) {
  const base::DictValue* dict = value.GetIfDict();
  const std::string* text = dict ? BoundedString(*dict, "text", kLinuxSelectionTextMax * 3) : nullptr;
  if (text && Utf16Length(*text) > kLinuxSelectionTextMax) text = nullptr;
  const base::DictValue* rect = dict ? dict->FindDict("rect") : nullptr;
  if (!text || text->empty() || !rect) return base::Value();
  auto x = Finite(*rect, "x");
  auto y = Finite(*rect, "y");
  auto width = Finite(*rect, "width");
  auto height = Finite(*rect, "height");
  if (!x || !y || !width || !height || *width < 0 || *height < 0) return base::Value();
  return base::Value(base::DictValue().Set("text", *text).Set("rect", base::DictValue()
      .Set("x", *x).Set("y", *y).Set("width", *width).Set("height", *height)));
}

base::Value Theme(const base::Value& value) {
  const base::DictValue* dict = value.GetIfDict();
  const std::string* color = dict ? BoundedString(*dict, "color", 64) : nullptr;
  const std::string* source = dict ? BoundedString(*dict, "source", 32) : nullptr;
  if (!color || !HexColor(*color) || !source || !OneOf(*source, {"meta", "header", "background"})) return base::Value();
  return base::Value(base::DictValue().Set("color", Lower(*color)).Set("source", *source));
}

size_t Depth(const base::Value& value) {
  if (const base::DictValue* dict = value.GetIfDict()) {
    size_t deepest = 0;
    for (const auto [key, child] : *dict) deepest = std::max(deepest, Depth(child));
    return deepest + 1;
  }
  if (value.is_list()) {
    size_t deepest = 0;
    for (const auto& child : value.GetList()) deepest = std::max(deepest, Depth(child));
    return deepest + 1;
  }
  return 0;
}

}

std::optional<LinuxPageMessageKind> LinuxPageMessageKindOf(std::string_view kind) {
  if (kind == "hello") return LinuxPageMessageKind::kHello;
  if (kind == "peekHello") return LinuxPageMessageKind::kPeekHello;
  if (kind == "peekGone") return LinuxPageMessageKind::kPeekGone;
  if (kind == "peek") return LinuxPageMessageKind::kPeek;
  if (kind == "selection") return LinuxPageMessageKind::kSelection;
  if (kind == "scroll") return LinuxPageMessageKind::kScroll;
  if (kind == "theme") return LinuxPageMessageKind::kTheme;
  if (kind == "linkDrop") return LinuxPageMessageKind::kLinkDrop;
  if (kind == "nowPlaying") return LinuxPageMessageKind::kNowPlaying;
  return std::nullopt;
}

bool LinuxPageMessageFromMainOnly(LinuxPageMessageKind kind) {
  return kind == LinuxPageMessageKind::kSelection || kind == LinuxPageMessageKind::kScroll ||
         kind == LinuxPageMessageKind::kTheme || kind == LinuxPageMessageKind::kLinkDrop;
}

bool LinuxPageMessageEnvelopeFits(std::string_view kind, std::string_view json) {
  return !kind.empty() && kind.size() <= kLinuxPageMessageKindMax && json.size() <= kLinuxPageMessageBytesMax &&
         kind.find('\0') == std::string_view::npos;
}

bool LinuxPageSenderAccepted(LinuxPageMessageKind kind, const LinuxPageSender& sender) {
  if (!sender.primary || !sender.active) return false;
  return sender.main || !LinuxPageMessageFromMainOnly(kind);
}

bool IsLinuxPageHttpUrl(std::string_view url) {
  const std::string lower = Lower(url.substr(0, 8));
  return (lower.starts_with("http://") && url.size() > 7) || (lower.starts_with("https://") && url.size() > 8);
}

std::string LinuxNowPlayingReport(bool present, bool has_video, std::string_view playback_state) {
  if (!present) return "null";
  const std::string_view state = OneOf(playback_state, {"playing", "paused"}) ? playback_state : "none";
  return std::string(R"({"hasVideo":)") + (has_video ? "true" : "false") + R"(,"playbackState":")" +
         std::string(state) + R"("})";
}

std::optional<LinuxPageMessage> NormalizeLinuxPageMessage(LinuxPageMessageKind kind, const base::Value& value) {
  if (Depth(value) > kLinuxPageMessageDepthMax) return std::nullopt;
  const base::DictValue* dict = value.GetIfDict();
  switch (kind) {
    case LinuxPageMessageKind::kHello:
    case LinuxPageMessageKind::kPeekHello:
    case LinuxPageMessageKind::kPeekGone:
      return Message(kind, base::Value(base::DictValue()));
    case LinuxPageMessageKind::kPeek:
      return dict ? Peek(*dict) : std::nullopt;
    case LinuxPageMessageKind::kSelection:
      return Message(kind, Selection(value));
    case LinuxPageMessageKind::kScroll: {
      const std::string* state = dict ? BoundedString(*dict, "state", 8) : nullptr;
      if (!state || !OneOf(*state, {"down", "up", "top"})) return std::nullopt;
      return Message(kind, base::Value(base::DictValue().Set("state", *state)));
    }
    case LinuxPageMessageKind::kTheme:
      return Message(kind, Theme(value));
    case LinuxPageMessageKind::kLinkDrop: {
      const std::string* url = dict ? BoundedString(*dict, "url", kLinuxPageUrlMax) : nullptr;
      if (!url || !IsLinuxPageHttpUrl(*url)) return std::nullopt;
      return Message(kind, base::Value(base::DictValue().Set("url", *url)));
    }
    case LinuxPageMessageKind::kNowPlaying: {
      if (value.is_none()) return Message(kind, base::Value());
      if (!dict) return std::nullopt;
      const std::string* state = BoundedString(*dict, "playbackState", 8);
      return Message(kind, base::Value(base::DictValue()
          .Set("hasVideo", dict->FindBool("hasVideo").value_or(false))
          .Set("playing", state && *state == "playing")));
    }
  }
  return std::nullopt;
}

bool LinuxPageMessageBudget::Admit(double now_seconds, size_t bytes) {
  if (muted_) return false;
  if (at_ >= 0 && now_seconds > at_) {
    const double elapsed = now_seconds - at_;
    messages_ = std::min(kMessages, messages_ + elapsed * kMessagesPerSecond);
    bytes_ = std::min(kBytes, bytes_ + elapsed * kBytesPerSecond);
  }
  if (at_ < 0 || now_seconds > at_) at_ = now_seconds;
  const double cost = static_cast<double>(bytes);
  if (messages_ >= 1 && bytes_ >= cost) {
    messages_ -= 1;
    bytes_ -= cost;
    return true;
  }
  if (++refusals_ >= kRefusalsBeforeMute) muted_ = true;
  return false;
}

void LinuxPageMessageBudget::Reset() {
  *this = LinuxPageMessageBudget();
}

bool LinuxPageOptions::SetPeek(std::string_view modifier) {
  std::string next = OneOf(modifier, {"alt", "shift"}) ? std::string(modifier) : "off";
  if (next == peek) return false;
  peek = std::move(next);
  return true;
}

bool LinuxPageOptions::SetSplit(std::string_view modifier) {
  std::string next = modifier == "alt" ? "alt" : "altShift";
  if (next == split) return false;
  split = std::move(next);
  return true;
}

std::string LinuxPageOptions::EffectiveSplit() const {
  return split == "alt" && peek != "alt" ? "alt" : "altShift";
}

std::optional<std::string> LinuxPageOptions::ActionFor(std::string_view key) const {
  if (std::find(std::begin(kLinkKeys), std::end(kLinkKeys), key) == std::end(kLinkKeys)) return std::nullopt;
  if (key == peek) return std::string("peek");
  if (key == "altShift" || key == "altMeta" || key == EffectiveSplit()) return std::string("split");
  return std::nullopt;
}

base::DictValue LinuxPageOptions::PeekConfig() const {
  return base::DictValue().Set("modifier", peek).Set("split", EffectiveSplit()).Set("trace", false);
}

base::DictValue LinuxPageOptions::PageConfig(bool main, bool block_autoplay) const {
  base::DictValue config;
  config.Set("peek", peek);
  config.Set("split", EffectiveSplit());
  if (main) config.Set("selectionPopover", selection_popover);
  if (block_autoplay) config.Set("blockAutoplay", true);
  return config;
}

}
