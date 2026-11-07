#ifndef ARDIA_LINUX_AC_LINUX_TYPEAHEAD_H_
#define ARDIA_LINUX_AC_LINUX_TYPEAHEAD_H_

#include <algorithm>
#include <cstddef>
#include <utility>
#include <vector>

namespace ardia::linux_window {

template <typename Event>
class Typeahead {
 public:
  static constexpr size_t kMaxEvents = 512;

  void Start() {
    if (state_ == State::kIdle) state_ = State::kCapturing;
  }
  bool capturing() const { return state_ == State::kCapturing || state_ == State::kOverflowed; }
  bool Hold(Event event) {
    if (!capturing()) return false;
    if (state_ == State::kOverflowed) return true;
    if (held_.size() >= kMaxEvents) {
      held_.clear();
      state_ = State::kOverflowed;
      return true;
    }
    held_.push_back(std::move(event));
    return true;
  }
  void DropHeld() {
    if (!capturing()) return;
    held_.clear();
    state_ = State::kCapturing;
  }
  std::vector<Event> Release() {
    if (!capturing()) return {};
    state_ = State::kDone;
    return std::exchange(held_, {});
  }

 private:
  enum class State { kIdle, kCapturing, kOverflowed, kDone };
  State state_ = State::kIdle;
  std::vector<Event> held_;
};

enum class ShortcutKind { kNone, kShortcut, kFocusing };
enum class LiveKey { kHold, kPass, kPassAndHold };

template <typename Code>
class LiveKeys {
 public:
  LiveKey Pass(bool pressed, Code code, ShortcutKind shortcut, bool modifier) {
    const auto found = std::find(codes_.begin(), codes_.end(), code);
    if (pressed) {
      if (shortcut == ShortcutKind::kNone) return LiveKey::kHold;
      if (found == codes_.end()) codes_.push_back(code);
      return LiveKey::kPass;
    }
    if (found != codes_.end()) {
      codes_.erase(found);
      return LiveKey::kPass;
    }
    return modifier ? LiveKey::kPassAndHold : LiveKey::kHold;
  }

 private:
  std::vector<Code> codes_;
};

}

#endif
