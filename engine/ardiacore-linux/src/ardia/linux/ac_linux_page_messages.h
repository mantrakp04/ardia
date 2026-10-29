#ifndef ARDIA_LINUX_AC_LINUX_PAGE_MESSAGES_H_
#define ARDIA_LINUX_AC_LINUX_PAGE_MESSAGES_H_

#include <stddef.h>
#include <stdint.h>

#include <optional>
#include <string>
#include <string_view>

#include "base/values.h"

namespace ardiacore {

inline constexpr size_t kLinuxPageMessageKindMax = 32;
inline constexpr size_t kLinuxPageMessageBytesMax = 64 * 1024;
inline constexpr size_t kLinuxNowPlayingBytesMax = 1280 * 1024;
inline constexpr size_t kLinuxPageMessageDepthMax = 4;
inline constexpr size_t kLinuxPageUrlMax = 8192;
inline constexpr size_t kLinuxSelectionTextMax = 4000;
inline constexpr const char* kLinuxPageMessageRoutes[] = {
    "webView.setPeekModifier", "webView.setSplitLinkModifier", "webView.setSelectionPopover"};

enum class LinuxPageMessageKind {
  kHello,
  kPeekHello,
  kPeekGone,
  kPeek,
  kSelection,
  kScroll,
  kTheme,
  kLinkDrop,
  kNowPlaying,
};

struct LinuxPageMessage {
  LinuxPageMessageKind kind;
  base::Value data;
};

struct LinuxPageSender {
  bool main = false;
  bool primary = false;
  bool active = false;
};

std::optional<LinuxPageMessageKind> LinuxPageMessageKindOf(std::string_view kind);
bool LinuxPageMessageFromMainOnly(LinuxPageMessageKind kind);
bool LinuxPageMessageEnvelopeFits(std::string_view kind, std::string_view json);
bool LinuxPageSenderAccepted(LinuxPageMessageKind kind, const LinuxPageSender& sender);
std::optional<LinuxPageMessage> NormalizeLinuxPageMessage(LinuxPageMessageKind kind, const base::Value& value);
bool IsLinuxPageHttpUrl(std::string_view url);
std::string LinuxNowPlayingReport(bool present, bool has_video, std::string_view playback_state);

class LinuxPageMessageBudget {
 public:
  static constexpr double kMessages = 64;
  static constexpr double kMessagesPerSecond = 32;
  static constexpr double kBytes = 512 * 1024;
  static constexpr double kBytesPerSecond = 256 * 1024;
  static constexpr int kRefusalsBeforeMute = 256;
  bool Admit(double now_seconds, size_t bytes);
  bool muted() const { return muted_; }
  void Reset();

 private:
  double messages_ = kMessages;
  double bytes_ = kBytes;
  double at_ = -1;
  int refusals_ = 0;
  bool muted_ = false;
};

struct LinuxPageOptions {
  std::string peek = "shift";
  std::string split = "altShift";
  bool selection_popover = true;
  bool SetPeek(std::string_view modifier);
  bool SetSplit(std::string_view modifier);
  std::string EffectiveSplit() const;
  std::optional<std::string> ActionFor(std::string_view key) const;
  base::DictValue PeekConfig() const;
  base::DictValue PageConfig(bool main, bool block_autoplay = false) const;
};

}

#endif
