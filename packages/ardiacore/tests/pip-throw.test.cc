#include "../ios/ArdiaPiPThrowMath.h"

#include <cstdio>
#include <cstdlib>
#include <vector>

using namespace ardia_pip_throw;

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)
static bool Near(double a, double b, double eps = 1e-9) { return std::fabs(a - b) <= eps; }


struct Random {
  unsigned long long state;
  unsigned long long next() {
    state = state * 6364136223846793005ULL + 1442695040888963407ULL;
    return state >> 33;
  }
  double uniform(double lo, double hi) { return lo + (hi - lo) * (next() % 1000000) / 1000000.0; }
  int integer(int lo, int hi) { return lo + (int)(next() % (unsigned long long)(hi - lo + 1)); }
  bool chance(double p) { return uniform(0, 1) < p; }
};

static bool Overlaps(Rect a, Rect b) { return a.x < b.maxX() && b.x < a.maxX() && a.y < b.maxY() && b.y < a.maxY(); }

static Rect Inset(Random &r, Rect frame, bool menuBar) {
  Rect v = frame;
  if (menuBar) v.h -= r.integer(24, 40);
  if (r.chance(0.4)) {
    const double dock = r.integer(40, 100);
    switch (r.integer(0, 2)) {
      case 0: v.y += dock, v.h -= dock; break;
      case 1: v.x += dock, v.w -= dock; break;
      default: v.w -= dock; break;
    }
  }
  return v;
}

static int Layout(Random &r, Screen *out, bool halfPoints = false) {
  const double w0 = r.integer(1024, 2560), h0 = r.integer(640, 1440);
  out[0].frame = {0, 0, w0, h0};
  out[0].visible = Inset(r, out[0].frame, true);
  int count = 1;
  const int extra = r.integer(0, 2);
  for (int attempt = 0; attempt < 40 && count < 1 + extra; attempt++) {
    const Rect &base = out[r.integer(0, count - 1)].frame;
    const double w = r.chance(0.2) ? r.integer(300, 800) : r.integer(1024, 2560);
    const double h = r.chance(0.2) ? r.integer(300, 600) : r.integer(640, 1440);
    Rect f{0, 0, w, h};
    switch (r.integer(0, 3)) {
      case 0: f.y = base.maxY(), f.x = base.x + r.uniform(-w + 100, base.w - 100); break;
      case 1: f.y = base.y - h, f.x = base.x + r.uniform(-w + 100, base.w - 100); break;
      case 2: f.x = base.maxX(), f.y = base.y + r.uniform(-h + 100, base.h - 100); break;
      default: f.x = base.x - w, f.y = base.y + r.uniform(-h + 100, base.h - 100); break;
    }
    f.x = std::round(f.x), f.y = std::round(f.y);
    if (halfPoints) f.x += 0.5, f.y += 0.5;
    bool clear = true;
    for (int i = 0; i < count; i++) clear = clear && !Overlaps(f, out[i].frame);
    if (!clear) continue;
    out[count].frame = f;
    out[count].visible = Inset(r, f, r.chance(0.5));
    count++;
  }
  return count;
}


static void Describe(const Screen *s, int n, Rect start, const std::vector<Point> &walk, int failedAt, const char *what) {
  std::printf("PROPERTY FAIL (%s) at step %d\n", what, failedAt);
  for (int i = 0; i < n; i++)
    std::printf("  screen %d frame {%g,%g,%g,%g} visible {%g,%g,%g,%g}\n", i, s[i].frame.x, s[i].frame.y, s[i].frame.w, s[i].frame.h,
                s[i].visible.x, s[i].visible.y, s[i].visible.w, s[i].visible.h);
  std::printf("  start {%g,%g,%g,%g}\n  walk:", start.x, start.y, start.w, start.h);
  for (int i = 0; i <= failedAt && i < (int)walk.size(); i++) std::printf(" {%g,%g}", walk[i].x, walk[i].y);
  std::printf("\n");
}

