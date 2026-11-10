#pragma once

#include "NativeModules.h"

#include "Paths.h"

namespace Ardia {

REACT_MODULE(WindowsHostModule, L"ArdiaWindowsHost")
struct WindowsHostModule {
  REACT_CONSTANT(selfCheck)
  const bool selfCheck = Paths::HasSwitch(L"--self-check") && Paths::HasCustomDataDirectory();

  REACT_SYNC_METHOD(pointerState)
  int pointerState() noexcept {
    const bool swapped = GetSystemMetrics(SM_SWAPBUTTON) != 0;
    auto down = [](int key) noexcept { return (GetAsyncKeyState(key) & 0x8000) != 0; };
    int state = 0;
    if (down(swapped ? VK_RBUTTON : VK_LBUTTON)) state |= 1;
    if (down(swapped ? VK_LBUTTON : VK_RBUTTON)) state |= 2;
    if (down(VK_MBUTTON)) state |= 4;
    if (down(VK_SHIFT)) state |= 8;
    if (down(VK_CONTROL)) state |= 16;
    if (down(VK_MENU)) state |= 32;
    return state;
  }

  REACT_SYNC_METHOD(secureRandomHex)
  std::string secureRandomHex(int byteCount) noexcept {
    if (byteCount < 1 || byteCount > 1024) return {};
    std::vector<uint8_t> bytes(static_cast<size_t>(byteCount));
    if (BCryptGenRandom(nullptr, bytes.data(), static_cast<ULONG>(bytes.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) return {};
    static constexpr char digits[] = "0123456789abcdef";
    std::string hex;
    hex.reserve(bytes.size() * 2);
    for (uint8_t byte : bytes) {
      hex.push_back(digits[byte >> 4]);
      hex.push_back(digits[byte & 0xF]);
    }
    return hex;
  }
};

}
