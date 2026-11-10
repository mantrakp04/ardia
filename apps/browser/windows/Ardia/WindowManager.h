#pragma once

#include <array>
#include <chrono>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <commctrl.h>
#include <dwmapi.h>
#include <winrt/Microsoft.UI.Input.h>
#include <winrt/Windows.Graphics.h>
#include <winrt/Windows.UI.h>

#include "Events.h"
#include "Host.h"
#include "LaunchLog.h"
#include "Paths.h"

#pragma comment(lib, "dwmapi.lib")

namespace Ardia {

struct OpenWindowRequest {
  std::string id;
  std::string kind{"browser"};
  std::string title;
  std::optional<std::array<double, 4>> frame;
  std::optional<std::array<double, 2>> size;
  bool focus{true};
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

  static bool Background() noexcept {
    static const bool background = Paths::Environment(L"ARDIA_BACKGROUND") == L"1";
    return background;
  }

  void Open(OpenWindowRequest const &request) noexcept {
    if (Find(request.id)) {
      if (request.focus) Focus(request.id);
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
      PassTitleBarInputToContent(entry);

      bool activate = request.focus && !Background();
      HWND hwnd = entry.hwnd;
      auto appWindow = entry.appWindow;
      m_order.push_back(entry.id);
      m_windows.emplace(entry.id, std::move(entry));
      appWindow.Show(activate);
      if (activate) SetForegroundWindow(hwnd);
      if (m_activeId.empty()) m_activeId = request.id;
      LaunchLog::Write(L"window", std::wstring(L"opened ").append(Paths::Wide(request.id)));
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

  void Hide(std::string_view id) noexcept {
    ManagedWindow *entry = Find(id);
    if (!entry) return;
    try {
      entry->appWindow.Hide();
    } catch (...) {
    }
  }

  void Focus(std::string_view id) noexcept {
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

  void SetDark(bool dark) noexcept {
    m_dark = dark;
    for (auto &[id, entry] : m_windows) ApplyTheme(entry, dark);
  }

  void BeginDrag(int64_t rootTag) noexcept {
    ManagedWindow *entry = ForRootTag(rootTag);
    if (!entry || Background()) return;
    POINT cursor{};
    GetCursorPos(&cursor);
    try {
      m_dragOrigin = entry->appWindow.Position();
    } catch (...) {
      return;
    }
    m_dragCursor = cursor;
    m_dragId = entry->id;
    LaunchLog::Write(L"window", std::wstring(L"drag began on ").append(Paths::Wide(entry->id)));
    TrackDrag();
  }

  void ToggleMaximize(int64_t rootTag) noexcept {
    ManagedWindow *entry = ForRootTag(rootTag);
    if (!entry) return;
    try {
      auto presenter = entry->appWindow.Presenter().try_as<winrt::Microsoft::UI::Windowing::OverlappedPresenter>();
      if (!presenter) return;
      if (presenter.State() == winrt::Microsoft::UI::Windowing::OverlappedPresenterState::Maximized) presenter.Restore();
      else presenter.Maximize();
    } catch (...) {
    }
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
      auto position = entry.appWindow.Position();
      auto size = entry.appWindow.Size();
      return {position.X / scale, position.Y / scale, size.Width / scale, size.Height / scale};
    } catch (...) {
      return {0, 0, 0, 0};
    }
  }

  static void Configure(ManagedWindow &entry, OpenWindowRequest const &request) noexcept {
    try {
      entry.appWindow.Title(winrt::to_hstring(request.title.empty() ? std::string{"Ardia"} : request.title));
      auto presenter = entry.appWindow.Presenter().try_as<winrt::Microsoft::UI::Windowing::OverlappedPresenter>();
      double scale = Scale(entry.hwnd);
      auto pixels = [scale](double points) noexcept { return static_cast<int32_t>(points * scale + 0.5); };
      if (entry.IsBrowser()) {
        auto titleBar = entry.appWindow.TitleBar();
        titleBar.ExtendsContentIntoTitleBar(true);
        titleBar.PreferredHeightOption(winrt::Microsoft::UI::Windowing::TitleBarHeightOption::Standard);
        titleBar.ButtonBackgroundColor(winrt::Windows::UI::Color{0, 0, 0, 0});
        titleBar.ButtonInactiveBackgroundColor(winrt::Windows::UI::Color{0, 0, 0, 0});
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
        entry.appWindow.MoveAndResize({pixels(frame[0]), pixels(frame[1]), pixels(frame[2]), pixels(frame[3])});
        double landed = Scale(entry.hwnd);
        if (landed != scale) {
          auto onLanded = [landed](double points) noexcept { return static_cast<int32_t>(points * landed + 0.5); };
          entry.appWindow.MoveAndResize({onLanded(frame[0]), onLanded(frame[1]), onLanded(frame[2]), onLanded(frame[3])});
        }
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
              PassTitleBarInputToContent(*found);
            }
            if (args.DidPresenterChange()) {
              bool fullScreen = found->appWindow.Presenter().Kind() == winrt::Microsoft::UI::Windowing::AppWindowPresenterKind::FullScreen;
              if (fullScreen != found->fullScreen) {
                found->fullScreen = fullScreen;
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
    m_windows.erase(found);
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

  void TrackDrag() noexcept {
    if (m_systemMove || m_tracking || !LeftButtonDown()) return;
    ManagedWindow *entry = Find(m_dragId);
    if (!entry) return;
    try {
      auto presenter = entry->appWindow.Presenter().try_as<winrt::Microsoft::UI::Windowing::OverlappedPresenter>();
      if (presenter && presenter.State() != winrt::Microsoft::UI::Windowing::OverlappedPresenterState::Restored) return;
      m_tracking = true;
      auto timer = Host::Current()->queue.DispatcherQueue().CreateTimer();
      timer.Interval(std::chrono::milliseconds(8));
      timer.IsRepeating(true);
      auto token = std::make_shared<winrt::event_token>();
      *token = timer.Tick([this, timer, token](auto const &, auto const &) noexcept {
        ManagedWindow *moving = Find(m_dragId);
        bool cancelled = (GetAsyncKeyState(VK_ESCAPE) & 0x8000) != 0;
        if (moving && cancelled) {
          try {
            moving->appWindow.Move(m_dragOrigin);
          } catch (...) {
          }
        }
        if (moving && !cancelled && LeftButtonDown() && !m_systemMove) {
          POINT now{};
          GetCursorPos(&now);
          try {
            moving->appWindow.Move({m_dragOrigin.X + now.x - m_dragCursor.x, m_dragOrigin.Y + now.y - m_dragCursor.y});
          } catch (...) {
          }
          return;
        }
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
    if (message == WM_ENTERSIZEMOVE) manager->m_systemMove = true;
    if (message == WM_EXITSIZEMOVE) manager->m_systemMove = false;
    if (message == WM_ACTIVATE && LOWORD(wParam) != WA_INACTIVE) manager->Activated(hwnd);
    if (message == WM_ACTIVATEAPP && wParam == FALSE) manager->EmitApp("resignActive");
    return DefSubclassProc(hwnd, message, wParam, lParam);
  }

  static void PassTitleBarInputToContent(ManagedWindow &entry) noexcept {
    if (!entry.IsBrowser()) return;
    try {
      auto titleBar = entry.appWindow.TitleBar();
      auto client = entry.appWindow.ClientSize();
      int32_t width = client.Width - titleBar.RightInset();
      int32_t height = titleBar.Height();
      if (width <= 0 || height <= 0) return;
      std::vector<winrt::Windows::Graphics::RectInt32> rects{{titleBar.LeftInset(), 0, width - titleBar.LeftInset(), height}};
      auto source = winrt::Microsoft::UI::Input::InputNonClientPointerSource::GetForWindowId(entry.appWindow.Id());
      source.SetRegionRects(winrt::Microsoft::UI::Input::NonClientRegionKind::Passthrough, rects);
    } catch (...) {
    }
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

  void Finish() noexcept {
    if (m_finished) return;
    m_finished = true;
    LaunchLog::Write(L"launch", L"quitting");
    try {
      auto unloading = Host::Current()->reactHost.UnloadInstance();
      unloading.Completed([](auto const &, auto const &) noexcept {
        Host::Current()->queue.DispatcherQueue().TryEnqueue([]() noexcept { PostQuitMessage(0); });
      });
    } catch (...) {
      PostQuitMessage(0);
    }
  }

  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
  winrt::Microsoft::ReactNative::ReactNativeWindow m_spare{nullptr};
  std::map<std::string, ManagedWindow> m_windows;
  std::vector<std::string> m_order;
  std::string m_activeId;
  bool m_quitting{false};
  bool m_dark{false};
  bool m_systemMove{false};
  bool m_tracking{false};
  POINT m_dragCursor{};
  winrt::Windows::Graphics::PointInt32 m_dragOrigin{};
  std::string m_dragId;
  int m_quitGeneration{0};
  bool m_finished{false};
};

}