static int PropertyTest() {
  Random r{20261022};
  int failed = 0, steps = 0, moves = 0, reversals = 0, multi = 0, oversized = 0, invalid = 0, crossings = 0, gestures = 0, rescues = 0, strandedInStrip = 0;
  for (int c = 0; c < 4000 && failed < 3; c++) {
    Screen screens[3];
    const int n = Layout(r, screens, r.chance(0.2));
    const int home = r.integer(0, n - 1);
    const Rect &v = screens[home].visible;
    double w = r.integer(284, 1400), h = std::round(w * r.uniform(0.4, 0.8));
    if (r.chance(0.15)) h = v.h + r.integer(1, 120);
    if (r.chance(0.05)) w = v.w + r.integer(1, 120);
    Rect frame{0, 0, w, h};
    if (r.chance(0.8)) {
      frame.x = w <= v.w ? v.x + r.uniform(0, v.w - w) : v.x + v.w - w + r.uniform(0, w - v.w);
      frame.y = h <= v.h ? v.y + r.uniform(0, v.h - h) : v.y + v.h - h + r.uniform(0, h - v.h);
    } else {
      frame.x = r.uniform(-2000, 4000), frame.y = r.uniform(-2000, 3000);
    }
    if (r.chance(0.5)) frame.x = std::round(frame.x), frame.y = std::round(frame.y);
    if (r.chance(0.2) && w <= v.w && h <= v.h) {
      switch (r.integer(0, 3)) {
        case 0: frame.y = v.maxY() - h; break;
        case 1: frame.y = v.y; break;
        case 2: frame.x = v.maxX() - kMinVisibleWidth; break;
        default: frame.x = v.x + kMinVisibleWidth - w; break;
      }
    }
    const Rect start = frame;
    multi += n > 1;
    oversized += w > v.w || h > v.h;
    invalid += Mover(frame, screens, n).shortfall(frame) > 1e-9;
    int lastHome = LargestOverlap(frame, screens, n);
    std::vector<Point> walk;
    Point direction{0, 0};
    int gesture = LargestOverlap(frame, screens, n);
    bool gestureStartedReachable = Reachable(frame, screens, n);
    const int target = n > 1 && r.chance(0.5) ? r.integer(0, n - 1) : -1;
    bool broke = false;
    auto endGesture = [&](int at) {
      gestures++;
      if (gestureStartedReachable && !Reachable(frame, screens, n)) {
        strandedInStrip++;
        if (std::getenv("PIP_THROW_VERBOSE")) Describe(screens, n, start, walk, at, "left in a passage strip");
      }
      const Rect rescued = Rescue(frame, screens, n, gesture);
      rescues += rescued.x != frame.x || rescued.y != frame.y;
      frame = rescued;
      if (!Reachable(frame, screens, n)) {
        Describe(screens, n, start, walk, at, "unreachable after the gesture-end rescue");
        failed++;
        return false;
      }
      gesture = LargestOverlap(frame, screens, n);
      gestureStartedReachable = true;
      return true;
    };
    for (int i = 0; i < 250; i++) {
      if (r.chance(0.08) && !endGesture(i)) {
        broke = true;
        break;
      }
      if (i == 0 || r.chance(0.3)) {
        double angle = r.uniform(0, 2 * kPi);
        const double size = r.chance(0.03) ? 500 : r.chance(0.1) ? r.uniform(0.05, 0.95) : r.uniform(1, 20);
        if (target >= 0 && r.chance(0.7)) {
          const Rect &t = screens[target].frame;
          angle = std::atan2(t.y + t.h / 2 - (frame.y + frame.h / 2), t.x + t.w / 2 - (frame.x + frame.w / 2)) + r.uniform(-0.6, 0.6);
        }
        direction = {size * std::cos(angle), size * std::sin(angle)};
        if (r.chance(0.3)) direction = {std::round(direction.x), std::round(direction.y)};
        if (r.chance(0.2)) direction = r.chance(0.5) ? Point{direction.x, 0} : Point{0, direction.y};
      }
      walk.push_back(direction);
      const Point d = direction;
      const Mover mover(frame, screens, n, gesture);
      const double before = mover.shortfall(frame);
      const Rect next = r.chance(0.5) ? SwipeStep(frame, d, screens, n, gesture) : DragStep(frame, d, screens, n, gesture);
      steps++;
      const double mx = next.x - frame.x, my = next.y - frame.y;
      const bool jumpX = std::fabs(mx) > std::fabs(d.x) + 1e-9 || (mx != 0 && (mx > 0) != (d.x > 0));
      const bool jumpY = std::fabs(my) > std::fabs(d.y) + 1e-9 || (my != 0 && (my > 0) != (d.y > 0));
      if (jumpX || jumpY || next.w != frame.w || next.h != frame.h) {
        Describe(screens, n, start, walk, i, "jump");
        failed++;
        break;
      }
      if (!mover.allowed(next, frame)) {
        Describe(screens, n, start, walk, i, "reachability");
        failed++;
        break;
      }
      if (mx != 0 || my != 0) {
        moves++;
        if (before <= 1e-9) {
          reversals++;
          const Rect back = SwipeStep(next, {-d.x, -d.y}, screens, n, gesture);
          if (back.x == next.x && back.y == next.y) {
            Describe(screens, n, start, walk, i, "stuck on reversal");
            std::printf("  from {%g,%g} moved to {%g,%g} by {%g,%g}; shortfall there %g, reversed full %g\n", frame.x, frame.y, next.x, next.y, d.x, d.y,
                        mover.shortfall(next), mover.shortfall(Shifted(next, -d.x, -d.y)));
            failed++;
            break;
          }
        }
      }
      frame = next;
      const int nowHome = LargestOverlap(frame, screens, n);
      crossings += nowHome != lastHome;
      lastHome = nowHome;
    }
    if (!broke) endGesture(250);
  }
  std::printf("pip-throw property: %d steps, %d moves, %d reversals checked, %d multi-display layouts, %d oversized, %d invalid starts, %d display crossings, %d gestures ended, %d rescued (%d of them from a reachable start, ending in a passage strip), %d failures\n",
              steps, moves, reversals, multi, oversized, invalid, crossings, gestures, rescues, strandedInStrip, failed);
  return failed;
}

