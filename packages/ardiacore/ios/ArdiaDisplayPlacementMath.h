#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>

namespace ardia_display {

struct Rect {
  double x, y, w, h;
  double maxX() const { return x + w; }
  double maxY() const { return y + h; }
};

inline double OverlapArea(Rect a, Rect b) {
  const double w = std::min(a.maxX(), b.maxX()) - std::max(a.x, b.x);
  const double h = std::min(a.maxY(), b.maxY()) - std::max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

inline bool HoldsMost(Rect frame, const Rect *screens, size_t count, size_t target) {
  const double mine = OverlapArea(frame, screens[target]);
  if (mine <= 0) return false;
  for (size_t i = 0; i < count; i++)
    if (i != target && OverlapArea(frame, screens[i]) > mine) return false;
  return true;
}

inline Rect Centered(Rect frame, Rect visible) {
  const double w = std::min(frame.w, visible.w), h = std::min(frame.h, visible.h);
  return {std::round(visible.x + (visible.w - w) / 2), std::round(visible.y + (visible.h - h) / 2), w, h};
}

inline Rect Contained(Rect frame, Rect visible) {
  const double w = std::min(frame.w, visible.w), h = std::min(frame.h, visible.h);
  return {std::clamp(frame.x, visible.x, visible.maxX() - w), std::clamp(frame.y, visible.y, visible.maxY() - h), w, h};
}

inline Rect OnScreen(Rect frame, const Rect *screens, size_t count, size_t target, Rect visible) {
  return HoldsMost(frame, screens, count, target) ? Contained(frame, visible) : Centered(frame, visible);
}

}
