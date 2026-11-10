#pragma once

#include <optional>
#include <set>
#include <string>
#include <utility>

#include "Events.h"
#include "LaunchLog.h"
#include "MenuKeys.h"
#include "MenuPopup.h"
#include "MenuStore.h"
#include "NativeModules.h"
#include "Paths.h"
#include "WindowManager.h"

namespace Ardia::Menus {

struct ActiveWindow {
  HWND hwnd = nullptr;
  std::string id;
};

inline ActiveWindow ActiveArdiaWindow() noexcept {
  HWND active = GetActiveWindow();
  if (!active) return {};
  HWND root = GetAncestor(active, GA_ROOT);
  WindowManager &manager = WindowManager::Shared();
  for (std::string const &id : manager.Ids()) {
    HWND hwnd = manager.Hwnd(id);
    if (hwnd && GetAncestor(hwnd, GA_ROOT) == root) return {hwnd, id};
  }
  return {};
}

inline HWND MenuOwnerWindow() noexcept {
  if (HWND active = ActiveArdiaWindow().hwnd) return active;
  return WindowManager::Shared().ActiveHwnd();
}

struct MenuKeyboard {
  winrt::Microsoft::ReactNative::ReactContext context{nullptr};
  HHOOK keyboardHook = nullptr;
  HHOOK mouseHook = nullptr;
  bool trackingMenu = false;
  unsigned switcherHeld = 0;
  bool consumedWithAlt = false;
  std::set<UINT> swallowedKeyUps;
  std::optional<winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue>> recording;

  static MenuKeyboard &Shared() noexcept {
    static MenuKeyboard *shared = new MenuKeyboard();
    return *shared;
  }

  void Install() noexcept {
    if (keyboardHook) return;
    keyboardHook = SetWindowsHookExW(WH_KEYBOARD, &MenuKeyboard::KeyboardProc, nullptr, GetCurrentThreadId());
    if (!keyboardHook) LaunchLog::Write(L"error", L"menus: the keyboard hook could not be installed");
  }

  static bool Background() noexcept {
    return WindowManager::Background();
  }

  void Emit(std::string const &command, std::optional<std::string> const &arg, std::string const &windowId) noexcept {
    using winrt::Microsoft::ReactNative::JSValue;
    using winrt::Microsoft::ReactNative::JSValueObject;
    JSValueObject payload;
    payload["command"] = JSValue{std::string{command}};
    payload["arg"] = arg ? JSValue{std::string{*arg}} : JSValue{nullptr};
    payload["windowId"] = windowId.empty() ? JSValue{nullptr} : JSValue{std::string{windowId}};
    payload["focusGeneration"] = JSValue{nullptr};
    EmitEvent(context, L"ArdiaMenus", L"onCommand", std::move(payload));
  }

  void EmitSwitcherReleased() noexcept {
    EmitEvent(context, L"ArdiaShell", L"onAppEvent", winrt::Microsoft::ReactNative::JSValueObject{{"type", "switcherReleased"}});
  }

  static unsigned HeldModifiersOf(Combo const &combo) noexcept {
    unsigned held = combo.modifiers & (ModifierControl | ModifierOption | ModifierCommand);
    return held ? held : static_cast<unsigned>(combo.modifiers & ModifierShift);
  }

  void OpenedSwitcher(CommandEntry const &entry, KeyPress const &press) noexcept {
    unsigned held = 0;
    for (Combo const &combo : entry.active) {
      if (Matches(combo, press)) {
        held = HeldModifiersOf(combo);
        break;
      }
    }
    switcherHeld = held && (press.modifiers & held) == held ? held : 0;
    if (!switcherHeld && context) RunOnUI(context, []() noexcept { Shared().EmitSwitcherReleased(); });
  }

  void ModifiersChanged(unsigned modifiers) noexcept {
    if (!switcherHeld || (modifiers & switcherHeld) == switcherHeld) return;
    switcherHeld = 0;
    EmitSwitcherReleased();
  }

  static bool NativeActionAvailable(std::string_view id, ActiveWindow const &window) noexcept {
    if (id == "std:miniaturizeAll:") return !WindowManager::Shared().Ids().empty();
    return window.hwnd != nullptr;
  }

  static void Minimize(HWND hwnd) noexcept {
    if (hwnd && IsWindowVisible(hwnd)) ShowWindow(hwnd, SW_MINIMIZE);
  }

