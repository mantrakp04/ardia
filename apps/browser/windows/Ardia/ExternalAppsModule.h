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

constexpr size_t ShortestScheme = 2;
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
  if (colon == std::string::npos || colon < ShortestScheme || colon > LongestScheme) return std::nullopt;
  std::string scheme = AppShell::Lowercase(url.substr(0, colon));
  for (size_t i = 0; i < scheme.size(); i++)
    if (!SchemeCharacter(scheme[i], i == 0)) return std::nullopt;
  return scheme;
}

inline bool BrowserScheme(std::string const &scheme) noexcept {
  return scheme == "http" || scheme == "https" || scheme == "file";
}

inline bool InternetScheme(std::wstring const &scheme) noexcept {
  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_CLASSES_ROOT, scheme.c_str(), 0, KEY_QUERY_VALUE, &key) != ERROR_SUCCESS) return false;
  bool marked = RegQueryValueExW(key, L"URL Protocol", nullptr, nullptr, nullptr, nullptr) == ERROR_SUCCESS;
  RegCloseKey(key);
  return marked;
}

inline std::optional<std::wstring> Associated(std::wstring const &scheme, ASSOCSTR what) noexcept {
  if (!InternetScheme(scheme)) return std::nullopt;
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

struct Handler {
  std::wstring name;
  std::optional<std::wstring> path;
};

inline std::optional<std::wstring> ClassesText(std::wstring const &key) noexcept {
  DWORD size = 0;
  if (RegGetValueW(HKEY_CLASSES_ROOT, key.c_str(), nullptr, RRF_RT_REG_SZ, nullptr, nullptr, &size) != ERROR_SUCCESS) return std::nullopt;
  if (size < sizeof(wchar_t) * 2 || size > LongestAssociation * sizeof(wchar_t)) return std::nullopt;
  std::wstring value(size / sizeof(wchar_t), L'\0');
  if (RegGetValueW(HKEY_CLASSES_ROOT, key.c_str(), nullptr, RRF_RT_REG_SZ, nullptr, value.data(), &size) != ERROR_SUCCESS) return std::nullopt;
  value.resize(wcsnlen(value.c_str(), value.size()));
  if (value.empty()) return std::nullopt;
  return value;
}

inline std::optional<std::wstring> CommandProgram(std::wstring const &scheme) noexcept {
  std::optional<std::wstring> command = ClassesText(scheme + L"\\shell\\open\\command");
  if (!command) return std::nullopt;
  int count = 0;
  LPWSTR *arguments = CommandLineToArgvW(command->c_str(), &count);
  if (!arguments) return std::nullopt;
  std::wstring program = count > 0 && arguments[0] ? arguments[0] : L"";
  LocalFree(arguments);
  if (program.empty()) return std::nullopt;
  return program;
}

inline std::wstring ProgramTitle(std::wstring const &program) noexcept {
  size_t slash = program.find_last_of(L"\\/");
  std::wstring file = slash == std::wstring::npos ? program : program.substr(slash + 1);
  size_t dot = file.find_last_of(L'.');
  return dot == std::wstring::npos || dot == 0 ? file : file.substr(0, dot);
}

inline std::optional<std::wstring> RegisteredTitle(std::wstring const &scheme) noexcept {
  constexpr std::wstring_view prefix = L"URL:";
  std::optional<std::wstring> title = ClassesText(scheme);
  if (!title) return std::nullopt;
  std::wstring shown = title->rfind(prefix.data(), 0) == 0 ? title->substr(prefix.size()) : *title;
  size_t start = shown.find_first_not_of(L' ');
  if (start == std::wstring::npos) return std::nullopt;
  return shown.substr(start);
}

inline std::optional<Handler> HandlerOf(std::wstring const &scheme) noexcept {
  if (!InternetScheme(scheme)) return std::nullopt;
  if (std::optional<std::wstring> name = Associated(scheme, ASSOCSTR_FRIENDLYAPPNAME)) return Handler{*name, Associated(scheme, ASSOCSTR_EXECUTABLE)};
  std::optional<std::wstring> program = CommandProgram(scheme);
  if (!program) return std::nullopt;
  std::optional<std::wstring> title = RegisteredTitle(scheme);
  return Handler{title ? *title : ProgramTitle(*program), program};
}

inline bool SameHandler(std::wstring const &scheme, std::wstring const &name, std::optional<std::wstring> const &path) noexcept {
  std::optional<Handler> handler = HandlerOf(scheme);
  if (!handler || handler->name != name) return false;
  if (!handler->path || !path) return !handler->path && !path;
  return CompareStringOrdinal(handler->path->c_str(), -1, path->c_str(), -1, TRUE) == CSTR_EQUAL;
}

inline winrt::Microsoft::ReactNative::JSValue Describe(std::string const &scheme) noexcept {
  using winrt::Microsoft::ReactNative::JSValue;
  std::optional<Handler> found = HandlerOf(Paths::Wide(scheme));
  if (!found) return JSValue{nullptr};
  winrt::Microsoft::ReactNative::JSValueObject handler;
  handler["name"] = JSValue{Paths::Utf8(found->name)};
  handler["path"] = found->path ? JSValue{Paths::Utf8(*found->path)} : JSValue{nullptr};
  handler["icon"] = found->path ? SystemShell::OptionalString(SystemShell::FileIcon(*found->path, IconPoints)) : JSValue{nullptr};
  return JSValue{std::move(handler)};
}

inline bool HexDigit(char c) noexcept {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

inline bool AlreadyEscaped(std::string const &url, size_t at) noexcept {
  return at + 2 < url.size() && HexDigit(url[at + 1]) && HexDigit(url[at + 2]);
}

inline std::string EscapedForHandler(std::string const &url) noexcept {
  static constexpr char digits[] = "0123456789ABCDEF";
  std::string escaped;
  escaped.reserve(url.size());
  for (size_t at = 0; at < url.size(); at++) {
    char c = url[at];
    unsigned char byte = static_cast<unsigned char>(c);
    bool bareEscape = c == '%' && !AlreadyEscaped(url, at);
    bool unsafe = bareEscape || byte <= 0x20 || byte >= 0x7F || EscapedForHandlers.find(c) != std::string_view::npos;
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

inline std::wstring SystemFolder() noexcept {
  wchar_t folder[MAX_PATH]{};
  UINT length = GetSystemDirectoryW(folder, MAX_PATH);
  return length > 0 && length < MAX_PATH ? std::wstring(folder, length) : std::wstring();
}

inline bool Launch(std::wstring const &target) noexcept {
  std::wstring folder = SystemFolder();
  SHELLEXECUTEINFOW info{};
  info.cbSize = sizeof(info);
  info.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
  info.lpVerb = L"open";
  info.lpFile = target.c_str();
  info.lpDirectory = folder.empty() ? nullptr : folder.c_str();
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
  void open(std::string url, std::string name, std::optional<std::string> path, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    if (url.empty() || url.size() > ExternalApps::LongestLink) return promise.Resolve(false);
    std::optional<std::string> scheme = ExternalApps::SchemeOf(url);
    if (!scheme || ExternalApps::BrowserScheme(*scheme) || name.empty()) return promise.Resolve(false);
    if (AppLaunch::Background()) {
      AppLaunch::Note(L"ArdiaExternalApps: background instance, not opening an app link");
      return promise.Resolve(false);
    }
    std::wstring target = Paths::Wide(ExternalApps::EscapedForHandler(url));
    std::wstring wideScheme = Paths::Wide(*scheme);
    std::wstring wideName = Paths::Wide(name);
    std::optional<std::wstring> widePath = path ? std::optional<std::wstring>(Paths::Wide(*path)) : std::nullopt;
    bool started = AppShell::RunOnShellThread([target, wideScheme, wideName, widePath, promise]() noexcept {
      if (!ExternalApps::SameHandler(wideScheme, wideName, widePath)) {
        AppLaunch::Note(L"ArdiaExternalApps: the link's handler changed since the prompt, not opening");
        return promise.Resolve(false);
      }
      bool opened = ExternalApps::Launch(target);
      AppLaunch::Note(opened ? L"ArdiaExternalApps: opened an app link" : L"ArdiaExternalApps: the app link didn't open");
      promise.Resolve(opened);
    });
    if (!started) promise.Resolve(false);
  }
};

}
