#ifndef ARDIA_LINUX_AC_LINUX_GLASS_GEOMETRY_H_
#define ARDIA_LINUX_AC_LINUX_GLASS_GEOMETRY_H_

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <optional>

namespace ardia::linux_glass {

inline constexpr size_t kMaxRegions = 64;
inline constexpr double kMaxBlur = 64;
inline constexpr double kMaxRadius = 256;

struct CssRect {
  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
};

struct Radii {
  double upper_left = 0;
  double upper_right = 0;
  double lower_right = 0;
  double lower_left = 0;
};

struct LayerPlacement {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  double offset_x = 0;
  double offset_y = 0;
  double scale_x = 1;
  double scale_y = 1;
  Radii radii;
  double blur = 0;
};

inline bool Finite(double value) { return std::isfinite(value); }

inline bool RadiiAreValid(const Radii& radii) {
  for (const double r : {radii.upper_left, radii.upper_right, radii.lower_right, radii.lower_left}) {
    if (!Finite(r) || r < 0 || r > kMaxRadius) return false;
  }
  return true;
}

inline std::optional<LayerPlacement> PlaceRegion(const CssRect& rect, const Radii& radii, double blur, double zoom) {
  if (!Finite(rect.x) || !Finite(rect.y) || !Finite(rect.width) || !Finite(rect.height) || !Finite(zoom) || zoom <= 0 ||
      !Finite(blur) || blur < 0 || blur > kMaxBlur || !RadiiAreValid(radii)) {
    return std::nullopt;
  }
  const double x = rect.x * zoom;
  const double y = rect.y * zoom;
  const double width = rect.width * zoom;
  const double height = rect.height * zoom;
  if (width <= 0 || height <= 0) return std::nullopt;
  LayerPlacement placement;
  placement.x = static_cast<int>(std::floor(x));
  placement.y = static_cast<int>(std::floor(y));
  placement.offset_x = x - placement.x;
  placement.offset_y = y - placement.y;
  placement.width = std::max(1, static_cast<int>(std::ceil(width)));
  placement.height = std::max(1, static_cast<int>(std::ceil(height)));
  placement.scale_x = width / placement.width;
  placement.scale_y = height / placement.height;
  const double scale = (placement.scale_x + placement.scale_y) / 2;
  const double limit = std::min(placement.width, placement.height) / 2.0;
  const auto corner = [&](double css) { return std::min(css * zoom / scale, limit); };
  placement.radii = {corner(radii.upper_left), corner(radii.upper_right), corner(radii.lower_right),
                     corner(radii.lower_left)};
  placement.blur = blur * zoom;
  return placement;
}

struct Box {
  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
};

inline bool Overlaps(const Box& a, const Box& b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

}

#endif
