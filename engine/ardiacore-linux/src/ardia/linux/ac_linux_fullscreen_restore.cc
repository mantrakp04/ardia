#include "ardia/linux/ac_linux_fullscreen_restore.h"

#include <algorithm>

namespace ardia::linux_window {

namespace {

constexpr size_t kMaxWindows = 64;
constexpr size_t kMaxIdLength = 128;

bool ValidId(const std::string& id) {
  return !id.empty() && id.size() <= kMaxIdLength &&
         std::none_of(id.begin(), id.end(), [](char c) { return c == '/' || c == '\\' || c == '\0'; });
}

}

bool FullScreenRestore::Begin(const std::vector<std::string>& ids, const std::string& focus) {
  if (begun_) return false;
  begun_ = true;
  for (const auto& id : ids) {
    if (waiting_.size() == kMaxWindows) break;
    if (ValidId(id) && std::find(waiting_.begin(), waiting_.end(), id) == waiting_.end()) waiting_.push_back(id);
  }
  focus_ = ValidId(focus) ? focus : std::string();
  if (waiting_.empty()) finished_ = true;
  return !waiting_.empty();
}

bool FullScreenRestore::Wants(const std::string& id) const {
  return active() && std::find(waiting_.begin(), waiting_.end(), id) != waiting_.end();
}

bool FullScreenRestore::Enter(const std::string& id, bool already_fullscreen) {
  if (!Wants(id)) return false;
  waiting_.erase(std::find(waiting_.begin(), waiting_.end(), id));
  if (already_fullscreen) return false;
  entering_.insert(id);
  toggled_ = true;
  return true;
}

void FullScreenRestore::Entered(const std::string& id) {
  if (active()) entering_.erase(id);
}

bool FullScreenRestore::Forget(const std::string& id) {
  if (!active()) return false;
  const auto waiting = std::find(waiting_.begin(), waiting_.end(), id);
  const bool forgotten = waiting != waiting_.end() || entering_.contains(id);
  if (waiting != waiting_.end()) waiting_.erase(waiting);
  entering_.erase(id);
  return forgotten;
}

std::vector<std::string> FullScreenRestore::Expire() {
  if (!active()) return {};
  std::vector<std::string> gone = waiting_;
  gone.insert(gone.end(), entering_.begin(), entering_.end());
  waiting_.clear();
  entering_.clear();
  return gone;
}

std::optional<std::string> FullScreenRestore::Finish() {
  if (!active() || !Settled()) return std::nullopt;
  finished_ = true;
  if (!toggled_ || focus_.empty()) return std::nullopt;
  return focus_;
}

}
