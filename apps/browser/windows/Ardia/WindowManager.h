#pragma once

#include <array>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <commctrl.h>
#include <dwmapi.h>
#include <shellscalingapi.h>
#include <winrt/Microsoft.UI.Input.h>
#include <winrt/Windows.Graphics.h>
#include <winrt/Windows.UI.h>

#include "AppIcon.h"
#include "Events.h"
#include "Host.h"
#include "LaunchLog.h"
#include "Paths.h"
#include "WindowFade.h"

#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shcore.lib")

namespace Ardia {

struct OpenWindowRequest {
  std::string id;
  std::string kind{"browser"};
  std::string title;
  std::optional<std::array<double, 4>> frame;
  std::optional<std::array<double, 2>> size;
  bool focus{true};
  bool animated{false};
};

struct ManagedWindow {
  std::string id;
  std::string kind;
  winrt::Microsoft::ReactNative::ReactNativeWindow window{nullptr};
  winrt::Microsoft::UI::Windowing::AppWindow appWindow{nullptr};
  HWND hwnd{nullptr};
  winrt::event_token changed{};
  winrt::event_token closing{};
  winrt::event_token destroying{};
  bool fullScreen{false};
  bool pageFullScreen{false};
  bool fullScreenBeforePage{false};
  winrt::Microsoft::UI::Input::InputNonClientPointerSource nonClient{nullptr};
  bool captionBand{false};
  bool maximized{false};
  std::wstring installedRegions;
  std::shared_ptr<WindowFade> fade;
  std::vector<std::function<void()>> exits;
  std::vector<std::function<void()>> revealWaiters;
  int closeGeneration{0};

  bool IsBrowser() const noexcept {
    return kind == "browser" || kind == "small";
  }
};

struct WindowManager {
  static WindowManager &Shared() noexcept {
    static WindowManager *shared = new WindowManager();
    return *shared;
  }

  void Prewarm() noexcept {
    if (m_spare) return;
    try {
      m_spare = winrt::Microsoft::ReactNative::ReactNativeWindow::CreateFromCompositor(Host::Current()->compositor);
      HWND hwnd = winrt::Microsoft::UI::GetWindowFromWindowId(m_spare.AppWindow().Id());
      winrt::Microsoft::ReactNative::ReactCoreInjection::SetTopLevelWindowId(
          Host::Current()->reactHost.InstanceSettings().Properties(), reinterpret_cast<uint64_t>(hwnd));
    } catch (...) {
      LaunchLog::Write(L"error", L"the first window could not be created");
    }
  }

  void Attach(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
  }

  void Detach() noexcept {
    m_context = nullptr;
  }

  HWND Hwnd(std::string_view id) const noexcept {
    const ManagedWindow *entry = Find(id);
    return entry ? entry->hwnd : nullptr;
  }

  HWND ActiveHwnd() const noexcept {
    if (HWND active = Hwnd(m_activeId)) return active;
    return m_order.empty() ? nullptr : Hwnd(m_order.front());
  }

  std::string ActiveId() const noexcept {
    if (Find(m_activeId)) return m_activeId;
    return m_order.empty() ? std::string{} : m_order.front();
  }

  std::vector<std::string> Ids() const noexcept {
    return m_order;
  }

  static double Scale(HWND hwnd) noexcept {
    UINT dpi = hwnd ? GetDpiForWindow(hwnd) : 0;
    return dpi ? dpi / static_cast<double>(USER_DEFAULT_SCREEN_DPI) : 1.0;
  }

  static double ScaleOfMonitor(HMONITOR monitor, double fallback) noexcept {
    UINT dpiX = 0;
    UINT dpiY = 0;
    if (!monitor || FAILED(GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY)) || dpiX == 0) return fallback;
    return dpiX / static_cast<double>(USER_DEFAULT_SCREEN_DPI);
  }

  static double PositionScale() noexcept {
    return ScaleOfMonitor(MonitorFromPoint(POINT{0, 0}, MONITOR_DEFAULTTOPRIMARY), 1.0);
  }

  static double ScaleAt(int32_t x, int32_t y, double fallback) noexcept {
    return ScaleOfMonitor(MonitorFromPoint(POINT{x, y}, MONITOR_DEFAULTTONEAREST), fallback);
  }

  static bool Background() noexcept {
    static const bool background = Paths::Environment(L"ARDIA_BACKGROUND") == L"1";
    return background;
  }

  void Open(OpenWindowRequest const &request) noexcept {
    if (ManagedWindow *existing = Find(request.id)) {
      bool wasClosing = !existing->exits.empty() || (existing->fade && (existing->fade->phase == WindowFade::Phase::Leaving || existing->fade->phase == WindowFade::Phase::Lingering));
      StopClosing(*existing);
      if (request.focus) {
        Focus(request.id);
      } else if (ManagedWindow *reopened = Find(request.id); reopened && wasClosing) {
        try {
          reopened->appWindow.Show(false);
        } catch (...) {
        }
      }
      return;
    }
    try {
      ManagedWindow entry;
      entry.id = request.id;
      entry.kind = request.kind.empty() ? std::string{"browser"} : request.kind;
      if (m_spare) {
        entry.window = m_spare;
        m_spare = nullptr;
      } else {
        entry.window = winrt::Microsoft::ReactNative::ReactNativeWindow::CreateFromCompositor(Host::Current()->compositor);
      }
      entry.appWindow = entry.window.AppWindow();
      entry.hwnd = winrt::Microsoft::UI::GetWindowFromWindowId(entry.appWindow.Id());
      entry.window.ResizePolicy(winrt::Microsoft::ReactNative::ContentSizePolicy::ResizeContentToParentWindow);

      Configure(entry, request);
      ApplyTheme(entry, m_dark);
      Place(entry, request);
      Watch(entry);
      Mount(entry);
      ConnectNonClientInput(entry);
      ApplyInputRegions(entry);

      bool activate = request.focus && !Background();
      bool entrance = request.animated || entry.kind != "browser";
      bool fades = entrance && WindowMotion::SystemAnimates();
      HWND hwnd = entry.hwnd;
      auto appWindow = entry.appWindow;
      m_order.push_back(entry.id);
      auto placed = m_windows.emplace(entry.id, std::move(entry)).first;
      if (fades) BeginEntrance(placed->second);
      appWindow.Show(activate);
      if (activate) SetForegroundWindow(hwnd);
      if (m_activeId.empty()) m_activeId = request.id;
      LaunchLog::Write(L"window", std::wstring(L"opened ").append(Paths::Wide(request.id)));
      if (entrance && !fades) LaunchLog::Write(L"window", std::wstring(L"window ").append(Paths::Wide(request.id)).append(L" shown at once: animations are off in Windows"));
    } catch (winrt::hresult_error const &error) {
      LaunchLog::Write(L"error", std::wstring(L"window could not open: ").append(error.message()));
    } catch (...) {
      LaunchLog::Write(L"error", L"window could not open");
    }
  }

  void Close(std::string_view id) noexcept {
    ManagedWindow *entry = Find(id);
    if (!entry) return;
    try {
      entry->appWindow.Destroy();
    } catch (...) {
    }
  }

  void AnimateClose(std::string const &id, std::optional<std::string> const &replacement, std::function<void()> done) noexcept {
    ManagedWindow *entry = Find(id);
    if (!entry) {
      LogFade(id, L" hidden at once: no such window");
      return done();
    }
    if (!entry->exits.empty()) {
      entry->exits.push_back(std::move(done));
      return;
    }
    if (const wchar_t *reason = HideAtOnceReason(*entry)) {
      HideNow(*entry, reason);
      return done();
    }
    entry->exits.push_back(std::move(done));
    int generation = ++entry->closeGeneration;
    if (replacement && *replacement != id && Find(*replacement)) {
      WhenRevealed(*replacement, [this, id, generation]() noexcept {
        After(WindowMotion::kReplacementSettle, [this, id, generation]() noexcept {
          ManagedWindow *closing = Find(id);
          if (!closing || closing->exits.empty() || closing->closeGeneration != generation) return;
          HideNow(*closing, L"replaced by another window");
          RunExits(*closing);
        });
      });
      return;
    }
    StartLeaving(*entry);
  }

