#include <cassert>
#include <cstdio>
#include <string_view>

#include "ardia/linux/ac_linux_popup_geometry.h"

using namespace ardia::linux_extensions;

namespace {

PopupPlacement Toolbar(double width = 1920, double height = 1080) {
  return {.anchor_right = 1902, .anchor_top = 51, .room_left = 9, .room_right = width - 9, .room_bottom = height - 9};
}

void RightAligned() {
  const auto box = PopupBoxFor(Toolbar(), 1, 600, 450, 0, 0, 1);
  assert(box && box->x == 1302 && box->y == 51 && box->width == 600 && box->height == 450);
}

void ClampedIntoTheRoom() {
  PopupPlacement p = Toolbar(700);
  p.anchor_right = 300;
  const auto box = PopupBoxFor(p, 1, 600, 450, 0, 0, 1);
  assert(box && box->x == 9 && box->width == 600);
  assert(box->x + box->width <= 691);
}

void LimitsFollowTheRoom() {
  const auto wide = PopupLimitsFor(Toolbar(), 1);
  assert(wide && wide->max_width == 800 && wide->max_height == 600 && wide->min_width == 25 && wide->min_height == 25);
  const auto narrow = PopupLimitsFor(Toolbar(320, 300), 1);
  assert(narrow && narrow->max_width == 302 && narrow->max_height == 240);
  const auto box = PopupBoxFor(Toolbar(320, 300), 1, 600, 450, 0, 0, 1);
  assert(box && box->width == 302 && box->height == 240 && box->x == 9);
}

void RoomBelowTheMinimum() {
  PopupPlacement p = Toolbar();
  p.room_left = 100;
  p.room_right = 110.5;
  const auto limits = PopupLimitsFor(p, 1);
  assert(limits && limits->max_width == 10 && limits->min_width == 10);
  const auto box = PopupBoxFor(p, 1, 600, 450, 0, 0, 1);
  assert(box && box->width == 10 && box->x == 100);
  p.room_right = 100.5;
  assert(!PopupLimitsFor(p, 1));
  assert(!PopupBoxFor(p, 1, 600, 450, 0, 0, 1));
  p = Toolbar();
  p.room_bottom = p.anchor_top;
  assert(!PopupLimitsFor(p, 1));
}

void ZoomScalesTheIntent() {
  const auto box = PopupBoxFor(Toolbar(), 1.25, 600, 450, 0, 0, 1);
  assert(box && box->width == 600 && box->x == 2378 - 600 && box->y == 64);
  const auto limits = PopupLimitsFor(Toolbar(), 1.25);
  assert(limits && limits->max_width == 800 && limits->max_height == 600);
}

void FractionalScaleLandsOnWholePixels() {
  PopupPlacement p = Toolbar();
  p.anchor_right = 1903;
  p.anchor_top = 50.86;
  const auto box = PopupBoxFor(p, 1, 600, 450, 0, 0, 1.5);
  assert(box);
  assert(box->x % 2 == 0 && box->y % 2 == 0);
  assert(box->x >= 1302 && box->x <= 1304 && box->y >= 51 && box->y <= 52);
  const auto shifted = PopupBoxFor(p, 1, 600, 450, 1.5, 0, 1.5);
  assert(shifted && PixelError(1.5, shifted->x, 1.5) < 0.01);
}

void NonFiniteIsRefused() {
  PopupPlacement p = Toolbar();
  p.anchor_top = 0.0 / 0.0;
  assert(!PopupLimitsFor(p, 1));
  assert(!PopupLimitsFor(Toolbar(), 0));
}

}

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const std::string_view name = argv[1];
  if (name == "right") RightAligned();
  else if (name == "clamped") ClampedIntoTheRoom();
  else if (name == "limits") LimitsFollowTheRoom();
  else if (name == "tiny") RoomBelowTheMinimum();
  else if (name == "zoom") ZoomScalesTheIntent();
  else if (name == "pixels") FractionalScaleLandsOnWholePixels();
  else if (name == "finite") NonFiniteIsRefused();
  else return 2;
  return 0;
}
