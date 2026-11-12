#pragma once

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cwctype>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

#include "DocumentsModule.h"
#include "Events.h"
#include "NativeModules.h"
#include "Paths.h"

namespace Ardia {

namespace ConfigFolder {

inline constexpr int64_t ReadLimit = 1 << 20;
inline constexpr std::string_view MissingStamp = "missing";

inline bool IsSchemaName(std::string_view name) noexcept {
  return name == "config.schema.json" || name == "theme.schema.json";
}

inline bool IsThemeFile(std::string_view name) noexcept {
  constexpr std::string_view prefix = "themes/";
  constexpr std::string_view suffix = ".json";
  if (name.size() <= prefix.size() + suffix.size()) return false;
  if (name.substr(0, prefix.size()) != prefix || name.substr(name.size() - suffix.size()) != suffix) return false;
  std::string_view stem = name.substr(prefix.size(), name.size() - prefix.size() - suffix.size());
  auto isLowerAlnum = [](char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); };
  if (!isLowerAlnum(stem.front())) return false;
  for (char c : stem) {
    if (!isLowerAlnum(c) && c != '_' && c != '-') return false;
  }
  return true;
}

inline bool IsWatchable(std::string_view name) noexcept {
  return name == "config.json" || name == "hooks.json" || IsThemeFile(name);
}

inline std::filesystem::path PathOf(std::string_view name) {
  std::filesystem::path path = Paths::ConfigDirectory() / std::filesystem::path(Paths::Wide(name));
  return path.make_preferred();
}

inline std::string HandleStamp(HANDLE file) noexcept {
  BY_HANDLE_FILE_INFORMATION info{};
  if (!GetFileInformationByHandle(file, &info)) return "unreadable:" + std::to_string(GetLastError());
  FILE_BASIC_INFO basic{};
  int64_t changed = 0;
  if (GetFileInformationByHandleEx(file, FileBasicInfo, &basic, sizeof(basic))) changed = basic.ChangeTime.QuadPart;
  uint64_t index = (static_cast<uint64_t>(info.nFileIndexHigh) << 32) | info.nFileIndexLow;
  uint64_t size = (static_cast<uint64_t>(info.nFileSizeHigh) << 32) | info.nFileSizeLow;
  uint64_t written = (static_cast<uint64_t>(info.ftLastWriteTime.dwHighDateTime) << 32) | info.ftLastWriteTime.dwLowDateTime;
  return std::to_string(info.dwVolumeSerialNumber) + ":" + std::to_string(index) + ":" + std::to_string(size) + ":" + std::to_string(written) + ":" +
      std::to_string(changed);
}

struct Reading {
  std::string status;
  std::optional<std::string> text;
  std::optional<std::string> stamp;
};

inline Reading ReadRegularFile(std::filesystem::path const &path, bool stamped = false) noexcept {
  HANDLE file = CreateFileW(
      path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS,
      nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    DWORD error = GetLastError();
    bool missing = error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND || error == ERROR_INVALID_NAME || error == ERROR_DIRECTORY;
    Reading result{missing ? "missing" : "unreadable", std::nullopt, std::nullopt};
    if (stamped && (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND)) result.stamp = std::string(MissingStamp);
    return result;
  }
  Reading result{"unreadable", std::nullopt, std::nullopt};
  if (stamped) result.stamp = HandleStamp(file);
  BY_HANDLE_FILE_INFORMATION info{};
  if (!GetFileInformationByHandle(file, &info)) {
    CloseHandle(file);
    return result;
  }
  if ((info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) || GetFileType(file) != FILE_TYPE_DISK) {
    CloseHandle(file);
    result.status = "notFile";
    return result;
  }
  uint64_t size = (static_cast<uint64_t>(info.nFileSizeHigh) << 32) | info.nFileSizeLow;
  if (size > static_cast<uint64_t>(ReadLimit)) {
    CloseHandle(file);
    result.status = "tooBig";
    return result;
  }
  std::string data;
  bool failed = false;
  try {
    data.reserve(static_cast<size_t>(size));
    std::vector<char> buffer(64 * 1024);
    while (static_cast<int64_t>(data.size()) <= ReadLimit) {
      DWORD got = 0;
      if (!ReadFile(file, buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr)) {
        failed = true;
        break;
      }
      if (got == 0) break;
      data.append(buffer.data(), got);
    }
  } catch (...) {
    failed = true;
  }
  CloseHandle(file);
  if (failed) return result;
  if (static_cast<int64_t>(data.size()) > ReadLimit) {
    result.status = "tooBig";
    return result;
  }
  if (!Files::IsValidUtf8(data)) return result;
  result.status = "ok";
  result.text = std::move(data);
  return result;
}

inline Reading Read(std::string_view name) noexcept {
  if (!IsWatchable(name)) return Reading{"unreadable", std::nullopt, std::nullopt};
  try {
    return ReadRegularFile(PathOf(name), name == "hooks.json");
  } catch (...) {
    return Reading{"unreadable", std::nullopt, std::nullopt};
  }
}

inline bool FolderExists() noexcept {
  DWORD attributes = GetFileAttributesW(Paths::ConfigDirectory().c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY);
}

inline std::vector<std::string> WriteSchemas(std::map<std::string, std::string> const &files, std::string &failure) noexcept {
  std::vector<std::string> written;
  try {
    auto schemaDir = DocumentStore::Url("config-schema");
    if (!schemaDir) {
      failure = "No data directory";
      return written;
    }
    std::error_code created;
    std::filesystem::create_directories(*schemaDir, created);
    if (created) {
      failure = created.message();
      return written;
    }
    std::vector<std::filesystem::path> folders{*schemaDir};
    if (FolderExists()) folders.push_back(Paths::ConfigDirectory());
    for (auto const &folder : folders) {
      for (auto const &[name, contents] : files) {
        if (!IsSchemaName(name)) continue;
        std::filesystem::path target = folder / Paths::Wide(name);
        Reading current = ReadRegularFile(target);
        if (current.text && *current.text == contents) continue;
        DWORD error = Files::ReplaceAtomically(target, contents);
        if (error != ERROR_SUCCESS) {
          failure = Paths::Utf8(Files::ErrorText(error));
          return written;
        }
        written.push_back(Paths::Utf8(target.wstring()));
      }
    }
  } catch (...) {
    failure = "Writing the schemas failed";
  }
  return written;
}

}

