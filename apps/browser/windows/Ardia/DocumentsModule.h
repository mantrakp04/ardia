#pragma once

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <functional>
#include <future>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

#include "NativeModules.h"
#include "Paths.h"

namespace Ardia {

class SerialQueue {
 public:
  using Task = std::function<void()>;

  void Async(Task task) noexcept { AsyncAfter(std::chrono::milliseconds(0), std::move(task)); }

  void AsyncAfter(std::chrono::milliseconds delay, Task task) noexcept {
    try {
      std::lock_guard<std::mutex> guard(m_mutex);
      StartIfNeeded();
      m_tasks.emplace(std::chrono::steady_clock::now() + delay, std::move(task));
      m_wake.notify_one();
    } catch (...) {
    }
  }

  void Sync(Task task) noexcept {
    if (OnQueue()) {
      Run(task);
      return;
    }
    try {
      auto finished = std::make_shared<std::promise<void>>();
      std::future<void> done = finished->get_future();
      Async([task = std::move(task), finished]() {
        Run(task);
        finished->set_value();
      });
      done.wait_for(std::chrono::seconds(30));
    } catch (...) {
    }
  }

  bool OnQueue() const noexcept { return m_started.load(std::memory_order_acquire) && std::this_thread::get_id() == m_threadId; }

 private:
  static void Run(Task const &task) noexcept {
    try {
      if (task) task();
    } catch (...) {
    }
  }

  void StartIfNeeded() {
    if (m_started.load(std::memory_order_acquire)) return;
    std::thread worker([this]() { Loop(); });
    m_threadId = worker.get_id();
    m_started.store(true, std::memory_order_release);
    worker.detach();
  }

  void Loop() noexcept {
    std::unique_lock<std::mutex> lock(m_mutex);
    for (;;) {
      if (m_tasks.empty()) {
        m_wake.wait(lock);
        continue;
      }
      auto first = m_tasks.begin();
      if (first->first > std::chrono::steady_clock::now()) {
        m_wake.wait_until(lock, first->first);
        continue;
      }
      Task task = std::move(first->second);
      m_tasks.erase(first);
      lock.unlock();
      Run(task);
      lock.lock();
    }
  }

