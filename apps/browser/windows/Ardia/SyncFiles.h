#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <deque>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "Paths.h"
#include "SyncCrypto.h"
#include "SyncLogins.h"

namespace Ardia::SyncFiles {

constexpr DWORD PlaceholderAttributes = FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_OFFLINE;
constexpr std::wstring_view VaultExtension = L".nns";
constexpr uint64_t LargestFile = 256ull * 1024 * 1024;
constexpr size_t LongestHydrateQueue = 64;
constexpr DWORD FirstCloudFileError = 358;
constexpr DWORD LastCloudFileError = 400;
constexpr std::chrono::seconds HydrateRetry{60};

struct Failure : std::exception {
  explicit Failure(std::string text) : message(std::move(text)) {}
  char const *what() const noexcept override { return message.c_str(); }
  std::string message;
};

inline std::string Problem(char const *what, DWORD error) { return std::string{what} + " (" + std::to_string(error) + ")"; }

inline bool IsPlaceholder(DWORD attributes) noexcept { return attributes != INVALID_FILE_ATTRIBUTES && (attributes & PlaceholderAttributes) != 0; }

inline bool IsMissing(DWORD error) noexcept { return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND; }

inline bool IsBusy(DWORD error) noexcept {
  return error == ERROR_SHARING_VIOLATION || error == ERROR_LOCK_VIOLATION || error == ERROR_ACCESS_DENIED || (error >= FirstCloudFileError && error <= LastCloudFileError);
}

inline double UnixMilliseconds(FILETIME time) noexcept {
  ULARGE_INTEGER value{};
  value.LowPart = time.dwLowDateTime;
  value.HighPart = time.dwHighDateTime;
  return static_cast<double>(value.QuadPart / 10000ull) - 11644473600000.0;
}

inline std::string Quoted(std::string_view text) {
  std::string out;
  SyncLogins::Quote(out, text);
  return out;
}

inline bool IsUsableFolder(std::wstring const &folder) noexcept {
  if (folder.size() < 3 || folder.find(L'\0') != std::wstring::npos) return false;
  bool drive = folder[1] == L':' && (folder[2] == L'\\' || folder[2] == L'/');
  bool share = folder.rfind(L"\\\\", 0) == 0;
  return drive || share;
}

enum class Probe { Directory, File, Absent, Inaccessible, Link };

inline bool IsNameSurrogate(std::wstring const &path) noexcept {
  WIN32_FIND_DATAW found{};
  HANDLE search = FindFirstFileExW(path.c_str(), FindExInfoBasic, &found, FindExSearchNameMatch, nullptr, 0);
  if (search == INVALID_HANDLE_VALUE) return false;
  FindClose(search);
  return (found.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) && IsReparseTagNameSurrogate(found.dwReserved0);
}

inline bool IsLink(HANDLE handle) noexcept {
  FILE_ATTRIBUTE_TAG_INFO tag{};
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &tag, sizeof(tag))) return true;
  return (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) && IsReparseTagNameSurrogate(tag.ReparseTag);
}

inline HANDLE HoldDirectory(std::wstring const &path) noexcept {
  HANDLE held = CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
                            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (held == INVALID_HANDLE_VALUE) return held;
  FILE_ATTRIBUTE_TAG_INFO tag{};
  bool directory = GetFileInformationByHandleEx(held, FileAttributeTagInfo, &tag, sizeof(tag)) && (tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY);
  if (!directory || IsLink(held)) {
    CloseHandle(held);
    return INVALID_HANDLE_VALUE;
  }
  return held;
}

inline Probe ProbePath(std::wstring const &path) noexcept {
  DWORD attributes = GetFileAttributesW(path.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES) return IsMissing(GetLastError()) ? Probe::Absent : Probe::Inaccessible;
  if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) && IsNameSurrogate(path)) return Probe::Link;
  return (attributes & FILE_ATTRIBUTE_DIRECTORY) ? Probe::Directory : Probe::File;
}

inline bool IsDirectory(std::wstring const &path) noexcept { return ProbePath(path) == Probe::Directory; }

inline void RequireNoLink(std::wstring const &path) {
  if (ProbePath(path) == Probe::Link) throw Failure("the sync folder holds a link where sync data belongs");
}

