#ifndef ARDIA_LINUX_AC_LINUX_CONFIG_CORE_H_
#define ARDIA_LINUX_AC_LINUX_CONFIG_CORE_H_

#include <cstddef>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

namespace ardia::linux_config {

inline constexpr size_t kReadLimit = 1 << 20;
inline constexpr char kConfigFile[] = "config.json";
inline constexpr char kSchemaFolder[] = "config-schema";
inline constexpr const char* kSchemaNames[] = {"config.schema.json", "theme.schema.json"};
inline constexpr size_t kMaxWatchedNames = 64;

enum class ReadStatus { kOk, kMissing, kUnreadable, kNotFile, kTooBig };

struct FileRead {
  ReadStatus status = ReadStatus::kUnreadable;
  std::string text;
};

std::string_view StatusName(ReadStatus status);
bool IsThemeFile(std::string_view name);
bool IsWatchable(std::string_view name);
bool IsSchemaName(std::string_view name);
bool IsUtf8(std::string_view text);

FileRead ReadRegularFileAt(int directory, const std::string& path);
FileRead Read(const std::string& folder, std::string_view name);

struct SchemaWrite {
  std::vector<std::string> written;
  std::string error;
};

SchemaWrite WriteSchemas(const std::string& schema_folder, const std::string& config_folder,
                         const std::map<std::string, std::string>& files);

class Watcher {
 public:
  explicit Watcher(std::string folder);
  ~Watcher();
  Watcher(const Watcher&) = delete;
  Watcher& operator=(const Watcher&) = delete;

  int fd() const { return fd_; }
  void SetNames(const std::vector<std::string>& names);
  bool Drain();

  const std::set<std::string>& watched_directories() const { return directories_; }

 private:
  struct Targets {
    std::optional<std::string> folder;
    std::set<std::string> exact;
    std::set<std::string> directories;
    std::string topology;
    std::string topology_child;
    bool operator==(const Targets&) const = default;
  };

  Targets Compute() const;
  void Apply(const Targets& next);
  void Unwatch(int wd);

  std::string lexical_;
  std::vector<std::string> names_;
  int fd_ = -1;
  Targets targets_;
  std::set<std::string> directories_;
  std::map<std::string, int> wd_by_path_;
  std::map<int, std::set<std::string>> paths_by_wd_;
};

}

#endif