  std::optional<winrt::Microsoft::ReactNative::JSValueObject> DebugFade(std::string_view id) noexcept {
    if (!DebugAvailable()) return std::nullopt;
    winrt::Microsoft::ReactNative::JSValueObject report;
    report["animates"] = WindowMotion::SystemAnimates();
    ManagedWindow *entry = Find(id);
    report["exists"] = entry != nullptr;
    if (!entry) return report;
    report["visible"] = IsWindowVisible(entry->hwnd) != FALSE;
    report["layered"] = (GetWindowLongPtrW(entry->hwnd, GWL_EXSTYLE) & WS_EX_LAYERED) != 0;
    report["phase"] = PhaseName(entry->fade.get());
    report["opacity"] = entry->fade ? entry->fade->opacity : 1.0;
    report["closing"] = !entry->exits.empty();
    report["pageWindows"] = static_cast<int64_t>(LayeredWindows::VisibleOwnedBy(entry->hwnd).size());
    return report;
  }

  void Focus(std::string_view id) noexcept {
    if (ManagedWindow *closing = Find(id)) StopClosing(*closing);
    ManagedWindow *entry = Find(id);
    if (!entry) return;
    try {
      if (!entry->appWindow.IsVisible()) entry->appWindow.Show(!Background());
    } catch (...) {
    }
    if (Background()) return;
    if (IsIconic(entry->hwnd)) ShowWindow(entry->hwnd, SW_RESTORE);
    SetForegroundWindow(entry->hwnd);
  }

  void SetTitle(std::string_view id, std::string_view title) noexcept {
    ManagedWindow *entry = Find(id);
    if (!entry) return;
    try {
      entry->appWindow.Title(winrt::to_hstring(title));
    } catch (...) {
    }
  }

  std::optional<std::array<double, 4>> Frame(std::string_view id) const noexcept {
    const ManagedWindow *entry = Find(id);
    if (!entry) return std::nullopt;
    return FrameOf(*entry);
  }

  void RestoreFullScreen(std::vector<std::string> const &ids, std::optional<std::string> const &focus) noexcept {
    for (auto const &id : ids) {
      ManagedWindow *entry = Find(id);
      if (!entry) continue;
      try {
        entry->appWindow.SetPresenter(winrt::Microsoft::UI::Windowing::AppWindowPresenterKind::FullScreen);
      } catch (...) {
      }
    }
    if (focus) Focus(*focus);
  }

  void SetPageFullScreen(std::string const &id, bool on) noexcept {
    ManagedWindow *entry = Find(id);
    if (!entry || Background() || entry->pageFullScreen == on) return;
    using winrt::Microsoft::UI::Windowing::AppWindowPresenterKind;
    try {
      bool full = entry->appWindow.Presenter().Kind() == AppWindowPresenterKind::FullScreen;
      entry->pageFullScreen = on;
      if (on) {
        entry->fullScreenBeforePage = full;
        if (!full) entry->appWindow.SetPresenter(AppWindowPresenterKind::FullScreen);
      } else if (full && !entry->fullScreenBeforePage) {
        entry->appWindow.SetPresenter(AppWindowPresenterKind::Overlapped);
      }
    } catch (...) {
    }
  }

  void SetDark(bool dark) noexcept {
    m_dark = dark;
    for (auto &[id, entry] : m_windows) ApplyTheme(entry, dark);
  }

  void BeginDrag(int64_t rootTag) noexcept {
    ForgetPress();
    ManagedWindow *entry = ForRootTag(rootTag);
    if (!entry || Background()) return;
    StartAppDrag(*entry);
  }

  void PressDragArea(int64_t rootTag) noexcept {
    ManagedWindow *entry = ForRootTag(rootTag);
    if (!entry || Background()) return;
    POINT cursor{};
    GetCursorPos(&cursor);
    if (IsSecondPress(entry->hwnd, cursor, GetTickCount())) {
      LaunchLog::Write(L"window", std::wstring(L"double click on a drag area of ").append(Paths::Wide(entry->id)).append(L", second press through the UI"));
      ToggleMaximized(*entry);
      return;
    }
    StartAppDrag(*entry);
  }

  void ToggleMaximize(int64_t rootTag) noexcept {
    if (Background()) return;
    ManagedWindow *entry = ForRootTag(rootTag);
    if (entry) ToggleMaximized(*entry);
  }

  void Minimize(std::string_view id) noexcept {
    ManagedWindow *entry = Find(id);
    if (!entry || Background()) return;
    if (auto presenter = OverlappedOf(*entry)) {
      try {
        if (presenter.IsMinimizable()) presenter.Minimize();
      } catch (...) {
      }
    }
  }

  void ToggleMaximizeOf(std::string_view id) noexcept {
    ManagedWindow *entry = Find(id);
    if (!entry || Background()) return;
    ToggleMaximized(*entry);
  }

  void SetCaptionRegions(std::string const &id, std::vector<std::array<double, 4>> regions) noexcept {
    m_captionRegions[id] = std::move(regions);
    if (ManagedWindow *entry = Find(id)) ApplyInputRegions(*entry);
  }

  void WatchSidebarEdge(std::string const &id, bool on, double hold, bool right, bool whilePressed) noexcept {
    if (!on) {
      m_edgeWatches.erase(id);
      if (m_edgeWatches.empty()) StopEdgeTimer();
      return;
    }
    EdgeWatch &watch = m_edgeWatches[id];
    watch.hold = std::isfinite(hold) ? (std::max)(0.0, hold) : 0.0;
    watch.right = right;
    watch.whilePressed = whilePressed;
    watch.unreported = true;
    StartEdgeTimer();
    CheckEdges();
  }

  std::optional<winrt::Microsoft::ReactNative::JSValueObject> DebugEdgeWatch() const noexcept {
    if (!DebugAvailable()) return std::nullopt;
    winrt::Microsoft::ReactNative::JSValueArray ids;
    for (auto const &[id, watch] : m_edgeWatches) ids.push_back(id);
    winrt::Microsoft::ReactNative::JSValueObject report;
    report["running"] = static_cast<bool>(m_edgeTimer);
    report["windows"] = std::move(ids);
    return report;
  }

  bool DebugAvailable() const noexcept {
    static const bool available = Paths::HasSwitch(L"--self-check") && Paths::HasCustomDataDirectory();
    return available;
  }

  std::optional<winrt::Microsoft::ReactNative::JSValueObject> DebugRegions(std::string_view id) noexcept {
    ManagedWindow *entry = Find(id);
    if (!DebugAvailable() || !entry) return std::nullopt;
    winrt::Microsoft::ReactNative::JSValueObject report;
    report["rootTag"] = RootTagOf(*entry).value_or(0);
    report["scale"] = Scale(entry->hwnd);
    report["nonClient"] = static_cast<bool>(entry->nonClient);
    report["kind"] = entry->kind;
    report["titleBand"] = entry->captionBand ? "caption" : "content";
    report["maximized"] = entry->maximized;
    report["titleBarHeight"] = TitleBarHeightOf(*entry);
    report["caption"] = InstalledRects(*entry, winrt::Microsoft::UI::Input::NonClientRegionKind::Caption);
    report["passthrough"] = InstalledRects(*entry, winrt::Microsoft::UI::Input::NonClientRegionKind::Passthrough);
    return report;
  }

  void ReplyToTerminate(bool ok) noexcept {
    if (!m_quitting) return;
    if (ok) return Finish();
    m_quitting = false;
    m_quitGeneration++;
    EmitApp("quitCancelled");
  }

  void Quit() noexcept {
    if (m_quitting) return;
    m_quitting = true;
    if (!m_context) return Finish();
    EmitApp("willQuit");
    After(std::chrono::milliseconds(3000), [this, generation = ++m_quitGeneration]() noexcept {
      if (m_quitting && generation == m_quitGeneration) Finish();
    });
  }

 private:
  static constexpr UINT_PTR kSubclassId = 0xA2D1A;
  static constexpr int kEdgePollMs = 40;
  static constexpr double kEdgeReach = 24.0;

