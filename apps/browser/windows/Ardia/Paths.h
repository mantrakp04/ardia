#pragma once

#include <filesystem>
#include <string>
#include <string_view>

#include <shlobj.h>

namespace Ardia::Paths {

inline std::string Utf8(std::wstring_view wide) noexcept {
  if (wide.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
  std::string utf8(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), utf8.data(), size, nullptr, nullptr);
  return utf8;
}

inline std::wstring Wide(std::string_view utf8) noexcept {
  if (utf8.empty()) return {};
  int size = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
  std::wstring wide(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), wide.data(), size);
  return wide;
}

inline std::wstring Environment(const wchar_t *name) noexcept {
  DWORD size = GetEnvironmentVariableW(name, nullptr, 0);
  if (size == 0) return {};
  std::wstring value(size, L'\0');
  DWORD written = GetEnvironmentVariableW(name, value.data(), size);
  value.resize(written);
  return value;
}

inline std::filesystem::path KnownFolder(REFKNOWNFOLDERID folder) noexcept {
  PWSTR raw = nullptr;
  std::filesystem::path found;
  if (SUCCEEDED(SHGetKnownFolderPath(folder, KF_FLAG_CREATE, nullptr, &raw)) && raw) found = raw;
  if (raw) CoTaskMemFree(raw);
  return found;
}

inline std::filesystem::path UserFolder(REFKNOWNFOLDERID folder, const wchar_t *variable) noexcept {
  std::filesystem::path found = KnownFolder(folder);
  if (!found.empty()) return found;
  std::wstring fromEnvironment = Environment(variable);
  if (!fromEnvironment.empty()) return fromEnvironment;
  std::error_code ignored;
  return std::filesystem::temp_directory_path(ignored);
}

inline std::filesystem::path Ensured(std::filesystem::path directory) noexcept {
  std::error_code ignored;
  std::filesystem::create_directories(directory, ignored);
  return directory;
}

inline bool HasCustomDataDirectory() noexcept {
  return !Environment(L"ARDIA_DATA_DIR").empty();
}

inline const std::filesystem::path &DataDirectory() noexcept {
  static const std::filesystem::path directory = [] {
    std::wstring chosen = Environment(L"ARDIA_DATA_DIR");
    return Ensured(chosen.empty() ? UserFolder(FOLDERID_LocalAppData, L"LOCALAPPDATA") / L"Ardia" : std::filesystem::path(chosen));
  }();
  return directory;
}

inline bool HasSwitch(std::wstring_view name) noexcept {
  int count = 0;
  LPWSTR *arguments = CommandLineToArgvW(GetCommandLineW(), &count);
  if (!arguments) return false;
  bool found = false;
  for (int i = 1; i < count && !found; i++) found = name == arguments[i];
  LocalFree(arguments);
  return found;
}

}
