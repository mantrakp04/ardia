#pragma once

#include "NativeModules.h"

#include <shellapi.h>
#include <shlwapi.h>

#include <optional>
#include <string>
#include <string_view>

#include "AppModule.h"
#include "Paths.h"
#include "SystemModule.h"

namespace Ardia {

namespace ExternalApps {

constexpr size_t LongestScheme = 64;
constexpr size_t LongestLink = 32 * 1024;
constexpr DWORD LongestAssociation = 4096;
constexpr double IconPoints = 32;
constexpr std::string_view EscapedForHandlers = "\"<>\\^`{|}";

inline bool SchemeCharacter(char c, bool first) noexcept {
  if (c >= 'a' && c <= 'z') return true;
  if (first) return false;
  return (c >= '0' && c <= '9') || c == '+' || c == '-' || c == '.';
}

inline std::optional<std::string> SchemeOf(std::string const &url) noexcept {
  size_t colon = url.find(':');
  if (colon == std::string::npos || colon == 0 || colon > LongestScheme) return std::nullopt;
  std::string scheme = AppShell::Lowercase(url.substr(0, colon));
  for (size_t i = 0; i < scheme.size(); i++)
    if (!SchemeCharacter(scheme[i], i == 0)) return std::nullopt;
  return scheme;
}

inline bool BrowserScheme(std::string const &scheme) noexcept {
  return scheme == "http" || scheme == "https" || scheme == "file";
}

inline std::optional<std::wstring> Associated(std::wstring const &scheme, ASSOCSTR what) noexcept {
  constexpr ASSOCF flags = ASSOCF_IS_PROTOCOL | ASSOCF_NOTRUNCATE;
  DWORD length = 0;
  HRESULT sized = AssocQueryStringW(flags, what, scheme.c_str(), nullptr, nullptr, &length);
  if ((sized != S_OK && sized != S_FALSE) || length < 2 || length > LongestAssociation) return std::nullopt;
  std::wstring value(length, L'\0');
  if (FAILED(AssocQueryStringW(flags, what, scheme.c_str(), nullptr, value.data(), &length))) return std::nullopt;
  value.resize(wcsnlen(value.c_str(), value.size()));
  if (value.empty()) return std::nullopt;
  return value;
}

inline winrt::Microsoft::ReactNative::JSValue Describe(std::string const &scheme) noexcept {
  using winrt::Microsoft::ReactNative::JSValue;
  std::wstring wide = Paths::Wide(scheme);
  std::optional<std::wstring> name = Associated(wide, ASSOCSTR_FRIENDLYAPPNAME);
  if (!name) return JSValue{nullptr};
  std::optional<std::wstring> executable = Associated(wide, ASSOCSTR_EXECUTABLE);
  winrt::Microsoft::ReactNative::JSValueObject handler;
  handler["name"] = JSValue{Paths::Utf8(*name)};
  handler["path"] = executable ? JSValue{Paths::Utf8(*executable)} : JSValue{nullptr};
  handler["icon"] = executable ? SystemShell::OptionalString(SystemShell::FileIcon(*executable, IconPoints)) : JSValue{nullptr};
  return JSValue{std::move(handler)};
}

inline std::string EscapedForHandler(std::string const &url) noexcept {
  static constexpr char digits[] = "0123456789ABCDEF";
  std::string escaped;
  escaped.reserve(url.size());
  for (char c : url) {
    unsigned char byte = static_cast<unsigned char>(c);
    bool unsafe = byte <= 0x20 || byte >= 0x7F || EscapedForHandlers.find(c) != std::string_view::npos;
    if (!unsafe) {
      escaped.push_back(c);
      continue;
    }
    escaped.push_back('%');
    escaped.push_back(digits[byte >> 4]);
    escaped.push_back(digits[byte & 0xF]);
  }
  return escaped;
}

inline bool Launch(std::wstring const &target) noexcept {
  SHELLEXECUTEINFOW info{};
  info.cbSize = sizeof(info);
  info.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
  info.lpVerb = L"open";
  info.lpFile = target.c_str();
  info.nShow = SW_SHOWNORMAL;
  return ShellExecuteExW(&info) != FALSE;
}

}

REACT_MODULE(ExternalAppsModule, L"ArdiaExternalApps")
struct ExternalAppsModule {
  REACT_METHOD(describe)
  void describe(std::string scheme, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
    std::optional<std::string> valid = ExternalApps::SchemeOf(scheme + ":");
    if (!valid || *valid != scheme || ExternalApps::BrowserScheme(scheme)) return promise.Resolve(winrt::Microsoft::ReactNative::JSValue{nullptr});
    if (!AppShell::RunOnShellThread([scheme, promise]() noexcept { promise.Resolve(ExternalApps::Describe(scheme)); }))
      promise.Resolve(winrt::Microsoft::ReactNative::JSValue{nullptr});
  }

  REACT_METHOD(open)
  void open(std::string url, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    if (url.empty() || url.size() > ExternalApps::LongestLink) return promise.Resolve(false);
    std::optional<std::string> scheme = ExternalApps::SchemeOf(url);
    if (!scheme || ExternalApps::BrowserScheme(*scheme)) return promise.Resolve(false);
    if (AppLaunch::Background()) {
      AppLaunch::Note(L"ArdiaExternalApps: background instance, not opening an app link");
      return promise.Resolve(false);
    }
    std::wstring target = Paths::Wide(ExternalApps::EscapedForHandler(url));
    std::wstring wideScheme = Paths::Wide(*scheme);
    bool started = AppShell::RunOnShellThread([target, wideScheme, promise]() noexcept {
      if (!ExternalApps::Associated(wideScheme, ASSOCSTR_FRIENDLYAPPNAME)) return promise.Resolve(false);
      bool opened = ExternalApps::Launch(target);
      AppLaunch::Note(opened ? L"ArdiaExternalApps: opened an app link" : L"ArdiaExternalApps: the app link didn't open");
      promise.Resolve(opened);
    });
    if (!started) promise.Resolve(false);
  }
};

}
