#pragma once

#include <algorithm>
#include <cmath>

namespace ardia_pip_throw {

struct Point {
  double x, y;
};
struct Rect {
  double x, y, w, h;
  double maxX() const { return x + w; }
  double maxY() const { return y + h; }
};

enum Corner : int { kNoCorner = -1, kTopLeft = 0, kTopRight = 1, kBottomLeft = 2, kBottomRight = 3 };

constexpr double kPi = 3.14159265358979323846;
constexpr double kCornerInset = 10;
constexpr double kCornerTolerance = kPi / 4;
constexpr double kDragFlingSpeed = 350;
constexpr double kSwipeFlingDelta = 6;
constexpr double kSwipeEventsPerSecond = 90;
constexpr double kResponse = 0.9, kDampingRatio = 0.9, kResolve = 0.2;
constexpr double kVelocityWindow = 0.1, kVelocityStale = 0.05;

inline Point CornerPoint(Corner corner, Rect r) {
  const bool left = corner == kTopLeft || corner == kBottomLeft;
  const bool top = corner == kTopLeft || corner == kTopRight;
  return {left ? r.x : r.maxX(), top ? r.maxY() : r.y};
}

inline double AngleApart(double a, double b) {
  double d = std::fabs(a - b);
  d -= std::floor(d / (2 * kPi)) * 2 * kPi;
  return d < kPi ? d : 2 * kPi - d;
}

inline Corner PickCorner(Point from, Point velocity, Rect screen) {
  if (velocity.x == 0 && velocity.y == 0) return kNoCorner;
  const double heading = std::atan2(velocity.y, velocity.x);
  Corner best = kNoCorner;
  double closest = kCornerTolerance;
  for (Corner corner : {kTopLeft, kTopRight, kBottomLeft, kBottomRight}) {
    const Point p = CornerPoint(corner, screen);
    const double apart = AngleApart(std::atan2(p.y - from.y, p.x - from.x), heading);
    if (apart < closest) best = corner, closest = apart;
  }
  return best;
}

inline Rect CornerFrame(Corner corner, double w, double h, Rect visible) {
  const Rect inner{visible.x + kCornerInset, visible.y + kCornerInset, visible.w - 2 * kCornerInset, visible.h - 2 * kCornerInset};
  const bool left = corner == kTopLeft || corner == kBottomLeft;
  const bool top = corner == kTopLeft || corner == kTopRight;
  return {std::round(left ? inner.x : inner.maxX() - w), std::round(top ? inner.maxY() - h : inner.y), w, h};
}

inline Point FingerDelta(double scrollingDeltaX, double scrollingDeltaY, bool inverted) {
  return {inverted ? scrollingDeltaX : -scrollingDeltaX, inverted ? -scrollingDeltaY : scrollingDeltaY};
}

inline Point SwipeVelocity(Point lastDelta) { return {lastDelta.x * kSwipeEventsPerSecond, lastDelta.y * kSwipeEventsPerSecond}; }

inline bool SwipeFlings(Point lastDelta) { return std::hypot(lastDelta.x, lastDelta.y) > kSwipeFlingDelta; }

inline bool DragFlings(Point velocity) { return std::hypot(velocity.x, velocity.y) > kDragFlingSpeed; }

struct Sample {
  double t, x, y;
};

inline Point ReleaseVelocity(const Sample *samples, int count, double releasedAt) {
  int first = count;
  while (first > 0 && samples[first - 1].t >= releasedAt - kVelocityWindow) first--;
  if (count - first < 2 || releasedAt - samples[count - 1].t > kVelocityStale) return {0, 0};
  const Sample &a = samples[first], &b = samples[count - 1];
  const double dt = b.t - a.t;
  if (dt <= 0) return {0, 0};
  return {(b.x - a.x) / dt, (b.y - a.y) / dt};
}

struct Screen {
  Rect frame, visible;
};

inline int LargestOverlap(Rect r, const Screen *screens, int count) {
  int best = 0;
  double bestArea = 0;
  for (int i = 0; i < count; i++) {
    const Rect &f = screens[i].frame;
    const double w = std::min(r.maxX(), f.maxX()) - std::max(r.x, f.x);
    const double h = std::min(r.maxY(), f.maxY()) - std::max(r.y, f.y);
    if (w > 0 && h > 0 && w * h > bestArea) best = i, bestArea = w * h;
  }
  return best;
}

enum Side : int { kAbove, kBelow, kLeft, kRight };

inline bool DisplayBeyond(Rect window, int current, const Screen *screens, int count, Side side) {
  const Rect &edge = screens[current].frame;
  for (int i = 0; i < count; i++) {
    if (i == current) continue;
    const Rect &f = screens[i].frame;
    bool touches = false, beside = false;
    switch (side) {
      case kAbove: touches = std::fabs(f.y - edge.maxY()) <= 1, beside = std::min(window.maxX(), f.maxX()) > std::max(window.x, f.x); break;
      case kBelow: touches = std::fabs(f.maxY() - edge.y) <= 1, beside = std::min(window.maxX(), f.maxX()) > std::max(window.x, f.x); break;
      case kLeft: touches = std::fabs(f.maxX() - edge.x) <= 1, beside = std::min(window.maxY(), f.maxY()) > std::max(window.y, f.y); break;
      case kRight: touches = std::fabs(f.x - edge.maxX()) <= 1, beside = std::min(window.maxY(), f.maxY()) > std::max(window.y, f.y); break;
    }
    if (touches && beside) return true;
  }
  return false;
}

inline Rect Usable(int i, Rect window, const Screen *screens, int count) {
  const Rect &v = screens[i].visible, &f = screens[i].frame;
  const double x0 = DisplayBeyond(window, i, screens, count, kLeft) ? f.x : v.x;
  const double x1 = DisplayBeyond(window, i, screens, count, kRight) ? f.maxX() : v.maxX();
  const double y0 = DisplayBeyond(window, i, screens, count, kBelow) ? f.y : v.y;
  const double y1 = DisplayBeyond(window, i, screens, count, kAbove) ? f.maxY() : v.maxY();
  return {x0, y0, x1 - x0, y1 - y0};
}

constexpr double kMinVisibleWidth = 60, kMinVisibleShare = 0.4;

inline double Shortfall(Rect p, const Screen *screens, int count) {
  double reach = HUGE_VAL, top = -HUGE_VAL, bottom = HUGE_VAL;
  bool overlapping = false;
  for (int i = 0; i < count; i++) {
    const Rect u = Usable(i, p, screens, count);
    const double wide = std::max(0.0, std::min(p.maxX(), u.maxX()) - std::max(p.x, u.x));
    const double tall = std::max(0.0, std::min(p.maxY(), u.maxY()) - std::max(p.y, u.y));
    reach = std::min(reach, std::max(0.0, std::min(kMinVisibleWidth, p.w) - wide) +
                                std::max(0.0, std::min(kMinVisibleShare * p.h, u.h) - tall));
    const Rect &v = screens[i].visible;
    if (std::min(p.maxX(), v.maxX()) > std::max(p.x, v.x)) {
      overlapping = true;
      top = std::max(top, v.maxY());
      bottom = std::min(bottom, v.y);
    }
  }
  if (!overlapping) return reach;
  return reach + std::max(0.0, p.maxY() - top) + std::max(0.0, bottom - p.y);
}

inline Rect Shifted(Rect r, double dx, double dy) { return {r.x + dx, r.y + dy, r.w, r.h}; }

inline double Outside(double v, double size, double start, double extent) {
  const double lo = size > extent ? start + extent - size : start, hi = size > extent ? start : start + extent - size;
  return v < lo ? lo - v : v > hi ? v - hi : 0;
}

struct Mover {
  const Screen *screens;
  int count;
  bool boxed;
  Rect box;

