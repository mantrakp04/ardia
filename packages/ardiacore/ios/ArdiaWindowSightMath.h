#pragma once

#include <algorithm>
#include <vector>

namespace ardia_window_sight {

struct Rect {
  double x, y, width, height;
  double right() const { return x + width; }
  double bottom() const { return y + height; }
  bool contains(double px, double py) const { return px > x && px < right() && py > y && py < bottom(); }
};

inline double VisibleArea(const Rect &window, const std::vector<Rect> &covers, const std::vector<Rect> &displays) {
  if (window.width <= 0 || window.height <= 0) return 0;
  std::vector<double> xs{window.x, window.right()};
  std::vector<double> ys{window.y, window.bottom()};
  auto addEdges = [&](const Rect &r) {
    for (double v : {r.x, r.right()})
      if (v > window.x && v < window.right()) xs.push_back(v);
    for (double v : {r.y, r.bottom()})
      if (v > window.y && v < window.bottom()) ys.push_back(v);
  };
  for (const Rect &r : covers) addEdges(r);
  for (const Rect &r : displays) addEdges(r);
  std::sort(xs.begin(), xs.end());
  xs.erase(std::unique(xs.begin(), xs.end()), xs.end());
  std::sort(ys.begin(), ys.end());
  ys.erase(std::unique(ys.begin(), ys.end()), ys.end());
  double area = 0;
  for (size_t i = 0; i + 1 < xs.size(); i++) {
    const double cx = (xs[i] + xs[i + 1]) / 2;
    for (size_t j = 0; j + 1 < ys.size(); j++) {
      const double cy = (ys[j] + ys[j + 1]) / 2;
      const bool onDisplay = std::any_of(displays.begin(), displays.end(), [&](const Rect &d) { return d.contains(cx, cy); });
      if (!onDisplay) continue;
      const bool covered = std::any_of(covers.begin(), covers.end(), [&](const Rect &c) { return c.contains(cx, cy); });
      if (!covered) area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    }
  }
  return area;
}

constexpr double kMinimumVisibleArea = 1;

constexpr int kNormalWindowLayer = 0;

inline bool CountsAsCover(int layer, double alpha) { return layer == kNormalWindowLayer && alpha >= 1; }

inline bool PartlyVisible(const Rect &window, const std::vector<Rect> &covers, const std::vector<Rect> &displays) {
  return VisibleArea(window, covers, displays) >= kMinimumVisibleArea;
}

}