  std::mutex m_mutex;
  std::condition_variable m_wake;
  std::multimap<std::chrono::steady_clock::time_point, Task> m_tasks;
  std::thread::id m_threadId;
  std::atomic<bool> m_started{false};
};

namespace Files {

inline bool IsValidUtf8(std::string_view bytes) noexcept {
  if (bytes.empty()) return true;
  if (bytes.size() > static_cast<size_t>(INT32_MAX)) return false;
  return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes.data(), static_cast<int>(bytes.size()), nullptr, 0) > 0;
}

inline std::wstring ErrorText(DWORD code) noexcept {
  wchar_t *buffer = nullptr;
  DWORD length = FormatMessageW(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, nullptr, code, 0,
      reinterpret_cast<wchar_t *>(&buffer), 0, nullptr);
  std::wstring text = length && buffer ? std::wstring(buffer, length) : L"error " + std::to_wstring(code);
  if (buffer) LocalFree(buffer);
  while (!text.empty() && (text.back() == L'\n' || text.back() == L'\r' || text.back() == L' ' || text.back() == L'.')) text.pop_back();
  return text;
}

inline std::optional<std::string> ReadAll(std::filesystem::path const &path) noexcept {
  HANDLE file = CreateFileW(
      path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL,
      nullptr);
  if (file == INVALID_HANDLE_VALUE) return std::nullopt;
  std::optional<std::string> result;
  LARGE_INTEGER size{};
  if (GetFileSizeEx(file, &size) && size.QuadPart >= 0 && size.QuadPart < (1ll << 31)) {
    try {
      std::string contents;
      contents.reserve(static_cast<size_t>(size.QuadPart));
      std::vector<char> buffer(64 * 1024);
      bool failed = false;
      for (;;) {
        DWORD got = 0;
        if (!ReadFile(file, buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr)) {
          failed = true;
          break;
        }
        if (got == 0) break;
        contents.append(buffer.data(), got);
      }
      if (!failed) result = std::move(contents);
    } catch (...) {
    }
  }
  CloseHandle(file);
  return result;
}

inline std::wstring TempSibling(std::filesystem::path const &target) noexcept {
  uint64_t random = 0;
  BCryptGenRandom(nullptr, reinterpret_cast<PUCHAR>(&random), sizeof(random), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
  wchar_t suffix[64]{};
  swprintf_s(suffix, L".%lu.%016llx.tmp", GetCurrentProcessId(), static_cast<unsigned long long>(random));
  std::filesystem::path temp = target.parent_path() / (L"." + target.filename().wstring() + suffix);
  return temp.wstring();
}

inline DWORD ReplaceAtomically(std::filesystem::path const &target, std::string_view bytes) noexcept {
  std::wstring temp = TempSibling(target);
  HANDLE file = CreateFileW(temp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return GetLastError();
  DWORD failure = ERROR_SUCCESS;
  size_t offset = 0;
  while (offset < bytes.size()) {
    DWORD chunk = static_cast<DWORD>(std::min<size_t>(bytes.size() - offset, 1u << 20));
    DWORD wrote = 0;
    if (!WriteFile(file, bytes.data() + offset, chunk, &wrote, nullptr) || wrote == 0) {
      failure = GetLastError();
      if (failure == ERROR_SUCCESS) failure = ERROR_WRITE_FAULT;
      break;
    }
    offset += wrote;
  }
  if (failure == ERROR_SUCCESS && !FlushFileBuffers(file)) failure = GetLastError();
  CloseHandle(file);
  if (failure == ERROR_SUCCESS) {
    for (int attempt = 0; attempt < 5; attempt++) {
      if (MoveFileExW(temp.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) return ERROR_SUCCESS;
      failure = GetLastError();
      if (failure != ERROR_ACCESS_DENIED && failure != ERROR_SHARING_VIOLATION && failure != ERROR_LOCK_VIOLATION) break;
      Sleep(20u << attempt);
    }
  }
  DeleteFileW(temp.c_str());
  return failure == ERROR_SUCCESS ? ERROR_WRITE_FAULT : failure;
}

inline bool RemoveFile(std::filesystem::path const &path) noexcept {
  if (DeleteFileW(path.c_str())) return true;
  DWORD error = GetLastError();
  return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND;
}

}

class DocumentStore {
 public:
  using Done = std::function<void(std::optional<std::string> const &)>;

  static std::optional<std::filesystem::path> Url(std::string_view name) noexcept {
    std::wstring wide = Paths::Wide(name);
    size_t slash = wide.find_last_of(L"/\\");
    std::wstring last = slash == std::wstring::npos ? wide : wide.substr(slash + 1);
    if (last.empty() || last == L"." || last == L"..") return std::nullopt;
    for (wchar_t c : last) {
      if (c < 32 || c == L'<' || c == L'>' || c == L':' || c == L'"' || c == L'|' || c == L'?' || c == L'*') return std::nullopt;
    }
    if (last.back() == L'.' || last.back() == L' ') return std::nullopt;
    try {
      std::filesystem::path directory = Paths::DataDirectory();
      std::error_code ignored;
      std::filesystem::create_directories(directory, ignored);
      return directory / last;
    } catch (...) {
      return std::nullopt;
    }
  }

  static std::optional<std::string> Read(std::string_view name) noexcept {
    auto url = Url(name);
    if (!url) return std::nullopt;
    std::wstring key = url->filename().wstring();
    {
      std::lock_guard<std::mutex> guard(State().mutex);
      auto found = State().staged.find(key);
      if (found != State().staged.end()) return found->second.contents;
      if (State().removing.contains(key)) return std::nullopt;
    }
    auto contents = Files::ReadAll(*url);
    if (!contents || !Files::IsValidUtf8(*contents)) return std::nullopt;
    return contents;
  }

  static bool Write(std::string_view name, std::string contents, Done done = nullptr) noexcept {
    auto url = Url(name);
    if (!url) {
      if (done) done(std::string("Invalid document name"));
      return false;
    }
    RegisterFlushOnExit();
    std::wstring key = url->filename().wstring();
    uint64_t mine = 0;
    bool closed = false;
    bool staged = false;
    try {
      std::lock_guard<std::mutex> guard(State().mutex);
      closed = State().closed;
      if (!closed) {
        Staged &slot = State().staged[key];
        mine = ++State().generation;
        slot.path = *url;
        slot.generation = mine;
        slot.contents = std::move(contents);
        if (done) slot.waiters.push_back(std::move(done));
        staged = true;
      }
    } catch (...) {
    }
    if (!staged) {
      if (done) done(std::string(closed ? "Documents are closed" : "Out of memory"));
      return false;
    }
    Queue().Async([key, mine]() { Land(key, mine, 0); });
    return true;
  }

  static void WhenSaved(std::string_view name, Done done) noexcept {
    auto url = Url(name);
    if (!url) {
      done(std::string("Invalid document name"));
      return;
    }
    std::wstring key = url->filename().wstring();
    {
      std::lock_guard<std::mutex> guard(State().mutex);
      auto found = State().staged.find(key);
      if (found != State().staged.end()) {
        found->second.waiters.push_back(std::move(done));
        return;
      }
    }
    done(std::nullopt);
  }

  static bool Remove(std::string_view name) noexcept {
    auto url = Url(name);
    if (!url) return false;
    std::wstring key = url->filename().wstring();
    std::vector<Done> waiters;
    {
      std::lock_guard<std::mutex> guard(State().mutex);
      if (State().closed) return false;
      ++State().generation;
      auto found = State().staged.find(key);
      if (found != State().staged.end()) {
        waiters = std::move(found->second.waiters);
        State().staged.erase(found);
      }
      ++State().removing[key];
    }
    std::filesystem::path path = *url;
    Queue().Async([path, key, waiters = std::move(waiters)]() {
      {
        std::unique_lock<std::timed_mutex> writing(State().writing, std::chrono::seconds(10));
        Files::RemoveFile(path);
      }
      {
        std::lock_guard<std::mutex> guard(State().mutex);
        auto pending = State().removing.find(key);
        if (pending != State().removing.end() && --pending->second <= 0) State().removing.erase(pending);
      }
      for (auto const &waiter : waiters) waiter(std::nullopt);
    });
    return true;
  }

  static void Close() noexcept {
    std::lock_guard<std::mutex> guard(State().mutex);
    State().closed = true;
  }

  static bool Flush(bool notifyWaiters = true) noexcept {
    std::vector<std::wstring> keys;
    {
      std::lock_guard<std::mutex> guard(State().mutex);
      for (auto const &entry : State().staged) keys.push_back(entry.first);
    }
    for (auto const &key : keys) {
      std::optional<uint64_t> generation;
      {
        std::lock_guard<std::mutex> guard(State().mutex);
        auto found = State().staged.find(key);
        if (found != State().staged.end()) generation = found->second.generation;
      }
      if (generation) Land(key, *generation, FlushAttempt, notifyWaiters);
    }
    std::lock_guard<std::mutex> guard(State().mutex);
    return State().staged.empty();
  }

 private:
  static constexpr int FlushAttempt = 99;

  struct Staged {
    std::filesystem::path path;
    uint64_t generation = 0;
    std::string contents;
    std::vector<Done> waiters;
  };

  struct Shared {
    std::mutex mutex;
    std::timed_mutex writing;
    std::map<std::wstring, Staged> staged;
    std::map<std::wstring, int> removing;
    uint64_t generation = 0;
    bool closed = false;
  };

  static Shared &State() noexcept {
    static Shared *shared = new Shared();
    return *shared;
  }

  static SerialQueue &Queue() noexcept {
    static SerialQueue *queue = new SerialQueue();
    return *queue;
  }

  static void RegisterFlushOnExit() noexcept {
    static const bool registered = [] {
      std::atexit([] { Flush(false); });
      return true;
    }();
    (void)registered;
  }

  static void Land(std::wstring const &key, uint64_t generation, int attempt, bool notifyWaiters = true) noexcept {
    std::unique_lock<std::timed_mutex> writing(State().writing, std::defer_lock);
    if (!writing.try_lock_for(std::chrono::seconds(attempt == FlushAttempt ? 2 : 30))) {
      if (attempt != FlushAttempt) Queue().AsyncAfter(std::chrono::seconds(1), [key, generation, attempt]() { Land(key, generation, attempt); });
      return;
    }
    std::filesystem::path path;
    std::string contents;
    {
      std::lock_guard<std::mutex> guard(State().mutex);
      auto found = State().staged.find(key);
      if (found == State().staged.end() || found->second.generation != generation) return;
      path = found->second.path;
      contents = found->second.contents;
    }
    std::error_code ignored;
    std::filesystem::create_directories(path.parent_path(), ignored);
    DWORD failure = Files::ReplaceAtomically(path, contents);
    writing.unlock();
    std::optional<std::string> message;
    if (failure != ERROR_SUCCESS) message = Paths::Utf8(Files::ErrorText(failure));
    std::vector<Done> waiters;
    {
      std::lock_guard<std::mutex> guard(State().mutex);
      auto found = State().staged.find(key);
      if (found != State().staged.end() && found->second.generation == generation) {
        waiters = std::move(found->second.waiters);
        found->second.waiters.clear();
        if (!message) State().staged.erase(found);
      }
    }
    if (notifyWaiters) {
      for (auto const &waiter : waiters) waiter(message);
    } else if (!waiters.empty()) {
      new std::vector<Done>(std::move(waiters));
    }
    if (!message) return;
    OutputDebugStringW((L"Ardia: saving " + key + L" failed (try " + std::to_wstring(attempt + 1) + L"): " + Paths::Wide(*message) + L"\n").c_str());
    if (attempt == FlushAttempt) return;
    int delaySeconds = std::min(60, 2 << std::min(attempt, 5));
    Queue().AsyncAfter(std::chrono::seconds(delaySeconds), [key, generation, attempt]() { Land(key, generation, attempt + 1); });
  }
};

REACT_MODULE(DocumentsModule, L"ArdiaDocuments")
struct DocumentsModule {
  REACT_SYNC_METHOD(readDocument)
  std::optional<std::string> readDocument(std::string name) noexcept { return DocumentStore::Read(name); }

  REACT_SYNC_METHOD(writeDocument)
  bool writeDocument(std::string name, std::string contents) noexcept { return DocumentStore::Write(name, std::move(contents)); }

  REACT_METHOD(saveDocument)
  void saveDocument(std::string name, std::string contents, winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    DocumentStore::Write(name, std::move(contents), Settle(promise));
  }

  REACT_METHOD(documentSaved)
  void documentSaved(std::string name, winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    DocumentStore::WhenSaved(name, Settle(promise));
  }

  REACT_SYNC_METHOD(removeDocument)
  bool removeDocument(std::string name) noexcept { return DocumentStore::Remove(name); }

 private:
  static DocumentStore::Done Settle(winrt::Microsoft::ReactNative::ReactPromise<void> const &promise) noexcept {
    return [promise](std::optional<std::string> const &error) {
      if (!error) return promise.Resolve();
      winrt::Microsoft::ReactNative::ReactError failure;
      failure.Code = "ERR_SAVE_DOCUMENT";
      failure.Message = *error;
      promise.Reject(failure);
    };
  }
};

}
