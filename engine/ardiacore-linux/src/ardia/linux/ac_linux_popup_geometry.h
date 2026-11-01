#ifndef ARDIA_LINUX_AC_LINUX_POPUP_GEOMETRY_H_
#define ARDIA_LINUX_AC_LINUX_POPUP_GEOMETRY_H_

#include <algorithm>
#include <cmath>
#include <optional>

namespace ardia::linux_extensions {

inline constexpr int kPopupMinWidth = 25;
inline constexpr int kPopupMinHeight = 25;
inline constexpr int kPopupMaxWidth = 800;
inline constexpr int kPopupMaxHeight = 600;

struct PopupPlacement {
  double anchor_right = 0;
  double anchor_top = 0;
  double room_left = 0;
  double room_right = 0;
  double room_bottom = 0;

  bool operator==(const PopupPlacement&) const = default;
};

struct PopupLimits {
  int min_width = kPopupMinWidth;
  int min_height = kPopupMinHeight;
  int max_width = kPopupMaxWidth;
  int max_height = kPopupMaxHeight;

  bool operator==(const PopupLimits&) const = default;
};

struct PopupBox {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;

  bool operator==(const PopupBox&) const = default;
};

inline constexpr double kEdgeSlack = 1e-6;

inline int FloorDip(double value) { return static_cast<int>(std::floor(value + kEdgeSlack)); }
inline int CeilDip(double value) { return static_cast<int>(std::ceil(value - kEdgeSlack)); }

inline bool PlacementIsFinite(const PopupPlacement& p) {
  return std::isfinite(p.anchor_right) && std::isfinite(p.anchor_top) && std::isfinite(p.room_left) &&
         std::isfinite(p.room_right) && std::isfinite(p.room_bottom);
}

inline int PopupTop(const PopupPlacement& p, double zoom) { return static_cast<int>(std::lround(p.anchor_top * zoom)); }

inline std::optional<PopupLimits> PopupLimitsFor(const PopupPlacement& p, double zoom) {
  if (!PlacementIsFinite(p) || !std::isfinite(zoom) || zoom <= 0) return std::nullopt;
  const int span_width = FloorDip(p.room_right * zoom) - CeilDip(p.room_left * zoom);
  const int span_height = FloorDip(p.room_bottom * zoom) - PopupTop(p, zoom);
  if (span_width < 1 || span_height < 1) return std::nullopt;
  PopupLimits limits;
  limits.max_width = std::min(kPopupMaxWidth, span_width);
  limits.max_height = std::min(kPopupMaxHeight, span_height);
  limits.min_width = std::min(kPopupMinWidth, limits.max_width);
  limits.min_height = std::min(kPopupMinHeight, limits.max_height);
  return limits;
}

inline double PixelError(double base_px, int dip, double scale) {
  const double px = base_px + dip * scale;
  return std::abs(px - std::round(px));
}

inline int PixelAligned(int want, int low, int high, double base_px, double scale) {
  if (low > high) return want;
  want = std::clamp(want, low, high);
  if (PixelError(base_px, want, scale) < 0.01) return want;
  for (int step = 1; step <= 3; ++step) {
    for (const int candidate : {want - step, want + step}) {
      if (candidate >= low && candidate <= high && PixelError(base_px, candidate, scale) < 0.01) return candidate;
    }
  }
  return want;
}

inline std::optional<PopupBox> PopupBoxFor(const PopupPlacement& p, double zoom, int preferred_width,
                                           int preferred_height, double origin_x_px, double origin_y_px,
                                           double device_scale) {
  const std::optional<PopupLimits> limits = PopupLimitsFor(p, zoom);
  if (!limits) return std::nullopt;
  const double scale = std::isfinite(device_scale) && device_scale > 0 ? device_scale : 1;
  PopupBox box;
  box.width = std::clamp(preferred_width > 0 ? preferred_width : limits->min_width, limits->min_width, limits->max_width);
  box.height = std::clamp(preferred_height > 0 ? preferred_height : limits->min_height, limits->min_height,
                          limits->max_height);
  const int low = CeilDip(p.room_left * zoom);
  const int high = FloorDip(p.room_right * zoom) - box.width;
  box.x = PixelAligned(static_cast<int>(std::lround(p.anchor_right * zoom)) - box.width, low, high, origin_x_px, scale);
  const int top = PopupTop(p, zoom);
  box.y = PixelAligned(top, top, FloorDip(p.room_bottom * zoom) - box.height, origin_y_px, scale);
  return box;
}

}

#endif