  Mover(Rect from, const Screen *s, int n, int home = -1) : screens(s), count(n), boxed(false), box{} {
    if (n <= 0) return;
    const Rect &visible = s[home >= 0 && home < n ? home : LargestOverlap(from, s, n)].visible;
    boxed = from.w > visible.w || from.h > visible.h;
    box = visible;
  }

  double shortfall(Rect p) const {
    if (count <= 0) return 0;
    if (boxed) return Outside(p.x, p.w, box.x, box.w) + Outside(p.y, p.h, box.y, box.h);
    return Shortfall(p, screens, count);
  }

  bool allowed(Rect next, Rect current) const {
    if (count <= 0) return true;
    if (boxed)
      return Outside(next.x, next.w, box.x, box.w) <= Outside(current.x, current.w, box.x, box.w) + 1e-9 &&
             Outside(next.y, next.h, box.y, box.h) <= Outside(current.y, current.h, box.y, box.h) + 1e-9;
    return shortfall(next) <= std::max(shortfall(current), 0.0) + 1e-9;
  }

  Rect along(Rect r, double dx, double dy) const {
    if (dx == 0 && dy == 0) return r;
    if (allowed(Shifted(r, dx, dy), r)) return Shifted(r, dx, dy);
    const double length = std::max(std::fabs(dx), std::fabs(dy));
    for (long k = (long)std::ceil(length) - 1; k >= 1; k--) {
      const Rect candidate = Shifted(r, dx * k / length, dy * k / length);
      if (allowed(candidate, r)) return candidate;
    }
    return r;
  }

