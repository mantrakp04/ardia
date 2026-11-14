#pragma once

#include <filesystem>
#include <initializer_list>
#include <optional>
#include <string>
#include <string_view>

#include <shlobj.h>

#include "Paths.h"

namespace Ardia::TestGate {

constexpr wchar_t TestBuildMarker[] = L"Ardia.test-build";

inline std::optional<std::wstring> OpenedFinalPath(std::filesystem::path const &path) noexcept {
  constexpr DWORD share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
  HANDLE handle = CreateFileW(path.c_str(), 0, share, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return std::nullopt;
  constexpr DWORD flags = VOLUME_NAME_GUID | FILE_NAME_NORMALIZED;
  std::optional<std::wstring> found;
  DWORD size = GetFinalPathNameByHandleW(handle, nullptr, 0, flags);
  if (size > 0) {
    std::wstring value(size, L'\0');
    DWORD written = GetFinalPathNameByHandleW(handle, value.data(), size, flags);
    if (written > 0 && written < size) {
      value.resize(written);
      found = std::move(value);
    }
  }
  CloseHandle(handle);
  return found;
}

inline std::optional<std::wstring> CanonicalPath(std::filesystem::path const &path) noexcept {
  std::error_code error;
  if (std::filesystem::exists(path, error)) return OpenedFinalPath(path);
  if (error || !path.has_parent_path() || path.parent_path() == path || !path.has_filename()) return std::nullopt;
  std::optional<std::wstring> parent = CanonicalPath(path.parent_path());
  if (!parent) return std::nullopt;
  std::wstring joined = *parent;
  if (joined.empty() || joined.back() != L'\\') joined.push_back(L'\\');
  return joined + path.filename().wstring();
}

inline bool SameText(std::wstring_view a, std::wstring_view b) noexcept {
  return a.size() == b.size() && CompareStringOrdinal(a.data(), static_cast<int>(a.size()), b.data(), static_cast<int>(b.size()), TRUE) == CSTR_EQUAL;
}

inline bool WithinOrSame(std::wstring_view inner, std::wstring_view outer) noexcept {
  while (!outer.empty() && outer.back() == L'\\') outer.remove_suffix(1);
  if (inner.size() < outer.size() || !SameText(inner.substr(0, outer.size()), outer)) return false;
  return inner.size() == outer.size() || inner[outer.size()] == L'\\';
}

inline bool Overlaps(std::wstring_view a, std::wstring_view b) noexcept {
  return WithinOrSame(a, b) || WithinOrSame(b, a);
}

inline std::wstring RealFolderClash(std::initializer_list<std::filesystem::path> checked, std::wstring_view variable) noexcept {
  std::filesystem::path const realFolders[] = {
      Paths::UserFolder(FOLDERID_LocalAppData, L"LOCALAPPDATA") / L"Ardia",
      Paths::UserFolder(FOLDERID_RoamingAppData, L"APPDATA") / L"Ardia",
  };
  for (std::filesystem::path const &real : realFolders) {
    std::optional<std::wstring> canonicalReal = CanonicalPath(real);
    if (!canonicalReal) return L"the real profile folder can't be resolved";
    for (std::filesystem::path const &mine : checked) {
      if (!mine.is_absolute()) return std::wstring{variable} + L" is not an absolute path";
      std::optional<std::wstring> canonicalMine = CanonicalPath(mine);
      if (!canonicalMine) return std::wstring{variable} + L" can't be resolved on a local volume";
      if (Overlaps(*canonicalMine, *canonicalReal)) return std::wstring{variable} + L" is or overlaps the real profile folder";
    }
  }
  return {};
}

inline std::filesystem::path RunningFolder() noexcept {
  std::wstring path(MAX_PATH, L'\0');
  while (true) {
    DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (length == 0) return {};
    if (length < path.size()) {
      path.resize(length);
      return std::filesystem::path(path).parent_path();
    }
    if (path.size() >= 32768) return {};
    path.resize(path.size() * 2);
  }
}

inline bool TestBuild() noexcept {
  std::filesystem::path folder = RunningFolder();
  if (folder.empty()) return false;
  std::error_code error;
  return std::filesystem::is_regular_file(folder / TestBuildMarker, error);
}

inline std::wstring Refusal() noexcept {
  std::filesystem::path requested{Paths::RequestedDataDirectory()};
  if (requested.empty()) return L"no scratch ARDIA_DATA_DIR";
  if (!requested.is_absolute()) return L"ARDIA_DATA_DIR is not an absolute path";
  std::wstring clash = RealFolderClash({Paths::DataDirectory(), Paths::DataDirectory() / L"Chromium", Paths::DataDirectory() / L"Sync"}, L"ARDIA_DATA_DIR");
  if (!clash.empty()) return clash;
  if (!TestBuild()) return std::wstring{L"not a test build: no "} + TestBuildMarker + L" beside the app";
  return {};
}

}
