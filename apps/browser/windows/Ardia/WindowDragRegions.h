#pragma once

#include <algorithm>
#include <cmath>
#include <optional>
#include <vector>

#include <winrt/Windows.Graphics.h>

namespace Ardia::WindowDragRegions {

using Rect = winrt::Windows::Graphics::RectInt32;

inline constexpr double kLargestPixel = 1000000.0;
inline constexpr double kRoundingTolerance = 0.001;

inline bool Same(std::optional<Rect> const &left, std::optional<Rect> const &right) noexcept {
  if (left.has_value() != right.has_value()) return false;
  if (!left) return true;
  return left->X == right->X && left->Y == right->Y && left->Width == right->Width && left->Height == right->Height;
}

inline bool Contains(Rect const &rect, int32_t x, int32_t y) noexcept {
  return x >= rect.X && x < rect.X + rect.Width && y >= rect.Y && y < rect.Y + rect.Height;
}

inline std::vector<Rect> Subtract(Rect const &outer, std::optional<Rect> const &hole) {
  std::vector<Rect> pieces;
  if (outer.Width <= 0 || outer.Height <= 0) return pieces;
  int32_t outerRight = outer.X + outer.Width;
  int32_t outerBottom = outer.Y + outer.Height;
  if (!hole) {
    pieces.push_back(outer);
    return pieces;
  }
  int32_t left = (std::max)(outer.X, hole->X);
  int32_t top = (std::max)(outer.Y, hole->Y);
  int32_t right = (std::min)(outerRight, hole->X + hole->Width);
  int32_t bottom = (std::min)(outerBottom, hole->Y + hole->Height);
  if (left >= right || top >= bottom) {
    pieces.push_back(outer);
    return pieces;
  }
  if (top > outer.Y) pieces.push_back({outer.X, outer.Y, outer.Width, top - outer.Y});
  if (bottom < outerBottom) pieces.push_back({outer.X, bottom, outer.Width, outerBottom - bottom});
  if (left > outer.X) pieces.push_back({outer.X, top, left - outer.X, bottom - top});
  if (right < outerRight) pieces.push_back({right, top, outerRight - right, bottom - top});
  return pieces;
}

inline std::optional<int32_t> PixelOf(double points, double scale) noexcept {
  double pixels = points * scale;
  if (!std::isfinite(pixels) || pixels < -kLargestPixel || pixels > kLargestPixel) return std::nullopt;
  return static_cast<int32_t>(std::floor(pixels + kRoundingTolerance));
}

inline std::optional<Rect> PixelAt(double x, double y, double scale) noexcept {
  if (!std::isfinite(scale) || scale <= 0) return std::nullopt;
  auto column = PixelOf(x, scale);
  auto row = PixelOf(y, scale);
  if (!column || !row) return std::nullopt;
  return Rect{*column, *row, 1, 1};
}

}
