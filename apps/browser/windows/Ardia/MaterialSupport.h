#pragma once

#include <commctrl.h>
#include <dwmapi.h>
#include <uxtheme.h>
#include <winrt/Microsoft.UI.Content.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <string_view>

#include "LaunchLog.h"
#include "Paths.h"
#include "WindowManager.h"

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "gdi32.lib")

namespace Ardia::Materials {

constexpr DWORD SystemBackdropAttribute = 38;
constexpr DWORD BackdropNone = 1;
constexpr DWORD BackdropMica = 2;
constexpr DWORD BackdropAcrylic = 3;
constexpr DWORD BackdropMicaAlt = 4;
constexpr DWORD FirstSystemBackdropBuild = 22621;
constexpr DWORD FirstBackdropBrushBuild = 17763;
constexpr UINT_PTR EraseSubclassId = 0xA2D1B;

inline DWORD BuildNumber() noexcept {
  static const DWORD build = []() noexcept -> DWORD {
    using RtlGetVersionFunction = LONG(WINAPI *)(OSVERSIONINFOW *);
    HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
    if (!ntdll) return 0;
    auto getVersion = reinterpret_cast<RtlGetVersionFunction>(reinterpret_cast<void *>(GetProcAddress(ntdll, "RtlGetVersion")));
    if (!getVersion) return 0;
    OSVERSIONINFOW version{};
    version.dwOSVersionInfoSize = sizeof(version);
    if (getVersion(&version) != 0) return 0;
    return version.dwBuildNumber;
  }();
  return build;
}

inline bool Background() noexcept {
  static const bool background = Paths::Environment(L"ARDIA_BACKGROUND") == L"1";
  return background;
}

inline bool SystemBackdropSupported() noexcept {
  return BuildNumber() >= FirstSystemBackdropBuild;
}

inline bool SystemBackdropAvailable() noexcept {
  return SystemBackdropSupported() && !Background();
}

inline bool &BlurFailed() noexcept {
  static bool failed = false;
  return failed;
}

inline bool &GradientFailed() noexcept {
  static bool failed = false;
  return failed;
}

inline bool BlurAvailable() noexcept {
  return BuildNumber() >= FirstBackdropBrushBuild && !BlurFailed();
}

inline bool GradientAvailable() noexcept {
  return !GradientFailed();
}

inline void NoteOnce(std::wstring_view key, std::wstring_view message) noexcept {
  static std::mutex mutex;
  static std::set<std::wstring> noted;
  {
    std::scoped_lock lock{mutex};
    if (!noted.emplace(key).second) return;
  }
  LaunchLog::Write(L"info", std::wstring{L"materials: "}.append(message));
}

inline std::wstring HexOf(HRESULT result) noexcept {
  wchar_t text[16]{};
  swprintf_s(text, L"0x%08X", static_cast<unsigned int>(result));
  return text;
}

inline std::wstring Described(winrt::hresult_error const &error) noexcept {
  return HexOf(error.code()).append(L" ").append(error.message());
}

inline DWORD BackdropType(std::string_view material) noexcept {
  if (material == "mica") return BackdropMica;
  if (material == "acrylic") return BackdropAcrylic;
  return BackdropMicaAlt;
}

inline const wchar_t *BackdropName(DWORD type) noexcept {
  switch (type) {
    case BackdropMica:
      return L"mica";
    case BackdropAcrylic:
      return L"acrylic";
    case BackdropMicaAlt:
      return L"micaAlt";
    default:
      return L"flat";
  }
}

struct BackdropHold {
  int count{0};
  DWORD type{BackdropNone};
};

inline std::map<HWND, BackdropHold> &Holds() noexcept {
  static std::map<HWND, BackdropHold> holds;
  return holds;
}

inline LRESULT CALLBACK EraseBlack(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR, DWORD_PTR) noexcept {
  if (message == WM_ERASEBKGND) {
    RECT client{};
    if (wParam && GetClientRect(hwnd, &client)) FillRect(reinterpret_cast<HDC>(wParam), &client, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
    return 1;
  }
  return DefSubclassProc(hwnd, message, wParam, lParam);
}

inline HRESULT SetSystemBackdrop(HWND hwnd, DWORD type) noexcept {
  return DwmSetWindowAttribute(hwnd, SystemBackdropAttribute, &type, sizeof(type));
}

inline void ForgetClosedWindows() noexcept {
  auto &holds = Holds();
  for (auto it = holds.begin(); it != holds.end();) {
    if (IsWindow(it->first)) ++it;
    else it = holds.erase(it);
  }
}

struct HoldResult {
  bool held{false};
  std::wstring reason;
};

inline HoldResult Hold(HWND hwnd, DWORD type) noexcept {
  ForgetClosedWindows();
  if (!hwnd || !IsWindow(hwnd)) return {false, L"no window"};
  if (Background()) return {false, L"background instance"};
  if (!SystemBackdropSupported()) return {false, std::wstring{L"Windows build "}.append(std::to_wstring(BuildNumber())).append(L" is older than 22621")};
  auto &holds = Holds();
  auto found = holds.find(hwnd);
  if (found != holds.end() && found->second.type == type) {
    found->second.count++;
    return {true, {}};
  }
  const bool first = found == holds.end();
  MARGINS everywhere{-1, -1, -1, -1};
  const HRESULT extended = DwmExtendFrameIntoClientArea(hwnd, &everywhere);
  const HRESULT set = SetSystemBackdrop(hwnd, type);
  if (FAILED(set)) {
    if (first) {
      MARGINS none{0, 0, 0, 0};
      DwmExtendFrameIntoClientArea(hwnd, &none);
    }
    return {false, std::wstring{L"DwmSetWindowAttribute(38) failed with "}.append(HexOf(set))};
  }
  if (first) {
    SetWindowSubclass(hwnd, &EraseBlack, EraseSubclassId, 0);
    holds.emplace(hwnd, BackdropHold{1, type});
  } else {
    found->second.count++;
    found->second.type = type;
  }
  InvalidateRect(hwnd, nullptr, TRUE);
  if (FAILED(extended)) return {true, std::wstring{L"frame not extended: "}.append(HexOf(extended))};
  return {true, {}};
}

inline void Release(HWND hwnd) noexcept {
  auto &holds = Holds();
  auto found = holds.find(hwnd);
  if (found == holds.end()) return;
  if (--found->second.count > 0) return;
  holds.erase(found);
  if (!IsWindow(hwnd)) return;
  SetSystemBackdrop(hwnd, BackdropNone);
  MARGINS none{0, 0, 0, 0};
  DwmExtendFrameIntoClientArea(hwnd, &none);
  RemoveWindowSubclass(hwnd, &EraseBlack, EraseSubclassId);
  InvalidateRect(hwnd, nullptr, TRUE);
}

struct FoundWindow {
  HWND hwnd{nullptr};
  const wchar_t *route{L"none"};
};

inline FoundWindow WindowOfView(winrt::Microsoft::ReactNative::ComponentView const &view) noexcept {
  try {
    auto root = view.as<winrt::Microsoft::ReactNative::Composition::ComponentView>().Root();
    if (root) {
      auto island = root.ReactNativeIsland();
      if (island) {
        auto content = island.Island();
        if (content) {
          HWND hwnd = winrt::Microsoft::UI::GetWindowFromWindowId(content.Environment().AppWindowId());
          if (hwnd) return {hwnd, L"island"};
        }
      }
    }
  } catch (...) {
  }
  auto &windows = WindowManager::Shared();
  auto ids = windows.Ids();
  if (ids.size() == 1) return {windows.Hwnd(ids.front()), L"only window"};
  return {};
}

inline bool CoversRoot(winrt::Microsoft::ReactNative::ComponentView const &view) noexcept {
  try {
    auto root = view.as<winrt::Microsoft::ReactNative::Composition::ComponentView>().Root();
    if (!root) return false;
    const int rootTag = root.Tag();
    const auto rootFrame = root.LayoutMetrics().Frame;
    const auto own = view.LayoutMetrics().Frame;
    float x = 0;
    float y = 0;
    winrt::Microsoft::ReactNative::ComponentView current = view;
    while (current && current.Tag() != rootTag) {
      const auto frame = current.LayoutMetrics().Frame;
      x += frame.X;
      y += frame.Y;
      current = current.Parent();
    }
    constexpr float slack = 1.5f;
    return own.Width > 0 && own.Height > 0 && x <= slack && y <= slack && x + own.Width >= rootFrame.Width - slack &&
        y + own.Height >= rootFrame.Height - slack;
  } catch (...) {
    return false;
  }
}

inline winrt::Windows::UI::Color ColorFromUnit(float r, float g, float b, float a) noexcept {
  auto channel = [](float value) noexcept {
    const float clamped = std::isfinite(value) ? (std::min)(1.0f, (std::max)(0.0f, value)) : 0.0f;
    return static_cast<uint8_t>(std::lround(clamped * 255.0f));
  };
  return winrt::Windows::UI::Color{channel(a), channel(r), channel(g), channel(b)};
}

}