  struct EdgeWatch {
    double hold{0};
    bool right{false};
    bool whilePressed{false};
    bool over{false};
    bool unreported{true};
  };

  ManagedWindow *Find(std::string_view id) noexcept {
    auto found = m_windows.find(std::string(id));
    return found == m_windows.end() ? nullptr : &found->second;
  }

  const ManagedWindow *Find(std::string_view id) const noexcept {
    auto found = m_windows.find(std::string(id));
    return found == m_windows.end() ? nullptr : &found->second;
  }

  ManagedWindow *FindByRootTag(int64_t rootTag) noexcept {
    for (auto &[id, entry] : m_windows) {
      try {
        if (entry.window.ReactNativeIsland().RootTag() == rootTag) return &entry;
      } catch (...) {
      }
    }
    return nullptr;
  }

  ManagedWindow *ForRootTag(int64_t rootTag) noexcept {
    if (ManagedWindow *entry = FindByRootTag(rootTag)) return entry;
    LaunchLog::Write(L"warning", std::wstring(L"no window has root tag ").append(std::to_wstring(rootTag)).append(L"; using the active window"));
    return Find(m_activeId);
  }

  ManagedWindow *FindByHwnd(HWND hwnd) noexcept {
    for (auto &[id, entry] : m_windows) {
      if (entry.hwnd == hwnd) return &entry;
    }
    return nullptr;
  }

  static std::array<double, 4> FrameOf(ManagedWindow const &entry) noexcept {
    try {
      double scale = Scale(entry.hwnd);
      double placed = PositionScale();
      auto position = entry.appWindow.Position();
      auto size = entry.appWindow.Size();
      return {position.X / placed, position.Y / placed, size.Width / scale, size.Height / scale};
    } catch (...) {
      return {0, 0, 0, 0};
    }
  }

  static void Configure(ManagedWindow &entry, OpenWindowRequest const &request) noexcept {
    try {
      entry.appWindow.Title(winrt::to_hstring(request.title.empty() ? std::string{"Ardia"} : request.title));
      AppIcon::Apply(entry.hwnd, entry.id);
      auto presenter = entry.appWindow.Presenter().try_as<winrt::Microsoft::UI::Windowing::OverlappedPresenter>();
      double scale = Scale(entry.hwnd);
      auto pixels = [scale](double points) noexcept { return static_cast<int32_t>(points * scale + 0.5); };
      auto titleBar = entry.appWindow.TitleBar();
      titleBar.ExtendsContentIntoTitleBar(true);
      titleBar.PreferredHeightOption(winrt::Microsoft::UI::Windowing::TitleBarHeightOption::Standard);
      titleBar.ButtonBackgroundColor(winrt::Windows::UI::Color{0, 0, 0, 0});
      titleBar.ButtonInactiveBackgroundColor(winrt::Windows::UI::Color{0, 0, 0, 0});
      if (presenter) presenter.SetBorderAndTitleBar(true, false);
      if (entry.IsBrowser()) {
        if (presenter) {
          presenter.PreferredMinimumWidth(pixels(entry.kind == "small" ? 420 : 480));
          presenter.PreferredMinimumHeight(pixels(entry.kind == "small" ? 300 : 360));
        }
      } else if (presenter) {
        bool settings = entry.kind == "settings";
        presenter.IsMaximizable(settings);
        presenter.IsResizable(settings);
        presenter.PreferredMinimumWidth(pixels(settings ? 720 : 640));
        presenter.PreferredMinimumHeight(pixels(settings ? 480 : 600));
      }
    } catch (...) {
      LaunchLog::Write(L"warning", L"window chrome could not be set");
    }
  }

  void Place(ManagedWindow &entry, OpenWindowRequest const &request) noexcept {
    try {
      double scale = Scale(entry.hwnd);
      auto pixels = [scale](double points) noexcept { return static_cast<int32_t>(points * scale + 0.5); };
      if (request.frame && (*request.frame)[2] > 0 && (*request.frame)[3] > 0) {
        auto const &frame = *request.frame;
        double placed = PositionScale();
        int32_t x = static_cast<int32_t>(std::lround(frame[0] * placed));
        int32_t y = static_cast<int32_t>(std::lround(frame[1] * placed));
        auto sized = [](double points, double by) noexcept { return static_cast<int32_t>(points * by + 0.5); };
        double there = ScaleAt(x, y, scale);
        there = ScaleAt(x + sized(frame[2], there) / 2, y + sized(frame[3], there) / 2, there);
        entry.appWindow.MoveAndResize({x, y, sized(frame[2], there), sized(frame[3], there)});
        double landed = Scale(entry.hwnd);
        if (landed != there) entry.appWindow.MoveAndResize({x, y, sized(frame[2], landed), sized(frame[3], landed)});
        KeepOnADisplay(entry);
        return;
      }
      double width = 1280;
      double height = 800;
      if (entry.kind == "settings") {
        width = 820;
        height = 640;
      } else if (entry.kind == "import") {
        width = 640;
        height = 600;
      } else if (entry.kind == "small") {
        width = request.size ? (*request.size)[0] : 900;
        height = request.size ? (*request.size)[1] : 640;
      }
      auto area = winrt::Microsoft::UI::Windowing::DisplayArea::GetFromWindowId(
                      entry.appWindow.Id(), winrt::Microsoft::UI::Windowing::DisplayAreaFallback::Primary)
                      .WorkArea();
      int32_t pixelWidth = (std::min)(pixels(width), area.Width);
      int32_t pixelHeight = (std::min)(pixels(height), area.Height);
      int32_t x = area.X + (area.Width - pixelWidth) / 2;
      int32_t y = area.Y + (area.Height - pixelHeight) / 2;
      if (entry.kind == "browser") {
        if (const ManagedWindow *active = Find(m_activeId); active && active->kind == "browser") {
          auto position = active->appWindow.Position();
          int32_t step = pixels(28);
          x = (std::min)(position.X + step, area.X + area.Width - pixelWidth);
          y = (std::min)(position.Y + step, area.Y + area.Height - pixelHeight);
        }
      }
      entry.appWindow.MoveAndResize({x, y, pixelWidth, pixelHeight});
    } catch (...) {
      LaunchLog::Write(L"warning", L"window could not be placed");
    }
  }

  static void ApplyTheme(ManagedWindow &entry, bool dark) noexcept {
    static constexpr DWORD kUseImmersiveDarkMode = 20;
    BOOL useDark = dark ? TRUE : FALSE;
    DwmSetWindowAttribute(entry.hwnd, kUseImmersiveDarkMode, &useDark, sizeof(useDark));
    try {
      entry.appWindow.TitleBar().PreferredTheme(
          dark ? winrt::Microsoft::UI::Windowing::TitleBarTheme::Dark : winrt::Microsoft::UI::Windowing::TitleBarTheme::Light);
    } catch (...) {
    }
  }

  static void KeepOnADisplay(ManagedWindow &entry) noexcept {
    try {
      auto area = winrt::Microsoft::UI::Windowing::DisplayArea::GetFromWindowId(
                      entry.appWindow.Id(), winrt::Microsoft::UI::Windowing::DisplayAreaFallback::Nearest)
                      .WorkArea();
      auto position = entry.appWindow.Position();
      auto size = entry.appWindow.Size();
      int32_t width = (std::min)(size.Width, area.Width);
      int32_t height = (std::min)(size.Height, area.Height);
      int32_t x = (std::max)(area.X, (std::min)(position.X, area.X + area.Width - width));
      int32_t y = (std::max)(area.Y, (std::min)(position.Y, area.Y + area.Height - height));
      if (x != position.X || y != position.Y || width != size.Width || height != size.Height) entry.appWindow.MoveAndResize({x, y, width, height});
    } catch (...) {
    }
  }

