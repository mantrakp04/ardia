import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
LINUX = SOURCE / 'ardia' / 'linux'
HOST = (LINUX / 'ac_linux_host.cc').read_text()

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

static void EveryBehindWindowOfARestoreHandsFocusBack() {
  for (const int windows : {3, 4}) {
    FocusLedger ledger(true);
    ledger.Create(1, {.focus = true}, 0);
    ledger.Observe(1, true);
    const OpenIntent behind{.focus = false, .behind = true, .behind_window = 1, .hand_back = true};
    for (int window = 2; window <= windows; ++window) ledger.Create(window, behind, 10 + window);
    for (int window = 2; window <= windows; ++window) {
      ledger.Observe(window, true);
      const auto keep = ledger.Unrequested(window, 50 + window);
      assert(keep == std::optional<int>(1));
      assert(ledger.HandBack(*keep) == Activation::kActivate);
      ledger.Observe(1, true);
    }
  }
  FocusLedger background(false);
  assert(background.HandBack(1) == Activation::kNone);
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

static void WaylandFramesCarrySizeOnly() {
  const Rect primary{0, 0, 1920, 1080};
  const auto wayland = RequestedFrame({400, 300, 900, 700}, primary, false);
  assert(wayland && !wayland->positioned);
  assert(wayland->bounds.width == 900 && wayland->bounds.height == 700);
  GeometryLedger geometry(false);
  assert(!geometry.Frame({0, 0, 900, 700}, primary, false, false));
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

static void FrameReportsSkipFullscreenMinimizedAndRepeats() {
  const Rect primary{0, 0, 1920, 1080};
  GeometryLedger geometry(true);
  const auto first = geometry.Frame({100, 50, 800, 600}, primary, false, false);
  assert(first && (*first == std::array<int, 4>{100, 430, 800, 600}));
  assert(!geometry.Frame({100, 50, 800, 600}, primary, false, false));
  assert(!geometry.Frame({0, 0, 1920, 1080}, primary, true, false));
  assert(!geometry.Frame({0, 0, 160, 28}, primary, false, true));
  assert(!geometry.Frame({0, 0, 0, 0}, primary, false, false));
  assert(geometry.Frame({120, 50, 800, 600}, primary, false, false));
  geometry.Reset();
  assert(geometry.Frame({120, 50, 800, 600}, primary, false, false));
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
  EveryBehindWindowOfARestoreHandsFocusBack();
  SharedFramesUseBottomUpPrimaryCoordinates();
  WaylandFramesCarrySizeOnly();
  MalformedFramesAreRejected();
  FrameReportsSkipFullscreenMinimizedAndRepeats();
  FullScreenChangesAreReportedOnTransitionsOnly();
}
'''


from document_host_fixture import values
from test_renderer_contract import method as extract

REPO = ROOT.parents[1]
LOADER = REPO / 'apps' / 'linux' / 'scripts' / 'host-test-loader.mjs'
WINDOW_DROP = REPO / 'apps' / 'browser' / 'src' / 'state' / 'drag' / 'windowDrop.ts'


def fake_values():
    return values().replace('''  const DictValue* FindDict''', '''  std::optional<bool> FindBool(std::string_view key) const {
    auto* value = Find(key); return value && value->is_bool() ? std::optional(value->GetBool()) : std::nullopt;
  }
  Value* Set(std::string_view key, const char* value) & { return Set(key, Value(value)); }
  DictValue&& Set(std::string_view key, const char* value) && { Set(key, value); return std::move(*this); }
  Value* Set(std::string_view key, bool value) & { return Set(key, Value(value)); }
  DictValue&& Set(std::string_view key, bool value) && { Set(key, value); return std::move(*this); }
  Value* Set(std::string_view key, int value) & { return Set(key, Value(value)); }
  DictValue&& Set(std::string_view key, int value) && { Set(key, value); return std::move(*this); }
  Value* Set(std::string_view key, ListValue&& value) & { return Set(key, Value(std::move(value))); }
  DictValue&& Set(std::string_view key, ListValue&& value) && { Set(key, std::move(value)); return std::move(*this); }
  const DictValue* FindDict''').replace('''  void Append(Value&& value) & { entries_.push_back(std::move(value)); }''', '''  void Append(Value&& value) & { entries_.push_back(std::move(value)); }
  void Append(int value) & { entries_.push_back(Value(value)); }
  void Append(const char* value) & { entries_.push_back(Value(value)); }
  ListValue&& Append(int value) && { Append(value); return std::move(*this); }
  ListValue&& Append(const char* value) && { Append(value); return std::move(*this); }''')


def between(start, end_marker, inclusive=True):
    begin = HOST.index(start)
    end = HOST.index(end_marker, begin) + (len(end_marker) if inclusive else 0)
    return HOST[begin:end]


PRELUDE = r'''#include <algorithm>
#include <cassert>
#include <cstdio>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>
#include "base/values.h"
#include "ardia/linux/ac_linux_profiles.h"
#include "ardia/linux/ac_linux_fullscreen_restore.h"
#include "ardia/linux/ac_linux_window_lifecycle.h"

#define FROM_HERE 0

namespace gfx {
class Rect {
 public:
  Rect() = default;
  Rect(int width, int height) : width_(width), height_(height) {}
  Rect(int x, int y, int width, int height) : x_(x), y_(y), width_(width), height_(height) {}
  int x() const { return x_; }
  int y() const { return y_; }
  int width() const { return width_; }
  int height() const { return height_; }
  bool operator==(const Rect&) const = default;
 private:
  int x_ = 0, y_ = 0, width_ = 0, height_ = 0;
};
}

namespace base {
template <typename T> class NoDestructor {
 public:
  template <typename... Args> explicit NoDestructor(Args&&... args) : value_(std::forward<Args>(args)...) {}
  T& operator*() { return value_; }
 private:
  T value_;
};
struct CommandLine {
  static CommandLine* ForCurrentProcess() { static CommandLine line; return &line; }
  bool HasSwitch(std::string_view) const { return false; }
  std::string GetSwitchValueASCII(std::string_view) const { return ""; }
};
template <typename T> class AutoReset {
 public:
  AutoReset(T* target, T value) : target_(target), old_(*target) { *target = value; }
  ~AutoReset() { *target_ = old_; }
 private:
  T* target_;
  T old_;
};
template <typename... Args> int BindOnce(Args&&...) { return 0; }
template <typename T> T* Unretained(T* value) { return value; }
using TimeDelta = int;
struct TimeTicks {
  static inline int64_t now_ms = 0;
  struct Since {
    int64_t InMilliseconds() const { return now_ms; }
  };
  static TimeTicks Now() { return {}; }
  Since since_origin() const { return {}; }
};
constexpr int Milliseconds(int value) { return value; }
constexpr int Seconds(int value) { return value; }
struct OneShotTimer {
  bool running = false;
  void Start(int, int, int) { running = true; }
  void Stop() { running = false; }
};
template <typename F, typename T> std::function<void()> BindRepeating(F method, T* object) {
  return [method, object] { (object->*method)(); };
}
struct RepeatingTimer {
  std::function<void()> task;
  bool IsRunning() const { return static_cast<bool>(task); }
  void Start(int, int, std::function<void()> callback) { task = std::move(callback); }
  void Stop() { task = nullptr; }
  void Fire() { if (task) task(); }
};
struct SingleThreadTaskRunner {
  static SingleThreadTaskRunner* GetCurrentDefault() { static SingleThreadTaskRunner runner; return &runner; }
  void PostTask(int, int) {}
  void PostDelayedTask(int, int, int) {}
};
template <typename T> class WeakPtr {
 public:
  WeakPtr() = default;
  explicit WeakPtr(T* value) : value_(value) {}
  T* get() const { return value_; }
  T* operator->() const { return value_; }
  explicit operator bool() const { return value_ != nullptr; }
 private:
  T* value_ = nullptr;
};
inline std::string UTF8ToUTF16(std::string value) { return value; }
}

namespace ardiacore {
inline bool background = false;
inline bool BackgroundInstance() { return background; }
}

namespace ui {
struct PlatformProperties {
  bool supports_global_screen_coordinates = true;
};
struct OzonePlatform {
  static inline PlatformProperties properties;
  static bool IsInitialized() { return true; }
  static OzonePlatform* GetInstance() { static OzonePlatform platform; return &platform; }
  const PlatformProperties& GetPlatformProperties() const { return properties; }
};
enum class EventType { kMousePressed, kMouseReleased, kTouchPressed };
struct Event {
  EventType kind;
  EventType type() const { return kind; }
};
struct MouseEvent : Event {};
struct TouchEvent : Event {};
class EventHandler {
 public:
  virtual ~EventHandler() = default;
  virtual void OnMouseEvent(MouseEvent*) {}
  virtual void OnTouchEvent(TouchEvent*) {}
};
namespace mojom { enum class WindowShowState { kDefault, kNormal }; }
struct NativeWindow {
  std::string title;
  void SetTitle(std::string value) { title = std::move(value); }
};
struct BaseWindow {
  std::vector<std::string> calls;
  gfx::Rect bounds;
  bool maximized = false;
  NativeWindow native;
  void Show() { calls.push_back("Show"); }
  void ShowInactive() { calls.push_back("ShowInactive"); }
  void Activate() { calls.push_back("Activate"); }
  void SetBounds(const gfx::Rect& value) { calls.push_back("SetBounds"); bounds = value; }
  gfx::Rect GetBounds() const { return bounds; }
  void Minimize() { calls.push_back("Minimize"); }
  bool IsMaximized() const { return maximized; }
  void Restore() { maximized = false; }
  void Maximize() { maximized = true; }
  NativeWindow* GetNativeWindow() { return &native; }
};
using NativeWindow = NativeWindow;
}

namespace ui {
struct Compositor {};
}
namespace gfx {
struct PresentationFeedback {};
}

namespace display {
struct Display {
  gfx::Rect rect;
  int64_t id_ = 0;
  std::string label_;
  gfx::Rect bounds() const { return rect; }
  int64_t id() const { return id_; }
  const std::string& label() const { return label_; }
};
struct Screen {
  static inline gfx::Rect primary{0, 0, 1920, 1080};
  static inline std::vector<Display> displays;
  static inline Display nearest;
  static Screen* Get() { static Screen screen; return &screen; }
  Display GetPrimaryDisplay() const { Display display; display.rect = primary; return display; }
  const std::vector<Display>& GetAllDisplays() const { return displays; }
  Display GetDisplayNearestWindow(ui::NativeWindow*) const { return nearest; }
};
}

namespace aura {
struct Window {
  bool modal = false;
};
}

namespace wm {
inline aura::Window* GetModalTransient(aura::Window* window) { return window && window->modal ? window : nullptr; }
}

namespace views {
struct View {};
struct FocusManager {
  View* focused = nullptr;
  View* stored = nullptr;
  View* GetFocusedView() { return focused; }
};
struct Widget {
  bool fullscreen = false, minimized = false, active = false, visible = true;
  gfx::Rect bounds;
  aura::Window native;
  aura::Window* GetNativeWindow() { return &native; }
  bool IsVisible() const { return visible; }
  bool IsFullscreen() const { return fullscreen; }
  bool IsMinimized() const { return minimized; }
  bool IsActive() const { return active; }
  gfx::Rect GetWindowBoundsInScreen() const { return bounds; }
  std::vector<int64_t> fullscreen_targets;
  std::function<void()> show_state_changed;
  void SetFullscreen(bool on, int64_t target) {
    fullscreen_targets.push_back(target);
    fullscreen = on;
    if (show_state_changed) show_state_changed();
  }
};
struct WebView {
  bool visible = true;
  std::function<void()> focused;
  void RequestFocus() { if (focused) focused(); }
  bool GetVisible() const { return visible; }
};
}

namespace content {
class RenderWidgetHost;
struct WebContents {
  int id = 0;
  std::function<void()> focused;
  void Focus() { if (focused) focused(); }
};
}

struct PrefService {
  base::DictValue placements;
};
struct ScopedDictPrefUpdate {};
struct Profile {
  PrefService prefs;
  PrefService* GetPrefs() { return &prefs; }
  base::WeakPtr<Profile> GetWeakPtr() { return base::WeakPtr<Profile>(this); }
};
struct SessionID {
  int value;
  int id() const { return value; }
};
struct BrowserWindowInterface {
  enum Type { TYPE_NORMAL, TYPE_APP };
  enum class CreationStatus { kOk };
  explicit BrowserWindowInterface(int value = 0) : session(value) {}
  int session = 0;
  ui::BaseWindow window;
  ui::BaseWindow* GetWindow() { return &window; }
  SessionID GetSessionID() const { return {session}; }
  base::WeakPtr<BrowserWindowInterface> GetWeakPtr() { return base::WeakPtr<BrowserWindowInterface>(this); }
};
struct BrowserWindowCreateParams {
  BrowserWindowCreateParams(Profile*, bool) {}
  BrowserWindowInterface::Type type = BrowserWindowInterface::TYPE_NORMAL;
  std::string app_name;
  bool is_trusted_source = false, omit_from_session_restore = false, should_trigger_session_restore = true;
  std::string user_title;
  bool can_resize = true, can_maximize = true, can_fullscreen = true;
  gfx::Rect initial_bounds;
  ui::mojom::WindowShowState initial_show_state = ui::mojom::WindowShowState::kDefault;
};
std::vector<std::unique_ptr<BrowserWindowInterface>> created_browsers;
std::vector<gfx::Rect> created_bounds;
int next_session = 100;
BrowserWindowInterface* CreateBrowserWindow(BrowserWindowCreateParams params) {
  auto browser = std::make_unique<BrowserWindowInterface>();
  browser->session = next_session++;
  created_bounds.push_back(params.initial_bounds);
  created_browsers.push_back(std::move(browser));
  return created_browsers.back().get();
}
namespace chrome {
inline const base::DictValue* GetWindowPlacementDictionaryReadOnly(const std::string& name, PrefService* prefs) {
  return prefs->placements.FindDict(name);
}
inline base::DictValue& GetWindowPlacementDictionaryReadWrite(const std::string& name, PrefService* prefs,
                                                             std::unique_ptr<ScopedDictPrefUpdate>&) {
  if (!prefs->placements.FindDict(name)) prefs->placements.Set(name, base::DictValue());
  return const_cast<base::DictValue&>(*prefs->placements.FindDict(name));
}
}
inline bool ValidUtilityPlacement(const base::DictValue*) { return false; }
std::string String(const base::DictValue& dict, std::string_view key) {
  const auto* value = dict.FindString(key);
  return value ? *value : "";
}
std::string ArgumentString(const base::ListValue& values, size_t index) {
  return index < values.size() && values[index].is_string() ? values[index].GetString() : "";
}
bool DefaultProfileId(const std::string& profile) { return profile.empty() || profile == "default"; }
struct RequestedWindow {
  std::string id;
  std::string kind;
  std::string title;
  base::DictValue utility;
  base::WeakPtr<BrowserWindowInterface> browser;
  std::string page_profile;
  base::WeakPtr<Profile> app_profile;
  base::DictValue private_window;
  int opener_host = 0;
  uint64_t opener_generation = 0;
};
std::map<int, RequestedWindow>& RequestedWindows() { static std::map<int, RequestedWindow> windows; return windows; }
struct Done {
  std::function<void(bool, base::Value)> reply;
  void Run(bool ok, base::Value value) && { reply(ok, std::move(value)); }
};
'''

HOST_FAKE = r'''
struct FullscreenController {
  bool tab = false, caused_by_tab = false;
  bool browser_fullscreen = false;
  int toggles = 0;
  views::Widget* widget = nullptr;
  bool IsWindowFullscreenForTabOrPending() const { return tab; }
  bool IsFullscreenCausedByTab() const { return caused_by_tab; }
  bool IsFullscreenForBrowser() const { return browser_fullscreen; }
  void ToggleBrowserFullscreenMode(bool) {
    ++toggles;
    browser_fullscreen = !browser_fullscreen;
    if (!widget) return;
    widget->fullscreen = browser_fullscreen;
    if (widget->show_state_changed) widget->show_state_changed();
  }
};
struct ExclusiveAccessManager {
  FullscreenController controller;
  FullscreenController* fullscreen_controller() { return &controller; }
  static ExclusiveAccessManager* From(BrowserWindowInterface* browser) {
    static std::map<BrowserWindowInterface*, ExclusiveAccessManager> managers;
    return browser ? &managers[browser] : nullptr;
  }
};
uint64_t& ActivationClock() { static uint64_t clock = 0; return clock; }
struct ShellHostView {
  ShellHostView(int id, std::string window_id, BrowserWindowInterface* browser, std::string kind = "")
      : id_(id), window_id_(std::move(window_id)), kind_(std::move(kind)), browser_(browser) {
    Hosts()[id_] = this;
    widget.show_state_changed = [this] { OnWidgetShowStateChanged(&widget); };
    ExclusiveAccessManager::From(browser_)->controller.widget = &widget;
  }
  ~ShellHostView() { Hosts().erase(id_); }
  int id_;
  std::string window_id_;
  std::string kind_;
  BrowserWindowInterface* browser_;
  Profile profile_;
  views::Widget widget;
  base::DictValue utility_;
  bool utility_ready_ = false;
  bool utility_close_pending_ = false;
  bool startup_ = false;
  uint64_t activation_ = 0;
  linux_window::GeometryLedger geometry_{GlobalScreenCoordinates()};
  base::OneShotTimer frame_timer_;
  std::vector<base::DictValue> events;
  std::vector<std::pair<int, std::string>> reports;
  int id() const { return id_; }
  const std::string& window_id() const { return window_id_; }
  bool is_utility() const { return !kind_.empty(); }
  BrowserWindowInterface* browser() const { return browser_; }
  Profile* profile_source = &profile_;
  Profile* profile() const { return profile_source; }
  bool private_window() const { return false; }
  PrefService* WindowOutputPrefs() const;
  void RememberWindowOutput();
  void ForgetWindowOutput();
  std::optional<std::pair<int64_t, std::string>> SavedWindowOutput() const;
  std::optional<std::string> output_target_;
  bool output_forgotten_ = false;
  base::RepeatingTimer output_watch_;
  std::string page_profile_;
  int opener_host_ = 0;
  uint64_t opener_generation_ = 0;
  uint64_t renderer_generation_ = 1;
  ardiacore::linux_profiles::WindowAccess access() const { return {window_id_, page_profile_, id_, opener_host_, opener_generation_}; }
  bool Reaches(const ShellHostView* target) const {
    return target && ardiacore::linux_profiles::WindowReachableBy(target->access(), {id_, renderer_generation_});
  }
  bool FocusReaches(const ShellHostView* target) const {
    return target && ardiacore::linux_profiles::WindowFocusableBy(target->access(), {id_, renderer_generation_});
  }
  views::Widget* GetWidget() { return &widget; }
  const views::Widget* GetWidget() const { return &widget; }
  views::FocusManager focus_manager;
  views::FocusManager* GetFocusManager() { return &focus_manager; }
  views::View overlay_child;
  views::WebView shell_view;
  views::WebView* shell_ = &shell_view;
  views::View chrome_child;
  struct BrowserViewTree {
    const views::View* overlay;
    const views::View* chrome;
    bool Contains(const views::View* view) const { return view == overlay || view == chrome; }
  } browser_tree{&overlay_child, &chrome_child};
  BrowserViewTree* browser_view_ = &browser_tree;
  int shell_focus = 0;
  bool Contains(const views::View* view) const { return view == &overlay_child; }
  void FocusShell() { ++shell_focus; }
  void FocusShellOnActivation();
  void Activate() {
    if (focus_manager.stored) focus_manager.focused = focus_manager.stored;
    widget.active = true;
    OnWidgetActivationChanged(&widget, true);
  }
  struct { void Reset() {} } presentation_observation_;
  bool presented_ = true;
  void OnDidPresentCompositorFrame(ui::Compositor*, uint32_t, const gfx::PresentationFeedback&);
  void Event(std::string_view module, std::string_view event, base::Value payload) {
    if (module == "ArdiaShell" && event == "onWindowEvent") events.push_back(payload.GetDict().Clone());
  }
  void NavigateUtility(base::DictValue) {}
  base::DictValue RequestWindowClose() { return {}; }
  void RequestUtilityClose() {}
  base::WeakPtr<ShellHostView> GetWeakPtr() { return base::WeakPtr<ShellHostView>(this); }
  void WindowInvoke(const std::string& method, const base::ListValue& values, Done done);
  void OnWidgetActivationChanged(views::Widget* widget, bool active);
  void OnWidgetBoundsChanged(views::Widget* widget, const gfx::Rect& bounds);
  void OnWidgetShowStateChanged(views::Widget* widget);
  void OnWidgetVisibilityChanged(views::Widget* widget, bool visible);
  void ReportWindowGeometry();
  std::vector<base::DictValue> WindowState() const;
  bool WindowFullScreen() const;
  void SeedWindowActivation();
  void RendererReady();
  void RestoreFullScreenNow();
};

struct TabBinding {
  ShellHostView* owner_ = nullptr;
  content::WebContents* contents_ = nullptr;
  views::WebView* viewport_ = nullptr;
  bool presented = true;
  bool host_focusing_ = false;
  void FocusFromHost();
  void OnWebContentsFocused(content::RenderWidgetHost*);
  void ReportPresentation(std::string name, base::DictValue data);
};
int TabId(content::WebContents* contents) { return contents->id; }
void TabBinding::ReportPresentation(std::string name, base::DictValue) {
  owner_->reports.emplace_back(TabId(contents_), std::move(name));
}
'''

SCENARIOS = r'''
static base::Value Call(ShellHostView& host, const std::string& method, base::ListValue values, bool* ok = nullptr) {
  base::Value result;
  bool succeeded = false;
  host.WindowInvoke(method, values, Done{[&](bool success, base::Value value) { succeeded = success; result = std::move(value); }});
  if (ok) *ok = succeeded;
  return result;
}

static base::ListValue Args(const char* id, base::DictValue options) {
  base::ListValue values;
  values.Append(id);
  values.Append(base::Value(std::move(options)));
  return values;
}

static base::ListValue Frame(int x, int y, int width, int height) {
  return base::ListValue().Append(x).Append(y).Append(width).Append(height);
}

static int Count(const std::vector<std::string>& calls, const char* call) {
  return static_cast<int>(std::count(calls.begin(), calls.end(), call));
}

static int EventsOf(const ShellHostView& host, const char* type, const char* id) {
  int count = 0;
  for (const auto& event : host.events) {
    if (*event.FindString("type") == type && *event.FindString("id") == id) ++count;
  }
  return count;
}

static void Created() {
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  Call(main, "ArdiaShell.openWindow", Args("w-new", base::DictValue().Set("focus", true).Set("frame", Frame(100, 430, 800, 600))));
  assert(created_bounds.back() == gfx::Rect(100, 50, 800, 600));
  assert((created_browsers.back()->window.calls == std::vector<std::string>{"Show", "Activate"}));
  Call(main, "ArdiaShell.openWindow", Args("w-behind", base::DictValue().Set("focus", false).Set("behind", "main")));
  assert((created_browsers.back()->window.calls == std::vector<std::string>{"ShowInactive"}));
  bool ok = false;
  Call(main, "ArdiaShell.openWindow", Args("w-bad", base::DictValue().Set("frame", Frame(0, 0, 0, 600))), &ok);
  assert(ok && created_bounds.back() == gfx::Rect());
}

static void Reused() {
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  BrowserWindowInterface full_browser{2};
  ShellHostView full(2, "w-full", &full_browser);
  full.widget.fullscreen = true;
  Call(main, "ArdiaShell.openWindow", Args("w-full", base::DictValue().Set("focus", false).Set("frame", Frame(5, 5, 640, 480))));
  Call(full, "ArdiaShell.openWindow", Args("w-full", base::DictValue().Set("focus", true).Set("frame", Frame(5, 5, 640, 480))));
  assert(Count(full_browser.window.calls, "SetBounds") == 0);
  assert(Count(full_browser.window.calls, "Activate") == 0);
  Call(main, "ArdiaShell.openWindow", Args("w-full", base::DictValue().Set("focus", true)));
  assert(Count(full_browser.window.calls, "Activate") == 1);
  Call(main, "ArdiaShell.focusWindow", base::ListValue().Append("w-full"));
  assert(Count(full_browser.window.calls, "Activate") == 2);
}

static void Ready() {
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.widget.bounds = gfx::Rect(0, 0, 800, 600);
  BrowserWindowInterface full_browser{2};
  ShellHostView full(2, "w-full", &full_browser);
  full.widget.fullscreen = true;
  Call(main, "ArdiaShell.openWindow", Args("w-new", base::DictValue().Set("focus", true)));
  BrowserWindowInterface* created = created_browsers.back().get();
  ShellHostView arrived(created->GetSessionID().id(), "w-new", created);
  arrived.widget.bounds = gfx::Rect(100, 50, 800, 600);
  Call(arrived, "ArdiaShell.openWindow", Args("w-new", base::DictValue().Set("focus", true)));
  assert(Count(created->window.calls, "Activate") == 2);
  assert(EventsOf(main, "frame", "w-new") == 1);
  assert(EventsOf(full, "frame", "w-new") == 1);
  assert(EventsOf(arrived, "frame", "w-new") == 1);
  assert(EventsOf(arrived, "frame", "main") == 1);
  assert(EventsOf(arrived, "fullScreen", "w-full") == 1);
  assert(EventsOf(main, "frame", "main") == 0);
}

static void Clicked() {
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.OnWidgetActivationChanged(&main.widget, true);
  Call(main, "ArdiaShell.openWindow", Args("w-clicked", base::DictValue().Set("focus", true)));
  BrowserWindowInterface* clicked = created_browsers.back().get();
  WindowPointerHandler pointer;
  ui::MouseEvent release{{ui::EventType::kMouseReleased}};
  pointer.OnMouseEvent(&release);
  ui::MouseEvent press{{ui::EventType::kMousePressed}};
  pointer.OnMouseEvent(&press);
  ShellHostView refused(clicked->GetSessionID().id(), "w-clicked", clicked);
  Call(refused, "ArdiaShell.openWindow", Args("w-clicked", base::DictValue().Set("focus", true)));
  assert(Count(clicked->window.calls, "Activate") == 1);
}

static void RestoredBehind() {
  for (const bool wayland : {true, false}) {
    for (const bool pressed : {false, true}) {
      ui::OzonePlatform::properties.supports_global_screen_coordinates = !wayland;
      base::TimeTicks::now_ms = 0;
      BrowserWindowInterface main_browser{1};
      ShellHostView main(1, "main", &main_browser);
      main.OnWidgetActivationChanged(&main.widget, true);
      const std::string id = "w-back-" + std::to_string(wayland) + std::to_string(pressed);
      const size_t created = created_browsers.size();
      Call(main, "ArdiaShell.openWindow", Args(id.c_str(), base::DictValue().Set("focus", false).Set("behind", "main")));
      assert(created_browsers.size() == created + 1);
      BrowserWindowInterface* back_browser = created_browsers.back().get();
      assert((back_browser->window.calls == std::vector<std::string>{"ShowInactive"}));
      if (pressed) {
        WindowPointerHandler pointer;
        ui::MouseEvent press{{ui::EventType::kMousePressed}};
        pointer.OnMouseEvent(&press);
      }
      ShellHostView back(back_browser->GetSessionID().id(), id, back_browser);
      base::TimeTicks::now_ms = 400;
      back.OnDidPresentCompositorFrame(nullptr, 1, {});
      base::TimeTicks::now_ms = 450;
      main.OnWidgetActivationChanged(&main.widget, false);
      back.OnWidgetActivationChanged(&back.widget, true);
      const int expected = wayland && !pressed ? 1 : 0;
      assert(Count(main_browser.window.calls, "Activate") == expected);
      assert(Count(back_browser->window.calls, "Activate") == 0);
      back.OnWidgetActivationChanged(&back.widget, false);
      main.OnWidgetActivationChanged(&main.widget, true);
      back.OnWidgetActivationChanged(&back.widget, true);
      assert(Count(main_browser.window.calls, "Activate") == expected);
      back.OnWidgetActivationChanged(&back.widget, false);
    }
  }
  ui::OzonePlatform::properties.supports_global_screen_coordinates = true;
}

static void ARestoreOfManyWindowsEndsOnTheSavedOne() {
  ui::OzonePlatform::properties.supports_global_screen_coordinates = false;
  for (const int windows : {3, 4}) {
    base::TimeTicks::now_ms = 0;
    BrowserWindowInterface main_browser{1};
    ShellHostView main(1, "main", &main_browser);
    main.OnWidgetActivationChanged(&main.widget, true);
    std::vector<std::unique_ptr<ShellHostView>> behind;
    for (int n = 2; n <= windows; ++n) {
      const std::string id = "w-many-" + std::to_string(windows) + "-" + std::to_string(n);
      Call(main, "ArdiaShell.openWindow", Args(id.c_str(), base::DictValue().Set("focus", false).Set("behind", "main")));
      BrowserWindowInterface* browser = created_browsers.back().get();
      behind.push_back(std::make_unique<ShellHostView>(browser->GetSessionID().id(), id, browser));
    }
    ShellHostView* active = &main;
    for (auto& window : behind) {
      base::TimeTicks::now_ms += 40;
      window->OnDidPresentCompositorFrame(nullptr, 1, {});
      active->OnWidgetActivationChanged(&active->widget, false);
      window->OnWidgetActivationChanged(&window->widget, true);
      window->OnWidgetActivationChanged(&window->widget, false);
      main.OnWidgetActivationChanged(&main.widget, true);
      active = &main;
    }
    assert(Count(main_browser.window.calls, "Activate") == windows - 1);
    for (auto& window : behind) assert(Count(window->browser()->window.calls, "Activate") == 0);
    main.OnWidgetActivationChanged(&main.widget, false);
  }
  ui::OzonePlatform::properties.supports_global_screen_coordinates = true;
}

static void TheUsersOwnActivationOfABehindWindowStays() {
  ui::OzonePlatform::properties.supports_global_screen_coordinates = false;
  base::TimeTicks::now_ms = 0;
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.OnWidgetActivationChanged(&main.widget, true);
  Call(main, "ArdiaShell.openWindow", Args("w-late", base::DictValue().Set("focus", false).Set("behind", "main")));
  BrowserWindowInterface* late_browser = created_browsers.back().get();
  ShellHostView late(late_browser->GetSessionID().id(), "w-late", late_browser);
  base::TimeTicks::now_ms = 300;
  late.OnDidPresentCompositorFrame(nullptr, 1, {});
  base::TimeTicks::now_ms = 2000;
  main.OnWidgetActivationChanged(&main.widget, false);
  late.OnWidgetActivationChanged(&late.widget, true);
  assert(Count(main_browser.window.calls, "Activate") == 0);
  Call(main, "ArdiaShell.openWindow", Args("w-asked", base::DictValue().Set("focus", false).Set("behind", "main")));
  BrowserWindowInterface* asked_browser = created_browsers.back().get();
  ShellHostView asked(asked_browser->GetSessionID().id(), "w-asked", asked_browser);
  Call(main, "ArdiaShell.focusWindow", base::ListValue().Append("w-asked"));
  late.OnWidgetActivationChanged(&late.widget, false);
  asked.OnWidgetActivationChanged(&asked.widget, true);
  assert(Count(main_browser.window.calls, "Activate") == 0);
  ui::OzonePlatform::properties.supports_global_screen_coordinates = true;
}

static void Activation() {
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  BrowserWindowInterface other_browser{2};
  ShellHostView other(2, "w-other", &other_browser);
  BrowserWindowInterface settings_browser{3};
  ShellHostView settings(3, "settings", &settings_browser, "settings");
  other.OnWidgetActivationChanged(&other.widget, true);
  assert(EventsOf(main, "focus", "w-other") == 1 && EventsOf(other, "focus", "w-other") == 1);
  assert(settings.events.empty());
  other.OnWidgetActivationChanged(&other.widget, true);
  assert(EventsOf(main, "focus", "w-other") == 1);
  settings.OnWidgetActivationChanged(&settings.widget, true);
  assert(EventsOf(main, "focus", "settings") == 0 && settings.events.empty());
}

static void KeyboardFocusFollowsActivation() {
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  BrowserWindowInterface settings_browser{2};
  ShellHostView settings(2, "settings", &settings_browser, "settings");
  main.Activate();
  assert(main.shell_focus == 1);
  main.OnWidgetActivationChanged(&main.widget, false);
  assert(main.shell_focus == 1);
  settings.Activate();
  assert(settings.shell_focus == 1);
  main.focus_manager.focused = &main.chrome_child;
  main.Activate();
  assert(main.shell_focus == 2);
  main.focus_manager.focused = nullptr;
  main.focus_manager.stored = &main.overlay_child;
  main.Activate();
  assert(main.shell_focus == 2);
  main.focus_manager.focused = nullptr;
  main.focus_manager.stored = nullptr;
  main.widget.native.modal = true;
  main.Activate();
  assert(main.shell_focus == 2);
  main.widget.native.modal = false;
  BrowserWindowInterface seeded_browser{3};
  ShellHostView seeded(3, "w-seeded", &seeded_browser);
  seeded.widget.active = true;
  seeded.SeedWindowActivation();
  assert(seeded.shell_focus == 1);
}

static void ATabModalDialogKeepsFocusAcrossActivation() {
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  views::View dialog_button;
  main.focus_manager.focused = &dialog_button;
  main.OnWidgetActivationChanged(&main.widget, false);
  main.focus_manager.stored = &dialog_button;
  main.focus_manager.focused = nullptr;
  main.Activate();
  assert(main.focus_manager.focused == &dialog_button);
  assert(main.shell_focus == 0);
}

static void Seeded() {
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.widget.bounds = gfx::Rect(0, 0, 800, 600);
  BrowserWindowInterface seeded_browser{4};
  ShellHostView seeded(4, "w-seeded", &seeded_browser);
  seeded.widget.active = true;
  seeded.SeedWindowActivation();
  assert(EventsOf(main, "focus", "w-seeded") == 1);
  seeded.events.clear();
  seeded.RendererReady();
  assert(EventsOf(seeded, "focus", "w-seeded") == 1);
  assert(*seeded.events.back().FindString("type") == "focus");
}

static void Geometry() {
  BrowserWindowInterface main_browser{1};
  main_browser.window.bounds = gfx::Rect(100, 50, 800, 600);
  ShellHostView main(1, "main", &main_browser);
  BrowserWindowInterface other_browser{2};
  ShellHostView other(2, "w-other", &other_browser);
  BrowserWindowInterface settings_browser{3};
  ShellHostView settings(3, "settings", &settings_browser, "settings");
  main.widget.bounds = gfx::Rect(10, 20, 900, 700);
  main.OnWidgetBoundsChanged(&main.widget, main.widget.bounds);
  assert(main.frame_timer_.running && main.events.empty());
  main.ReportWindowGeometry();
  const base::ListValue* frame = main.events.back().FindList("frame");
  assert(frame && (*frame == Frame(10, 360, 900, 700)));
  assert(EventsOf(other, "frame", "main") == 1 && settings.events.empty());
  main.ReportWindowGeometry();
  assert(EventsOf(other, "frame", "main") == 1);
  auto& tab = ExclusiveAccessManager::From(&main_browser)->controller;
  tab.tab = tab.caused_by_tab = true;
  main.widget.fullscreen = true;
  main.OnWidgetShowStateChanged(&main.widget);
  assert(EventsOf(main, "fullScreen", "main") == 0 && EventsOf(main, "frame", "main") == 1);
  for (const auto& event : main.WindowState()) assert(*event.FindString("type") != "fullScreen");
  main.widget.fullscreen = false;
  tab.tab = tab.caused_by_tab = false;
  main.OnWidgetShowStateChanged(&main.widget);
  assert(EventsOf(main, "fullScreen", "main") == 0);
  main.widget.fullscreen = true;
  main.OnWidgetShowStateChanged(&main.widget);
  assert(*main.events.back().FindString("type") == "fullScreen" && main.events.back().FindBool("on") == std::optional<bool>(true));
  tab.tab = true;
  main.OnWidgetShowStateChanged(&main.widget);
  assert(EventsOf(main, "fullScreen", "main") == 1);
  bool listed = false;
  for (const auto& event : main.WindowState()) listed = listed || *event.FindString("type") == "fullScreen";
  assert(listed);
  tab.tab = false;
  assert(EventsOf(main, "frame", "main") == 1);
  bool ok = false;
  base::Value reply = Call(main, "ArdiaShell.windowFrame", base::ListValue().Append("main"), &ok);
  assert(ok && reply.is_list() && (reply.GetList() == Frame(100, 430, 800, 600)));
}

static void PageFocus() {
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  content::WebContents page;
  page.id = 42;
  views::WebView viewport;
  TabBinding binding{&main, &page, &viewport};
  page.focused = [&] { binding.OnWebContentsFocused(nullptr); };
  viewport.focused = [&] { page.Focus(); };
  binding.FocusFromHost();
  assert(main.reports.empty());
  page.Focus();
  assert(main.reports.size() == 1 && main.reports[0] == std::make_pair(42, std::string("focus")));
  viewport.visible = false;
  page.Focus();
  assert(main.reports.size() == 1);
}

static void Wayland() {
  ui::OzonePlatform::properties.supports_global_screen_coordinates = false;
  BrowserWindowInterface main_browser{1};
  main_browser.window.bounds = gfx::Rect(0, 0, 800, 600);
  ShellHostView main(1, "main", &main_browser);
  main.widget.bounds = gfx::Rect(0, 0, 800, 600);
  bool ok = false;
  base::Value reply = Call(main, "ArdiaShell.windowFrame", base::ListValue().Append("main"), &ok);
  assert(ok && reply.is_none());
  Call(main, "ArdiaShell.openWindow", Args("w-torn", base::DictValue().Set("focus", true).Set("frame", Frame(400, 300, 900, 700))));
  assert(created_bounds.back() == gfx::Rect(0, 0, 900, 700));
  main.ReportWindowGeometry();
  assert(EventsOf(main, "frame", "main") == 0);
  main.RendererReady();
  assert(EventsOf(main, "frame", "main") == 0);
}

static void Background() {
  ardiacore::background = true;
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  BrowserWindowInterface settings_browser{2};
  ShellHostView settings(2, "settings", &settings_browser, "settings");
  Call(main, "ArdiaShell.openWindow", Args("w-new", base::DictValue().Set("focus", true)));
  assert((created_browsers.back()->window.calls == std::vector<std::string>{"ShowInactive"}));
  Call(main, "ArdiaShell.focusWindow", base::ListValue().Append("main"));
  assert((main_browser.window.calls == std::vector<std::string>{"ShowInactive"}));
  Call(main, "ArdiaShell.openWindow", Args("settings", base::DictValue().Set("kind", "settings")));
  assert((settings_browser.window.calls == std::vector<std::string>{"ShowInactive"}));
}

static void Frames() {
  BrowserWindowInterface a_browser{1};
  a_browser.window.bounds = gfx::Rect(0, 0, 800, 600);
  ShellHostView a(1, "a", &a_browser);
  BrowserWindowInterface b_browser{2};
  b_browser.window.bounds = gfx::Rect(900, 400, 800, 600);
  ShellHostView b(2, "b", &b_browser);
  base::Value fa = Call(a, "ArdiaShell.windowFrame", base::ListValue().Append("a"));
  base::Value fb = Call(a, "ArdiaShell.windowFrame", base::ListValue().Append("b"));
  auto print = [](const base::Value& frame) {
    const auto& list = frame.GetList();
    std::printf("[%d,%d,%d,%d]", list[0].GetInt(), list[1].GetInt(), list[2].GetInt(), list[3].GetInt());
  };
  std::printf("{\"a\":");
  print(fa);
  std::printf(",\"b\":");
  print(fb);
  std::printf("}\n");
}

static int Toggles(BrowserWindowInterface& browser) {
  return ExclusiveAccessManager::From(&browser)->fullscreen_controller()->toggles;
}

static base::ListValue RestoreArgs(std::vector<const char*> ids, const char* focus) {
  base::ListValue list;
  for (const char* id : ids) list.Append(id);
  base::ListValue values;
  values.Append(base::Value(std::move(list)));
  if (focus) values.Append(focus);
  return values;
}

static void FullScreenRestored() {
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.startup_ = true;
  BrowserWindowInterface other_browser{2};
  ShellHostView other(2, "w-other", &other_browser);
  main.OnWidgetActivationChanged(&main.widget, true);
  bool ok = false;
  Call(other, "ArdiaShell.restoreFullScreen", RestoreArgs({"main", "w-other"}, "main"), &ok);
  assert(ok && Toggles(main_browser) == 0 && Toggles(other_browser) == 0);
  Call(main, "ArdiaShell.restoreFullScreen", base::ListValue().Append("main"), &ok);
  assert(!ok);
  Call(main, "ArdiaShell.restoreFullScreen", RestoreArgs({"main", "w-late"}, "main"), &ok);
  assert(ok && Toggles(main_browser) == 1 && Toggles(other_browser) == 0);
  main.widget.fullscreen = true;
  main.OnWidgetShowStateChanged(&main.widget);
  assert(EventsOf(other, "fullScreen", "main") == 1);
  assert(Count(main_browser.window.calls, "Activate") == 0);
  BrowserWindowInterface late_browser{3};
  ShellHostView late(3, "w-late", &late_browser);
  late.widget.visible = false;
  late.RendererReady();
  assert(Toggles(late_browser) == 0);
  late.widget.visible = true;
  late.RendererReady();
  assert(Toggles(late_browser) == 1);
  late.RendererReady();
  assert(Toggles(late_browser) == 1);
  late.widget.fullscreen = true;
  late.OnWidgetShowStateChanged(&late.widget);
  assert(Count(main_browser.window.calls, "Activate") == 1);
  Call(main, "ArdiaShell.restoreFullScreen", RestoreArgs({"w-other"}, "w-other"), &ok);
  assert(ok && Toggles(other_browser) == 0);
}

static const std::string* SavedOutput(Profile& profile, const char* id) {
  const base::DictValue* outputs = profile.prefs.placements.FindDict("ArdiaLinuxWindowOutputs");
  return outputs ? outputs->FindString(id) : nullptr;
}

static void FullScreenOnTheSavedOutput() {
  ui::OzonePlatform::properties.supports_global_screen_coordinates = false;
  display::Screen::displays = {{{0, 0, 1920, 1080}, 10, "Out A"}, {{1920, 0, 1920, 1080}, 20, "Out B"}};
  Profile app;
  {
    BrowserWindowInterface main_browser{1};
    ShellHostView main(1, "main", &main_browser);
    main.profile_source = &app;
    BrowserWindowInterface settings_browser{2};
    ShellHostView settings(2, "settings", &settings_browser, "settings");
    settings.profile_source = &app;
    display::Screen::nearest = display::Screen::displays[1];
    main.ReportWindowGeometry();
    assert(!SavedOutput(app, "main"));
    main.widget.fullscreen = true;
    main.OnWidgetShowStateChanged(&main.widget);
    assert(SavedOutput(app, "main") && *SavedOutput(app, "main") == "Out B");
    settings.widget.fullscreen = true;
    settings.RememberWindowOutput();
    assert(!SavedOutput(app, "settings"));
    BrowserWindowInterface other_browser{3};
    ShellHostView other(3, "w-other", &other_browser);
    other.profile_source = &app;
    other.widget.fullscreen = true;
    other.RememberWindowOutput();
    assert(SavedOutput(app, "w-other"));
    other.ForgetWindowOutput();
    assert(!SavedOutput(app, "w-other"));
    other.RememberWindowOutput();
    assert(!SavedOutput(app, "w-other"));
  }
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.profile_source = &app;
  main.startup_ = true;
  display::Screen::nearest = display::Screen::displays[0];
  bool ok = false;
  Call(main, "ArdiaShell.restoreFullScreen", RestoreArgs({"main"}, "main"), &ok);
  assert(ok && Toggles(main_browser) == 0 && main.widget.fullscreen);
  assert((main.widget.fullscreen_targets == std::vector<int64_t>{20}));
  assert(*SavedOutput(app, "main") == "Out B");
  main.ReportWindowGeometry();
  assert(*SavedOutput(app, "main") == "Out B");
  display::Screen::nearest = display::Screen::displays[1];
  main.ReportWindowGeometry();
  assert(*SavedOutput(app, "main") == "Out B");
  display::Screen::nearest = display::Screen::displays[0];
  main.ReportWindowGeometry();
  assert(*SavedOutput(app, "main") == "Out A");
}

static void ALateOutputChangeIsSavedWhileFullscreen() {
  ui::OzonePlatform::properties.supports_global_screen_coordinates = false;
  display::Screen::displays = {{{0, 0, 1920, 1080}, 10, "Out A"}, {{1920, 0, 1920, 1080}, 20, "Out B"}};
  Profile app;
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.profile_source = &app;
  display::Screen::nearest = display::Screen::displays[0];
  main.ReportWindowGeometry();
  assert(!main.output_watch_.IsRunning());
  main.widget.fullscreen = true;
  main.OnWidgetShowStateChanged(&main.widget);
  assert(*SavedOutput(app, "main") == "Out A");
  assert(main.output_watch_.IsRunning());
  display::Screen::nearest = display::Screen::displays[1];
  main.output_watch_.Fire();
  assert(*SavedOutput(app, "main") == "Out B");
  main.widget.fullscreen = false;
  main.OnWidgetShowStateChanged(&main.widget);
  assert(!main.output_watch_.IsRunning());
  assert(*SavedOutput(app, "main") == "Out B");
  ui::OzonePlatform::properties.supports_global_screen_coordinates = true;
}

static void TheRestoresFinalFocusKeepsTheBehindWindowsHandBack() {
  ui::OzonePlatform::properties.supports_global_screen_coordinates = false;
  base::TimeTicks::now_ms = 0;
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.startup_ = true;
  main.OnWidgetActivationChanged(&main.widget, true);
  Call(main, "ArdiaShell.openWindow", Args("w-back", base::DictValue().Set("focus", false).Set("behind", "main")));
  BrowserWindowInterface* back_browser = created_browsers.back().get();
  ShellHostView back(back_browser->GetSessionID().id(), "w-back", back_browser);
  bool ok = false;
  Call(main, "ArdiaShell.restoreFullScreen", RestoreArgs({"main"}, "main"), &ok);
  assert(ok && main.widget.fullscreen);
  assert(Count(main_browser.window.calls, "Activate") == 1);
  base::TimeTicks::now_ms = 100;
  back.OnDidPresentCompositorFrame(nullptr, 1, {});
  main.OnWidgetActivationChanged(&main.widget, false);
  back.OnWidgetActivationChanged(&back.widget, true);
  assert(Count(main_browser.window.calls, "Activate") == 2);
  ui::OzonePlatform::properties.supports_global_screen_coordinates = true;
}

static void TheRestoreWaitsForTheWindowsFirstFrame() {
  ui::OzonePlatform::properties.supports_global_screen_coordinates = false;
  display::Screen::displays = {{{0, 0, 1920, 1080}, 10, "Out A"}, {{1920, 0, 1920, 1080}, 20, "Out B"}};
  display::Screen::nearest = display::Screen::displays[0];
  Profile app;
  app.prefs.placements.Set("ArdiaLinuxWindowOutputs", base::DictValue().Set("main", "Out B"));
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.profile_source = &app;
  main.startup_ = true;
  main.presented_ = false;
  bool ok = false;
  Call(main, "ArdiaShell.restoreFullScreen", RestoreArgs({"main"}, "main"), &ok);
  assert(ok && !main.widget.fullscreen && main.widget.fullscreen_targets.empty() && Toggles(main_browser) == 0);
  main.RendererReady();
  assert(!main.widget.fullscreen && main.widget.fullscreen_targets.empty());
  main.OnDidPresentCompositorFrame(nullptr, 1, {});
  assert(main.widget.fullscreen);
  assert((main.widget.fullscreen_targets == std::vector<int64_t>{20}));
  main.OnDidPresentCompositorFrame(nullptr, 2, {});
  assert(main.widget.fullscreen_targets.size() == 1);
  ui::OzonePlatform::properties.supports_global_screen_coordinates = true;
}

static void FullScreenWhenTheSavedOutputIsGone() {
  ui::OzonePlatform::properties.supports_global_screen_coordinates = false;
  display::Screen::displays = {{{0, 0, 1920, 1080}, 10, "Out A"}};
  Profile app;
  app.prefs.placements.Set("ArdiaLinuxWindowOutputs", base::DictValue().Set("main", "Out B"));
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.profile_source = &app;
  main.startup_ = true;
  Call(main, "ArdiaShell.restoreFullScreen", RestoreArgs({"main"}, "main"));
  assert(Toggles(main_browser) == 1 && main.widget.fullscreen_targets.empty());
}

static void OutputLabels() {
  using linux_window::Output;
  using linux_window::OutputLabelled;
  const std::vector<Output> outputs{{10, "Make A (HEADLESS-1)"}, {20, "Make B (HEADLESS-2)"}, {30, "Twin"}, {40, "Twin"}};
  assert(OutputLabelled(outputs, "Make B (HEADLESS-2)") == std::optional<int64_t>(20));
  assert(!OutputLabelled(outputs, "Gone"));
  assert(!OutputLabelled(outputs, "Twin"));
  assert(!OutputLabelled(outputs, ""));
  assert(!OutputLabelled({{50, ""}}, ""));
}

static void X11KeepsNoOutputs() {
  display::Screen::displays = {{{0, 0, 1920, 1080}, 10, "Out A"}};
  display::Screen::nearest = display::Screen::displays[0];
  Profile app;
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.profile_source = &app;
  main.widget.fullscreen = true;
  main.OnWidgetShowStateChanged(&main.widget);
  assert(!SavedOutput(app, "main"));
}

static void FullScreenGivenUp() {
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.startup_ = true;
  main.widget.minimized = true;
  BrowserWindowInterface full_browser{2};
  ShellHostView full(2, "w-full", &full_browser);
  full.widget.fullscreen = true;
  ExclusiveAccessManager::From(&full_browser)->fullscreen_controller()->browser_fullscreen = true;
  bool ok = false;
  Call(main, "ArdiaShell.restoreFullScreen", RestoreArgs({"main", "w-full", "w-missing"}, nullptr), &ok);
  assert(ok && Toggles(main_browser) == 0 && Toggles(full_browser) == 0);
  ExpireFullScreenRestore();
  assert(EventsOf(full, "fullScreen", "main") == 1);
  assert(EventsOf(full, "fullScreen", "w-missing") == 1);
  assert(EventsOf(full, "fullScreen", "w-full") == 0);
  assert(!main.events.back().FindBool("on").value());
  main.widget.minimized = false;
  main.RendererReady();
  assert(Toggles(main_browser) == 0);
  assert(Count(main_browser.window.calls, "Activate") == 0);
}

static void FullScreenFocusYieldsToTheUser() {
  for (const bool pressed : {true, false}) {
    BrowserWindowInterface main_browser{1};
    ShellHostView main(1, "main", &main_browser);
    main.startup_ = true;
    BrowserWindowInterface other_browser{2};
    ShellHostView other(2, "w-other", &other_browser);
    main.OnWidgetActivationChanged(&main.widget, true);
    Call(main, "ArdiaShell.restoreFullScreen", RestoreArgs({"main", "w-late"}, "main"));
    main.widget.fullscreen = true;
    main.OnWidgetShowStateChanged(&main.widget);
    if (pressed) {
      WindowPointerHandler pointer;
      ui::MouseEvent press{{ui::EventType::kMousePressed}};
      pointer.OnMouseEvent(&press);
    } else {
      other.OnWidgetActivationChanged(&other.widget, true);
    }
    BrowserWindowInterface late_browser{3};
    ShellHostView late(3, "w-late", &late_browser);
    late.RendererReady();
    late.widget.fullscreen = true;
    late.OnWidgetShowStateChanged(&late.widget);
    assert(Toggles(late_browser) == 1);
    assert(Count(main_browser.window.calls, "Activate") == 0);
    main.OnWidgetActivationChanged(&main.widget, false);
    other.OnWidgetActivationChanged(&other.widget, false);
  }
}

static void FullScreenWhenShownLater() {
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.startup_ = true;
  BrowserWindowInterface late_browser{3};
  ShellHostView late(3, "w-late", &late_browser);
  late.widget.visible = false;
  Call(main, "ArdiaShell.restoreFullScreen", RestoreArgs({"w-late"}, nullptr));
  late.RendererReady();
  assert(Toggles(late_browser) == 0);
  late.OnWidgetVisibilityChanged(&late.widget, false);
  assert(Toggles(late_browser) == 0);
  late.widget.visible = true;
  late.OnWidgetVisibilityChanged(&late.widget, true);
  assert(Toggles(late_browser) == 1);
}

static void FullScreenInBackground() {
  ardiacore::background = true;
  BrowserWindowInterface main_browser{1};
  ShellHostView main(1, "main", &main_browser);
  main.startup_ = true;
  main.OnWidgetActivationChanged(&main.widget, true);
  Call(main, "ArdiaShell.restoreFullScreen", RestoreArgs({"main"}, "main"));
  assert(Toggles(main_browser) == 1);
  main.widget.fullscreen = true;
  main.OnWidgetShowStateChanged(&main.widget);
  assert(Count(main_browser.window.calls, "Activate") == 0);
}

int main(int argc, char** argv) {
  const std::string mode = argc > 1 ? argv[1] : "";
  const std::map<std::string, void (*)()> scenarios = {
      {"created", Created}, {"reused", Reused}, {"ready", Ready}, {"clicked", Clicked},
      {"activation", Activation}, {"keyboard-focus", KeyboardFocusFollowsActivation}, {"restored-behind", RestoredBehind}, {"users-activation-stays", TheUsersOwnActivationOfABehindWindowStays},
      {"many-behind", ARestoreOfManyWindowsEndsOnTheSavedOne},
      {"tab-modal-dialog", ATabModalDialogKeepsFocusAcrossActivation}, {"seeded", Seeded}, {"geometry", Geometry}, {"page-focus", PageFocus},
      {"wayland", Wayland}, {"background", Background}, {"frames", Frames},
      {"fullscreen-restore", FullScreenRestored}, {"fullscreen-given-up", FullScreenGivenUp},
      {"fullscreen-background", FullScreenInBackground}, {"fullscreen-focus-yields", FullScreenFocusYieldsToTheUser},
      {"fullscreen-shown-later", FullScreenWhenShownLater}, {"fullscreen-output", FullScreenOnTheSavedOutput},
      {"fullscreen-output-gone", FullScreenWhenTheSavedOutputIsGone}, {"x11-outputs", X11KeepsNoOutputs}, {"late-output", ALateOutputChangeIsSavedWhileFullscreen},
      {"restore-after-first-frame", TheRestoreWaitsForTheWindowsFirstFrame},
      {"restore-keeps-hand-back", TheRestoresFinalFocusKeepsTheBehindWindowsHandBack}, {"output-labels", OutputLabels}};
  const auto found = scenarios.find(mode);
  if (found == scenarios.end()) return 2;
  found->second();
}
'''

DROP = r'''globalThis.__DEV__ = false;
const [frames, module] = [JSON.parse(process.argv[2]), process.argv[3]];
const { screenPoint, windowUnder } = await import(module);
const state = {
  windows: {
    a: { id: "a", kind: "main", frame: frames.a },
    b: { id: "b", kind: "main", frame: frames.b },
  },
  ui: { focusOrder: ["a", "b"] },
};
const local = [1000, 500];
const under = windowUnder(state, "a", local[0], local[1], frames.a);
const screen = screenPoint(state, "a", local[0], local[1], frames.a);
const over = frames.b;
console.log(JSON.stringify({ under, overPoint: [screen[0] - over[0], over[1] + over[3] - screen[1]] }));
'''


def profile_openings():
    glue = r'''
namespace base {
inline std::optional<std::string> WriteJson(const DictValue&) { return std::string("{}"); }
}
namespace ardiacore {
inline bool LinuxProfileHosts(std::string_view, const Profile*) { return true; }
}
namespace browser_shutdown {
inline bool IsTryingToQuit() { return false; }
}
inline BrowserWindowInterface::CreationStatus GetBrowserWindowCreationStatusForProfile(Profile&) {
  return BrowserWindowInterface::CreationStatus::kOk;
}
using WindowReply = Done;
'''
    real = '\n'.join([
        extract(HOST, 'base::Value ProfileFailure('),
        between('constexpr size_t kPrivateWindowLimit', '\n'),
        extract(HOST, 'bool PrivateProfileId('),
        extract(HOST, 'struct WindowOpening {') + ';',
        extract(HOST, 'ardiacore::linux_profiles::OpeningLedger<WindowReply>& OpeningWindows() {'),
        extract(HOST, 'void FinishWindowOpening('),
        extract(HOST, 'void OpenNativeWindow('),
    ])
    begin = r'''
void BeginWindowOpening(WindowOpening opening, uint64_t generation, Profile* utility_profile) {
  static Profile page;
  OpenNativeWindow(std::move(opening), generation, utility_profile ? utility_profile : &page,
                   ardiacore::linux_profiles::ProfileError::kNone);
}
'''
    return glue + real + begin


def host_harness():
    free = between('namespace linux_window = ardia::linux_window;', 'class WindowPointerHandler', False)
    pointer = between('class WindowPointerHandler', '\n};\n')
    window_branch = extract(HOST, '  if (method == "ArdiaShell.windowFrame" || method == "ArdiaShell.closeWindow"')
    restore_branch = extract(HOST, '  if (method == "ArdiaShell.restoreFullScreen")')
    restore = '\n'.join(extract(HOST, signature) for signature in ['void FinishFullScreenRestore()', 'void ExpireFullScreenRestore()'])
    open_branch = extract(HOST, '  if (method == "ArdiaShell.openWindow")')
    broadcast = extract(HOST, 'void BroadcastWindowEvent(') + '\n' + extract(HOST, 'void ReturnUnrequestedActivation(')
    members = '\n'.join(extract(HOST, signature) for signature in [
        'void ShellHostView::OnWidgetActivationChanged(',
        'void ShellHostView::FocusShellOnActivation(',
        'void ShellHostView::OnDidPresentCompositorFrame(',
        'void ShellHostView::OnWidgetBoundsChanged(',
        'void ShellHostView::OnWidgetShowStateChanged(',
        'void ShellHostView::OnWidgetVisibilityChanged(',
        'void ShellHostView::ReportWindowGeometry(',
        'std::vector<base::DictValue> ShellHostView::WindowState(',
        'bool ShellHostView::WindowFullScreen(',
        'void ShellHostView::SeedWindowActivation(',
        'void ShellHostView::RendererReady(',
        'void ShellHostView::RestoreFullScreenNow(',
        'PrefService* ShellHostView::WindowOutputPrefs(',
        'void ShellHostView::RememberWindowOutput(',
        'void ShellHostView::ForgetWindowOutput(',
        'std::optional<std::pair<int64_t, std::string>> ShellHostView::SavedWindowOutput(',
        'void TabBinding::FocusFromHost(',
        'void TabBinding::OnWebContentsFocused('])
    status = (LINUX / 'ac_linux_page_status.h').read_text()
    fullscreen = 'namespace ardiacore {\n' + extract(status, 'inline bool LinuxWindowFullScreen(') + '\n}\n'
    status = (LINUX / 'ac_linux_page_status.h').read_text()
    fullscreen = 'namespace ardiacore {\n' + extract(status, 'inline bool LinuxWindowFullScreen(') + '\n}\n'
    hosts = 'struct ShellHostView;\nstd::map<int, ShellHostView*>& Hosts() { static std::map<int, ShellHostView*> hosts; return hosts; }\n'
    invoke = ('void ShellHostView::WindowInvoke(const std::string& method, const base::ListValue& values, Done done) {\n'
              + restore_branch + '\n' + window_branch + '\n' + open_branch + '\n  std::move(done).Run(false, base::Value("unsupported"));\n}\n')
    return PRELUDE + hosts + free + pointer + fullscreen + HOST_FAKE + broadcast + '\n' + restore + '\n' + profile_openings() + invoke + members + SCENARIOS


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


class WindowLifecycleHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            raise unittest.SkipTest('C++ compiler is unavailable')
        cls.scratch = tempfile.TemporaryDirectory(prefix='ardia-window-host-')
        root = pathlib.Path(cls.scratch.name)
        (root / 'base').mkdir()
        (root / 'base' / 'values.h').write_text(fake_values())
        (root / 'host.cc').write_text(host_harness())
        cls.binary = root / 'host'
        result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
                                 '-I', str(root), '-I', str(SOURCE), str(root / 'host.cc'),
                                 str(LINUX / 'ac_linux_window_lifecycle.cc'), str(LINUX / 'ac_linux_fullscreen_restore.cc'), str(LINUX / 'ac_linux_profiles.cc'), '-o', str(cls.binary)],
                                capture_output=True, text=True)
        if result.returncode != 0:
            cls.scratch.cleanup()
            raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_mode(self, mode):
        result = subprocess.run([str(self.binary), mode], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def test_new_windows_follow_focus_behind_and_frame_intent(self):
        self.run_mode('created')

    def test_reuse_never_moves_or_unfullscreens_an_existing_window(self):
        self.run_mode('reused')

    def test_readiness_retries_activation_and_broadcasts_the_new_windows_state(self):
        self.run_mode('ready')

    def test_a_pointer_press_blocks_the_readiness_retry(self):
        self.run_mode('clicked')

    def test_observed_activation_reaches_regular_renderers_only(self):
        self.run_mode('activation')

    def test_activation_gives_the_shell_keyboard_focus_unless_ardia_already_holds_it(self):
        self.run_mode('keyboard-focus')

    def test_a_restored_behind_window_the_compositor_focuses_hands_focus_back(self):
        self.run_mode('restored-behind')

    def test_a_restore_of_three_or_four_windows_ends_on_the_saved_one(self):
        self.run_mode('many-behind')

    def test_the_users_own_activation_of_a_behind_window_is_never_undone(self):
        self.run_mode('users-activation-stays')

    def test_a_tab_modal_dialog_keeps_focus_when_its_window_is_activated_again(self):
        self.run_mode('tab-modal-dialog')

    def test_activation_before_attach_is_seeded_and_replayed_last(self):
        self.run_mode('seeded')

    def test_geometry_reports_use_the_shared_contract(self):
        self.run_mode('geometry')

    def test_app_focus_is_not_reported_as_page_focus(self):
        self.run_mode('page-focus')

    def test_wayland_has_no_origins_in_replies_or_reports(self):
        self.run_mode('wayland')

    def test_background_instances_show_without_activating(self):
        self.run_mode('background')

    def test_launch_renderer_restores_saved_fullscreen_windows_as_they_arrive(self):
        self.run_mode('fullscreen-restore')

    def test_unavailable_fullscreen_windows_are_given_up_as_windowed(self):
        self.run_mode('fullscreen-given-up')

    def test_fullscreen_restore_leaves_focus_alone_after_the_user_acts(self):
        self.run_mode('fullscreen-focus-yields')

    def test_a_window_shown_after_it_is_ready_still_restores_fullscreen(self):
        self.run_mode('fullscreen-shown-later')

    def test_wayland_fullscreen_windows_return_to_their_saved_output(self):
        self.run_mode('fullscreen-output')

    def test_a_missing_saved_output_falls_back_to_the_compositors_choice(self):
        self.run_mode('fullscreen-output-gone')

    def test_a_saved_output_matches_exactly_one_display_label(self):
        self.run_mode('output-labels')

    def test_a_fullscreen_windows_output_is_rechecked_without_a_geometry_report(self):
        self.run_mode('late-output')

    def test_the_fullscreen_restores_final_focus_keeps_the_behind_windows_hand_back(self):
        self.run_mode('restore-keeps-hand-back')

    def test_x11_keeps_no_saved_outputs(self):
        self.run_mode('x11-outputs')

    def test_the_fullscreen_restore_waits_for_the_windows_first_presented_frame(self):
        self.run_mode('restore-after-first-frame')

    def test_quitting_saves_the_output_before_the_browser_is_detached(self):
        detach = extract(HOST, 'void ShellHostView::DetachBrowser()')
        self.assertLess(detach.index('RememberWindowOutput();'), detach.index('browser_ = nullptr;'))
        self.assertLess(detach.index('RememberWindowOutput();'), detach.index('if (!RetireDocuments()) return;'))

    def test_outputs_are_saved_on_close_and_forgotten_when_the_window_departs(self):
        self.assertIn('RememberWindowOutput();', extract(HOST, 'void ShellHostView::OnWidgetClosing('))
        self.assertIn('ForgetWindowOutput();', extract(HOST, 'void ShellHostView::CommitWindowDeparture('))

    def test_fullscreen_restore_never_activates_a_background_instance(self):
        self.run_mode('fullscreen-background')

    def test_shared_drop_code_targets_windows_from_native_frames(self):
        node = shutil.which('node')
        if node is None:
            self.skipTest('node is unavailable')
        frames = self.run_mode('frames').strip()
        with tempfile.TemporaryDirectory(prefix='ardia-window-drop-') as scratch:
            script = pathlib.Path(scratch) / 'drop.mjs'
            script.write_text(DROP)
            result = subprocess.run([node, '--experimental-strip-types', '--no-warnings', '--import', LOADER.as_uri(),
                                     str(script), frames, WINDOW_DROP.as_uri()],
                                    capture_output=True, text=True, cwd=REPO / 'apps' / 'linux')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        import json
        reply = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(reply['under'], {'outside': True, 'overWindow': 'b'})
        self.assertEqual(reply['overPoint'], [100, 100])

    def test_native_glue_seeds_activation_and_registers_pointer_input(self):
        initialize = extract(HOST, 'void ShellHostView::Initialize()')
        self.assertIn('SeedWindowActivation();', initialize)
        self.assertIn('AddPreTargetHandler(&pointer_handler_', initialize)
        self.assertIn('RemovePreTargetHandler(&pointer_handler_)', extract(HOST, 'void ShellHostView::UnregisterAccelerators()'))
        self.assertIn('binding->FocusFromHost();', HOST)
        self.assertIn('WindowFocus().Forget(browser->GetSessionID().id());', extract(HOST, 'void OnBrowserClosed('))

    def test_lifecycle_helper_is_built(self):
        build = (LINUX / 'BUILD.gn').read_text()
        for name in ('"ac_linux_window_lifecycle.cc"', '"ac_linux_window_lifecycle.h"', '"//ui/display"', '"//ui/ozone"'):
            self.assertIn(name, build)

    def test_new_sources_have_no_comments(self):
        for path in (LINUX / 'ac_linux_window_lifecycle.h', LINUX / 'ac_linux_window_lifecycle.cc'):
            self.assertIsNone(re.search(r'//|/\*', path.read_text()), path)


if __name__ == '__main__':
    unittest.main()
