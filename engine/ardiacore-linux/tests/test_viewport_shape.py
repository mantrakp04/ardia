from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class ViewportShapeTests(unittest.TestCase):
    def test_empty_attach_reattach_rebind_and_destroy_preserve_shape_ownership(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        source = (Path(__file__).resolve().parents[1] / 'src/ardia/linux/ac_linux_host.cc').read_text()
        start = source.index('class ViewportTargeter :')
        end = source.index('BEGIN_METADATA(ViewportView)', start)
        classes = source[start:end]
        prelude = r'''
        #include <algorithm>
        #include <cassert>
        #include <memory>
        #include <utility>
        #include <vector>
        #define METADATA_HEADER(C, P)
        struct Profile {};
        namespace gfx {
        struct Rect {
          int x, y, width, height;
          bool operator==(const Rect&) const = default;
          bool Intersects(const Rect& other) const {
            return x < other.x + other.width && x + width > other.x &&
                   y < other.y + other.height && y + height > other.y;
          }
        };
        }
        namespace ui {
        struct Layer {
          using ShapeRects = std::vector<gfx::Rect>;
          std::unique_ptr<ShapeRects> shape;
          void SetAlphaShape(std::unique_ptr<ShapeRects> value) { shape = std::move(value); }
        };
        }
        namespace aura {
        struct Window;
        class WindowTargeter {
         public:
          using HitTestRects = std::vector<gfx::Rect>;
          virtual ~WindowTargeter() = default;
          virtual std::unique_ptr<HitTestRects> GetExtraHitTestShapeRects(Window*) const { return nullptr; }
          const Window* window() const { return owner; }
          Window* owner = nullptr;
        };
        struct Window {
          ui::Layer surface;
          std::unique_ptr<WindowTargeter> targeter;
          ui::Layer* layer() { return &surface; }
          void SetEventTargeter(std::unique_ptr<WindowTargeter> value) {
            if (value) value->owner = this;
            targeter = std::move(value);
          }
        };
        }
        namespace content {
        struct WebContents {
          aura::Window native;
          aura::Window* GetNativeView() { return &native; }
        };
        }
        namespace views {
        struct View { virtual ~View() = default; };
        struct ViewTargeterDelegate {
          virtual bool DoesIntersectRect(const View*, const gfx::Rect&) const = 0;
        };
        struct ViewTargeter {
          explicit ViewTargeter(ViewTargeterDelegate* value) : delegate(value) {}
          ViewTargeterDelegate* delegate;
        };
        struct WebView : View {
          explicit WebView(Profile*) {}
          content::WebContents* attached = nullptr;
          std::unique_ptr<ViewTargeter> targeter;
          inline static int created = 0;
          content::WebContents* web_contents() const { return attached; }
          content::WebContents* GetWebContents() {
            if (!attached) { ++created; assert(false); }
            return attached;
          }
          virtual void SetWebContents(content::WebContents* value) {
            if (attached && attached != value) attached->native.SetEventTargeter(nullptr);
            attached = value;
          }
          void SetEventTargeter(std::unique_ptr<ViewTargeter> value) { targeter = std::move(value); }
        };
        }
        '''
        checks = r'''
        int main() {
          Profile profile;
          content::WebContents first, second;
          auto view = std::make_unique<ViewportView>(&profile);
          const std::vector<gfx::Rect> paint{{0, 20, 100, 80}};
          const std::vector<gfx::Rect> input{{0, 10, 100, 90}};
          view->SetShape(paint, input);
          assert(views::WebView::created == 0);
          assert(view->targeter->delegate->DoesIntersectRect(view.get(), {0, 15, 1, 1}));
          assert(!view->targeter->delegate->DoesIntersectRect(view.get(), {0, 5, 1, 1}));
          view->SetWebContents(&first);
          assert(*first.native.surface.shape == paint);
          assert(*first.native.targeter->GetExtraHitTestShapeRects(&first.native) == input);
          view->SetWebContents(nullptr);
          assert(!first.native.surface.shape && !first.native.targeter);
          assert(views::WebView::created == 0);
          view->SetWebContents(&first);
          assert(*first.native.surface.shape == paint);
          assert(*first.native.targeter->GetExtraHitTestShapeRects(&first.native) == input);
          view->SetWebContents(&second);
          assert(!first.native.surface.shape && !first.native.targeter);
          assert(*second.native.surface.shape == paint);
          view.reset();
          assert(!second.native.surface.shape && !second.native.targeter);
          assert(views::WebView::created == 0);
        }
        '''
        with tempfile.TemporaryDirectory(prefix='ardia-viewport-shape-') as scratch:
            path = Path(scratch)
            (path / 'test.cc').write_text(prelude + classes + checks)
            subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', str(path / 'test.cc'), '-o', str(path / 'test')], check=True, timeout=30)
            subprocess.run([str(path / 'test')], check=True, timeout=10)