  void Watch(ManagedWindow &entry) noexcept {
    std::string id = entry.id;
    entry.changed = entry.appWindow.Changed(
        [this, id](winrt::Microsoft::UI::Windowing::AppWindow const &, winrt::Microsoft::UI::Windowing::AppWindowChangedEventArgs const &args) noexcept {
          ManagedWindow *found = Find(id);
          if (!found) return;
          try {
            if (args.DidPositionChange() || args.DidSizeChange()) {
              auto frame = FrameOf(*found);
              winrt::Microsoft::ReactNative::JSValueArray values;
              for (double value : frame) values.push_back(value);
              winrt::Microsoft::ReactNative::JSValueObject event;
              event["type"] = "frame";
              event["id"] = id;
              event["frame"] = std::move(values);
              EmitWindow(std::move(event));
            }
            if (args.DidSizeChange()) ApplyInputRegions(*found);
            if (args.DidSizeChange() || args.DidPresenterChange()) ReportMaximized(*found);
            if (args.DidPresenterChange()) {
              bool fullScreen = found->appWindow.Presenter().Kind() == winrt::Microsoft::UI::Windowing::AppWindowPresenterKind::FullScreen;
              if (fullScreen != found->fullScreen) {
                found->fullScreen = fullScreen;
                ApplyInputRegions(*found);
                winrt::Microsoft::ReactNative::JSValueObject event;
                event["type"] = "fullScreen";
                event["id"] = id;
                event["on"] = fullScreen;
                EmitWindow(std::move(event));
              }
            }
          } catch (...) {
          }
        });
    entry.closing = entry.appWindow.Closing(
        [this, id](winrt::Microsoft::UI::Windowing::AppWindow const &, winrt::Microsoft::UI::Windowing::AppWindowClosingEventArgs const &args) noexcept {
          ManagedWindow *found = Find(id);
          if (!found || !found->IsBrowser() || !m_context || m_quitting) return;
          try {
            args.Cancel(true);
          } catch (...) {
            return;
          }
          winrt::Microsoft::ReactNative::JSValueObject event;
          event["type"] = "closeRequest";
          event["id"] = id;
          EmitWindow(std::move(event));
        });
    entry.destroying = entry.appWindow.Destroying(
        [this, id](winrt::Microsoft::UI::Windowing::AppWindow const &, winrt::Windows::Foundation::IInspectable const &) noexcept { Closed(id); });
    SetWindowSubclass(entry.hwnd, &WindowManager::WindowProc, kSubclassId, reinterpret_cast<DWORD_PTR>(this));
  }

  static void Mount(ManagedWindow &entry) {
    winrt::Microsoft::ReactNative::ReactViewOptions options;
    options.ComponentName(L"main");
    options.InitialProps([id = entry.id](winrt::Microsoft::ReactNative::IJSValueWriter const &writer) {
      writer.WriteObjectBegin();
      writer.WritePropertyName(L"windowId");
      writer.WriteString(winrt::to_hstring(id));
      writer.WriteObjectEnd();
    });
    entry.window.ReactNativeIsland().ReactViewHost(
        winrt::Microsoft::ReactNative::ReactCoreInjection::MakeViewHost(Host::Current()->reactHost, options));
  }

  void Closed(std::string const &id) noexcept {
    auto found = m_windows.find(id);
    if (found == m_windows.end()) return;
    RemoveWindowSubclass(found->second.hwnd, &WindowManager::WindowProc, kSubclassId);
    auto closedWindow = found->second.window;
    auto exits = std::move(found->second.exits);
    auto revealWaiters = std::move(found->second.revealWaiters);
    std::shared_ptr<WindowFade> unfinished = std::move(found->second.fade);
    found->second.fade = nullptr;
    if (!exits.empty()) LogFade(id, L" hidden at once: closed");
    m_windows.erase(found);
    if (unfinished) {
      unfinished->StopTimer();
      After(std::chrono::milliseconds(50), [unfinished]() noexcept { unfinished->layered.ReleaseAll(); });
    }
    m_captionRegions.erase(id);
    if (m_edgeWatches.erase(id) && m_edgeWatches.empty()) StopEdgeTimer();
    std::erase(m_order, id);
    if (m_activeId == id) m_activeId = m_order.empty() ? std::string{} : m_order.back();
    if (HWND next = ActiveHwnd()) {
      try {
        winrt::Microsoft::ReactNative::ReactCoreInjection::SetTopLevelWindowId(
            Host::Current()->reactHost.InstanceSettings().Properties(), reinterpret_cast<uint64_t>(next));
      } catch (...) {
      }
    }
    winrt::Microsoft::ReactNative::JSValueObject event;
    event["type"] = "close";
    event["id"] = id;
    EmitWindow(std::move(event));
    LaunchLog::Write(L"window", std::wstring(L"closed ").append(Paths::Wide(id)));
    for (auto &exit : exits) exit();
    for (auto &waiter : revealWaiters) waiter();
    After(std::chrono::milliseconds(1), [closedWindow]() noexcept {});
    if (m_windows.empty() && !m_quitting) {
      After(std::chrono::milliseconds(400), [this]() noexcept {
        if (m_windows.empty()) Quit();
      });
    }
  }

  void Activated(HWND hwnd) noexcept {
    ManagedWindow *entry = FindByHwnd(hwnd);
    if (!entry) return;
    m_activeId = entry->id;
    try {
      winrt::Microsoft::ReactNative::ReactCoreInjection::SetTopLevelWindowId(
          Host::Current()->reactHost.InstanceSettings().Properties(), reinterpret_cast<uint64_t>(hwnd));
    } catch (...) {
    }
    winrt::Microsoft::ReactNative::JSValueObject event;
    event["type"] = "focus";
    event["id"] = entry->id;
    EmitWindow(std::move(event));
  }

  static bool LeftButtonDown() noexcept {
    return (GetAsyncKeyState(GetSystemMetrics(SM_SWAPBUTTON) ? VK_RBUTTON : VK_LBUTTON) & 0x8000) != 0;
  }

  static std::optional<int64_t> RootTagOf(ManagedWindow const &entry) noexcept {
    try {
      return entry.window.ReactNativeIsland().RootTag();
    } catch (...) {
      return std::nullopt;
    }
  }

  void StartAppDrag(ManagedWindow &entry) noexcept {
    POINT cursor{};
    GetCursorPos(&cursor);
    try {
      m_dragOrigin = entry.appWindow.Position();
    } catch (...) {
      return;
    }
    m_dragCursor = cursor;
    m_dragId = entry.id;
    LaunchLog::Write(L"window", std::wstring(L"drag began on ").append(Paths::Wide(entry.id)));
    TrackDrag();
  }

  static void ToggleMaximized(ManagedWindow &entry) noexcept {
    auto presenter = OverlappedOf(entry);
    if (!presenter) return;
    try {
      if (presenter.State() == winrt::Microsoft::UI::Windowing::OverlappedPresenterState::Maximized) presenter.Restore();
      else if (presenter.IsMaximizable()) presenter.Maximize();
    } catch (...) {
    }
  }

  bool IsSecondPress(HWND hwnd, POINT where, DWORD at) noexcept {
    DWORD elapsed = at >= m_lastPressAt ? at - m_lastPressAt : m_lastPressAt - at;
    bool second = m_lastPressHwnd == hwnd && elapsed <= GetDoubleClickTime() &&
        std::abs(where.x - m_lastPressWhere.x) * 2 <= GetSystemMetrics(SM_CXDOUBLECLK) &&
        std::abs(where.y - m_lastPressWhere.y) * 2 <= GetSystemMetrics(SM_CYDOUBLECLK);
    m_lastPressHwnd = second ? nullptr : hwnd;
    m_lastPressAt = at;
    m_lastPressWhere = where;
    return second;
  }

  void ForgetPress() noexcept {
    m_lastPressHwnd = nullptr;
  }

  void ReportMaximized(ManagedWindow &entry) noexcept {
    auto presenter = OverlappedOf(entry);
    bool maximized = false;
    try {
      maximized = presenter && presenter.State() == winrt::Microsoft::UI::Windowing::OverlappedPresenterState::Maximized;
    } catch (...) {
    }
    if (maximized == entry.maximized) return;
    entry.maximized = maximized;
    LaunchLog::Write(L"window", std::wstring(maximized ? L"maximized " : L"restored ").append(Paths::Wide(entry.id)));
    winrt::Microsoft::ReactNative::JSValueObject event;
    event["type"] = "maximized";
    event["id"] = entry.id;
    event["on"] = maximized;
    EmitWindow(std::move(event));
  }

