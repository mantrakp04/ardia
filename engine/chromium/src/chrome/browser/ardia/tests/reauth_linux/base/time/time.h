#pragma once
#include <cstdint>
namespace base {
class TimeDelta {
 public:
  constexpr TimeDelta() = default;
  static constexpr TimeDelta FromMs(int64_t ms) { TimeDelta delta; delta.ms_ = ms; return delta; }
  constexpr int64_t InMilliseconds() const { return ms_; }
  constexpr bool is_positive() const { return ms_ > 0; }

 private:
  int64_t ms_ = 0;
};
constexpr TimeDelta Milliseconds(int64_t ms) { return TimeDelta::FromMs(ms); }
constexpr TimeDelta Seconds(int64_t seconds) { return TimeDelta::FromMs(seconds * 1000); }
class TimeTicks {
 public:
  static inline int64_t now_ms = 1000000;
  constexpr TimeTicks() = default;
  static TimeTicks Now() { TimeTicks ticks; ticks.ms_ = now_ms; return ticks; }
  TimeDelta operator-(TimeTicks other) const { return Milliseconds(ms_ - other.ms_); }

 private:
  int64_t ms_ = 0;
};
}
