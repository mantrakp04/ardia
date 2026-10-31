#include "ardia/linux/ac_linux_import_storage.h"

#include <dirent.h>
#include <fcntl.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>

#include "third_party/sqlite/sqlite3.h"

namespace ardia::linux_import {

std::string Join(std::string_view directory, std::string_view name) {
  if (name.empty() || name == ".") return std::string(directory);
  std::string path(directory);
  if (path.empty() || path.back() != '/') path.push_back('/');
  path += name;
  return path;
}

bool IsDirectory(const std::string& path) {
  struct stat info;
  return !path.empty() && stat(path.c_str(), &info) == 0 && S_ISDIR(info.st_mode);
}

bool IsFile(const std::string& path) {
  struct stat info;
  return !path.empty() && stat(path.c_str(), &info) == 0 && S_ISREG(info.st_mode);
}

std::vector<std::string> ListDirectory(const std::string& path) {
  std::vector<std::string> names;
  DIR* directory = opendir(path.c_str());
  if (!directory) return names;
  while (dirent* entry = readdir(directory)) {
    const std::string name = entry->d_name;
    if (name != "." && name != "..") names.push_back(name);
  }
  closedir(directory);
  std::sort(names.begin(), names.end());
  return names;
}

FileRead CopyFile(const std::string& from, const std::string& to, size_t max_bytes, const ImportObserver* observer) {
  const int in = open(from.c_str(), O_RDONLY | O_CLOEXEC | O_NOCTTY | O_NOFOLLOW | O_NONBLOCK);
  if (in < 0) return errno == ENOENT ? FileRead::kMissing : FileRead::kUnreadable;
  struct stat info;
  if (fstat(in, &info) != 0 || !S_ISREG(info.st_mode)) {
    close(in);
    return FileRead::kUnreadable;
  }
  if (static_cast<uint64_t>(info.st_size) > max_bytes) {
    close(in);
    return FileRead::kTooLarge;
  }
  const int out = open(to.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (out < 0) {
    close(in);
    return FileRead::kUnreadable;
  }
  std::vector<char> buffer(64 * 1024);
  bool ok = true;
  uint64_t copied = 0;
  int chunks = 0;
  while (ok) {
    if (observer && ++chunks % 64 == 0 && observer->Cancelled()) {
      ok = false;
      break;
    }
    const ssize_t got = read(in, buffer.data(), buffer.size());
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) {
      ok = got == 0;
      break;
    }
    copied += static_cast<uint64_t>(got);
    if (copied > max_bytes) {
      ok = false;
      break;
    }
    for (ssize_t written = 0; written < got;) {
      const ssize_t put = write(out, buffer.data() + written, static_cast<size_t>(got - written));
      if (put < 0 && errno == EINTR) continue;
      if (put <= 0) {
        ok = false;
        break;
      }
      written += put;
    }
  }
  close(in);
  if (close(out) != 0) ok = false;
  return ok ? FileRead::kOk : FileRead::kUnreadable;
}

ScratchDirectory::ScratchDirectory(const std::string& root) {
  std::string pattern = Join(root.empty() ? "/tmp" : root, "ardia-import-XXXXXX");
  std::vector<char> buffer(pattern.begin(), pattern.end());
  buffer.push_back('\0');
  if (mkdtemp(buffer.data())) path_ = buffer.data();
}

ScratchDirectory::~ScratchDirectory() {
  if (path_.empty()) return;
  for (const std::string& name : ListDirectory(path_)) unlink(Join(path_, name).c_str());
  rmdir(path_.c_str());
}

std::string ScratchDirectory::Next() {
  return Join(path_, "copy-" + std::to_string(++counter_));
}

Statement::Statement(sqlite3* db, const std::string& sql) {
  if (sqlite3_prepare_v2(db, sql.c_str(), static_cast<int>(sql.size()), &statement_, nullptr) != SQLITE_OK) {
    sqlite3_finalize(statement_);
    statement_ = nullptr;
  }
}

Statement::~Statement() {
  sqlite3_finalize(statement_);
}

void Statement::Bind(int index, int64_t value) {
  if (statement_) sqlite3_bind_int64(statement_, index, value);
}

void Statement::BindStatic(int index, std::string_view text) {
  if (statement_) sqlite3_bind_text(statement_, index, text.data(), static_cast<int>(text.size()), nullptr);
}

bool Statement::Step() {
  if (!statement_) return false;
  const int result = sqlite3_step(statement_);
  if (result == SQLITE_ROW) return true;
  if (result != SQLITE_DONE) failed_ = true;
  return false;
}

int Statement::Column(std::string_view name) const {
  if (!statement_) return -1;
  for (int i = 0; i < sqlite3_column_count(statement_); ++i) {
    const char* column = sqlite3_column_name(statement_, i);
    if (column && name == column) return i;
  }
  return -1;
}

bool Statement::IsNull(int i) const {
  return i < 0 || sqlite3_column_type(statement_, i) == SQLITE_NULL;
}

int64_t Statement::Int(int i) const {
  return i < 0 ? 0 : sqlite3_column_int64(statement_, i);
}

std::string Statement::Text(int i) const {
  if (i < 0) return {};
  const unsigned char* text = sqlite3_column_text(statement_, i);
  const int bytes = sqlite3_column_bytes(statement_, i);
  return text ? std::string(reinterpret_cast<const char*>(text), static_cast<size_t>(bytes)) : std::string();
}

std::string Statement::Blob(int i) const {
  if (i < 0) return {};
  const void* blob = sqlite3_column_blob(statement_, i);
  const int bytes = sqlite3_column_bytes(statement_, i);
  return blob ? std::string(static_cast<const char*>(blob), static_cast<size_t>(bytes)) : std::string();
}

std::unique_ptr<Database> Database::Snapshot(const std::string& source, ScratchDirectory& scratch,
                                             const ImportObserver& observer, FileRead* status) {
  if (!scratch.ok()) {
    *status = FileRead::kUnreadable;
    return nullptr;
  }
  const std::string copy = scratch.Next();
  *status = CopyFile(source, copy, kMaxDatabaseBytes, &observer);
  if (*status != FileRead::kOk) return nullptr;
  for (const char* suffix : {"-wal", "-journal"}) {
    const FileRead side = CopyFile(source + suffix, copy + suffix, kMaxDatabaseBytes, &observer);
    if (side != FileRead::kOk && side != FileRead::kMissing) {
      *status = side;
      return nullptr;
    }
  }
  if (sqlite3_initialize() != SQLITE_OK) {
    *status = FileRead::kUnreadable;
    return nullptr;
  }
  sqlite3* db = nullptr;
  if (sqlite3_open_v2(copy.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_NOMUTEX, nullptr) != SQLITE_OK) {
    sqlite3_close_v2(db);
    *status = FileRead::kUnreadable;
    return nullptr;
  }
  return std::unique_ptr<Database>(new Database(db));
}

Database::Database(sqlite3* db) : db_(db) {}

Database::~Database() {
  sqlite3_close_v2(db_);
}

bool Database::HasTable(std::string_view name) {
  Statement statement(db_, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1");
  statement.BindStatic(1, name);
  return statement.Step();
}

}
