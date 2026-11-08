#include "../ios/ArdiaLittleFitMath.h"

#include <cstdio>
#include <vector>

using namespace ardia_little_fit;

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)

static bool Same(Rect a, Rect b) { return a.x == b.x && a.y == b.y && a.w == b.w && a.h == b.h; }

static const Size kMinimum = {420, 300};
static const Rect kBuiltIn = {-1512, 0, 1512, 950};
static const Rect kUltrawide = {0, 0, 3440, 1415};

static void FitTests() {
  CHECK(Same(Fit(kUltrawide, {2406, 1085}, kMinimum), {517, 236, 2406, 1085}));

  const Rect shrunk = Fit(kBuiltIn, {2406, 1085}, kMinimum);
  CHECK(Same(shrunk, {-1512, 0, 1512, 950}));
  CHECK(Contains(kBuiltIn, shrunk));

  CHECK(Same(Fit(kBuiltIn, {1400, 400}, kMinimum), {-1456, 323, 1400, 400}));

  const Rect floor = Fit(kBuiltIn, {100, 100}, kMinimum);
  CHECK(floor.w == 420 && floor.h == 300);
  CHECK(Contains(kBuiltIn, floor));

  const Rect cramped = Fit({0, 0, 300, 200}, {900, 640}, kMinimum);
  CHECK(Same(cramped, {0, 0, 300, 200}));

  const Rect raised = Fit({-1512, 40, 1512, 910}, {2406, 1085}, kMinimum);
  CHECK(Same(raised, {-1512, 40, 1512, 910}));
}

static void LiftTests() {
  CHECK(Same(Fit({0, 0, 1000, 1000}, {500, 400}, kMinimum), {250, 350, 500, 400}));
  CHECK(Same(Fit({0, 0, 1000, 1000}, {500, 960}, kMinimum), {250, 40, 500, 960}));
  CHECK(Same(Fit({0, 0, 1000, 1000}, {500, 1000}, kMinimum), {250, 0, 500, 1000}));
}

static void ScreenHoldingTests() {
  const std::vector<Rect> screens = {kUltrawide, kBuiltIn};
  CHECK(ScreenHolding({-1400, 100, 800, 600}, screens) == 1);
  CHECK(ScreenHolding({100, 100, 800, 600}, screens) == 0);
  CHECK(ScreenHolding({-300, 100, 800, 600}, screens) == 0);
  CHECK(ScreenHolding({-900, 100, 1000, 600}, screens) == 1);
  CHECK(ScreenHolding({9000, 9000, 100, 100}, screens) == -1);
  CHECK(ScreenHolding({0, 0, 10, 10}, {}) == -1);
}

static void ContainsTests() {
  CHECK(Contains(kBuiltIn, {-1512, 0, 1512, 950}));
  CHECK(Contains(kBuiltIn, {-1512.5, -0.5, 1513, 951}));
  CHECK(!Contains(kBuiltIn, {-1959, 100, 2406, 1085}));
  CHECK(!Contains(kBuiltIn, {-1512, 0, 1512, 952}));
}

static void FlipTests() {
  const Rect flipped = FlipFromTopLeft({-1959, 233, 2406, 1085}, 1415);
  CHECK(Same(flipped, {-1959, 1415 - 233 - 1085, 2406, 1085}));
  CHECK(Same(FlipFromTopLeft(flipped, 1415), {-1959, 233, 2406, 1085}));
}

static const Display kUltrawideDisplay = {{0, 0, 3440, 1440}, {0, 0, 3440, 1415}};
static const Display kBuiltInDisplay = {{-1512, 0, 1512, 982}, {-1512, 70, 1512, 886}};

static void LandedWindowTests() {
  const std::vector<Display> displays = {kUltrawideDisplay, kBuiltInDisplay};
  const Rect visible = kBuiltInDisplay.visible;
  Rect fitted = {};

  const Rect reportedByAppKit = {517, 236, 2406, 1085};
  CHECK(!FitLanding(reportedByAppKit, displays, kMinimum, &fitted));

  const Rect landed = {-1959, 100, 2406, 1085};
  CHECK(FitLanding(landed, displays, kMinimum, &fitted));
  CHECK(Contains(visible, fitted));
  CHECK(fitted.w >= kMinimum.w && fitted.h >= kMinimum.h);
  CHECK(fitted.y >= visible.y && fitted.maxY() <= visible.maxY());
  CHECK(!Contains(visible, Fit(kBuiltInDisplay.frame, {landed.w, landed.h}, kMinimum)));
}

static void LandedBeyondTheVisibleFrameTests() {
  const std::vector<Display> displays = {kUltrawideDisplay, kBuiltInDisplay};
  const Rect visible = kBuiltInDisplay.visible;
  Rect fitted = {};

  const Rect underTheDock = {-1400, 10, 800, 600};
  CHECK(Contains(kBuiltInDisplay.frame, underTheDock));
  CHECK(!Contains(visible, underTheDock));
  CHECK(FitLanding(underTheDock, displays, kMinimum, &fitted));
  CHECK(Same(fitted, {-1156, 257, 800, 600}));
  CHECK(Contains(visible, fitted));

  const Rect underTheMenuBar = {-1400, 500, 800, 480};
  CHECK(Contains(kBuiltInDisplay.frame, underTheMenuBar));
  CHECK(!Contains(visible, underTheMenuBar));
  CHECK(FitLanding(underTheMenuBar, displays, kMinimum, &fitted));
  CHECK(Contains(visible, fitted));

  const Rect inside = {-1400, 100, 800, 600};
  CHECK(Contains(visible, inside));
  CHECK(!FitLanding(inside, displays, kMinimum, &fitted));

  const Rect nowhere = {9000, 9000, 800, 600};
  CHECK(!FitLanding(nowhere, displays, kMinimum, &fitted));
  CHECK(!FitLanding(inside, {}, kMinimum, &fitted));
}

int main() {
  FitTests();
  LiftTests();
  ScreenHoldingTests();
  ContainsTests();
  FlipTests();
  LandedWindowTests();
  LandedBeyondTheVisibleFrameTests();
  if (failures) return 1;
  std::printf("little-fit: all passed\n");
  return 0;
}