static bool Inside(Rect w, Rect v) { return w.x >= v.x - 1e-9 && w.y >= v.y - 1e-9 && w.maxX() <= v.maxX() + 1e-9 && w.maxY() <= v.maxY() + 1e-9; }

static int ProgressTest() {
  Random r{7311};
  int failed = 0, walks = 0, totalSteps = 0, tight = 0, offsetPairs = 0, halfPoint = 0;
  for (int c = 0; c < 1200 && failed < 3; c++) {
    Screen screens[3];
    int n = 1;
    for (int attempt = 0; attempt < 20 && n < 2; attempt++) n = Layout(r, screens, r.chance(0.3));
    if (n < 2) continue;
    double fitW = HUGE_VAL, fitH = HUGE_VAL;
    for (int i = 0; i < n; i++) fitW = std::min(fitW, screens[i].visible.w), fitH = std::min(fitH, screens[i].visible.h);
    const double w = std::min<double>(r.integer(284, 900), fitW), h = std::min(std::round(w * r.uniform(0.4, 0.8)), fitH);
    const int from = r.integer(0, n - 1);
    const Rect &v = screens[from].visible;
    for (int target = 0; target < n; target++) {
      if (target == from) continue;
      const Rect &a = screens[from].frame, &b = screens[target].frame;
      const bool sideBySide = (std::fabs(a.maxX() - b.x) <= 1 || std::fabs(b.maxX() - a.x) <= 1) &&
                              std::min(a.maxY(), b.maxY()) > std::max(a.y, b.y);
      const bool stacked = (std::fabs(a.maxY() - b.y) <= 1 || std::fabs(b.maxY() - a.y) <= 1) &&
                           std::min(a.maxX(), b.maxX()) > std::max(a.x, b.x);
      if (!sideBySide && !stacked) continue;
      Rect frame{v.x + r.uniform(0, v.w - w), v.y + r.uniform(0, v.h - h), w, h};
      const Rect start = frame;
      const Rect &t = screens[target].visible;
      Rect waypoint = frame;
      offsetPairs += sideBySide ? std::fabs(a.y - b.y) > 1 : std::fabs(a.x - b.x) > 1;
      halfPoint += std::fabs(b.x - std::round(b.x)) > 0.1 || std::fabs(a.x - std::round(a.x)) > 0.1;
      if (sideBySide) {
        const double lo = std::max(v.y, t.y), hi = std::min(v.maxY(), t.maxY());
        tight += hi - lo < h;
        waypoint.y = std::clamp((lo + hi) / 2 - h / 2, v.y, v.maxY() - h);
      } else {
        const double lo = std::max(v.x, t.x), hi = std::min(v.maxX(), t.maxX());
        tight += hi - lo < w;
        waypoint.x = std::clamp((lo + hi) / 2 - w / 2, v.x, v.maxX() - w);
      }
      walks++;
      bool arrived = false;
      int phase = 0;
      for (int step = 0; step < 40000; step++) {
        if (Inside(frame, t)) {
          arrived = true;
          break;
        }
        if (phase == 0 && std::fabs(frame.x - waypoint.x) < 1e-9 && std::fabs(frame.y - waypoint.y) < 1e-9) phase = 1;
        if (phase == 1 && (sideBySide ? frame.x >= t.x && frame.maxX() <= t.maxX() : frame.y >= t.y && frame.maxY() <= t.maxY())) phase = 2;
        double dx = phase == 0 ? waypoint.x - frame.x : t.x + t.w / 2 - (frame.x + w / 2);
        double dy = phase == 0 ? waypoint.y - frame.y : t.y + t.h / 2 - (frame.y + h / 2);
        if (phase == 1) (sideBySide ? dy : dx) = 0;
        const Point d{dx > 0 ? std::min(1.0, dx) : std::max(-1.0, dx), dy > 0 ? std::min(1.0, dy) : std::max(-1.0, dy)};
        const bool drag = step % 2;
        auto go = [&](Point delta) { return drag ? DragStep(frame, delta, screens, n) : SwipeStep(frame, delta, screens, n); };
        Rect next = go(d);
        if (next.x == frame.x && next.y == frame.y) next = go({d.x, 0});
        if (next.x == frame.x && next.y == frame.y) next = go({0, d.y});
        totalSteps++;
        if (next.x == frame.x && next.y == frame.y) {
          if (phase < 2) {
            phase++;
            continue;
          }
          break;
        }
        frame = next;
      }
      if (!arrived) {
        failed++;
        std::printf("PROGRESS FAIL: from screen %d to %d, stuck at {%g,%g,%g,%g}\n", from, target, frame.x, frame.y, frame.w, frame.h);
        for (int i = 0; i < n; i++)
          std::printf("  screen %d frame {%g,%g,%g,%g} visible {%g,%g,%g,%g}\n", i, screens[i].frame.x, screens[i].frame.y, screens[i].frame.w,
                      screens[i].frame.h, screens[i].visible.x, screens[i].visible.y, screens[i].visible.w, screens[i].visible.h);
        std::printf("  start {%g,%g,%g,%g}\n", start.x, start.y, start.w, start.h);
      }
    }
  }
  std::printf("pip-throw progress: %d greedy walks between touching displays (%d offset, %d with a shared edge shorter than the window, %d at half-point origins), %d steps, %d failures\n",
              walks, offsetPairs, tight, halfPoint, totalSteps, failed);
  return failed;
}

