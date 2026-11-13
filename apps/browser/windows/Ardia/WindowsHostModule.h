#pragma once

#include "NativeModules.h"

#include "Paths.h"
#include "PointerLatch.h"

namespace Ardia {

namespace LaunchArguments {

constexpr std::wstring_view SingleArgumentSwitch = L"--single-argument";

inline std::wstring ExistingFullPath(std::wstring_view text) noexcept {
  if (text.empty()) return {};
  std::wstring given{text};
  DWORD length = GetFullPathNameW(given.c_str(), 0, nullptr, nullptr);
  if (!length) return {};
  std::wstring full(length, L'\0');
  DWORD written = GetFullPathNameW(given.c_str(), length, full.data(), nullptr);
  if (!written || written >= length) return {};
  full.resize(written);
  return GetFileAttributesW(full.c_str()) == INVALID_FILE_ATTRIBUTES ? std::wstring{} : full;
}

inline winrt::Microsoft::ReactNative::JSValue Entry(std::wstring_view text) noexcept {
  using winrt::Microsoft::ReactNative::JSValue;
  winrt::Microsoft::ReactNative::JSValueObject entry;
  entry["text"] = JSValue{Paths::Utf8(text)};
  std::wstring file = ExistingFullPath(text);
  if (!file.empty()) entry["file"] = JSValue{Paths::Utf8(file)};
  return JSValue{std::move(entry)};
}

inline winrt::Microsoft::ReactNative::JSValue Read() noexcept {
  using winrt::Microsoft::ReactNative::JSValue;
  winrt::Microsoft::ReactNative::JSValueArray arguments;
  winrt::Microsoft::ReactNative::JSValueObject read;
  std::wstring_view line{GetCommandLineW()};
  int count = 0;
  LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &count);
  if (argv) {
    for (int i = 1; i < count; i++) {
      std::wstring_view argument{argv[i]};
      if (argument == SingleArgumentSwitch) {
        size_t at = line.find(SingleArgumentSwitch);
        size_t rest = at == std::wstring_view::npos ? line.size() : at + SingleArgumentSwitch.size() + 1;
        if (rest < line.size()) read["single"] = Entry(line.substr(rest));
        break;
      }
      arguments.push_back(Entry(argument));
    }
    LocalFree(argv);
  }
  read["arguments"] = JSValue{std::move(arguments)};
  return JSValue{std::move(read)};
}

}

REACT_MODULE(WindowsHostModule, L"ArdiaWindowsHost")
struct WindowsHostModule {
  static constexpr double kAwaySeconds = 3600;

  REACT_CONSTANT(selfCheck)
  const bool selfCheck = Paths::HasSwitch(L"--self-check") && Paths::HasCustomDataDirectory();

  REACT_SYNC_METHOD(inputIdleSeconds)
  double inputIdleSeconds() noexcept {
    HWND front = GetForegroundWindow();
    DWORD process = 0;
    if (front) GetWindowThreadProcessId(front, &process);
    if (process != GetCurrentProcessId()) return kAwaySeconds;
    LASTINPUTINFO last{sizeof(LASTINPUTINFO)};
    if (!GetLastInputInfo(&last)) return kAwaySeconds;
    return static_cast<double>(GetTickCount() - last.dwTime) / 1000.0;
  }

  REACT_SYNC_METHOD(pointerState)
  int pointerState() noexcept {
    return PointerLatch::State();
  }

  REACT_SYNC_METHOD(launchArguments)
  winrt::Microsoft::ReactNative::JSValue launchArguments() noexcept {
    return LaunchArguments::Read();
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
