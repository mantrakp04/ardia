import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATCHES = ROOT.parents[0] / 'patches'
PATCH = PATCHES / 'chromium-linux-wayland-cursor-fallback.patch'
TREE_FILE = 'ui/ozone/platform/wayland/host/wayland_screen.cc'
TREE = pathlib.Path.home() / 'ardia-linux-build-156/chromium_git/chromium/src'


def pristine():
    if not (TREE / '.git').exists():
        return None
    result = subprocess.run(['git', '-C', str(TREE), 'show', f'HEAD:{TREE_FILE}'], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


PRISTINE = pristine()
SIGNATURE = 'gfx::Point WaylandScreen::GetCursorScreenPoint() const {'

HARNESS = r'''
#include <algorithm>
#include <cstdio>
#include <tuple>
#include <vector>
namespace gfx {
struct Point {
  int x_ = 0, y_ = 0;
  Point() = default;
  Point(int x, int y) : x_(x), y_(y) {}
  int x() const { return x_; }
  int y() const { return y_; }
  bool operator==(const Point& o) const { return x_ == o.x_ && y_ == o.y_; }
  bool operator<(const Point& o) const { return std::tie(y_, x_) < std::tie(o.y_, o.x_); }
};
struct PointF { float x = 0, y = 0; };
struct Rect {
  int x_ = 0, y_ = 0, w_ = 0, h_ = 0;
  Rect() = default;
  Rect(int x, int y, int w, int h) : x_(x), y_(y), w_(w), h_(h) {}
  int width() const { return w_; }
  int height() const { return h_; }
  int right() const { return x_ + w_; }
  int bottom() const { return y_ + h_; }
  bool IsEmpty() const { return w_ <= 0 || h_ <= 0; }
  bool Contains(const Point& p) const { return p.x_ >= x_ && p.x_ < right() && p.y_ >= y_ && p.y_ < bottom(); }
  void Union(const Rect& r) {
    if (r.IsEmpty()) return;
    if (IsEmpty()) { *this = r; return; }
    const int l = std::min(x_, r.x_), t = std::min(y_, r.y_);
    *this = Rect(l, t, std::max(right(), r.right()) - l, std::max(bottom(), r.bottom()) - t);
  }
  bool operator<(const Rect& o) const {
    const Point a(x_, y_), b(o.x_, o.y_);
    if (a == b) return w_ == o.w_ ? h_ < o.h_ : w_ < o.w_;
    return a < b;
  }
};
inline Point ScaleToRoundedPoint(PointF p, float s) { return Point(int(p.x * s + 0.5f), int(p.y * s + 0.5f)); }
}
#define DCHECK(condition) do { if (!(condition)) return gfx::Point(-1, -1); } while (0)
struct AppliedState { float ui_scale = 1; };
struct WaylandWindow {
  gfx::Rect bounds;
  AppliedState state;
  gfx::Rect GetBoundsInDIP() const { return bounds; }
  const AppliedState& applied_state() const { return state; }
};
struct CursorPosition { gfx::PointF GetCursorSurfacePoint() const { return {}; } };
struct WindowManager {
  std::vector<WaylandWindow*> windows;
  WaylandWindow* GetCurrentPointerOrTouchFocusedWindow() const { return nullptr; }
  std::vector<WaylandWindow*> GetAllWindows() const { return windows; }
  WaylandWindow* GetWindowWithLargestBounds() const {
    WaylandWindow* largest = nullptr;
    for (auto* window : windows) {
      if (!largest || largest->GetBoundsInDIP() < window->GetBoundsInDIP()) largest = window;
    }
    return largest;
  }
};
struct Connection {
  WindowManager manager;
  CursorPosition* wayland_cursor_position() { return nullptr; }
  WindowManager* window_manager() { return &manager; }
};
struct WaylandScreen {
  Connection* connection_;
  gfx::Point GetCursorScreenPoint() const;
};
FUNCTION
int main() {
  WaylandWindow browser{gfx::Rect(0, 0, 1920, 1080)};
  WaylandWindow settings{gfx::Rect(0, 0, 960, 1080)};
  WaylandWindow popup{gfx::Rect(210, 25, 96, 90)};
  for (auto windows : {std::vector<WaylandWindow*>{&browser, &popup}, {&settings, &browser, &popup}, {&browser}}) {
    Connection connection;
    connection.manager.windows = windows;
    const WaylandScreen screen{&connection};
    const gfx::Point point = screen.GetCursorScreenPoint();
    bool inside = false;
    for (auto* window : windows) inside = inside || window->bounds.Contains(point);
    std::printf("%d %d %s\n", point.x(), point.y(), inside ? "inside" : "outside");
  }
}
'''


def function(source):
    start = source.index(SIGNATURE)
    depth, end = 1, source.index('{', start) + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


def fallback_points(source):
    with tempfile.TemporaryDirectory(prefix='ardia-cursor-fallback-') as directory:
        program = pathlib.Path(directory) / 'fallback.cc'
        program.write_text(HARNESS.replace('FUNCTION', function(source)))
        binary = pathlib.Path(directory) / 'fallback'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Werror', str(program), '-o', str(binary)], check=True, timeout=120)
        result = subprocess.run([str(binary)], capture_output=True, text=True, timeout=30, check=True)
        return [line.split() for line in result.stdout.splitlines()]


def patched(source):
    with tempfile.TemporaryDirectory(prefix='ardia-cursor-patch-') as directory:
        target = pathlib.Path(directory) / TREE_FILE
        target.parent.mkdir(parents=True)
        target.write_text(source)
        subprocess.run(['git', 'apply', str(PATCH)], cwd=directory, check=True, capture_output=True, text=True)
        return target.read_text()


@unittest.skipUnless(PRISTINE is not None and shutil.which(os.environ.get('CXX', 'c++')), 'needs the Chromium 156 tree and a C++ compiler')
class WaylandCursorFallbackTests(unittest.TestCase):
    def test_chromium_puts_the_no_pointer_cursor_inside_the_browser_when_a_popup_sits_off_the_origin(self):
        points = fallback_points(PRISTINE)
        self.assertEqual(points[0], ['106', '100', 'inside'])
        self.assertEqual(points[1][2], 'inside')

    def test_the_patched_fallback_lies_outside_every_window(self):
        points = fallback_points(patched(PRISTINE))
        self.assertEqual(points, [['1930', '1090', 'outside'], ['1930', '1090', 'outside'], ['1930', '1090', 'outside']])


class WaylandCursorFallbackSeriesTests(unittest.TestCase):
    def test_the_patch_is_linux_only_and_touches_only_the_wayland_screen(self):
        self.assertIn('chromium chromium-linux-wayland-cursor-fallback.patch linux\n', (PATCHES / 'series').read_text())
        text = PATCH.read_text()
        self.assertEqual([line for line in text.splitlines() if line.startswith(('--- ', '+++ '))], [f'--- a/{TREE_FILE}', f'+++ b/{TREE_FILE}'])
        added = [line[1:] for line in text.splitlines() if line.startswith('+') and not line.startswith('+++')]
        self.assertFalse([line for line in added if line.strip().startswith('//')])

    @unittest.skipUnless(PRISTINE is not None, 'needs the Chromium 156 tree')
    def test_the_patch_applies_to_the_156_tree_without_fuzz(self):
        with tempfile.TemporaryDirectory(prefix='ardia-cursor-apply-') as directory:
            target = pathlib.Path(directory) / TREE_FILE
            target.parent.mkdir(parents=True)
            target.write_text(PRISTINE)
            result = subprocess.run(['git', 'apply', '--check', str(PATCH)], cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
