#include "../ios/ArdiaDisplayPlacementMath.h"

#include <cstdio>

using namespace ardia_display;

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)

static bool Same(Rect a, Rect b) { return a.x == b.x && a.y == b.y && a.w == b.w && a.h == b.h; }
static bool Inside(Rect inner, Rect outer) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.maxX() <= outer.maxX() && inner.maxY() <= outer.maxY();
}

static const Rect kMain{0, 0, 1512, 982};
static const Rect kMainVisible{0, 0, 1512, 944};
static const Rect kRight{1512, -120, 2560, 1440};
static const Rect kRightVisible{1512, -120, 2560, 1415};
static const Rect kLeft{-1920, 200, 1920, 1080};
static const Rect kLeftVisible{-1920, 200, 1920, 1055};

static int WindowSavedOnMainMovesToExternal() {
  const Rect screens[] = {kMain, kRight};
  const Rect saved{100, 80, 1200, 760};
  const Rect placed = OnScreen(saved, screens, 2, 1, kRightVisible);
  CHECK(Inside(placed, kRightVisible));
  CHECK(placed.w == saved.w && placed.h == saved.h);
  CHECK(HoldsMost(placed, screens, 2, 1));
  CHECK(!HoldsMost(placed, screens, 2, 0));
  return 0;
}

static int WindowAlreadyOnTargetIsUntouched() {
  const Rect screens[] = {kMain, kRight};
  const Rect saved{1700, 100, 1000, 700};
  CHECK(Same(OnScreen(saved, screens, 2, 1, kRightVisible), saved));
  const Rect onMain{40, 30, 900, 600};
  CHECK(Same(OnScreen(onMain, screens, 2, 0, kMainVisible), onMain));
  return 0;
}

static int WindowStraddlingGoesToTheDisplayHoldingMost() {
  const Rect screens[] = {kMain, kRight};
  const Rect mostlyRight{1312, 100, 1000, 700};
  CHECK(HoldsMost(mostlyRight, screens, 2, 1));
  CHECK(!HoldsMost(mostlyRight, screens, 2, 0));
  CHECK(Same(OnScreen(mostlyRight, screens, 2, 1, kRightVisible), Rect{1512, 100, 1000, 700}));
  const Rect placed = OnScreen(mostlyRight, screens, 2, 0, kMainVisible);
  CHECK(Inside(placed, kMainVisible));
  return 0;
}

static int FrameHoldingMostButPastTheVisibleAreaIsPulledInNotCentred() {
  const Rect screens[] = {kMain, kRight};
  const Rect underMenuBar{600, 700, 800, 600};
  CHECK(HoldsMost(underMenuBar, screens, 2, 0));
  const Rect pulledIn = OnScreen(underMenuBar, screens, 2, 0, kMainVisible);
  CHECK(Inside(pulledIn, kMainVisible));
  CHECK(Same(pulledIn, Rect{600, 344, 800, 600}));
  const Rect pastTheRightEdge{1000, 100, 900, 600};
  CHECK(Same(OnScreen(pastTheRightEdge, screens, 2, 0, kMainVisible), Rect{612, 100, 900, 600}));
  const Rect tallerThanVisible{100, 0, 700, 960};
  CHECK(Same(OnScreen(tallerThanVisible, screens, 2, 0, kMainVisible), Rect{100, 0, 700, 944}));
  return 0;
}

static int OversizedWindowIsClampedAndCentred() {
  const Rect screens[] = {kMain, kLeft};
  const Rect huge{50, 50, 3000, 2000};
  const Rect placed = OnScreen(huge, screens, 2, 1, kLeftVisible);
  CHECK(Same(placed, Rect{-1920, 200, 1920, 1055}));
  return 0;
}

static int ZeroOverlapIsCentredOnTarget() {
  const Rect screens[] = {kMain, kRight};
  const Rect offscreen{9000, 9000, 800, 600};
  CHECK(!HoldsMost(offscreen, screens, 2, 1));
  const Rect placed = OnScreen(offscreen, screens, 2, 1, kRightVisible);
  CHECK(placed.w == 800 && placed.h == 600);
  CHECK(Inside(placed, kRightVisible));
  CHECK(placed.x == 2392 && placed.y == 288);
  return 0;
}

static int NegativeCoordinateLayouts() {
  const Rect screens[] = {kLeft, kMain, kRight};
  const Rect saved{200, 100, 1000, 700};
  const Rect onLeft = OnScreen(saved, screens, 3, 0, kLeftVisible);
  CHECK(Inside(onLeft, kLeftVisible));
  CHECK(HoldsMost(onLeft, screens, 3, 0));
  const Rect keptLeft{-1500, 300, 1000, 700};
  CHECK(Same(OnScreen(keptLeft, screens, 3, 0, kLeftVisible), keptLeft));
  const Rect below{300, -500, 800, 600};
  const Rect placed = OnScreen(below, screens, 3, 2, kRightVisible);
  CHECK(Inside(placed, kRightVisible));
  return 0;
}

static int OverlapIsSymmetricAndZeroWhenApart() {
  CHECK(OverlapArea(kMain, kRight) == 0);
  CHECK(OverlapArea(kRight, kMain) == 0);
  const Rect a{0, 0, 100, 100}, b{50, 50, 100, 100};
  CHECK(OverlapArea(a, b) == 2500);
  CHECK(OverlapArea(b, a) == 2500);
  const Rect touching{100, 0, 100, 100};
  CHECK(OverlapArea(a, touching) == 0);
  return 0;
}

int main() {
  WindowSavedOnMainMovesToExternal();
  WindowAlreadyOnTargetIsUntouched();
  WindowStraddlingGoesToTheDisplayHoldingMost();
  FrameHoldingMostButPastTheVisibleAreaIsPulledInNotCentred();
  OversizedWindowIsClampedAndCentred();
  ZeroOverlapIsCentredOnTarget();
  NegativeCoordinateLayouts();
  OverlapIsSymmetricAndZeroWhenApart();
  if (failures) return 1;
  std::printf("display-placement: all passed\n");
  return 0;
}
