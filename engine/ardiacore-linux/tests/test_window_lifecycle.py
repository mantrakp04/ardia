import pathlib
import shutil
import subprocess
import tempfile
import unittest


SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'src'
LINUX = SOURCE / 'ardia' / 'linux'

LEDGER = r'''#include <array>
#include <cassert>
#include <cmath>
#include <limits>
#include <optional>
#include <vector>
#include "ardia/linux/ac_linux_window_lifecycle.h"

using namespace ardia::linux_window;

static void NewRegularWindowsHonorRequestedFocus() {
  FocusLedger ledger(true);
  assert(ledger.Create(7, {.focus = true}) == Presentation::kActivate);
  assert(ledger.pending(7));
  assert(ledger.Create(8, {.focus = false}) == Presentation::kInactive);
  assert(!ledger.pending(8));
  assert(ledger.Create(9, {.focus = true, .behind = true}) == Presentation::kInactive);
  assert(ledger.Create(10, {.focus = false, .utility = true}) == Presentation::kActivate);
}

static void BackgroundInstancesNeverActivate() {
  FocusLedger ledger(false);
  assert(ledger.Create(1, {.focus = true}) == Presentation::kInactive);
  assert(ledger.Create(2, {.utility = true}) == Presentation::kInactive);
  assert(ledger.Reuse(1, {.focus = true}, false) == Activation::kNone);
  assert(ledger.Reuse(2, {.utility = true}, false) == Activation::kShowInactive);
  assert(ledger.Focus(1) == Activation::kShowInactive);
  assert(ledger.Ready(1) == Activation::kNone);
  assert(!ledger.pending(1));
}

static void APointerPressBlocksTheReadinessRetry() {
  FocusLedger ledger(true);
  ledger.Observe(1, true);
  ledger.Create(2, {.focus = true});
  ledger.PointerPressed();
  assert(ledger.Ready(2) == Activation::kNone);
  ledger.Create(3, {.focus = true});
  assert(ledger.Ready(3) == Activation::kActivate);
}

static void ReuseFollowsIntentButIgnoresTheWindowsOwnLaunchEcho() {
  FocusLedger ledger(true);
  ledger.Create(1, {.focus = false});
  assert(ledger.Reuse(1, {.focus = true}, true) == Activation::kNone);
  assert(!ledger.pending(1));
  assert(ledger.Reuse(1, {.focus = false}, false) == Activation::kNone);
  assert(ledger.Reuse(1, {.focus = true, .behind = true}, false) == Activation::kNone);
  assert(ledger.Reuse(1, {.focus = true}, false) == Activation::kActivate);
  assert(ledger.pending(1));
  assert(ledger.Reuse(2, {.focus = false, .utility = true}, true) == Activation::kActivate);
}

static void ReadinessRetriesOnlyWhileNothingElseWasActivated() {
  FocusLedger ledger(true);
  ledger.Observe(1, true);
  ledger.Create(2, {.focus = true});
  assert(ledger.Ready(2) == Activation::kActivate);
  assert(!ledger.pending(2));
  assert(ledger.Ready(2) == Activation::kNone);

  ledger.Create(3, {.focus = true});
  ledger.Observe(1, false);
  assert(ledger.Ready(3) == Activation::kNone);

  ledger.Create(4, {.focus = true});
  assert(ledger.Observe(4, true));
  assert(!ledger.pending(4));
  assert(ledger.Ready(4) == Activation::kNone);

  ledger.Create(5, {.focus = true});
  ledger.Forget(5);
  assert(!ledger.pending(5));
  assert(ledger.Ready(5) == Activation::kNone);
}

static void ObservedActivationIsReportedOncePerTransition() {
  FocusLedger ledger(false);
  assert(ledger.Observe(1, true));
  assert(!ledger.Observe(1, true));
  assert(ledger.active() == 1);
  assert(ledger.Observe(2, true));
  assert(!ledger.Observe(1, false));
  assert(ledger.active() == 2);
  assert(!ledger.Observe(2, false));
  assert(ledger.active() == 0);
  assert(ledger.Observe(2, true));
  ledger.Forget(2);
  assert(ledger.active() == 0);
}

static void ACompositorActivationOfABehindWindowIsHandedBack() {
  FocusLedger ledger(true);
  ledger.Observe(1, true);
  assert(ledger.Create(2, {.focus = false, .behind = true, .behind_window = 1, .hand_back = true}, 1000) == Presentation::kInactive);
  ledger.Observe(1, false);
  assert(ledger.Observe(2, true));
  assert(ledger.Unrequested(2, 1100) == std::optional<int>(1));
  assert(!ledger.Unrequested(2, 1100));
  ledger.Create(3, {.focus = false, .hand_back = true}, 1000);
  ledger.PointerPressed();
  assert(!ledger.Unrequested(3, 1000));
  ledger.Create(5, {.focus = false, .behind = true, .behind_window = 6, .hand_back = true}, 1000);
  ledger.Forget(6);
  assert(!ledger.Unrequested(5, 1000));
  ledger.Create(7, {.focus = true, .hand_back = true}, 1000);
  assert(!ledger.Unrequested(7, 1000));
  ledger.Create(8, {.focus = false, .behind = true, .behind_window = 9, .hand_back = true}, 1000);
  ledger.Forget(8);
  assert(!ledger.Unrequested(8, 1000));
  FocusLedger background(false);
  background.Observe(1, true);
  background.Create(2, {.focus = false, .hand_back = true}, 0);
  assert(!background.Unrequested(2, 0));
  FocusLedger idle(true);
  idle.Create(2, {.focus = false, .hand_back = true}, 0);
  assert(!idle.Unrequested(2, 0));
}

static void OnlyTheActivationAroundTheFirstFrameIsHandedBack() {
  FocusLedger x11(true);
  x11.Observe(1, true);
  x11.Create(2, {.focus = false, .behind = true, .behind_window = 1}, 0);
  assert(!x11.Unrequested(2, 10));
  FocusLedger wayland(true);
  wayland.Observe(1, true);
  const OpenIntent behind{.focus = false, .behind = true, .behind_window = 1, .hand_back = true};
  wayland.Create(2, behind, 0);
  wayland.Presented(2, 900);
  wayland.Presented(2, 5000);
  assert(wayland.Unrequested(2, 900 + FocusLedger::kHandBackAfterFrameMs) == std::optional<int>(1));
  wayland.Create(3, behind, 0);
  wayland.Presented(3, 900);
  assert(!wayland.Unrequested(3, 901 + FocusLedger::kHandBackAfterFrameMs));
  wayland.Create(4, behind, 0);
  assert(wayland.Unrequested(4, FocusLedger::kHandBackLimitMs) == std::optional<int>(1));
  wayland.Create(5, behind, 0);
  assert(!wayland.Unrequested(5, FocusLedger::kHandBackLimitMs + 1));
  wayland.Create(6, behind, 0);
  assert(wayland.Focus(6) == Activation::kActivate);
  assert(!wayland.Unrequested(6, 10));
  wayland.Create(7, behind, 0);
  wayland.Create(8, behind, 0);
  assert(wayland.Focus(1) == Activation::kActivate);
  assert(!wayland.Unrequested(7, 10) && !wayland.Unrequested(8, 10));
  wayland.Create(9, behind, 0);
  assert(wayland.Reuse(9, {.focus = false}, false) == Activation::kNone);
  assert(wayland.Reuse(9, {.focus = false, .behind = true}, true) == Activation::kNone);
  assert(wayland.Unrequested(9, 10) == std::optional<int>(1));
  wayland.Create(10, behind, 0);
  assert(wayland.Reuse(10, {.focus = true}, false) == Activation::kActivate);
  assert(!wayland.Unrequested(10, 10));
}

static void SharedFramesUseBottomUpPrimaryCoordinates() {
  const Rect primary{0, 0, 1920, 1080};
  const auto shared = SharedFrame({100, 50, 800, 600}, primary);
  assert((shared == std::array<int, 4>{100, 430, 800, 600}));
  const auto back = RequestedFrame({100, 430, 800, 600}, primary, true);
  assert(back && back->positioned);
  assert(back->bounds.x == 100 && back->bounds.y == 50);
  assert(back->bounds.width == 800 && back->bounds.height == 600);
  const Rect offset{-1280, 200, 1920, 1080};
  const auto moved = SharedFrame({-1280, 200, 640, 480}, offset);
  assert((moved == std::array<int, 4>{0, 600, 640, 480}));
  const auto restored = RequestedFrame({0, 600, 640, 480}, offset, true);
  assert(restored->bounds.x == -1280 && restored->bounds.y == 200);
  const auto rounded = RequestedFrame({10.4, 20.6, 800.5, 600.2}, primary, true);
  assert(rounded->bounds.width == 801 && rounded->bounds.height == 600);
}

static void MalformedFramesAreRejected() {
  const Rect primary{0, 0, 1920, 1080};
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double inf = std::numeric_limits<double>::infinity();
  assert(!RequestedFrame({0, 0, 800}, primary, true));
  assert(!RequestedFrame({0, 0, 0, 600}, primary, true));
  assert(!RequestedFrame({0, 0, 800, -1}, primary, true));
  assert(!RequestedFrame({nan, 0, 800, 600}, primary, true));
  assert(!RequestedFrame({0, inf, 800, 600}, primary, true));
  assert(!RequestedFrame({0, 0, 1e9, 600}, primary, true));
  assert(!RequestedFrame({1e12, 0, 800, 600}, primary, true));
}

static void FullScreenChangesAreReportedOnTransitionsOnly() {
  GeometryLedger geometry(false);
  assert(!geometry.FullScreen(false));
  assert(geometry.FullScreen(true) == std::optional<bool>(true));
  assert(!geometry.FullScreen(true));
  assert(geometry.FullScreen(false) == std::optional<bool>(false));
}

int main() {
  NewRegularWindowsHonorRequestedFocus();
  BackgroundInstancesNeverActivate();
  ReuseFollowsIntentButIgnoresTheWindowsOwnLaunchEcho();
  ReadinessRetriesOnlyWhileNothingElseWasActivated();
  APointerPressBlocksTheReadinessRetry();
  ObservedActivationIsReportedOncePerTransition();
  ACompositorActivationOfABehindWindowIsHandedBack();
  OnlyTheActivationAroundTheFirstFrameIsHandedBack();
  SharedFramesUseBottomUpPrimaryCoordinates();
  MalformedFramesAreRejected();
  FullScreenChangesAreReportedOnTransitionsOnly();
}
'''


class WindowLifecycleLedgerTests(unittest.TestCase):
    def test_ledger(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        with tempfile.TemporaryDirectory(prefix='ardia-window-ledger-') as scratch:
            root = pathlib.Path(scratch)
            (root / 'ledger.cc').write_text(LEDGER)
            binary = root / 'ledger'
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(SOURCE),
                                    str(root / 'ledger.cc'), str(LINUX / 'ac_linux_window_lifecycle.cc'), '-o', str(binary)],
                                   capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            ran = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(ran.returncode, 0, ran.stdout + ran.stderr)


if __name__ == '__main__':
    unittest.main()