class DirectoryWatch {
 public:
  DirectoryWatch(bool subtree, DWORD filter) noexcept : m_subtree(subtree), m_filter(filter) {
    m_event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    try {
      m_buffer.resize(16 * 1024);
    } catch (...) {
    }
  }

  ~DirectoryWatch() noexcept {
    Close();
    if (m_event) CloseHandle(m_event);
  }

  DirectoryWatch(DirectoryWatch const &) = delete;
  DirectoryWatch &operator=(DirectoryWatch const &) = delete;

  bool IsOpen() const noexcept { return m_handle != INVALID_HANDLE_VALUE; }
  bool IsPending() const noexcept { return m_pending; }
  HANDLE Event() const noexcept { return m_event; }

  bool Open(std::filesystem::path const &path) noexcept {
    Close();
    if (!m_event || m_buffer.empty()) return false;
    m_handle = CreateFileW(
        path.c_str(), FILE_LIST_DIRECTORY, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED, nullptr);
    if (!IsOpen()) return false;
    if (!Arm()) {
      Close();
      return false;
    }
    return true;
  }

  bool Arm() noexcept {
    if (!IsOpen()) return false;
    m_overlapped = OVERLAPPED{};
    m_overlapped.hEvent = m_event;
    ResetEvent(m_event);
    m_pending = ReadDirectoryChangesW(
                    m_handle, m_buffer.data(), static_cast<DWORD>(m_buffer.size() * sizeof(DWORD)), m_subtree ? TRUE : FALSE, m_filter, nullptr,
                    &m_overlapped, nullptr) != FALSE;
    return m_pending;
  }

  void Close() noexcept {
    if (!IsOpen()) return;
    if (m_pending) {
      CancelIoEx(m_handle, &m_overlapped);
      DWORD ignored = 0;
      GetOverlappedResult(m_handle, &m_overlapped, &ignored, TRUE);
      m_pending = false;
    }
    CloseHandle(m_handle);
    m_handle = INVALID_HANDLE_VALUE;
  }

  enum class Outcome { Changes, Overflow, Failed };

  Outcome Collect(std::vector<std::wstring> &names) noexcept {
    DWORD bytes = 0;
    bool ok = GetOverlappedResult(m_handle, &m_overlapped, &bytes, FALSE) != FALSE;
    m_pending = false;
    if (!ok) {
      Close();
      return Outcome::Failed;
    }
    if (bytes == 0) return Rearmed(Outcome::Overflow);
    try {
      auto *base = reinterpret_cast<BYTE *>(m_buffer.data());
      size_t offset = 0;
      while (offset + sizeof(FILE_NOTIFY_INFORMATION) <= bytes) {
        auto *info = reinterpret_cast<FILE_NOTIFY_INFORMATION *>(base + offset);
        names.emplace_back(info->FileName, info->FileNameLength / sizeof(wchar_t));
        if (info->NextEntryOffset == 0) break;
        offset += info->NextEntryOffset;
      }
    } catch (...) {
      return Rearmed(Outcome::Overflow);
    }
    return Rearmed(Outcome::Changes);
  }

