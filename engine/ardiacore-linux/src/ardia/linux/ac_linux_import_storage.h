#ifndef ARDIA_LINUX_AC_LINUX_IMPORT_STORAGE_H_
#define ARDIA_LINUX_AC_LINUX_IMPORT_STORAGE_H_

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "ardia/linux/ac_linux_import_readers.h"

struct sqlite3;
struct sqlite3_stmt;

namespace ardia::linux_import {

struct Failure {
  std::string code;
  std::string message;
};

std::string Join(std::string_view directory, std::string_view name);
bool IsDirectory(const std::string& path);
bool IsFile(const std::string& path);
std::vector<std::string> ListDirectory(const std::string& path);
FileRead CopyFile(const std::string& from, const std::string& to, size_t max_bytes, const ImportObserver* observer);

class ScratchDirectory {
 public:
  explicit ScratchDirectory(const std::string& root);
  ScratchDirectory(const ScratchDirectory&) = delete;
  ScratchDirectory& operator=(const ScratchDirectory&) = delete;
  ~ScratchDirectory();

  bool ok() const { return !path_.empty(); }
  std::string Next();

 private:
  std::string path_;
  int counter_ = 0;
};

class Statement {
 public:
  Statement(sqlite3* db, const std::string& sql);
  Statement(const Statement&) = delete;
  Statement& operator=(const Statement&) = delete;
  ~Statement();

  bool ok() const { return statement_ != nullptr; }
  bool failed() const { return failed_; }
  void Bind(int index, int64_t value);
  void BindStatic(int index, std::string_view text);
  bool Step();
  int Column(std::string_view name) const;
  bool IsNull(int i) const;
  int64_t Int(int i) const;
  std::string Text(int i) const;
  std::string Blob(int i) const;

 private:
  sqlite3_stmt* statement_ = nullptr;
  bool failed_ = false;
};

class Database {
 public:
  static std::unique_ptr<Database> Snapshot(const std::string& source, ScratchDirectory& scratch,
                                            const ImportObserver& observer, FileRead* status);
  Database(const Database&) = delete;
  Database& operator=(const Database&) = delete;
  ~Database();

  sqlite3* get() const { return db_; }
  bool HasTable(std::string_view name);

 private:
  explicit Database(sqlite3* db);
  sqlite3* db_;
};

}

#endif