  static int32_t TitleBarHeightOf(ManagedWindow const &entry) noexcept {
    try {
      return entry.appWindow.TitleBar().Height();
    } catch (...) {
      return 0;
    }
  }

  static std::vector<winrt::Windows::Graphics::RectInt32> Outside(
      winrt::Windows::Graphics::RectInt32 area, std::vector<winrt::Windows::Graphics::RectInt32> const &holes) noexcept {
    std::vector<winrt::Windows::Graphics::RectInt32> pieces{area};
    for (auto const &hole : holes) {
      std::vector<winrt::Windows::Graphics::RectInt32> next;
      for (auto const &piece : pieces) {
        int32_t pieceRight = piece.X + piece.Width;
        int32_t pieceBottom = piece.Y + piece.Height;
        int32_t left = (std::max)(piece.X, hole.X);
        int32_t top = (std::max)(piece.Y, hole.Y);
        int32_t right = (std::min)(pieceRight, hole.X + hole.Width);
        int32_t bottom = (std::min)(pieceBottom, hole.Y + hole.Height);
        if (right <= left || bottom <= top) {
          next.push_back(piece);
          continue;
        }
        if (top > piece.Y) next.push_back({piece.X, piece.Y, piece.Width, top - piece.Y});
        if (bottom < pieceBottom) next.push_back({piece.X, bottom, piece.Width, pieceBottom - bottom});
        if (left > piece.X) next.push_back({piece.X, top, left - piece.X, bottom - top});
        if (right < pieceRight) next.push_back({right, top, pieceRight - right, bottom - top});
      }
      pieces = std::move(next);
    }
    return pieces;
  }

  std::vector<winrt::Windows::Graphics::RectInt32> CaptionRectsOf(ManagedWindow const &entry, winrt::Windows::Graphics::SizeInt32 client) const noexcept {
    std::vector<winrt::Windows::Graphics::RectInt32> rects;
    auto wanted = m_captionRegions.find(entry.id);
    if (wanted == m_captionRegions.end() || entry.fullScreen) return rects;
    double scale = Scale(entry.hwnd);
    auto across = [client](double value) noexcept { return static_cast<int32_t>((std::min)((std::max)(std::lround(value), 0L), static_cast<long>(client.Width))); };
    auto down = [client](double value) noexcept { return static_cast<int32_t>((std::min)((std::max)(std::lround(value), 0L), static_cast<long>(client.Height))); };
    for (auto const &region : wanted->second) {
      bool finite = std::isfinite(region[0]) && std::isfinite(region[1]) && std::isfinite(region[2]) && std::isfinite(region[3]);
      if (!finite) continue;
      int32_t left = across(region[0] >= 0 ? region[0] * scale : client.Width + region[0] * scale);
      int32_t right = across(client.Width - region[2] * scale);
      int32_t top = down(region[1] * scale);
      int32_t bottom = down((region[1] + region[3]) * scale);
      if (right > left && bottom > top) rects.push_back({left, top, right - left, bottom - top});
    }
    return rects;
  }

  static winrt::Microsoft::ReactNative::JSValueArray InstalledRects(ManagedWindow const &entry, winrt::Microsoft::UI::Input::NonClientRegionKind kind) noexcept {
    winrt::Microsoft::ReactNative::JSValueArray rects;
    if (!entry.nonClient) return rects;
    try {
      for (auto const &rect : entry.nonClient.GetRegionRects(kind)) {
        winrt::Microsoft::ReactNative::JSValueArray values;
        values.push_back(rect.X);
        values.push_back(rect.Y);
        values.push_back(rect.Width);
        values.push_back(rect.Height);
        rects.push_back(std::move(values));
      }
    } catch (...) {
    }
    return rects;
  }

  static winrt::Microsoft::UI::Windowing::OverlappedPresenter OverlappedOf(ManagedWindow const &entry) noexcept {
    try {
      return entry.appWindow.Presenter().try_as<winrt::Microsoft::UI::Windowing::OverlappedPresenter>();
    } catch (...) {
      return nullptr;
    }
  }

  void RestoreUnderCursor(ManagedWindow &entry) noexcept {
    auto presenter = OverlappedOf(entry);
    if (!presenter) return;
    try {
      auto position = entry.appWindow.Position();
      auto size = entry.appWindow.Size();
      double across = size.Width > 0 ? (m_dragCursor.x - position.X) / static_cast<double>(size.Width) : 0.5;
      int32_t down = m_dragCursor.y - position.Y;
      presenter.Restore();
      auto restored = entry.appWindow.Size();
      int32_t grab = static_cast<int32_t>(across * restored.Width);
      m_dragOrigin = {m_dragCursor.x - grab, m_dragCursor.y - (std::min)(down, restored.Height / 2)};
      entry.appWindow.Move(m_dragOrigin);
    } catch (...) {
    }
  }

  static void MaximizeAtTopEdge(ManagedWindow &entry, POINT cursor) noexcept {
    HMONITOR monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
    MONITORINFO info{};
    info.cbSize = static_cast<DWORD>(sizeof(info));
    if (!monitor || !GetMonitorInfoW(monitor, &info) || cursor.y > info.rcMonitor.top) return;
    auto presenter = OverlappedOf(entry);
    if (!presenter) return;
    try {
      if (presenter.IsMaximizable()) presenter.Maximize();
    } catch (...) {
    }
  }

  void TrackDrag() noexcept {
    if (m_systemMove || m_tracking || !LeftButtonDown()) return;
    ManagedWindow *entry = Find(m_dragId);
    if (!entry) return;
    try {
      auto presenter = OverlappedOf(*entry);
      bool maximized = presenter && presenter.State() == winrt::Microsoft::UI::Windowing::OverlappedPresenterState::Maximized;
      if (presenter && !maximized && presenter.State() != winrt::Microsoft::UI::Windowing::OverlappedPresenterState::Restored) return;
      m_dragFromMaximized = maximized;
      m_dragMoved = false;
      m_tracking = true;
      auto timer = Host::Current()->queue.DispatcherQueue().CreateTimer();
      timer.Interval(std::chrono::milliseconds(8));
      timer.IsRepeating(true);
      auto token = std::make_shared<winrt::event_token>();
      *token = timer.Tick([this, timer, token](auto const &, auto const &) noexcept {
        ManagedWindow *moving = Find(m_dragId);
        bool cancelled = (GetAsyncKeyState(VK_ESCAPE) & 0x8000) != 0;
        bool held = LeftButtonDown();
        POINT now{};
        GetCursorPos(&now);
        if (moving && cancelled && m_dragMoved) {
          try {
            if (m_dragFromMaximized) {
              if (auto presenter = OverlappedOf(*moving)) presenter.Maximize();
            } else {
              moving->appWindow.Move(m_dragOrigin);
            }
          } catch (...) {
          }
        }
        if (moving && !cancelled && held && !m_systemMove) {
          bool beyondSlop = std::abs(now.x - m_dragCursor.x) >= GetSystemMetrics(SM_CXDRAG) || std::abs(now.y - m_dragCursor.y) >= GetSystemMetrics(SM_CYDRAG);
          if (!m_dragMoved && !beyondSlop) return;
          if (!m_dragMoved) {
            m_dragMoved = true;
            if (m_dragFromMaximized) RestoreUnderCursor(*moving);
          }
          try {
            moving->appWindow.Move({m_dragOrigin.X + now.x - m_dragCursor.x, m_dragOrigin.Y + now.y - m_dragCursor.y});
          } catch (...) {
          }
          return;
        }
        if (moving && !cancelled && !held && m_dragMoved && !m_systemMove) MaximizeAtTopEdge(*moving, now);
        m_tracking = false;
        timer.Stop();
        timer.Tick(*token);
      });
      timer.Start();
    } catch (...) {
      m_tracking = false;
    }
  }