  Rect move(Rect frame, Point delta) const {
    if (count <= 0) return Shifted(frame, delta.x, delta.y);
    if (allowed(Shifted(frame, delta.x, delta.y), frame)) return Shifted(frame, delta.x, delta.y);
    return along(along(frame, delta.x, 0), 0, delta.y);
  }
};

inline bool Reachable(Rect p, const Screen *screens, int count) {
  if (count <= 0) return true;
  for (int i = 0; i < count; i++) {
    const Rect &v = screens[i].visible;
    const double wide = std::min(p.maxX(), v.maxX()) - std::max(p.x, v.x);
    const double tall = std::min(p.maxY(), v.maxY()) - std::max(p.y, v.y);
    if (wide >= std::min(kMinVisibleWidth, p.w) - 1e-9 && tall >= std::min(kMinVisibleShare * p.h, v.h) - 1e-9) return true;
  }
  return false;
}

inline double Settle(double v, double size, double start, double extent) {
  return size > extent ? std::clamp(v, start + extent - size, start) : std::clamp(v, start, start + extent - size);
}

inline Rect Rescue(Rect p, const Screen *screens, int count, int home = -1) {
  if (count <= 0 || Reachable(p, screens, count)) return p;
  const Rect &v = screens[home >= 0 && home < count ? home : LargestOverlap(p, screens, count)].visible;
  return {std::round(Settle(p.x, p.w, v.x, v.w)), std::round(Settle(p.y, p.h, v.y, v.h)), p.w, p.h};
}

inline Rect MoveWithin(Rect frame, Point delta, const Screen *screens, int count, int home = -1) {
  return Mover(frame, screens, count, home).move(frame, delta);
}

inline Rect SwipeStep(Rect frame, Point delta, const Screen *screens, int count, int home = -1) {
  return MoveWithin(frame, delta, screens, count, home);
}

inline Rect DragStep(Rect frame, Point delta, const Screen *screens, int count, int home = -1) {
  return MoveWithin(frame, delta, screens, count, home);
}

struct SpringState {
  double offset, velocity;
};

inline SpringState SpringAt(double offset, double velocity, double t, double response = kResponse, double ratio = kDampingRatio) {
  const double w0 = 2 * kPi / std::max(response, 0.0001);
  const double decay = ratio * w0;
  const double wd = w0 * std::sqrt(std::max(1 - ratio * ratio, 1e-9));
  const double envelope = std::exp(-decay * t);
  const double c = std::cos(wd * t), s = std::sin(wd * t);
  const double b = (velocity + decay * offset) / wd;
  return {envelope * (offset * c + b * s), envelope * (velocity * c - (decay * velocity + w0 * w0 * offset) / wd * s)};
}

inline bool Resolved(SpringState x, SpringState y) {
  return std::fabs(x.offset) < kResolve && std::fabs(y.offset) < kResolve && std::fabs(x.velocity) < kResolve &&
         std::fabs(y.velocity) < kResolve;
}

}
