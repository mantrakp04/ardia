#pragma once

#include <atomic>

#include "LaunchLog.h"

namespace Ardia {

struct PointerLatch {
  static constexpr int kLeft = 1;
  static constexpr int kRight = 2;
  static constexpr int kMiddle = 4;
  static constexpr int kShift = 8;
  static constexpr int kControl = 16;
  static constexpr int kAlt = 32;
  static constexpr ULONGLONG kFreshMs = 3000;
  static constexpr int kSamples = 24;

  static void Install() noexcept {
    if (Hook()) return;
    Hook() = SetWindowsHookExW(WH_GETMESSAGE, &PointerLatch::OnMessage, nullptr, GetCurrentThreadId());
    LaunchLog::Write(Hook() ? L"pointer" : L"warning", Hook() ? L"presses are watched on the UI thread" : L"pointer: presses cannot be watched, so right and middle clicks are read late");
  }

  static int State() noexcept {
    ULONGLONG at = LatchedAt().load();
    if (at != 0 && GetTickCount64() - at <= kFreshMs) return Latched().load();
    return Live();
  }

 private:
  static HHOOK &Hook() noexcept {
    static HHOOK hook = nullptr;
    return hook;
  }

  static std::atomic<int> &Latched() noexcept {
    static std::atomic<int> latched{0};
    return latched;
  }

  static std::atomic<ULONGLONG> &LatchedAt() noexcept {
    static std::atomic<ULONGLONG> at{0};
    return at;
  }

  static bool Down(int key) noexcept {
    return (GetAsyncKeyState(key) & 0x8000) != 0;
  }

  static int Modifiers() noexcept {
    int state = 0;
    if (Down(VK_SHIFT)) state |= kShift;
    if (Down(VK_CONTROL)) state |= kControl;
    if (Down(VK_MENU)) state |= kAlt;
    return state;
  }

  static int Live() noexcept {
    const bool swapped = GetSystemMetrics(SM_SWAPBUTTON) != 0;
    int state = Modifiers();
    if (Down(swapped ? VK_RBUTTON : VK_LBUTTON)) state |= kLeft;
    if (Down(swapped ? VK_LBUTTON : VK_RBUTTON)) state |= kRight;
    if (Down(VK_MBUTTON)) state |= kMiddle;
    return state;
  }

  static void Note(UINT message, WPARAM wParam) noexcept {
    int buttons = 0;
    switch (message) {
      case WM_LBUTTONDOWN:
      case WM_NCLBUTTONDOWN:
        buttons = kLeft;
        break;
      case WM_RBUTTONDOWN:
      case WM_NCRBUTTONDOWN:
        buttons = kRight;
        break;
      case WM_MBUTTONDOWN:
      case WM_NCMBUTTONDOWN:
        buttons = kMiddle;
        break;
      case WM_POINTERDOWN:
      case WM_NCPOINTERDOWN:
        if (IS_POINTER_FIRSTBUTTON_WPARAM(wParam)) buttons |= kLeft;
        if (IS_POINTER_SECONDBUTTON_WPARAM(wParam)) buttons |= kRight;
        if (IS_POINTER_THIRDBUTTON_WPARAM(wParam)) buttons |= kMiddle;
        break;
      default:
        return;
    }
    if (buttons == 0) return;
    Latched().store(buttons | Modifiers());
    LatchedAt().store(GetTickCount64());
    static std::atomic<bool> noted{false};
    if ((buttons & kRight) != 0 && !noted.exchange(true)) {
      LaunchLog::Write(L"pointer", message == WM_POINTERDOWN || message == WM_NCPOINTERDOWN ? L"a right press was seen as a pointer message" : L"a right press was seen as a mouse message");
    }
  }

  static bool IsButtonMessage(UINT message) noexcept {
    return (message >= WM_LBUTTONDOWN && message <= WM_XBUTTONDBLCLK && message != WM_MOUSEWHEEL) || (message >= WM_NCLBUTTONDOWN && message <= WM_NCXBUTTONDBLCLK) ||
           message == WM_POINTERDOWN || message == WM_POINTERUP || message == WM_NCPOINTERDOWN || message == WM_NCPOINTERUP || message == WM_CONTEXTMENU;
  }

  static void Sample(const MSG *message) noexcept {
    static std::atomic<int> sampled{0};
    if (!IsButtonMessage(message->message) || sampled.fetch_add(1) >= kSamples) return;
    wchar_t className[64]{};
    GetClassNameW(message->hwnd, className, 64);
    wchar_t line[160]{};
    swprintf_s(line, L"button message 0x%04X wParam 0x%llX for a %s window", message->message, static_cast<unsigned long long>(message->wParam), className);
    LaunchLog::Write(L"pointer", line);
  }

  static LRESULT CALLBACK OnMessage(int code, WPARAM wParam, LPARAM lParam) noexcept {
    if (code == HC_ACTION && wParam == PM_REMOVE && lParam != 0) {
      const MSG *message = reinterpret_cast<const MSG *>(lParam);
      Sample(message);
      Note(message->message, message->wParam);
    }
    return CallNextHookEx(nullptr, code, wParam, lParam);
  }
};

}