 private:
  Outcome Rearmed(Outcome outcome) noexcept {
    if (Arm()) return outcome;
    Close();
    return Outcome::Failed;
  }

  bool m_subtree;
  DWORD m_filter;
  HANDLE m_handle = INVALID_HANDLE_VALUE;
  HANDLE m_event = nullptr;
  OVERLAPPED m_overlapped{};
  std::vector<DWORD> m_buffer;
  bool m_pending = false;
};

class ConfigWatcher : public std::enable_shared_from_this<ConfigWatcher> {
 public:
  using Notify = std::function<void()>;

  ConfigWatcher() noexcept {
    m_stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    m_rearm = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  }

  ~ConfigWatcher() noexcept {
    if (m_stop) CloseHandle(m_stop);
    if (m_rearm) CloseHandle(m_rearm);
  }

  void Watch(std::vector<std::string> const &names, Notify armed, Notify onChange) noexcept {
    std::vector<std::wstring> relevant;
    try {
      for (auto const &name : names) {
        if (!ConfigFolder::IsWatchable(name)) continue;
        std::wstring entry = Folded(Paths::Wide(name));
        relevant.push_back(entry);
        for (size_t slash = entry.find(L'\\'); slash != std::wstring::npos; slash = entry.find(L'\\', slash + 1)) relevant.push_back(entry.substr(0, slash));
      }
    } catch (...) {
    }
    bool start = false;
    bool usable = m_stop && m_rearm;
    {
      std::lock_guard<std::mutex> guard(m_mutex);
      if (m_stopped) usable = false;
      m_relevant = std::move(relevant);
      if (usable) m_onChange = std::move(onChange);
      try {
        if (armed) m_armed.push_back(std::move(armed));
      } catch (...) {
      }
      if (usable && !m_running) {
        m_running = true;
        start = true;
      }
    }
    if (!usable) {
      ResolveArmed();
      return;
    }
    if (!start) {
      SetEvent(m_rearm);
      return;
    }
    try {
      std::thread([self = shared_from_this()]() { self->Loop(); }).detach();
    } catch (...) {
      {
        std::lock_guard<std::mutex> guard(m_mutex);
        m_running = false;
      }
      ResolveArmed();
    }
  }

  void Stop() noexcept {
    {
      std::lock_guard<std::mutex> guard(m_mutex);
      m_onChange = nullptr;
      m_stopped = true;
    }
    if (m_stop) SetEvent(m_stop);
    ResolveArmed();
  }

 private:
  static constexpr ULONGLONG Latency = 50;
  static constexpr DWORD ReopenPoll = 1000;

  static std::wstring Folded(std::wstring text) {
    for (auto &c : text) {
      if (c == L'/') c = L'\\';
      c = static_cast<wchar_t>(std::towlower(c));
    }
    return text;
  }

  void ResolveArmed() noexcept {
    std::vector<Notify> armed;
    {
      std::lock_guard<std::mutex> guard(m_mutex);
      armed.swap(m_armed);
    }
    for (auto const &done : armed) {
      if (done) done();
    }
  }

  void Fire() noexcept {
    Notify onChange;
    {
      std::lock_guard<std::mutex> guard(m_mutex);
      if (m_stopped) return;
      onChange = m_onChange;
    }
    if (onChange) onChange();
  }

  bool AnyRelevant(std::vector<std::wstring> const &changed) noexcept {
    try {
      std::lock_guard<std::mutex> guard(m_mutex);
      for (auto const &name : changed) {
        std::wstring folded = Folded(name);
        for (auto const &entry : m_relevant) {
          if (folded == entry) return true;
        }
      }
    } catch (...) {
    }
    return false;
  }

