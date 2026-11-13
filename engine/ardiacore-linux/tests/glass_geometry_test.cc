#include <cassert>
#include <cmath>
#include <string_view>

#include "ardia/linux/ac_linux_glass_geometry.h"

using namespace ardia::linux_glass;

namespace {

bool Near(double a, double b, double tolerance = 1e-9) { return std::abs(a - b) <= tolerance; }

void WholePixels() {
  const auto p = PlaceRegion({100, 50, 240, 120}, {10, 10, 10, 10}, 24, 1);
  assert(p && p->x == 100 && p->y == 50 && p->width == 240 && p->height == 120);
  assert(Near(p->offset_x, 0) && Near(p->offset_y, 0) && Near(p->scale_x, 1) && Near(p->scale_y, 1));
  assert(Near(p->radii.upper_left, 10) && Near(p->blur, 24));
}

void FractionalExtent() {
  const auto p = PlaceRegion({100.25, 50.5, 240.5, 120.75}, {12, 12, 12, 12}, 24, 1);
  assert(p && p->x == 100 && p->y == 50 && p->width == 241 && p->height == 121);
  assert(Near(p->x + p->offset_x, 100.25) && Near(p->y + p->offset_y, 50.5));
  assert(Near(p->width * p->scale_x, 240.5) && Near(p->height * p->scale_y, 120.75));
  const double scale = (p->scale_x + p->scale_y) / 2;
  assert(Near(p->radii.upper_left * scale, 12));
}

void ZoomScalesEverything() {
  const auto p = PlaceRegion({10, 10, 100, 40}, {8, 0, 8, 0}, 24, 1.25);
  assert(p && p->x == 12 && p->y == 12 && Near(p->offset_x, 0.5) && Near(p->offset_y, 0.5));
  assert(p->width == 125 && p->height == 50 && Near(p->blur, 30));
  assert(Near(p->radii.upper_left, 10) && Near(p->radii.upper_right, 0) && Near(p->radii.lower_right, 10));
}

void RadiiClampToHalfTheShortSide() {
  const auto p = PlaceRegion({0, 0, 40, 20}, {64, 64, 64, 64}, 0, 1);
  assert(p && Near(p->radii.upper_left, 10) && Near(p->radii.lower_left, 10));
}

void InvalidIsRefused() {
  assert(!PlaceRegion({0, 0, 0, 10}, {}, 24, 1));
  assert(!PlaceRegion({0, 0, 10, 10}, {}, -1, 1));
  assert(!PlaceRegion({0, 0, 10, 10}, {}, kMaxBlur + 1, 1));
  assert(!PlaceRegion({0, 0, 10, 10}, {-1, 0, 0, 0}, 24, 1));
  assert(!PlaceRegion({0.0 / 0.0, 0, 10, 10}, {}, 24, 1));
  assert(!PlaceRegion({0, 0, 10, 10}, {}, 24, 0));
}

void Overlap() {
  assert(Overlaps({0, 0, 10, 10}, {9.5, 9.5, 5, 5}));
  assert(!Overlaps({0, 0, 10, 10}, {10, 0, 5, 5}));
}

}

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const std::string_view name = argv[1];
  if (name == "whole") WholePixels();
  else if (name == "fractional") FractionalExtent();
  else if (name == "zoom") ZoomScalesEverything();
  else if (name == "radii") RadiiClampToHalfTheShortSide();
  else if (name == "invalid") InvalidIsRefused();
  else if (name == "overlap") Overlap();
  else return 2;
  return 0;
}
