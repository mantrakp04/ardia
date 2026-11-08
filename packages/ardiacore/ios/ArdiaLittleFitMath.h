#pragma once

#include <algorithm>
#include <cmath>
#include <vector>

namespace ardia_little_fit {

struct Size {
  double w, h;
};
struct Rect {
  double x, y, w, h;
  double maxX() const { return x + w; }
  double maxY() const { return y + h; }
  double midX() const { return x + w / 2; }
  double midY() const { return y + h / 2; }
};

constexpr double kLiftFraction = 0.05;
constexpr double kContainTolerance = 1;

inline Rect Fit(Rect visible, Size wanted, Size minimum) {
  const double width = std::min(std::max(wanted.w, minimum.w), visible.w);
  const double height = std::min(std::max(wanted.h, minimum.h), visible.h);
  const double lift = std::min(visible.h * kLiftFraction, (visible.h - height) / 2);
  return {std::round(visible.midX() - width / 2), std::round(visible.midY() - height / 2 + lift), std::round(width),
          std::round(height)};
}

inline bool Contains(Rect outer, Rect inner, double tolerance = kContainTolerance) {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance &&
         inner.maxX() <= outer.maxX() + tolerance && inner.maxY() <= outer.maxY() + tolerance;
}

inline double Overlap(Rect a, Rect b) {
  const double width = std::min(a.maxX(), b.maxX()) - std::max(a.x, b.x);
  const double height = std::min(a.maxY(), b.maxY()) - std::max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

inline int ScreenHolding(Rect bounds, const std::vector<Rect> &frames) {
  int best = -1;
  double bestOverlap = 0;
  for (size_t i = 0; i < frames.size(); i++) {
    const double overlap = Overlap(bounds, frames[i]);
    if (overlap > bestOverlap) best = static_cast<int>(i), bestOverlap = overlap;
  }
  return best;
}

inline Rect FlipFromTopLeft(Rect r, double primaryHeight) { return {r.x, primaryHeight - r.y - r.h, r.w, r.h}; }

}