  static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR, DWORD_PTR reference) noexcept {
    auto *manager = reinterpret_cast<WindowManager *>(reference);
    bool onCaption = wParam == HTCAPTION;
    if (onCaption && message == WM_NCLBUTTONDOWN) manager->TitleBandPressed(hwnd, 0, false, lParam);
    if (onCaption && message == WM_NCLBUTTONDBLCLK) manager->TitleBandPressed(hwnd, 0, true, lParam);
    if (onCaption && message == WM_NCRBUTTONDOWN) manager->TitleBandPressed(hwnd, 2, false, lParam);
    if (message == WM_ENTERSIZEMOVE) {
      manager->m_systemMove = true;
      manager->SystemMoveBegan(hwnd);
    }
    if (message == WM_EXITSIZEMOVE) {
      manager->m_systemMove = false;
      manager->m_captionPressed = nullptr;
    }
    if (message == WM_ACTIVATE && LOWORD(wParam) != WA_INACTIVE) manager->Activated(hwnd);
    if (message == WM_SIZE && wParam != SIZE_MINIMIZED) manager->ArrangeToClient(hwnd, LOWORD(lParam), HIWORD(lParam));
    if (message == WM_ACTIVATEAPP && wParam == FALSE) manager->EmitApp("resignActive");
    return DefSubclassProc(hwnd, message, wParam, lParam);
  }

  void ArrangeToClient(HWND hwnd, int width, int height) noexcept {
    ManagedWindow *entry = FindByHwnd(hwnd);
    if (!entry || width <= 0 || height <= 0) return;
    try {
      auto island = entry->window.ReactNativeIsland();
      if (!island) return;
      float scale = static_cast<float>(Scale(hwnd));
      winrt::Microsoft::ReactNative::LayoutConstraints constraints;
      constraints.LayoutDirection = winrt::Microsoft::ReactNative::LayoutDirection::Undefined;
      constraints.MaximumSize = constraints.MinimumSize = winrt::Windows::Foundation::Size{width / scale, height / scale};
      island.Arrange(constraints, {0, 0});
    } catch (...) {
    }
  }

  static void ConnectNonClientInput(ManagedWindow &entry) noexcept {
    try {
      entry.nonClient = winrt::Microsoft::UI::Input::InputNonClientPointerSource::GetForWindowId(entry.appWindow.Id());
    } catch (...) {
      entry.nonClient = nullptr;
    }
    std::wstring id = Paths::Wide(entry.id);
    if (entry.nonClient) LaunchLog::Write(L"window", std::wstring(L"drags of ").append(id).append(L" are moved by the app, and by Windows in the caption regions the UI marks"));
    else LaunchLog::Write(L"window", std::wstring(L"drags of ").append(id).append(L" are moved by the app: the window has no non-client input source"));
  }

  void ApplyInputRegions(ManagedWindow &entry) noexcept {
    if (!entry.nonClient) return;
    try {
      auto titleBar = entry.appWindow.TitleBar();
      auto client = entry.appWindow.ClientSize();
      auto caption = CaptionRectsOf(entry, client);
      int32_t left = titleBar.LeftInset();
      int32_t right = client.Width - titleBar.RightInset();
      int32_t height = titleBar.Height();
      std::vector<winrt::Windows::Graphics::RectInt32> passthrough;
      if (right > left && height > 0) passthrough = Outside({left, 0, right - left, height}, caption);
      entry.nonClient.SetRegionRects(winrt::Microsoft::UI::Input::NonClientRegionKind::Caption, caption);
      entry.nonClient.SetRegionRects(winrt::Microsoft::UI::Input::NonClientRegionKind::Passthrough, passthrough);
      bool captionBand = !caption.empty();
      if (captionBand != entry.captionBand) {
        entry.captionBand = captionBand;
        LaunchLog::Write(L"window", std::wstring(L"title band of ").append(Paths::Wide(entry.id)).append(captionBand ? L" is caption" : L" is content"));
      }
      std::wstring installed = std::wstring(L"band ").append(std::to_wstring(height)).append(L", insets ").append(std::to_wstring(left)).append(L" ").append(std::to_wstring(titleBar.RightInset())).append(L", caption");
      for (auto const &rect : caption) {
        installed.append(L" [").append(std::to_wstring(rect.X)).append(L",").append(std::to_wstring(rect.Y)).append(L",").append(std::to_wstring(rect.Width)).append(L",").append(std::to_wstring(rect.Height)).append(L"]");
      }
      if (installed != entry.installedRegions) {
        entry.installedRegions = installed;
        LaunchLog::Write(L"window", std::wstring(L"input regions of ").append(Paths::Wide(entry.id)).append(L": ").append(installed));
      }
    } catch (winrt::hresult_error const &error) {
      LaunchLog::Write(L"warning", std::wstring(L"input regions of ").append(Paths::Wide(entry.id)).append(L" could not be set: ").append(error.message()));
    } catch (...) {
    }
  }

  static bool AnyButtonDown() noexcept {
    for (int key : {VK_LBUTTON, VK_RBUTTON, VK_MBUTTON, VK_XBUTTON1, VK_XBUTTON2}) {
      if (GetAsyncKeyState(key) & 0x8000) return true;
    }
    return false;
  }

  static HWND TopWindowAt(POINT point) noexcept {
    HWND under = WindowFromPoint(point);
    return under ? GetAncestor(under, GA_ROOTOWNER) : nullptr;
  }

  bool OverAnotherOfOurs(POINT cursor, HWND window) noexcept {
    HWND under = TopWindowAt(cursor);
    return under && under != window && FindByHwnd(under);
  }

  bool EdgeOver(ManagedWindow const &entry, EdgeWatch const &watch, POINT cursor, bool appActive, double &pointX, double &pointY) noexcept {
    HWND hwnd = entry.hwnd;
    POINT origin{0, 0};
    RECT client{};
    if (!ClientToScreen(hwnd, &origin) || !GetClientRect(hwnd, &client)) return false;
    double scale = Scale(hwnd);
    double width = client.right / scale;
    double height = client.bottom / scale;
    pointX = (cursor.x - origin.x) / scale;
    pointY = (cursor.y - origin.y) / scale;
    if (!IsWindowVisible(hwnd) || IsIconic(hwnd) || entry.fullScreen || width <= 0 || height <= 0) return false;
    double slack = watch.over ? kEdgeReach : 0.0;
    if (pointY < -slack || pointY >= height + slack) return false;
    double insideY = (std::min)((std::max)(pointY, 0.0), height - 1);
    LONG probeY = origin.y + static_cast<LONG>(insideY * scale);
    bool inBand = watch.right ? pointX < width && pointX >= width - watch.hold : pointX >= 0 && pointX < watch.hold;
    if (inBand) {
      if (TopWindowAt(POINT{cursor.x, probeY}) != hwnd) return false;
      return insideY == pointY || !OverAnotherOfOurs(cursor, hwnd);
    }
    MONITORINFO info{};
    info.cbSize = static_cast<DWORD>(sizeof(info));
    HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    if (!monitor || !GetMonitorInfoW(monitor, &info)) return false;
    double screenLeft = (info.rcMonitor.left - origin.x) / scale;
    double screenRight = (info.rcMonitor.right - origin.x) / scale;
    bool beyond = watch.right ? pointX >= width && pointX < (std::min)(screenRight, width + kEdgeReach)
                              : pointX < 0 && pointX >= (std::max)(screenLeft, -kEdgeReach);
    if (!beyond) return false;
    POINT insideEdge{watch.right ? origin.x + client.right - 1 : origin.x, probeY};
    if (TopWindowAt(insideEdge) != hwnd || OverAnotherOfOurs(cursor, hwnd)) return false;
    bool besideScreenEdge = (watch.right ? screenRight - width : -screenLeft) <= kEdgeReach;
    return appActive || besideScreenEdge;
  }

  void CheckEdges() noexcept {
    if (Background() || m_edgeWatches.empty()) return;
    POINT cursor{};
    if (!GetCursorPos(&cursor)) return;
    bool pressed = AnyButtonDown();
    HWND foreground = GetForegroundWindow();
    bool appActive = foreground && FindByHwnd(GetAncestor(foreground, GA_ROOTOWNER));
    for (auto it = m_edgeWatches.begin(); it != m_edgeWatches.end();) {
      ManagedWindow *entry = Find(it->first);
      if (!entry) {
        it = m_edgeWatches.erase(it);
        continue;
      }
      EdgeWatch &watch = it->second;
      double pointX = 0;
      double pointY = 0;
      bool over = EdgeOver(*entry, watch, cursor, appActive, pointX, pointY) && (watch.whilePressed || !pressed);
      bool fresh = watch.unreported;
      watch.unreported = false;
      if (fresh || over != watch.over) {
        if (over != watch.over) LaunchLog::Write(L"window", std::wstring(over ? L"sidebar edge over " : L"sidebar edge away ").append(Paths::Wide(it->first)));
        watch.over = over;
        winrt::Microsoft::ReactNative::JSValueArray point;
        point.push_back(pointX);
        point.push_back(pointY);
        winrt::Microsoft::ReactNative::JSValueObject event;
        event["type"] = "sidebarEdge";
        event["id"] = it->first;
        event["over"] = over;
        event["point"] = std::move(point);
        EmitWindow(std::move(event));
      }
      ++it;
    }
    if (m_edgeWatches.empty()) StopEdgeTimer();
  }

  void StartEdgeTimer() noexcept {
    if (m_edgeTimer) return;
    try {
      auto timer = Host::Current()->queue.DispatcherQueue().CreateTimer();
      timer.Interval(std::chrono::milliseconds(kEdgePollMs));
      timer.IsRepeating(true);
      m_edgeTick = timer.Tick([this](auto const &, auto const &) noexcept { CheckEdges(); });
      m_edgeTimer = timer;
      timer.Start();
    } catch (...) {
      m_edgeTimer = nullptr;
    }
  }

  void StopEdgeTimer() noexcept {
    if (!m_edgeTimer) return;
    auto timer = m_edgeTimer;
    m_edgeTimer = nullptr;
    try {
      timer.Stop();
      timer.Tick(m_edgeTick);
    } catch (...) {
    }
  }

  static POINT ScreenPointOf(LPARAM lParam) noexcept {
    return POINT{static_cast<LONG>(static_cast<short>(LOWORD(lParam))), static_cast<LONG>(static_cast<short>(HIWORD(lParam)))};
  }

  void TitleBandPressed(HWND hwnd, int button, bool doubleClick, LPARAM lParam) noexcept {
    ManagedWindow *entry = FindByHwnd(hwnd);
    if (!entry) return;
    ForgetPress();
    if (button == 0) m_captionPressed = doubleClick ? nullptr : hwnd;
    if (!entry->captionBand) return;
    if (doubleClick) LaunchLog::Write(L"window", std::wstring(L"double click on the title band of ").append(Paths::Wide(entry->id)).append(L", through Windows"));
    EmitCaptionPress(*entry, button, ScreenPointOf(lParam));
  }

  void EmitCaptionPress(ManagedWindow &entry, int button, POINT screen) noexcept {
    if (!m_context) return;
    POINT point = screen;
    if (!ScreenToClient(entry.hwnd, &point)) return;
    std::optional<int64_t> rootTag = RootTagOf(entry);
    if (!rootTag) return;
    double scale = Scale(entry.hwnd);
    winrt::Microsoft::ReactNative::JSValueObject event;
    event["rootTag"] = *rootTag;
    event["button"] = button;
    event["x"] = point.x / scale;
    event["y"] = point.y / scale;
    event["shiftKey"] = (GetKeyState(VK_SHIFT) & 0x8000) != 0;
    event["ctrlKey"] = (GetKeyState(VK_CONTROL) & 0x8000) != 0;
    event["altKey"] = (GetKeyState(VK_MENU) & 0x8000) != 0;
    EmitEvent(m_context, L"ArdiaAppWindows", L"onCaptionPress", std::move(event));
  }

  void SystemMoveBegan(HWND hwnd) noexcept {
    if (m_captionPressed != hwnd) return;
    m_captionPressed = nullptr;
    ManagedWindow *entry = FindByHwnd(hwnd);
    if (entry) LaunchLog::Write(L"window", std::wstring(L"system move began on ").append(Paths::Wide(entry->id)));
  }

  void EmitWindow(winrt::Microsoft::ReactNative::JSValueObject &&event) noexcept {
    if (m_context) EmitEvent(m_context, L"ArdiaAppWindows", L"onWindowEvent", std::move(event));
  }

  void EmitApp(const char *type) noexcept {
    if (!m_context) return;
    winrt::Microsoft::ReactNative::JSValueObject event;
    event["type"] = type;
    EmitEvent(m_context, L"ArdiaShell", L"onAppEvent", std::move(event));
  }

  template <class TWork>
  void After(std::chrono::milliseconds delay, TWork &&work) noexcept {
    try {
      auto timer = Host::Current()->queue.DispatcherQueue().CreateTimer();
      timer.Interval(delay);
      timer.IsRepeating(false);
      auto token = std::make_shared<winrt::event_token>();
      *token = timer.Tick([timer, token, work = std::forward<TWork>(work)](auto const &, auto const &) mutable noexcept {
        timer.Stop();
        work();
        timer.Tick(*token);
      });
      timer.Start();
    } catch (...) {
    }
  }

  static std::chrono::milliseconds EntranceOf(ManagedWindow const &entry) noexcept {
    return entry.kind == "small" ? WindowMotion::kSmallEntrance : WindowMotion::kMainEntrance;
  }

  static std::chrono::milliseconds ExitOf(ManagedWindow const &entry) noexcept {
    return entry.kind == "small" ? WindowMotion::kSmallExit : WindowMotion::kMainExit;
  }

  static const char *PhaseName(WindowFade const *fade) noexcept {
    if (!fade) return "none";
    switch (fade->phase) {
      case WindowFade::Phase::Revealing:
        return "revealing";
      case WindowFade::Phase::Entering:
        return "entering";
      case WindowFade::Phase::Leaving:
        return "leaving";
      case WindowFade::Phase::Lingering:
        return "lingering";
    }
    return "none";
  }

  static void LogFade(std::string_view id, std::wstring_view what) noexcept {
    LaunchLog::Write(L"window", std::wstring(L"window ").append(Paths::Wide(id)).append(what));
  }

  static const wchar_t *HideAtOnceReason(ManagedWindow const &entry) noexcept {
    if (!IsWindowVisible(entry.hwnd)) return L"not shown";
    if (IsIconic(entry.hwnd)) return L"minimized";
    if (entry.fullScreen) return L"full screen";
    if (entry.fade && entry.fade->phase == WindowFade::Phase::Revealing) return L"not revealed yet";
    if (!WindowMotion::SystemAnimates()) return L"animations are off in Windows";
    return nullptr;
  }

  static bool HasContent(ManagedWindow const &entry) noexcept {
    try {
      auto root = entry.window.ReactNativeIsland().RootVisual().try_as<winrt::Microsoft::UI::Composition::ContainerVisual>();
      if (!root) return true;
      for (auto const &child : root.Children()) {
        auto container = child.try_as<winrt::Microsoft::UI::Composition::ContainerVisual>();
        if (container && container.Children().Count() > 0) return true;
      }
      return false;
    } catch (...) {
      return true;
    }
  }

  static void HoldOpacity(WindowFade &fade, bool owner, bool clickThrough) noexcept {
    BYTE alpha = WindowMotion::Alpha(fade.opacity);
    fade.layered.ReleaseDeparted(fade.hwnd);
    if (owner) fade.layered.Hold(fade.hwnd, alpha, clickThrough);
    for (HWND owned : LayeredWindows::VisibleOwnedBy(fade.hwnd)) fade.layered.Hold(owned, alpha, clickThrough);
  }

  static void RunExits(ManagedWindow &entry) noexcept {
    auto exits = std::move(entry.exits);
    entry.exits.clear();
    for (auto &exit : exits) exit();
  }

  static void RunRevealWaiters(ManagedWindow &entry) noexcept {
    auto waiters = std::move(entry.revealWaiters);
    entry.revealWaiters.clear();
    for (auto &waiter : waiters) waiter();
  }

  void WhenRevealed(std::string const &id, std::function<void()> then) noexcept {
    ManagedWindow *entry = Find(id);
    if (!entry || !entry->fade || entry->fade->phase != WindowFade::Phase::Revealing) return then();
    entry->revealWaiters.push_back(std::move(then));
  }

  bool StartFadeTimer(std::string const &id, std::shared_ptr<WindowFade> const &fade) noexcept {
    try {
      auto timer = Host::Current()->queue.DispatcherQueue().CreateTimer();
      timer.Interval(WindowMotion::kStep);
      timer.IsRepeating(true);
      std::weak_ptr<WindowFade> weak = fade;
      fade->tick = timer.Tick([this, id, weak](auto const &, auto const &) noexcept {
        if (auto stepping = weak.lock()) StepFade(id, stepping);
      });
      fade->timer = timer;
      timer.Start();
      return true;
    } catch (...) {
      fade->StopTimer();
      return false;
    }
  }

  void BeginEntrance(ManagedWindow &entry) noexcept {
    auto fade = std::make_shared<WindowFade>();
    fade->phase = WindowFade::Phase::Revealing;
    fade->hwnd = entry.hwnd;
    fade->opacity = 0;
    fade->started = std::chrono::steady_clock::now();
    fade->layered.Hold(entry.hwnd, 0, false);
    entry.fade = fade;
    if (StartFadeTimer(entry.id, fade)) return;
    entry.fade.reset();
    LogFade(entry.id, L" shown at once: no timer");
  }

  void Reveal(ManagedWindow &entry) noexcept {
    WindowFade &fade = *entry.fade;
    fade.phase = WindowFade::Phase::Entering;
    fade.from = 0;
    fade.opacity = 0;
    fade.started = std::chrono::steady_clock::now();
    fade.duration = EntranceOf(entry);
    HoldOpacity(fade, true, false);
    LogFade(entry.id, std::wstring(L" fades in over ")
                          .append(std::to_wstring(fade.duration.count()))
                          .append(L" ms with ")
                          .append(std::to_wstring(fade.layered.OwnedCount(fade.hwnd)))
                          .append(L" page windows"));
    RunRevealWaiters(entry);
  }

  void StartLeaving(ManagedWindow &entry) noexcept {
    if (!entry.fade) {
      auto fade = std::make_shared<WindowFade>();
      fade->hwnd = entry.hwnd;
      fade->opacity = 1;
      entry.fade = fade;
      if (!StartFadeTimer(entry.id, fade)) {
        entry.fade.reset();
        HideNow(entry, L"no timer");
        return RunExits(entry);
      }
    }
    WindowFade &fade = *entry.fade;
    fade.phase = WindowFade::Phase::Leaving;
    fade.from = fade.opacity;
    fade.started = std::chrono::steady_clock::now();
    fade.duration = ExitOf(entry);
    HoldOpacity(fade, true, true);
    LogFade(entry.id, std::wstring(L" fades out over ").append(std::to_wstring(fade.duration.count())).append(L" ms"));
  }

  static void EndFade(ManagedWindow &entry) noexcept {
    auto fade = std::move(entry.fade);
    entry.fade = nullptr;
    if (!fade) return;
    fade->StopTimer();
    fade->layered.ReleaseAll();
  }

  void HideAndLinger(ManagedWindow &entry) noexcept {
    try {
      entry.appWindow.Hide();
    } catch (...) {
    }
    if (!entry.fade) return;
    WindowFade &fade = *entry.fade;
    bool wasRevealing = fade.phase == WindowFade::Phase::Revealing;
    fade.opacity = 0;
    HoldOpacity(fade, false, true);
    fade.layered.Release(fade.hwnd);
    if (fade.layered.OwnedCount(fade.hwnd) == 0) {
      EndFade(entry);
    } else {
      fade.phase = WindowFade::Phase::Lingering;
      fade.started = std::chrono::steady_clock::now();
    }
    if (wasRevealing) RunRevealWaiters(entry);
  }

  void HideNow(ManagedWindow &entry, std::wstring_view reason) noexcept {
    HideAndLinger(entry);
    LogFade(entry.id, std::wstring(L" hidden at once: ").append(reason));
  }

  void StopClosing(ManagedWindow &entry) noexcept {
    entry.closeGeneration++;
    bool leaving = entry.fade && (entry.fade->phase == WindowFade::Phase::Leaving || entry.fade->phase == WindowFade::Phase::Lingering);
    if (leaving) EndFade(entry);
    if (leaving || !entry.exits.empty()) LogFade(entry.id, L" close stopped");
    RunExits(entry);
  }

  void StepFade(std::string const &id, std::shared_ptr<WindowFade> const &fade) noexcept {
    ManagedWindow *entry = Find(id);
    if (!entry || entry->fade != fade) {
      fade->StopTimer();
      fade->layered.ReleaseAll();
      return;
    }
    auto now = std::chrono::steady_clock::now();
    switch (fade->phase) {
      case WindowFade::Phase::Revealing:
        HoldOpacity(*fade, true, false);
        if (HasContent(*entry) || fade->Elapsed(now) >= WindowMotion::kRevealTimeout) Reveal(*entry);
        return;
      case WindowFade::Phase::Entering: {
        double progress = fade->Progress(now);
        fade->opacity = fade->from + (1.0 - fade->from) * WindowMotion::Eased(progress);
        HoldOpacity(*fade, true, false);
        if (progress < 1) return;
        EndFade(*entry);
        LogFade(id, L" shown");
        return;
      }
      case WindowFade::Phase::Leaving: {
        double progress = fade->Progress(now);
        fade->opacity = fade->from * (1.0 - WindowMotion::Eased(progress));
        HoldOpacity(*fade, true, true);
        if (progress < 1) return;
        HideAndLinger(*entry);
        LogFade(id, L" hidden");
        RunExits(*entry);
        return;
      }
      case WindowFade::Phase::Lingering:
        fade->opacity = 0;
        HoldOpacity(*fade, false, true);
        if (fade->layered.OwnedCount(fade->hwnd) == 0 || fade->Elapsed(now) >= WindowMotion::kLingerLimit) EndFade(*entry);
        return;
    }
  }

  void Finish() noexcept {
    if (m_finished) return;
    m_finished = true;
    LaunchLog::Write(L"launch", L"quitting");
    try {
      auto unloading = Host::Current()->reactHost.UnloadInstance();
      unloading.Completed([](auto const &, auto const &) noexcept {
        Host::Current()->queue.DispatcherQueue().TryEnqueue([]() noexcept { EndLoop(); });
      });
    } catch (...) {
      EndLoop();
    }
  }

  static void EndLoop() noexcept {
    const ArdiaEngineApi *engine = Host::Engine();
    if (!engine) return PostQuitMessage(0);
    LaunchLog::Write(L"launch", L"asking the engine to quit");
    engine->hostCall("app.quit", "{}", 0, nullptr, nullptr);
  }

  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
  winrt::Microsoft::ReactNative::ReactNativeWindow m_spare{nullptr};
  std::map<std::string, ManagedWindow> m_windows;
  std::map<std::string, std::vector<std::array<double, 4>>> m_captionRegions;
  std::map<std::string, EdgeWatch> m_edgeWatches;
  winrt::Microsoft::UI::Dispatching::DispatcherQueueTimer m_edgeTimer{nullptr};
  winrt::event_token m_edgeTick{};
  std::vector<std::string> m_order;
  std::string m_activeId;
  bool m_quitting{false};
  bool m_dark{false};
  bool m_systemMove{false};
  bool m_tracking{false};
  bool m_dragFromMaximized{false};
  bool m_dragMoved{false};
  HWND m_captionPressed{nullptr};
  HWND m_lastPressHwnd{nullptr};
  DWORD m_lastPressAt{0};
  POINT m_lastPressWhere{};
  POINT m_dragCursor{};
  winrt::Windows::Graphics::PointInt32 m_dragOrigin{};
  std::string m_dragId;
  int m_quitGeneration{0};
  bool m_finished{false};
};

}
