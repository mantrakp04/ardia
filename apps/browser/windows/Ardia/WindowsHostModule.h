#pragma once

#include "NativeModules.h"

namespace Ardia {

REACT_MODULE(WindowsHostModule, L"ArdiaWindowsHost")
struct WindowsHostModule {
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
