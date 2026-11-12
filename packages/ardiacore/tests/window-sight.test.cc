#include "../ios/ArdiaWindowSightMath.h"

#include <cmath>
#include <cstdio>

using namespace ardia_window_sight;

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)

struct Random {
  unsigned long long state;
  unsigned long long next() {
    state = state * 6364136223846793005ULL + 1442695040888963407ULL;
    return state >> 33;
  }
  double uniform(double lo, double hi) { return lo + (hi - lo) * (next() % 1000000) / 1000000.0; }
};

static double SampledArea(const Rect &w, const std::vector<Rect> &covers, const std::vector<Rect> &displays, int steps) {
  double area = 0;
  const double dx = w.width / steps, dy = w.height / steps;
  for (int i = 0; i < steps; i++)
    for (int j = 0; j < steps; j++) {
      const double px = w.x + (i + 0.5) * dx, py = w.y + (j + 0.5) * dy;
      bool on = false, covered = false;
      for (const Rect &d : displays) on = on || d.contains(px, py);
      for (const Rect &c : covers) covered = covered || c.contains(px, py);
      if (on && !covered) area += dx * dy;
    }
  return area;
}

int main() {
  const Rect laptop{0, 0, 1512, 982};
  const Rect external{1512, -200, 2560, 1440};
  const std::vector<Rect> both{laptop, external};
  const Rect browserOnLaptop{100, 80, 1200, 800};

  CHECK(PartlyVisible(browserOnLaptop, {}, both));
  CHECK(PartlyVisible(browserOnLaptop, {{1600, 0, 2000, 1200}}, both));
  CHECK(PartlyVisible(browserOnLaptop, {{0, 0, 1512, 25}, {200, 200, 1400, 600}}, both));
  CHECK(!PartlyVisible(browserOnLaptop, {{0, 0, 1512, 982}}, both));
  CHECK(!PartlyVisible(browserOnLaptop, {{0, 0, 800, 982}, {700, 0, 812, 982}}, both));
  CHECK(PartlyVisible(browserOnLaptop, {{0, 0, 800, 982}, {801, 0, 711, 982}}, both));
  CHECK(!PartlyVisible(browserOnLaptop, {}, {external}));
  CHECK(!PartlyVisible({1400, 100, 300, 300}, {{1400, 100, 112, 300}}, {laptop}));
  CHECK(PartlyVisible({1400, 100, 300, 300}, {{1400, 100, 112, 300}}, both));
  CHECK(!PartlyVisible({0, 0, 0, 100}, {}, both));
  CHECK(std::fabs(VisibleArea({0, 0, 100, 100}, {{50, 0, 100, 100}}, both) - 5000) < 1e-9);

  CHECK(CountsAsCover(0, 1));
  CHECK(!CountsAsCover(0, 0.97));
  CHECK(!CountsAsCover(0, 0.5));
  CHECK(!CountsAsCover(3, 1));
  CHECK(!CountsAsCover(25, 1));
  CHECK(!CountsAsCover(1000, 1));
  CHECK(!CountsAsCover(-1, 1));

  Random random{0x1236};
  for (int round = 0; round < 3000; round++) {
    const Rect w{random.uniform(-200, 3000), random.uniform(-300, 900), random.uniform(50, 1500), random.uniform(50, 1000)};
    std::vector<Rect> covers;
    const int n = (int)(random.next() % 12);
    for (int k = 0; k < n; k++) covers.push_back({random.uniform(-300, 3500), random.uniform(-400, 1200), random.uniform(10, 2000), random.uniform(10, 1400)});
    const double exact = VisibleArea(w, covers, both);
    const double sampled = SampledArea(w, covers, both, 400);
    CHECK(std::fabs(exact - sampled) <= w.width * w.height * 0.02 + 1);
  }

  if (failures) {
    std::printf("%d failure(s)\n", failures);
    return 1;
  }
  std::printf("window-sight: ok\n");
  return 0;
}