inline std::optional<std::string> List(std::wstring const &directory) {
  WIN32_FIND_DATAW found{};
  HANDLE search = FindFirstFileExW((directory + L"\\*").c_str(), FindExInfoBasic, &found, FindExSearchNameMatch, nullptr, FIND_FIRST_EX_LARGE_FETCH);
  if (search == INVALID_HANDLE_VALUE) {
    DWORD error = GetLastError();
    if (IsMissing(error)) return std::nullopt;
    throw Failure(Problem("the folder couldn't be listed", error));
  }
  std::string out = "[";
  do {
    std::wstring name = found.cFileName;
    if (name == L"." || name == L"..") continue;
    if (out.size() > 1) out.push_back(',');
    bool directoryEntry = (found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
    out += "{\"name\":" + Quoted(Paths::Utf8(name)) + ",\"dir\":" + (directoryEntry ? "true" : "false") +
        ",\"modified\":" + std::to_string(static_cast<int64_t>(UnixMilliseconds(found.ftLastWriteTime))) +
        ",\"placeholder\":" + (!directoryEntry && IsPlaceholder(found.dwFileAttributes) ? "true" : "false") + "}";
  } while (FindNextFileW(search, &found));
  DWORD error = GetLastError();
  FindClose(search);
  if (error != ERROR_NO_MORE_FILES) throw Failure(Problem("the folder couldn't be listed", error));
  out.push_back(']');
  return out;
}

inline bool HasTagFolder(std::wstring const &folder) noexcept {
  WIN32_FIND_DATAW found{};
  HANDLE search = FindFirstFileExW((folder + L"\\*").c_str(), FindExInfoBasic, &found, FindExSearchNameMatch, nullptr, 0);
  if (search == INVALID_HANDLE_VALUE) return false;
  bool any = false;
  do {
    any = SyncCrypto::IsTag(Paths::Utf8(found.cFileName));
  } while (!any && FindNextFileW(search, &found));
  FindClose(search);
  return any;
}

struct Read {
  enum class State { Data, Busy, Placeholder, Missing } state = State::Missing;
  std::string bytes;
};

inline bool SameVersion(BY_HANDLE_FILE_INFORMATION const &a, BY_HANDLE_FILE_INFORMATION const &b) noexcept {
  return a.nFileSizeHigh == b.nFileSizeHigh && a.nFileSizeLow == b.nFileSizeLow && a.ftLastWriteTime.dwLowDateTime == b.ftLastWriteTime.dwLowDateTime &&
      a.ftLastWriteTime.dwHighDateTime == b.ftLastWriteTime.dwHighDateTime && a.nFileIndexLow == b.nFileIndexLow && a.nFileIndexHigh == b.nFileIndexHigh;
}

inline Read ReadFile(std::wstring const &path) {
  DWORD attributes = GetFileAttributesW(path.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES) {
    DWORD error = GetLastError();
    if (IsMissing(error)) return Read{};
    if (IsBusy(error)) return Read{Read::State::Busy, {}};
    throw Failure(Problem("a sync file couldn't be read", error));
  }
  if (IsPlaceholder(attributes)) return Read{Read::State::Placeholder, {}};
  if (attributes & FILE_ATTRIBUTE_DIRECTORY) return Read{Read::State::Busy, {}};
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
                            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_NO_RECALL | FILE_FLAG_SEQUENTIAL_SCAN | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    DWORD error = GetLastError();
    if (IsMissing(error)) return Read{};
    if (IsBusy(error)) return Read{Read::State::Busy, {}};
    throw Failure(Problem("a sync file couldn't be opened", error));
  }
  if (IsLink(file)) {
    CloseHandle(file);
    return Read{Read::State::Busy, {}};
  }
  BY_HANDLE_FILE_INFORMATION before{};
  BY_HANDLE_FILE_INFORMATION after{};
  bool ok = GetFileInformationByHandle(file, &before);
  uint64_t size = (uint64_t{before.nFileSizeHigh} << 32) | before.nFileSizeLow;
  ok = ok && size <= LargestFile;
  std::string bytes;
  if (ok) {
    bytes.resize(static_cast<size_t>(size));
    DWORD done = 0;
    ok = bytes.empty() || (::ReadFile(file, bytes.data(), static_cast<DWORD>(bytes.size()), &done, nullptr) && done == bytes.size());
  }
  DWORD error = ok ? ERROR_SUCCESS : GetLastError();
  bool stable = ok && GetFileInformationByHandle(file, &after) && SameVersion(before, after);
  CloseHandle(file);
  if (!ok) {
    if (IsBusy(error) || error == ERROR_SUCCESS) return Read{Read::State::Busy, {}};
    throw Failure(Problem("a sync file couldn't be read", error));
  }
  if (!stable) return Read{Read::State::Busy, {}};
  return Read{Read::State::Data, std::move(bytes)};
}

inline std::wstring StagingName(std::wstring const &name) {
  uint8_t random[10]{};
  if (!SyncCrypto::RandomBytes(random, sizeof(random))) throw Failure("no random bytes for a staging name");
  return L"." + name + L"." + Paths::Wide(SyncCrypto::Base32(random, sizeof(random))) + L".partial";
}

inline void Publish(std::wstring const &directory, std::wstring const &name, std::string_view bytes, bool replacing) {
  std::wstring staged = directory + L"\\" + StagingName(name);
  std::wstring target = directory + L"\\" + name;
  HANDLE file = CreateFileW(staged.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_HIDDEN, nullptr);
  if (file == INVALID_HANDLE_VALUE) throw Failure(Problem("a sync file couldn't be written", GetLastError()));
  DWORD done = 0;
  bool ok = bytes.empty() || (WriteFile(file, bytes.data(), static_cast<DWORD>(bytes.size()), &done, nullptr) && done == bytes.size());
  ok = ok && FlushFileBuffers(file);
  DWORD error = ok ? ERROR_SUCCESS : GetLastError();
  CloseHandle(file);
  if (ok) {
    SetFileAttributesW(staged.c_str(), FILE_ATTRIBUTE_NORMAL);
    ok = MoveFileExW(staged.c_str(), target.c_str(), MOVEFILE_WRITE_THROUGH | (replacing ? MOVEFILE_REPLACE_EXISTING : 0));
    if (!ok) error = GetLastError();
  }
  if (!ok) {
    DeleteFileW(staged.c_str());
    throw Failure(Problem("a sync file couldn't be written", error));
  }
}