  void PerformNative(std::string_view id, ActiveWindow const &window) noexcept {
    if (Background() && id != "std:closeWindow:" && id != "std:toggleKeepOnTop:") {
      LogActivation(std::string{id.substr(4)} + " (acted out)");
      return;
    }
    HWND hwnd = window.hwnd;
    if (id == "std:closeWindow:") {
      if (hwnd) PostMessageW(hwnd, WM_CLOSE, 0, 0);
    } else if (id == "std:toggleFullScreen:") {
      if (!hwnd) return;
      try {
        using winrt::Microsoft::UI::Windowing::AppWindow;
        using winrt::Microsoft::UI::Windowing::AppWindowPresenterKind;
        AppWindow appWindow = AppWindow::GetFromWindowId(winrt::Microsoft::UI::GetWindowIdFromWindow(hwnd));
        if (!appWindow) return;
        bool fullScreen = appWindow.Presenter().Kind() == AppWindowPresenterKind::FullScreen;
        appWindow.SetPresenter(fullScreen ? AppWindowPresenterKind::Overlapped : AppWindowPresenterKind::FullScreen);
      } catch (...) {
        LaunchLog::Write(L"error", L"menus: full screen could not be toggled");
      }
    } else if (id == "std:performMiniaturize:") {
      Minimize(hwnd);
    } else if (id == "std:miniaturizeAll:") {
      WindowManager &manager = WindowManager::Shared();
      for (std::string const &windowId : manager.Ids()) Minimize(manager.Hwnd(windowId));
    } else if (id == "std:performZoom:") {
      if (hwnd && IsWindowVisible(hwnd)) ShowWindow(hwnd, IsZoomed(hwnd) ? SW_RESTORE : SW_MAXIMIZE);
    } else if (id == "std:toggleKeepOnTop:") {
      if (!hwnd) return;
      bool topmost = (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0;
      SetWindowPos(hwnd, topmost ? HWND_NOTOPMOST : HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
    }
  }

  bool Dispatch(KeyPress const &press) noexcept {
    MenuStore &store = MenuStore::Shared();
    CommandEntry const *entry = store.Match(press);
    if (!entry) return false;
    ActiveWindow window = ActiveArdiaWindow();
    if (entry->Native()) {
      if (!NativeActionAvailable(entry->id, window)) return false;
      PerformNative(entry->id, window);
      return true;
    }
    if (!store.EntryEnabled(*entry)) return false;
    Emit(entry->command, entry->arg, window.id);
    if (entry->command == "tabSwitcher") OpenedSwitcher(*entry, press);
    return true;
  }

  void StartRecording(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> const &promise) noexcept {
    FinishRecording(winrt::Microsoft::ReactNative::JSValue{nullptr});
    recording.emplace(promise);
    if (!mouseHook) mouseHook = SetWindowsHookExW(WH_MOUSE, &MenuKeyboard::MouseProc, nullptr, GetCurrentThreadId());
  }

  void FinishRecording(winrt::Microsoft::ReactNative::JSValue &&result) noexcept {
    if (mouseHook) {
      UnhookWindowsHookEx(mouseHook);
      mouseHook = nullptr;
    }
    if (!recording) return;
    auto pending = *recording;
    recording.reset();
    pending.Resolve(result);
  }

  bool Record(KeyPress const &press) noexcept {
    using winrt::Microsoft::ReactNative::JSValue;
    using winrt::Microsoft::ReactNative::JSValueArray;
    using winrt::Microsoft::ReactNative::JSValueObject;
    if (press.virtualKey == VK_ESCAPE && press.modifiers == 0) {
      FinishRecording(JSValue{nullptr});
      return true;
    }
    wchar_t key = RecordedKey(press);
    if (!key) return true;
    bool held = (press.modifiers & (ModifierControl | ModifierOption)) != 0;
    if (!held && !IsFunctionKey(key)) {
      MessageBeep(MB_OK);
      return true;
    }
    JSValueArray modifiers;
    for (unsigned modifier : kModifierOrder) {
      if (press.modifiers & modifier) modifiers.push_back(JSValue{std::string{ModifierNameOf(modifier)}});
    }
    FinishRecording(JSValue{JSValueObject{{"key", Paths::Utf8(std::wstring(1, key))}, {"modifiers", std::move(modifiers)}}});
    return true;
  }

  bool HandleKey(UINT virtualKey, LPARAM flags) noexcept {
    bool keyUp = (flags & (1u << 31)) != 0;
    if (keyUp) {
      if (unsigned released = ModifierOfKey(virtualKey)) ModifiersChanged(static_cast<unsigned>(HeldModifiers() & ~released));
      if (swallowedKeyUps.erase(virtualKey)) return true;
      if ((virtualKey == VK_MENU || virtualKey == VK_LMENU || virtualKey == VK_RMENU) && consumedWithAlt) {
        consumedWithAlt = false;
        return true;
      }
      return false;
    }
    if (IsModifierKey(virtualKey)) return false;
    if (trackingMenu) return false;
    KeyPress press = ReadKeyPress(virtualKey, flags);
    if (press.windowsKey || press.altGraph) return false;
    bool handled = false;
    if (recording) {
      handled = Record(press);
    } else {
      if (!ActiveArdiaWindow().hwnd) return false;
      handled = Dispatch(press);
    }
    if (handled) {
      swallowedKeyUps.insert(virtualKey);
      if (press.modifiers & ModifierOption) consumedWithAlt = true;
    }
    return handled;
  }

  static LRESULT CALLBACK KeyboardProc(int code, WPARAM wParam, LPARAM lParam) noexcept {
    MenuKeyboard &keyboard = Shared();
    if (code == HC_ACTION) {
      bool handled = false;
      try {
        handled = keyboard.HandleKey(static_cast<UINT>(wParam), lParam);
      } catch (...) {
        handled = false;
      }
      if (handled) return 1;
    }
    return CallNextHookEx(keyboard.keyboardHook, code, wParam, lParam);
  }

  static LRESULT CALLBACK MouseProc(int code, WPARAM wParam, LPARAM lParam) noexcept {
    MenuKeyboard &keyboard = Shared();
    if (code == HC_ACTION && keyboard.recording) {
      switch (wParam) {
        case WM_LBUTTONDOWN:
        case WM_RBUTTONDOWN:
        case WM_MBUTTONDOWN:
        case WM_NCLBUTTONDOWN:
        case WM_NCRBUTTONDOWN:
          keyboard.FinishRecording(winrt::Microsoft::ReactNative::JSValue{nullptr});
          break;
        default:
          break;
      }
    }
    return CallNextHookEx(keyboard.mouseHook, code, wParam, lParam);
  }
};

}
