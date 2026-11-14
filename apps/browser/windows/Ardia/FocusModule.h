#pragma once

#include <mutex>
#include <optional>
#include <string>
#include <string_view>

#include "NativeModules.h"
#include "Events.h"
#include "MenuKeyboard.h"

#pragma comment(lib, "user32.lib")

namespace Ardia {

struct SwitcherPointer {
  std::mutex lock;
  std::optional<POINT> origin;
  bool hasMoved = false;

  static SwitcherPointer &Shared() noexcept {
    static SwitcherPointer *shared = new SwitcherPointer();
    return *shared;
  }

  static std::optional<POINT> Cursor() noexcept {
    POINT point{};
    if (!GetCursorPos(&point)) return std::nullopt;
    return point;
  }

  void Start(bool active) noexcept {
    std::optional<POINT> start = active ? Cursor() : std::nullopt;
    std::scoped_lock guard{lock};
    origin = start;
    hasMoved = false;
  }

  bool Moved() noexcept {
    std::optional<POINT> now = Cursor();
    std::scoped_lock guard{lock};
    if (!origin || !now) return true;
    if (now->x != origin->x || now->y != origin->y) hasMoved = true;
    return hasMoved;
  }
};

struct KeyboardHandoff {
  static bool OursInFront() noexcept {
    HWND front = GetForegroundWindow();
    DWORD process = 0;
    return front && GetWindowThreadProcessId(front, &process) && process == GetCurrentProcessId();
  }

  static bool PageWindow(HWND window) noexcept {
    wchar_t name[16] = {};
    return window && GetClassNameW(window, name, 16) >= 7 && std::wstring_view(name, 7) == L"Chrome_";
  }

  static bool FromPage(std::string const &windowId) noexcept {
    if (windowId.empty() || WindowManager::Background() || !OursInFront()) return false;
    HWND app = WindowManager::Shared().Hwnd(windowId);
    HWND focus = GetFocus();
    HWND page = focus ? GetAncestor(focus, GA_ROOT) : nullptr;
    if (!app || !PageWindow(page) || GetWindow(page, GW_OWNER) != app) return false;
    SetActiveWindow(app);
    LaunchLog::Write(L"keys", L"an app field took the keyboard from a page");
    return GetActiveWindow() == app;
  }
};

REACT_MODULE(FocusModule, L"ArdiaFocus")
struct FocusModule {
  using DonePromise = winrt::Microsoft::ReactNative::ReactPromise<void>;

  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
  }

  REACT_METHOD(setDragEscapeCapture)
  void setDragEscapeCapture(bool active, DonePromise promise) noexcept {
    RunOnUI(m_context, [active, promise]() noexcept {
      Menus::MenuKeyboard::Shared().SetEscapeCapture(active);
      promise.Resolve();
    });
  }

  REACT_METHOD(setSwitcherCapture)
  void setSwitcherCapture(bool active, DonePromise promise) noexcept {
    SwitcherPointer::Shared().Start(active);
    RunOnUI(m_context, [active, promise]() noexcept {
      Menus::MenuKeyboard::Shared().SetSwitcherCapture(active);
      promise.Resolve();
    });
  }

  REACT_METHOD(setTextInputFocused)
  void setTextInputFocused(bool focused, DonePromise promise) noexcept {
    Menus::MenuKeyboard::Shared().textInputFocused.store(focused);
    promise.Resolve();
  }

  REACT_METHOD(takeKeyboardFromPage)
  void takeKeyboardFromPage(std::string windowId, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    RunOnUI(m_context, [windowId, promise]() noexcept { promise.Resolve(KeyboardHandoff::FromPage(windowId)); });
  }

  REACT_SYNC_METHOD(textInputFocused)
  bool textInputFocused() noexcept {
    return Menus::MenuKeyboard::Shared().textInputFocused.load();
  }

  REACT_SYNC_METHOD(switcherPointerMoved)
  bool switcherPointerMoved() noexcept {
    return SwitcherPointer::Shared().Moved();
  }

  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
};

}