inline std::string Remove(std::wstring const &path) {
  if (DeleteFileW(path.c_str())) return "removed";
  DWORD error = GetLastError();
  if (IsMissing(error)) return "missing";
  throw Failure(Problem("a sync file couldn't be removed", error));
}

inline void MakeDirectory(std::wstring const &path) {
  Probe probe = ProbePath(path);
  if (probe == Probe::Directory) return;
  if (probe == Probe::Link) throw Failure("the sync folder holds a link where sync data belongs");
  if (!CreateDirectoryW(path.c_str(), nullptr) && GetLastError() != ERROR_ALREADY_EXISTS) throw Failure(Problem("a sync folder couldn't be created", GetLastError()));
  if (!IsDirectory(path)) throw Failure("a sync folder couldn't be created");
}

inline bool RemoveTree(std::wstring const &directory, int depth = 0) noexcept {
  if (depth > 16) return false;
  HANDLE held = HoldDirectory(directory);
  if (held == INVALID_HANDLE_VALUE) return ProbePath(directory) == Probe::Link && RemoveDirectoryW(directory.c_str());
  WIN32_FIND_DATAW found{};
  HANDLE search = FindFirstFileExW((directory + L"\\*").c_str(), FindExInfoBasic, &found, FindExSearchNameMatch, nullptr, 0);
  bool ok = true;
  if (search != INVALID_HANDLE_VALUE) {
    do {
      std::wstring name = found.cFileName;
      if (name == L"." || name == L"..") continue;
      std::wstring path = directory + L"\\" + name;
      bool link = (found.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) && IsReparseTagNameSurrogate(found.dwReserved0);
      if (found.dwFileAttributes & FILE_ATTRIBUTE_READONLY) SetFileAttributesW(path.c_str(), found.dwFileAttributes & ~FILE_ATTRIBUTE_READONLY);
      if (!(found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) ok = DeleteFileW(path.c_str()) && ok;
      else if (link) ok = RemoveDirectoryW(path.c_str()) && ok;
      else ok = RemoveTree(path, depth + 1) && ok;
    } while (FindNextFileW(search, &found));
    FindClose(search);
  }
  CloseHandle(held);
  return RemoveDirectoryW(directory.c_str()) && ok;
}

class Hydrator {
 public:
  static Hydrator &Shared() noexcept {
    static Hydrator *shared = new Hydrator();
    return *shared;
  }

  void Request(std::wstring path) {
    std::lock_guard<std::mutex> guard(m_lock);
    auto now = std::chrono::steady_clock::now();
    auto tried = m_tried.find(path);
    if (tried != m_tried.end() && now - tried->second < HydrateRetry) return;
    if (m_queue.size() >= LongestHydrateQueue) return;
    m_tried[path] = now;
    if (m_tried.size() > LongestHydrateQueue * 16) m_tried.clear();
    m_queue.push_back(std::move(path));
    if (m_running) return;
    m_running = true;
    std::thread([this]() noexcept { Drain(); }).detach();
  }

  uint32_t TakeHydrated() noexcept { return m_hydrated.exchange(0); }

 private:
  void Drain() noexcept {
    while (true) {
      std::wstring path;
      {
        std::lock_guard<std::mutex> guard(m_lock);
        if (m_queue.empty()) {
          m_running = false;
          return;
        }
        path = std::move(m_queue.front());
        m_queue.pop_front();
      }
      if (Fetch(path)) m_hydrated++;
    }
  }

  static bool Fetch(std::wstring const &path) noexcept {
    HANDLE pinned = CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_OPEN_NO_RECALL, nullptr);
    if (pinned == INVALID_HANDLE_VALUE) return false;
    if (IsLink(pinned)) {
      CloseHandle(pinned);
      return false;
    }
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
      CloseHandle(pinned);
      return false;
    }
    std::vector<char> buffer(64 * 1024);
    DWORD done = 0;
    while (::ReadFile(file, buffer.data(), static_cast<DWORD>(buffer.size()), &done, nullptr) && done > 0) {
    }
    CloseHandle(file);
    bool fetched = !IsPlaceholder(GetFileAttributesW(path.c_str()));
    CloseHandle(pinned);
    return fetched;
  }

  std::mutex m_lock;
  std::deque<std::wstring> m_queue;
  std::map<std::wstring, std::chrono::steady_clock::time_point> m_tried;
  bool m_running = false;
  std::atomic<uint32_t> m_hydrated{0};
};

}
