#include "ardia/win/test_gate.h"

#include <windows.h>

#include <optional>
#include <string>
#include <string_view>

#include "base/base_paths_win.h"
#include "base/files/file_path.h"
#include "base/path_service.h"

namespace ardia_win {

namespace {

std::optional<std::wstring> OpenedFinalPath(const base::FilePath& path) {
  constexpr DWORD kShare = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
  HANDLE handle = ::CreateFileW(path.value().c_str(), 0, kShare, nullptr,
                                OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS,
                                nullptr);
  if (handle == INVALID_HANDLE_VALUE) {
    return std::nullopt;
  }
  constexpr DWORD kFlags = VOLUME_NAME_GUID | FILE_NAME_NORMALIZED;
  std::optional<std::wstring> found;
  DWORD size = ::GetFinalPathNameByHandleW(handle, nullptr, 0, kFlags);
  if (size > 0) {
    std::wstring value(size, L'\0');
    DWORD written =
        ::GetFinalPathNameByHandleW(handle, value.data(), size, kFlags);
    if (written > 0 && written < size) {
      value.resize(written);
      found = std::move(value);
    }
  }
  ::CloseHandle(handle);
  return found;
}

bool Exists(const base::FilePath& path) {
  return ::GetFileAttributesW(path.value().c_str()) != INVALID_FILE_ATTRIBUTES;
}

std::optional<std::wstring> CanonicalPath(const base::FilePath& path) {
  if (Exists(path)) {
    return OpenedFinalPath(path);
  }
  const base::FilePath parent = path.DirName();
  if (parent == path || path.BaseName().empty()) {
    return std::nullopt;
  }
  std::optional<std::wstring> canonical_parent = CanonicalPath(parent);
  if (!canonical_parent) {
    return std::nullopt;
  }
  std::wstring joined = *canonical_parent;
  if (joined.empty() || joined.back() != L'\\') {
    joined.push_back(L'\\');
  }
  return joined + path.BaseName().value();
}

bool SameText(std::wstring_view a, std::wstring_view b) {
  return a.size() == b.size() &&
         ::CompareStringOrdinal(a.data(), static_cast<int>(a.size()), b.data(),
                                static_cast<int>(b.size()),
                                TRUE) == CSTR_EQUAL;
}

bool WithinOrSame(std::wstring_view inner, std::wstring_view outer) {
  while (!outer.empty() && outer.back() == L'\\') {
    outer.remove_suffix(1);
  }
  if (inner.size() < outer.size() ||
      !SameText(inner.substr(0, outer.size()), outer)) {
    return false;
  }
  return inner.size() == outer.size() || inner[outer.size()] == L'\\';
}

bool Overlaps(std::wstring_view a, std::wstring_view b) {
  return WithinOrSame(a, b) || WithinOrSame(b, a);
}

std::wstring RealFolderClash(const base::FilePath& data_dir) {
  const base::FilePath checked[] = {
      data_dir, data_dir.Append(FILE_PATH_LITERAL("Chromium")),
      data_dir.Append(FILE_PATH_LITERAL("Sync"))};
  for (int key : {base::DIR_LOCAL_APP_DATA, base::DIR_ROAMING_APP_DATA}) {
    base::FilePath folder;
    if (!base::PathService::Get(key, &folder) || folder.empty()) {
      return L"the real profile folder can't be resolved";
    }
    std::optional<std::wstring> real =
        CanonicalPath(folder.Append(FILE_PATH_LITERAL("Ardia")));
    if (!real) {
      return L"the real profile folder can't be resolved";
    }
    for (const base::FilePath& mine : checked) {
      std::optional<std::wstring> canonical = CanonicalPath(mine);
      if (!canonical) {
        return L"ARDIA_DATA_DIR can't be resolved on a local volume";
      }
      if (Overlaps(*canonical, *real)) {
        return L"ARDIA_DATA_DIR is or overlaps the real profile folder";
      }
    }
  }
  return std::wstring();
}

bool TestBuild() {
  base::FilePath exe;
  if (!base::PathService::Get(base::FILE_EXE, &exe) || exe.empty()) {
    return false;
  }
  const DWORD attributes = ::GetFileAttributesW(
      exe.DirName().Append(kTestBuildMarker).value().c_str());
  return attributes != INVALID_FILE_ATTRIBUTES &&
         !(attributes & FILE_ATTRIBUTE_DIRECTORY);
}

}

std::wstring TestGateRefusal(const std::wstring& data_dir) {
  if (data_dir.empty()) {
    return L"no scratch ARDIA_DATA_DIR";
  }
  const base::FilePath path(data_dir);
  if (!path.IsAbsolute()) {
    return L"ARDIA_DATA_DIR is not an absolute path";
  }
  std::wstring clash = RealFolderClash(path);
  if (!clash.empty()) {
    return clash;
  }
  if (!TestBuild()) {
    return std::wstring(L"not a test build: no ") + kTestBuildMarker +
           L" beside the app";
  }
  return std::wstring();
}

}