int main() {
  const Rect screen{0, 0, 1512, 982}, visible{0, 0, 1512, 945};
  const Point middle{756, 491};

  CHECK(PickCorner(middle, {1000, 650}, screen) == kTopRight);
  CHECK(PickCorner(middle, {-1000, 650}, screen) == kTopLeft);
  CHECK(PickCorner(middle, {-1000, -650}, screen) == kBottomLeft);
  CHECK(PickCorner(middle, {1000, -650}, screen) == kBottomRight);
  CHECK(PickCorner(middle, {0, 0}, screen) == kNoCorner);
  CHECK(PickCorner(middle, {0, 1000}, screen) == kNoCorner);
  CHECK(PickCorner(middle, {1000, 0}, screen) == kTopRight || PickCorner(middle, {1000, 0}, screen) == kBottomRight);
  CHECK(PickCorner({1300, 200}, {1000, 0}, screen) == kBottomRight);
  CHECK(PickCorner({1300, 800}, {1000, 0}, screen) == kTopRight);
  CHECK(PickCorner({200, 200}, {1000, 0}, screen) == kBottomRight);
  CHECK(PickCorner({1400, 100}, {0, 1000}, screen) == kTopRight);
  CHECK(PickCorner({-100, 491}, {1000, 900}, screen) == kTopRight);

  CHECK(AngleApart(0.1, 2 * kPi - 0.1) < 0.2 + 1e-12);
  CHECK(Near(AngleApart(-kPi, kPi), 0));
  CHECK(Near(AngleApart(kPi / 2, -kPi / 2), kPi));

  {
    Rect r = CornerFrame(kTopRight, 468, 263, visible);
    CHECK(r.x == 1512 - 10 - 468 && r.y == 945 - 10 - 263 && r.w == 468 && r.h == 263);
    r = CornerFrame(kBottomLeft, 468, 263, visible);
    CHECK(r.x == 10 && r.y == 10);
    r = CornerFrame(kTopLeft, 300.4, 169, {1512, -200, 1920, 1055});
    CHECK(r.x == 1522 && r.y == -200 + 1055 - 10 - 169);
    r = CornerFrame(kBottomRight, 300, 169, {1512, -200, 1920, 1055});
    CHECK(r.x == 1512 + 1920 - 10 - 300 && r.y == -190);
  }

  CHECK(FingerDelta(5, 3, true).x == 5 && FingerDelta(5, 3, true).y == -3);
  CHECK(FingerDelta(5, 3, false).x == -5 && FingerDelta(5, 3, false).y == 3);
  CHECK(!SwipeFlings({6, 0}) && SwipeFlings({5, 4}) && SwipeFlings({-7, 0}));
  CHECK(SwipeVelocity({10, -2}).x == 900 && SwipeVelocity({10, -2}).y == -180);
  CHECK(!DragFlings({350, 0}) && DragFlings({300, 200}));

  {
    Sample s[] = {{0.00, 0, 0}, {0.02, 10, 0}, {0.10, 50, 0}, {0.15, 100, 20}, {0.18, 130, 26}};
    Point v = ReleaseVelocity(s, 5, 0.19);
    CHECK(Near(v.x, (130 - 50) / 0.08, 1e-6) && Near(v.y, 26 / 0.08, 1e-6));
    v = ReleaseVelocity(s, 5, 0.30);
    CHECK(v.x == 0 && v.y == 0);
    v = ReleaseVelocity(s, 1, 0.01);
    CHECK(v.x == 0 && v.y == 0);
  }
  {
    Sample drag[] = {{1.000, 0, 0}, {1.008, 8, 0}, {1.016, 16, 0}, {1.024, 24, 0}, {1.032, 32, 0}, {1.040, 40, 0}};
    Point held = ReleaseVelocity(drag, 6, 1.100);
    CHECK(held.x == 0 && held.y == 0);
    Point flicked = ReleaseVelocity(drag, 6, 1.044);
    CHECK(Near(flicked.x, 1000, 1e-6) && flicked.y == 0 && DragFlings(flicked));
  }

  {
    const Screen offset[] = {{{0, 0, 1512, 982}, {0, 0, 1512, 945}}, {{1000, 982, 1512, 982}, {1000, 982, 1512, 945}}};
    Rect w{700, 600, 468, 263};
    double biggest = 0;
    for (int i = 0; i < 1064; i++) {
      Rect next = SwipeStep(w, {0, 1}, offset, 2);
      biggest = std::max(biggest, std::fabs(next.y - w.y - 1));
      w = next;
    }
    CHECK(biggest == 0 && w.y == 982 + 945 - 263);
    CHECK(LargestOverlap(w, offset, 2) == 1);
    CHECK(SwipeStep(w, {0, 1}, offset, 2).y == w.y);
    CHECK(SwipeStep(w, {0, -1}, offset, 2).y == w.y - 1);
    Rect beside{100, 600, 468, 263};
    for (int i = 0; i < 600; i++) beside = SwipeStep(beside, {0, 1}, offset, 2);
    CHECK(beside.y == 945 - 263);

    const Screen single[] = {{{0, 0, 1512, 982}, {0, 0, 1512, 945}}};
    Rect top{500, 600, 468, 263};
    for (int i = 0; i < 300; i++) top = SwipeStep(top, {0, 2}, single, 1);
    CHECK(top.y == 945 - 263);
    top = SwipeStep(top, {0, -5}, single, 1);
    CHECK(top.y == 945 - 263 - 5);
    Rect above{500, 800, 468, 263};
    above = SwipeStep(above, {3, 4}, single, 1);
    CHECK(above.y == 800 && above.x == 503);
    above = SwipeStep(above, {0, -4}, single, 1);
    CHECK(above.y == 796);
  }

  {
    const Screen single[] = {{{0, 0, 1512, 982}, {0, 70, 1512, 875}}};
    Rect w{500, 100, 468, 263};
    for (int i = 0; i < 100; i++) w = SwipeStep(w, {0, -5}, single, 1);
    CHECK(w.y == 70 && w.x == 500);
    Rect low{500, 20, 468, 263};
    low = SwipeStep(low, {0, -5}, single, 1);
    CHECK(low.y == 20);
    low = SwipeStep(low, {0, 5}, single, 1);
    CHECK(low.y == 25);

    const Screen stacked[] = {{{0, 0, 1512, 982}, {0, 0, 1512, 945}}, {{-200, -1080, 1920, 1080}, {-200, -1080, 1920, 1055}}};
    Rect s{500, 100, 468, 263};
    double biggest = 0;
    for (int i = 0; i < 400; i++) {
      Rect next = SwipeStep(s, {0, -5}, stacked, 2);
      biggest = std::max(biggest, std::fabs(next.y - s.y + 5));
      s = next;
      if (s.y == -1080) break;
    }
    CHECK(s.y == -1080 && biggest == 0);
    CHECK(SwipeStep(s, {0, -5}, stacked, 2).y == -1080);
    const Screen narrowBelow[] = {{{0, 0, 1512, 982}, {0, 0, 1512, 945}}, {{0, -1080, 1200, 1080}, {0, -1080, 1200, 1055}}};
    Rect off{1250, 100, 250, 141};
    for (int i = 0; i < 100; i++) off = SwipeStep(off, {0, -5}, narrowBelow, 2);
    CHECK(off.y == 0);
  }

  {
    const Screen offset[] = {{{0, 0, 1512, 982}, {0, 0, 1512, 945}}, {{1000, 982, 1512, 982}, {1000, 982, 1512, 945}}};
    Rect w{700, 600, 468, 263};
    double biggest = 0;
    for (int pointer = 0; pointer < 1064; pointer++) {
      Rect next = DragStep(w, {0, 1}, offset, 2);
      biggest = std::max(biggest, std::fabs(next.y - w.y - 1));
      w = next;
    }
    CHECK(biggest == 0 && w.y == 982 + 945 - 263);
    Rect beside{100, 600, 468, 263};
    for (int pointer = 0; pointer < 600; pointer++) beside = DragStep(beside, {0, 1}, offset, 2);
    CHECK(beside.y == 945 - 263);
    beside = DragStep(beside, {0, 500 - beside.y}, offset, 2);
    CHECK(beside.y == 500);
    Rect under = DragStep({100, 100, 468, 263}, {0, -300}, offset, 2);
    CHECK(under.y == 0);

    Rect lost{1100, 1300, 468, 263};
    for (int i = 0; i < 600; i++) lost = SwipeStep(lost, {-1, 0}, offset, 2);
    CHECK(lost.x == 1000 + kMinVisibleWidth - 468 && lost.y == 1300);
    Rect lower{1000, 100, 468, 263};
    for (int i = 0; i < 600; i++) lower = SwipeStep(lower, {1, 0}, offset, 2);
    CHECK(lower.x == 1512 - kMinVisibleWidth && lower.y == 100);
    Rect dragged = DragStep({1100, 1300, 468, 263}, {-700, 0}, offset, 2);
    CHECK(dragged.x == 1000 + kMinVisibleWidth - 468);

    Rect crossing{100, 600, 468, 263};
    for (int i = 0; i < 281; i++) crossing = DragStep(crossing, {0, 1}, offset, 2);
    CHECK(crossing.y == 945 - 263);
    for (int i = 0; i < 432; i++) crossing = DragStep(crossing, {1, 0}, offset, 2);
    CHECK(crossing.x == 532 && crossing.y == 945 - 263);
    crossing = DragStep(crossing, {1, 0}, offset, 2);
    CHECK(crossing.x == 533 && crossing.y == 945 - 263);
    crossing = DragStep(crossing, {0, 1}, offset, 2);
    CHECK(crossing.y == 945 - 263 + 1);
  }

  {
    const Screen small[] = {{{0, 0, 1280, 720}, {0, 0, 1280, 683}}};
    auto at = [&](double y, double dy) { return SwipeStep({100, y, 1000, 720}, {0, dy}, small, 1).y; };
    CHECK(at(0, 5) == 0 && at(0, -5) == -5);
    CHECK(at(-37, -5) == -37 && at(-37, 5) == -32);
    CHECK(at(-20, 5) == -15 && at(-20, -5) == -25);
    CHECK(SwipeStep({100, -20, 1000, 720}, {30, 0}, small, 1).x == 130);
    CHECK(SwipeStep({100, -20, 1000, 720}, {300, 0}, small, 1).x == 280);

    const Screen tower[] = {{{0, 0, 1280, 720}, {0, 0, 1280, 683}}, {{0, 720, 1280, 720}, {0, 720, 1280, 683}}};
    Rect tall{100, 0, 1000, 720};
    for (int i = 0; i < 1000; i++) tall = SwipeStep(tall, {0, 1}, tower, 2);
    CHECK(tall.y == 0);
    tall = SwipeStep(tall, {0, -1}, tower, 2);
    CHECK(tall.y == -1);
    for (int i = 0; i < 100; i++) tall = DragStep(tall, {0, -1}, tower, 2);
    CHECK(tall.y == -37);
    CHECK(SwipeStep(tall, {0, 1}, tower, 2).y == -36);
  }


  {
    const Screen pair[] = {{{0, 0, 1280, 720}, {0, 0, 1280, 683}}, {{1280, 500, 1280, 720}, {1280, 500, 1280, 683}}};
    for (int drag = 0; drag < 2; drag++) {
      Rect w{1000, 400, 468, 263};
      for (int i = 0; i < 800; i++) w = drag ? DragStep(w, {1, 0}, pair, 2) : SwipeStep(w, {1, 0}, pair, 2);
      CHECK(w.x == 1279 && w.y == 400);
      for (int i = 0; i < 100; i++) w = drag ? DragStep(w, {0, 1}, pair, 2) : SwipeStep(w, {0, 1}, pair, 2);
      CHECK(w.y == 500);
      for (int i = 0; i < 521; i++) w = drag ? DragStep(w, {1, 0}, pair, 2) : SwipeStep(w, {1, 0}, pair, 2);
      CHECK(w.x == 1800 && Inside(w, pair[1].visible));
      for (int i = 0; i < 300; i++) w = drag ? DragStep(w, {0, 1}, pair, 2) : SwipeStep(w, {0, 1}, pair, 2);
      CHECK(w.y == 800);
      Rect u{700, 300, 468, 263};
      for (int i = 0; i < 300; i++) u = drag ? DragStep(u, {0, 1}, pair, 2) : SwipeStep(u, {0, 1}, pair, 2);
      CHECK(u.y == 683 - 263);
      for (int i = 0; i < 800; i++) u = drag ? DragStep(u, {1, 0}, pair, 2) : SwipeStep(u, {1, 0}, pair, 2);
      CHECK(u.x == 1279 && u.y == 683 - 263);
      const Rect up = drag ? DragStep(u, {0, 1}, pair, 2) : SwipeStep(u, {0, 1}, pair, 2);
      CHECK(up.y == 683 - 263 + 1);
    }
  }

  {
    const Screen one[] = {{{0, 0, 1280, 720}, {0, 0, 1280, 683}}};
    Rect w{100, 0, 700, 400};
    const Point grab{100, 20};
    for (int i = 0; i < 630; i++) w = DragStep(w, {0, 1}, one, 1);
    CHECK(w.y == 683 - 400);
    for (int i = 0; i < 100; i++) w = DragStep(w, {1, 0}, one, 1);
    CHECK(w.x == 200 && w.y == 283);
    const Point spot{w.x + grab.x, w.y + grab.y}, cursor{300, 650};
    CHECK(spot.x == 300 && spot.y == 303);
    CHECK(PickCorner(spot, {2000, 0}, one[0].frame) == kBottomRight);
    CHECK(PickCorner(cursor, {2000, 0}, one[0].frame) == kTopRight);
  }

  {
    const Screen one[] = {{{0, 0, 1280, 720}, {0, 0, 1280, 683}}};
    Rect w{100, 100, 468, 263};
    w = SwipeStep(w, {500, 0}, one, 1);
    CHECK(w.x == 600);
    w = SwipeStep(w, {0, 500}, one, 1);
    CHECK(w.y == 683 - 263);
    w = SwipeStep(w, {0.4, -0.3}, one, 1);
    CHECK(Near(w.x, 600.4) && Near(w.y, 683 - 263 - 0.3));
    w = SwipeStep(w, {0, 0.8}, one, 1);
    CHECK(Near(w.y, 683 - 263 - 0.3));
    w = SwipeStep(w, {-0.4, 0.3}, one, 1);
    CHECK(Near(w.x, 600) && Near(w.y, 683 - 263));
  }


  {
    const Screen wide[] = {{{0, 0, 3440, 1440}, {0, 0, 3440, 1403}}, {{2000, 1440, 1280, 800}, {2000, 1440, 1280, 763}}};
    Rect w{760, 400, 1300, 650};
    for (int i = 0; i < 1040; i++) w = SwipeStep(w, {0, 1}, wide, 2, 0);
    CHECK(w.y == 1440 && Reachable(w, wide, 2));
    Rect stashed{728, 1440, 1300, 650};
    CHECK(!Reachable(stashed, wide, 2));
    Rect lost = stashed;
    for (int i = 0; i < 800; i++) lost = SwipeStep(lost, {1, 1}, wide, 2, 1);
    CHECK(lost.y <= 2203 - 650 && Reachable(lost, wide, 2));
    CHECK(Reachable(Rescue({1528, 2240, 1300, 650}, wide, 2, 1), wide, 2));
    CHECK(Rescue({1528, 2240, 1300, 650}, wide, 2, 1).x == 1980 && Rescue({1528, 2240, 1300, 650}, wide, 2, 1).y == 2203 - 650);
    CHECK(Rescue(w, wide, 2, 0).x == w.x && Rescue(w, wide, 2, 0).y == w.y);
  }

  {
    SpringState a = SpringAt(500, 0, 0);
    CHECK(Near(a.offset, 500) && Near(a.velocity, 0));
    a = SpringAt(0, 1000, 0);
    CHECK(Near(a.offset, 0) && Near(a.velocity, 1000));
    const double dt = 1e-6;
    for (double t : {0.05, 0.2, 0.5}) {
      SpringState p = SpringAt(-800, 2000, t), q = SpringAt(-800, 2000, t + dt);
      CHECK(Near((q.offset - p.offset) / dt, p.velocity, 0.05));
    }
    double settled = -1;
    for (int frame = 0; frame < 600; frame++) {
      double t = frame / 60.0;
      SpringState x = SpringAt(-1000, 0, t), y = SpringAt(0, 0, t);
      if (Resolved(x, y)) {
        settled = t;
        break;
      }
    }
    CHECK(settled > 1.5 && settled < 3.5);
    double overshoot = 0;
    for (int frame = 0; frame < 600; frame++) overshoot = std::max(overshoot, SpringAt(-1000, 0, frame / 120.0).offset);
    CHECK(overshoot > 0 && overshoot < 2);
  }

  failures += PropertyTest();
  failures += ProgressTest();
  if (failures) return 1;
  std::printf("pip-throw: all passed\n");
  return 0;
}