  void Loop() noexcept {
    constexpr DWORD folderFilter = FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME | FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_SIZE |
        FILE_NOTIFY_CHANGE_CREATION | FILE_NOTIFY_CHANGE_ATTRIBUTES;
    DirectoryWatch folder(true, folderFilter);
    DirectoryWatch parent(false, FILE_NOTIFY_CHANGE_DIR_NAME);
    std::filesystem::path folderPath;
    std::filesystem::path parentPath;
    std::wstring leaf;
    try {
      folderPath = Paths::ConfigDirectory();
      parentPath = folderPath.parent_path();
      leaf = Folded(folderPath.filename().wstring());
    } catch (...) {
    }
    folder.Open(folderPath);
    parent.Open(parentPath);
    ResolveArmed();
    bool dirty = false;
    ULONGLONG fireAt = 0;
    auto markDirty = [&]() {
      if (dirty) return;
      dirty = true;
      fireAt = GetTickCount64() + Latency;
    };
    for (;;) {
      HANDLE waits[4] = {m_stop, m_rearm, nullptr, nullptr};
      DWORD count = 2;
      int folderSlot = -1;
      int parentSlot = -1;
      if (folder.IsPending()) {
        folderSlot = static_cast<int>(count);
        waits[count++] = folder.Event();
      }
      if (parent.IsPending()) {
        parentSlot = static_cast<int>(count);
        waits[count++] = parent.Event();
      }
      DWORD timeout = INFINITE;
      if (dirty) {
        ULONGLONG now = GetTickCount64();
        timeout = fireAt > now ? static_cast<DWORD>(fireAt - now) : 0;
      }
      if (!folder.IsOpen() || !parent.IsOpen()) timeout = std::min<DWORD>(timeout, ReopenPoll);
      DWORD woke = WaitForMultipleObjects(count, waits, FALSE, timeout);
      if (woke == WAIT_OBJECT_0) break;
      if (woke == WAIT_OBJECT_0 + 1) {
        ResolveArmed();
      } else if (folderSlot >= 0 && woke == WAIT_OBJECT_0 + static_cast<DWORD>(folderSlot)) {
        std::vector<std::wstring> changed;
        auto outcome = folder.Collect(changed);
        if (outcome != DirectoryWatch::Outcome::Changes || AnyRelevant(changed)) markDirty();
      } else if (parentSlot >= 0 && woke == WAIT_OBJECT_0 + static_cast<DWORD>(parentSlot)) {
        std::vector<std::wstring> changed;
        auto outcome = parent.Collect(changed);
        bool moved = outcome == DirectoryWatch::Outcome::Overflow;
        for (auto const &name : changed) {
          try {
            if (Folded(name) == leaf) moved = true;
          } catch (...) {
          }
        }
        if (moved) {
          folder.Open(folderPath);
          markDirty();
        }
      } else if (woke == WAIT_FAILED) {
        Sleep(ReopenPoll);
      }
      if (!folder.IsOpen() && folder.Open(folderPath)) markDirty();
      if (!parent.IsOpen()) parent.Open(parentPath);
      if (dirty && GetTickCount64() >= fireAt) {
        dirty = false;
        Fire();
      }
    }
    std::lock_guard<std::mutex> guard(m_mutex);
    m_running = false;
  }

  std::mutex m_mutex;
  HANDLE m_stop = nullptr;
  HANDLE m_rearm = nullptr;
  std::vector<std::wstring> m_relevant;
  Notify m_onChange;
  std::vector<Notify> m_armed;
  bool m_running = false;
  bool m_stopped = false;
};

REACT_MODULE(ConfigModule, L"ArdiaConfig")
struct ConfigModule {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept { m_context = context; }

  ~ConfigModule() noexcept {
    if (m_watcher) m_watcher->Stop();
  }

  REACT_SYNC_METHOD(readFile)
  winrt::Microsoft::ReactNative::JSValue readFile(std::string name) noexcept {
    ConfigFolder::Reading reading = ConfigFolder::Read(name);
    winrt::Microsoft::ReactNative::JSValueObject result;
    result["status"] = std::move(reading.status);
    if (reading.text) result["text"] = std::move(*reading.text);
    if (reading.stamp) result["stamp"] = std::move(*reading.stamp);
    return winrt::Microsoft::ReactNative::JSValue(std::move(result));
  }

  REACT_METHOD(watch)
  void watch(std::vector<std::string> names, winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    try {
      if (!m_watcher) m_watcher = std::make_shared<ConfigWatcher>();
    } catch (...) {
      promise.Reject("Watching the config folder failed");
      return;
    }
    auto context = m_context;
    m_watcher->Watch(names, [promise]() { promise.Resolve(); }, [context]() { EmitEvent(context, L"ArdiaConfig", L"onChange", winrt::Microsoft::ReactNative::JSValueObject{}); });
  }

  REACT_METHOD(writeSchemas)
  void writeSchemas(std::map<std::string, std::string> files, winrt::Microsoft::ReactNative::ReactPromise<std::vector<std::string>> promise) noexcept {
    try {
      std::thread([files = std::move(files), promise]() {
        std::string failure;
        std::vector<std::string> written = ConfigFolder::WriteSchemas(files, failure);
        if (failure.empty()) promise.Resolve(written);
        else promise.Reject(failure.c_str());
      }).detach();
    } catch (...) {
      promise.Reject("Writing the schemas failed");
    }
  }

 private:
  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
  std::shared_ptr<ConfigWatcher> m_watcher;
};

}
