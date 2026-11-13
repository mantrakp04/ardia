#pragma once

#include <wincrypt.h>
#include <winsqlite/winsqlite3.h>

#include <chrono>
#include <cmath>
#include <map>
#include <memory>
#include <mutex>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "DocumentsModule.h"
#include "Paths.h"

#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "winsqlite3.lib")

namespace Ardia {

namespace ImportFiles {

inline constexpr uint64_t kLargestFileBytes = 256ull << 20;
inline constexpr size_t kLargestQueryRows = 2'000'000;
inline constexpr char kSnapshotPrefix[] = "ardia-import-";

inline std::wstring SecretStoreKey(std::wstring name) {
  size_t stream = name.find(L':');
  if (stream != std::wstring::npos) name.resize(stream);
  CharLowerBuffW(name.data(), static_cast<DWORD>(name.size()));
  while (!name.empty() && (name.back() == L'.' || name.back() == L' ')) name.pop_back();
  for (const wchar_t *suffix : {L"-wal", L"-journal", L"-shm"}) {
    std::wstring_view tail{suffix};
    if (name.size() > tail.size() && name.compare(name.size() - tail.size(), tail.size(), tail) == 0) name.resize(name.size() - tail.size());
  }
  return name;
}

inline bool IsSecretName(std::wstring const &key) noexcept {
  for (const wchar_t *secret : {L"cookies", L"cookies.sqlite", L"login data", L"login data for account", L"web data", L"key4.db", L"logins.db", L"logins.json"})
    if (key == secret) return true;
  return false;
}

inline bool IsSecretStore(std::filesystem::path const &path) noexcept {
  try {
    if (IsSecretName(SecretStoreKey(path.filename().wstring()))) return true;
    HANDLE file = CreateFileW(path.c_str(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    std::wstring real(32768, L'\0');
    DWORD length = GetFinalPathNameByHandleW(file, real.data(), static_cast<DWORD>(real.size()), FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    CloseHandle(file);
    if (length == 0 || length >= real.size()) return true;
    real.resize(length);
    return IsSecretName(SecretStoreKey(std::filesystem::path{real}.filename().wstring()));
  } catch (...) {
    return true;
  }
}

inline void AppendJsonString(std::string &out, std::string_view text) {
  out.push_back('"');
  for (unsigned char c : text) {
    switch (c) {
      case '"': out.append("\\\""); break;
      case '\\': out.append("\\\\"); break;
      case '\n': out.append("\\n"); break;
      case '\r': out.append("\\r"); break;
      case '\t': out.append("\\t"); break;
      default:
        if (c < 0x20) {
          char escaped[8];
          snprintf(escaped, sizeof(escaped), "\\u%04x", c);
          out.append(escaped);
        } else {
          out.push_back(static_cast<char>(c));
        }
    }
  }
  out.push_back('"');
}

inline std::string JsonString(std::string_view text) {
  std::string out;
  AppendJsonString(out, text);
  return out;
}

inline void AppendNumber(std::string &out, double value) {
  if (!std::isfinite(value)) {
    out.append("null");
    return;
  }
  if (value == std::floor(value) && std::fabs(value) < 9e15) {
    out.append(std::to_string(static_cast<int64_t>(value)));
    return;
  }
  char text[40];
  snprintf(text, sizeof(text), "%.17g", value);
  out.append(text);
}

inline std::string Base64(const uint8_t *data, size_t size) {
  if (size == 0) return {};
  DWORD length = 0;
  DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
  if (size > 0x7fffffff || !CryptBinaryToStringA(data, static_cast<DWORD>(size), flags, nullptr, &length)) return {};
  std::string out(length, '\0');
  if (!CryptBinaryToStringA(data, static_cast<DWORD>(size), flags, out.data(), &length)) return {};
  out.resize(length);
  while (!out.empty() && out.back() == '\0') out.pop_back();
  return out;
}

inline std::string TextOf(std::string bytes) {
  if (bytes.size() >= 3 && static_cast<unsigned char>(bytes[0]) == 0xEF && static_cast<unsigned char>(bytes[1]) == 0xBB &&
      static_cast<unsigned char>(bytes[2]) == 0xBF)
    bytes.erase(0, 3);
  if (Files::IsValidUtf8(bytes)) return bytes;
  if (bytes.size() > static_cast<size_t>(INT32_MAX)) return {};
  int count = MultiByteToWideChar(1252, 0, bytes.data(), static_cast<int>(bytes.size()), nullptr, 0);
  std::wstring wide(static_cast<size_t>(count), L'\0');
  MultiByteToWideChar(1252, 0, bytes.data(), static_cast<int>(bytes.size()), wide.data(), count);
  return Paths::Utf8(wide);
}

inline std::wstring RealPath(HANDLE file) {
  std::wstring real(32768, L'\0');
  DWORD length = GetFinalPathNameByHandleW(file, real.data(), static_cast<DWORD>(real.size()), FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (length == 0 || length >= real.size()) return {};
  real.resize(length);
  while (!real.empty() && (real.back() == L'\\' || real.back() == L'/')) real.pop_back();
  return real;
}

inline std::wstring RealFolder(std::filesystem::path const &folder) {
  HANDLE handle = CreateFileW(folder.c_str(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return {};
  std::wstring real = RealPath(handle);
  CloseHandle(handle);
  return real;
}

inline std::optional<std::string> ReadOpened(HANDLE file, uint64_t largest) noexcept {
  try {
    BY_HANDLE_FILE_INFORMATION info{};
    LARGE_INTEGER size{};
    if (!GetFileInformationByHandle(file, &info) || (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) || !GetFileSizeEx(file, &size)) return std::nullopt;
    if (size.QuadPart < 0 || static_cast<uint64_t>(size.QuadPart) > std::min(largest, kLargestFileBytes)) return std::nullopt;
    std::string contents(static_cast<size_t>(size.QuadPart), '\0');
    size_t filled = 0;
    while (filled < contents.size()) {
      DWORD got = 0;
      DWORD chunk = static_cast<DWORD>(std::min<size_t>(contents.size() - filled, 1u << 20));
      if (!ReadFile(file, contents.data() + filled, chunk, &got, nullptr)) return std::nullopt;
      if (got == 0) break;
      filled += got;
    }
    contents.resize(filled);
    return contents;
  } catch (...) {
    return std::nullopt;
  }
}

inline std::optional<std::string> ReadBytes(std::filesystem::path const &path, uint64_t largest) noexcept {
  if (IsSecretStore(path)) return std::nullopt;
  HANDLE file = Files::OpenForReading(path);
  if (file == INVALID_HANDLE_VALUE) return std::nullopt;
  std::optional<std::string> bytes = ReadOpened(file, largest);
  CloseHandle(file);
  return bytes;
}

inline std::optional<std::string> ReadBytesWithin(std::filesystem::path const &folder, std::filesystem::path const &path, uint64_t largest) noexcept {
  try {
    if (IsSecretStore(path)) return std::nullopt;
    std::wstring root = RealFolder(folder);
    if (root.empty()) return std::nullopt;
    HANDLE file = Files::OpenForReading(path);
    if (file == INVALID_HANDLE_VALUE) return std::nullopt;
    std::wstring real = RealPath(file);
    std::optional<std::string> bytes;
    if (!real.empty() && real.size() > root.size() + 1 && real.compare(0, root.size(), root) == 0 && real[root.size()] == L'\\') bytes = ReadOpened(file, largest);
    CloseHandle(file);
    return bytes;
  } catch (...) {
    return std::nullopt;
  }
}

inline double UnixMilliseconds(FILETIME time) noexcept {
  uint64_t ticks = (static_cast<uint64_t>(time.dwHighDateTime) << 32) | time.dwLowDateTime;
  return static_cast<double>(ticks / 10000) - 11644473600000.0;
}

inline std::string ListJson(std::filesystem::path const &folder) {
  WIN32_FIND_DATAW found{};
  HANDLE search = FindFirstFileExW((folder / L"*").c_str(), FindExInfoBasic, &found, FindExSearchNameMatch, nullptr, 0);
  if (search == INVALID_HANDLE_VALUE) {
    DWORD error = GetLastError();
    if (error == ERROR_ACCESS_DENIED) return "{\"denied\":true}";
    return "null";
  }
  std::string out = "[";
  bool first = true;
  do {
    std::wstring_view name{found.cFileName};
    if (name == L"." || name == L"..") continue;
    if (!first) out.push_back(',');
    first = false;
    bool directory = (found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
    uint64_t size = (static_cast<uint64_t>(found.nFileSizeHigh) << 32) | found.nFileSizeLow;
    out.append("{\"name\":");
    AppendJsonString(out, Paths::Utf8(name));
    out.append(directory ? ",\"dir\":true,\"size\":" : ",\"dir\":false,\"size\":");
    AppendNumber(out, static_cast<double>(size));
    out.append(",\"modified\":");
    AppendNumber(out, UnixMilliseconds(found.ftLastWriteTime));
    out.push_back('}');
  } while (FindNextFileW(search, &found));
  FindClose(search);
  out.push_back(']');
  return out;
}

enum class CopyOutcome { copied, missing, inUse, failed };

inline CopyOutcome CopyShared(std::filesystem::path const &from, std::filesystem::path const &to) noexcept {
  HANDLE source = Files::OpenForReading(from);
  if (source == INVALID_HANDLE_VALUE) {
    DWORD error = GetLastError();
    if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) return CopyOutcome::missing;
    if (error == ERROR_SHARING_VIOLATION || error == ERROR_LOCK_VIOLATION) return CopyOutcome::inUse;
    return CopyOutcome::failed;
  }
  HANDLE target = CreateFileW(to.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_TEMPORARY, nullptr);
  if (target == INVALID_HANDLE_VALUE) {
    CloseHandle(source);
    return CopyOutcome::failed;
  }
  std::vector<char> buffer(256 * 1024);
  CopyOutcome outcome = CopyOutcome::copied;
  for (;;) {
    DWORD got = 0;
    if (!ReadFile(source, buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr)) {
      outcome = GetLastError() == ERROR_LOCK_VIOLATION ? CopyOutcome::inUse : CopyOutcome::failed;
      break;
    }
    if (got == 0) break;
    DWORD wrote = 0;
    if (!WriteFile(target, buffer.data(), got, &wrote, nullptr) || wrote != got) {
      outcome = CopyOutcome::failed;
      break;
    }
  }
  CloseHandle(source);
  CloseHandle(target);
  return outcome;
}

inline constexpr int kCopyAttempts = 3;

struct FileStamp {
  bool present = false;
  int64_t size = 0;
  int64_t written = 0;
  int64_t changed = 0;
  bool operator==(FileStamp const &other) const noexcept {
    return present == other.present && size == other.size && written == other.written && changed == other.changed;
  }
};

inline FileStamp StampOf(std::filesystem::path const &path) noexcept {
  FileStamp stamp;
  HANDLE file = CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, 0, nullptr);
  if (file == INVALID_HANDLE_VALUE) return stamp;
  FILE_BASIC_INFO basic{};
  LARGE_INTEGER size{};
  if (GetFileInformationByHandleEx(file, FileBasicInfo, &basic, sizeof(basic)) && GetFileSizeEx(file, &size)) {
    stamp.present = true;
    stamp.size = size.QuadPart;
    stamp.written = basic.LastWriteTime.QuadPart;
    stamp.changed = basic.ChangeTime.QuadPart;
  }
  CloseHandle(file);
  return stamp;
}

struct FileStamps {
  FileStamp main;
  FileStamp wal;
  bool operator==(FileStamps const &other) const noexcept { return main == other.main && wal == other.wal; }
};

inline FileStamps StampsOf(std::filesystem::path const &source) noexcept {
  return FileStamps{StampOf(source), StampOf(std::filesystem::path{source.wstring() + L"-wal"})};
}

class Snapshot {
 public:
  explicit Snapshot(std::filesystem::path const &source) noexcept {
    uint64_t random = 0;
    BCryptGenRandom(nullptr, reinterpret_cast<PUCHAR>(&random), sizeof(random), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    wchar_t name[96]{};
    swprintf_s(name, L"%hs%lu-%016llx", kSnapshotPrefix, GetCurrentProcessId(), static_cast<unsigned long long>(random));
    std::error_code ignored;
    m_folder = std::filesystem::temp_directory_path(ignored) / name;
    if (!std::filesystem::create_directories(m_folder, ignored)) {
      m_failure = "noTemp";
      return;
    }
    std::filesystem::path copy = m_folder / L"db.sqlite";
    for (int attempt = 1;; attempt++) {
      if (CopyAll(source, copy)) break;
      if (!m_failure.empty()) return;
      std::error_code removed;
      for (const wchar_t *suffix : {L"", L"-wal", L"-journal"}) std::filesystem::remove(std::filesystem::path{copy.wstring() + suffix}, removed);
      if (attempt == kCopyAttempts) {
        m_failure = "inUse";
        return;
      }
      Sleep(150);
    }
    std::string utf8 = Paths::Utf8(copy.wstring());
    if (sqlite3_open_v2(utf8.c_str(), &m_db, SQLITE_OPEN_READWRITE, nullptr) != SQLITE_OK) {
      sqlite3_close(m_db);
      m_db = nullptr;
      m_failure = "unreadable";
      return;
    }
    sqlite3_busy_timeout(m_db, 2000);
    sqlite3_limit(m_db, SQLITE_LIMIT_ATTACHED, 0);
  }

  ~Snapshot() noexcept {
    if (m_db) sqlite3_close(m_db);
    std::error_code ignored;
    if (!m_folder.empty()) std::filesystem::remove_all(m_folder, ignored);
  }

  Snapshot(Snapshot const &) = delete;
  Snapshot &operator=(Snapshot const &) = delete;

  sqlite3 *Db() const noexcept { return m_db; }
  std::string const &Failure() const noexcept { return m_failure; }

 private:
  bool CopyAll(std::filesystem::path const &source, std::filesystem::path const &copy) noexcept {
    FileStamps before = StampsOf(source);
    CopyOutcome outcome = CopyShared(source, copy);
    if (outcome != CopyOutcome::copied) {
      m_failure = outcome == CopyOutcome::missing ? "missing" : outcome == CopyOutcome::inUse ? "inUse" : "unreadable";
      return false;
    }
    for (const wchar_t *suffix : {L"-wal", L"-journal"}) {
      CopyOutcome copied = CopyShared(std::filesystem::path{source.wstring() + suffix}, std::filesystem::path{copy.wstring() + suffix});
      if (copied == CopyOutcome::inUse || copied == CopyOutcome::failed) {
        m_failure = copied == CopyOutcome::inUse ? "inUse" : "unreadable";
        return false;
      }
    }
    return StampsOf(source) == before;
  }

 public:

 private:
  std::filesystem::path m_folder;
  sqlite3 *m_db = nullptr;
  std::string m_failure;
};

class Statement {
 public:
  Statement(sqlite3 *db, std::string const &sql) noexcept {
    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &m_statement, nullptr) != SQLITE_OK) m_statement = nullptr;
  }
  ~Statement() noexcept {
    if (m_statement) sqlite3_finalize(m_statement);
  }
  Statement(Statement const &) = delete;
  Statement &operator=(Statement const &) = delete;

  sqlite3_stmt *Get() const noexcept { return m_statement; }
  explicit operator bool() const noexcept { return m_statement != nullptr; }

 private:
  sqlite3_stmt *m_statement = nullptr;
};

inline int ColumnIndex(sqlite3_stmt *statement, std::string_view name) noexcept {
  int count = sqlite3_column_count(statement);
  for (int i = 0; i < count; i++) {
    const char *column = sqlite3_column_name(statement, i);
    if (column && name == column) return i;
  }
  return -1;
}

inline std::string ColumnText(sqlite3_stmt *statement, int column) {
  if (column < 0 || sqlite3_column_type(statement, column) == SQLITE_NULL) return {};
  const unsigned char *text = sqlite3_column_text(statement, column);
  int size = sqlite3_column_bytes(statement, column);
  return text ? std::string(reinterpret_cast<const char *>(text), static_cast<size_t>(size)) : std::string{};
}

inline std::optional<int64_t> ColumnInt(sqlite3_stmt *statement, int column) noexcept {
  if (column < 0 || sqlite3_column_type(statement, column) == SQLITE_NULL) return std::nullopt;
  return sqlite3_column_int64(statement, column);
}

enum class Table { present, absent, broken };

inline Table TableIn(sqlite3 *db, const char *table) noexcept {
  Statement found{db, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?"};
  if (!found) return Table::broken;
  sqlite3_bind_text(found.Get(), 1, table, -1, SQLITE_TRANSIENT);
  if (sqlite3_step(found.Get()) != SQLITE_ROW) return Table::broken;
  return sqlite3_column_int64(found.Get(), 0) > 0 ? Table::present : Table::absent;
}

inline bool TableExists(sqlite3 *db, const char *table) noexcept {
  return TableIn(db, table) == Table::present;
}

inline void BindArgument(sqlite3_stmt *statement, int index, winrt::Microsoft::ReactNative::JSValue const &value) {
  using winrt::Microsoft::ReactNative::JSValueType;
  switch (value.Type()) {
    case JSValueType::Int64: sqlite3_bind_int64(statement, index, value.AsInt64()); break;
    case JSValueType::Double: {
      double number = value.AsDouble();
      if (number == std::floor(number) && std::fabs(number) < 9.2e18) sqlite3_bind_int64(statement, index, static_cast<int64_t>(number));
      else sqlite3_bind_double(statement, index, number);
      break;
    }
    case JSValueType::String: sqlite3_bind_text(statement, index, value.AsString().c_str(), -1, SQLITE_TRANSIENT); break;
    case JSValueType::Boolean: sqlite3_bind_int64(statement, index, value.AsBoolean() ? 1 : 0); break;
    default: sqlite3_bind_null(statement, index); break;
  }
}

inline void AppendQuery(std::string &out, sqlite3 *db, winrt::Microsoft::ReactNative::JSValue const &query) {
  using winrt::Microsoft::ReactNative::JSValueType;
  std::string sql = query["sql"].AsString();
  Statement statement{db, sql};
  if (!statement) {
    out.append("{\"error\":");
    AppendJsonString(out, sqlite3_errmsg(db));
    out.push_back('}');
    return;
  }
  if (!sqlite3_stmt_readonly(statement.Get())) {
    out.append("{\"error\":\"only reads are allowed\"}");
    return;
  }
  auto const &args = query["args"];
  if (args.Type() == JSValueType::Array) {
    int index = 1;
    for (auto const &value : args.AsArray()) BindArgument(statement.Get(), index++, value);
  }
  size_t limit = kLargestQueryRows;
  if (query["limit"].Type() == JSValueType::Int64 || query["limit"].Type() == JSValueType::Double) {
    double asked = query["limit"].AsDouble();
    if (asked >= 0 && asked < static_cast<double>(kLargestQueryRows)) limit = static_cast<size_t>(asked);
  }
  int columns = sqlite3_column_count(statement.Get());
  out.append("{\"columns\":[");
  for (int i = 0; i < columns; i++) {
    if (i) out.push_back(',');
    const char *name = sqlite3_column_name(statement.Get(), i);
    AppendJsonString(out, name ? name : "");
  }
  out.append("],\"rows\":[");
  size_t rows = 0;
  int step = SQLITE_ROW;
  while (rows < limit && (step = sqlite3_step(statement.Get())) == SQLITE_ROW) {
    if (rows++) out.push_back(',');
    out.push_back('[');
    for (int i = 0; i < columns; i++) {
      if (i) out.push_back(',');
      switch (sqlite3_column_type(statement.Get(), i)) {
        case SQLITE_INTEGER: AppendNumber(out, static_cast<double>(sqlite3_column_int64(statement.Get(), i))); break;
        case SQLITE_FLOAT: AppendNumber(out, sqlite3_column_double(statement.Get(), i)); break;
        case SQLITE_TEXT: {
          std::string text = ColumnText(statement.Get(), i);
          AppendJsonString(out, Files::IsValidUtf8(text) ? text : TextOf(text));
          break;
        }
        case SQLITE_BLOB: {
          auto blob = static_cast<const uint8_t *>(sqlite3_column_blob(statement.Get(), i));
          out.append("{\"blob\":");
          AppendJsonString(out, Base64(blob, static_cast<size_t>(sqlite3_column_bytes(statement.Get(), i))));
          out.push_back('}');
          break;
        }
        default: out.append("null"); break;
      }
    }
    out.push_back(']');
  }
  out.push_back(']');
  if (step != SQLITE_ROW && step != SQLITE_DONE) {
    out.append(",\"error\":");
    AppendJsonString(out, sqlite3_errmsg(db));
  }
  out.push_back('}');
}

inline std::string ResultsJson(sqlite3 *db, winrt::Microsoft::ReactNative::JSValueArray const &queries) {
  std::string out = "{\"results\":[";
  bool first = true;
  for (auto const &query : queries) {
    if (!first) out.push_back(',');
    first = false;
    AppendQuery(out, db, query);
  }
  out.append("]}");
  return out;
}

inline std::string QueryJson(std::filesystem::path const &database, winrt::Microsoft::ReactNative::JSValueArray const &queries) {
  if (IsSecretStore(database)) return "{\"failure\":\"refused\"}";
  Snapshot snapshot{database};
  if (!snapshot.Db()) return "{\"failure\":" + JsonString(snapshot.Failure()) + "}";
  return ResultsJson(snapshot.Db(), queries);
}

class OpenSnapshots {
 public:
  static OpenSnapshots &Shared() noexcept {
    static OpenSnapshots shared;
    return shared;
  }

  std::string Open(std::filesystem::path const &database) {
    if (IsSecretStore(database)) return "{\"failure\":\"refused\"}";
    auto snapshot = std::make_shared<Snapshot>(database);
    if (!snapshot->Db()) return "{\"failure\":" + JsonString(snapshot->Failure()) + "}";
    std::lock_guard guard{m_lock};
    Purge();
    std::string id = "snapshot-" + std::to_string(++m_next);
    m_open[id] = Held{snapshot, std::make_shared<std::mutex>(), std::chrono::steady_clock::now()};
    return "{\"id\":" + JsonString(id) + "}";
  }

  std::string Query(std::string const &id, winrt::Microsoft::ReactNative::JSValueArray const &queries) {
    Held held;
    {
      std::lock_guard guard{m_lock};
      auto found = m_open.find(id);
      if (found == m_open.end()) return "{\"failure\":\"closed\"}";
      found->second.used = std::chrono::steady_clock::now();
      held = found->second;
    }
    std::lock_guard busy{*held.busy};
    return ResultsJson(held.snapshot->Db(), queries);
  }

  void Close(std::string const &id) {
    std::shared_ptr<Snapshot> closing;
    std::lock_guard guard{m_lock};
    auto found = m_open.find(id);
    if (found == m_open.end()) return;
    closing = found->second.snapshot;
    m_open.erase(found);
  }

 private:
  struct Held {
    std::shared_ptr<Snapshot> snapshot;
    std::shared_ptr<std::mutex> busy;
    std::chrono::steady_clock::time_point used;
  };

  void Purge() {
    auto cutoff = std::chrono::steady_clock::now() - std::chrono::minutes(10);
    for (auto it = m_open.begin(); it != m_open.end();) it = it->second.used < cutoff ? m_open.erase(it) : std::next(it);
  }

  std::mutex m_lock;
  std::map<std::string, Held> m_open;
  uint64_t m_next = 0;
};

}

}
