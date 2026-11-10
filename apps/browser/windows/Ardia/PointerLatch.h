#pragma once

namespace Ardia {

struct PointerLatch {
  static constexpr int kLeft = 1;
  static constexpr int kRight = 2;
  static constexpr int kMiddle = 4;
  static constexpr int kShift = 8;
  static constexpr int kControl = 16;
  static constexpr int kAlt = 32;

  static void Install() noexcept {}

  static int State() noexcept {
    const bool swapped = GetSystemMetrics(SM_SWAPBUTTON) != 0;
    int state = 0;
    if (Down(VK_SHIFT)) state |= kShift;
    if (Down(VK_CONTROL)) state |= kControl;
    if (Down(VK_MENU)) state |= kAlt;
    if (Down(swapped ? VK_RBUTTON : VK_LBUTTON)) state |= kLeft;
    if (Down(swapped ? VK_LBUTTON : VK_RBUTTON)) state |= kRight;
    if (Down(VK_MBUTTON)) state |= kMiddle;
    return state;
  }

 private:
  static bool Down(int key) noexcept {
    return (GetAsyncKeyState(key) & 0x8000) != 0;
  }
};

}
