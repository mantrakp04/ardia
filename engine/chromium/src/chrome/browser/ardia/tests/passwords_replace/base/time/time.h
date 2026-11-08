#pragma once
#include <cstdint>
namespace base {
class TimeDelta {
 public:
  constexpr TimeDelta() = default;
  static constexpr TimeDelta FromMs(int64_t ms) {
    TimeDelta delta;
    delta.ms_ = ms;
    return delta;
  }

 private:
  int64_t ms_ = 0;
};
constexpr TimeDelta Milliseconds(int64_t ms) { return TimeDelta::FromMs(ms); }
constexpr TimeDelta Seconds(int64_t seconds) { return TimeDelta::FromMs(seconds * 1000); }
class Time {
 public:
  static inline int64_t now = 1000;
  static Time Now() {
    Time time;
    time.value_ = ++now;
    return time;
  }
  bool is_null() const { return value_ == 0; }
  bool operator==(const Time&) const = default;

 private:
  int64_t value_ = 0;
};
}
