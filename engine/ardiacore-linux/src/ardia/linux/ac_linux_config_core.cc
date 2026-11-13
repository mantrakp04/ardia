#include "ardia/linux/ac_linux_config_core.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <string.h>
#include <sys/inotify.h>
#include <sys/random.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <utility>

namespace ardia::linux_config {

namespace {

constexpr uint32_t kWatchMask = IN_CREATE | IN_DELETE | IN_MODIFY | IN_CLOSE_WRITE | IN_MOVED_FROM | IN_MOVED_TO |
                                IN_ATTRIB | IN_DELETE_SELF | IN_MOVE_SELF | IN_ONLYDIR;
constexpr uint32_t kSelfEvents = IN_DELETE_SELF | IN_MOVE_SELF | IN_IGNORED | IN_UNMOUNT;
constexpr size_t kReadChunk = 64 * 1024;
constexpr int kTempAttempts = 8;
constexpr int kMaxLinks = 40;

bool IsThemeNameCharacter(char c) {
  return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
}

std::string Dirname(const std::string& path) {
  const size_t slash = path.rfind('/');
  if (slash == std::string::npos) return ".";
  if (slash == 0) return "/";
  return path.substr(0, slash);
}

std::string Join(const std::string& folder, std::string_view name) {
  if (name.empty()) return folder;
  if (folder == "/") return "/" + std::string(name);
  return folder + "/" + std::string(name);
}

struct Resolution {
  std::optional<std::string> real;
  std::vector<std::string> dependencies;
};

void PrependComponents(std::vector<std::string>& pending, std::string_view path) {
  std::vector<std::string> components;
  size_t start = 0;
  while (start <= path.size()) {
    const size_t end = std::min(path.find('/', start), path.size());
    if (end > start) components.emplace_back(path.substr(start, end - start));
    start = end + 1;
  }
  if (path.size() > 1 && path.back() == '/') components.emplace_back(".");
  pending.insert(pending.end(), components.rbegin(), components.rend());
}

Resolution Resolve(const std::string& path) {
  Resolution result;
  if (path.empty() || path.front() != '/') return result;
  std::vector<std::string> pending;
  PrependComponents(pending, path);
  std::string current = "/";
  int links = 0;
  while (!pending.empty()) {
    const std::string component = std::move(pending.back());
    pending.pop_back();
    if (component == ".") continue;
    if (component == "..") {
      current = Dirname(current);
      continue;
    }
    const std::string next = Join(current, component);
    struct stat info;
    if (lstat(next.c_str(), &info) != 0) {
      result.dependencies.push_back(next);
      return result;
    }
    if (!S_ISLNK(info.st_mode)) {
      if (!S_ISDIR(info.st_mode) && !pending.empty()) {
        result.dependencies.push_back(next);
        return result;
      }
      current = next;
      continue;
    }
    result.dependencies.push_back(next);
    char target[PATH_MAX];
    const ssize_t length = readlink(next.c_str(), target, sizeof(target));
    if (++links > kMaxLinks || length <= 0 || length >= static_cast<ssize_t>(sizeof(target))) return result;
    const std::string_view link(target, static_cast<size_t>(length));
    if (link.front() == '/') current = "/";
    PrependComponents(pending, link);
  }
  result.real = current;
  return result;
}

std::string Normalized(std::string path) {
  while (path.size() > 1 && path.back() == '/') path.pop_back();
  return path;
}

bool Exists(const std::string& path) {
  struct stat info;
  return stat(path.c_str(), &info) == 0;
}

std::string NearestExisting(std::string path) {
  while (!Exists(path) && path != "/" && path != ".") path = Dirname(path);
  return path;
}

std::string ChildBelow(const std::string& ancestor, const std::string& path) {
  const size_t start = ancestor == "/" ? 1 : ancestor.size() + 1;
  if (path.size() <= start || path.compare(0, ancestor.size(), ancestor) != 0) return std::string();
  const size_t end = path.find('/', start);
  return path.substr(start, end == std::string::npos ? std::string::npos : end - start);
}

std::string TempName(std::string_view name) {
  uint64_t random = 0;
  if (getrandom(&random, sizeof(random), GRND_NONBLOCK) != static_cast<ssize_t>(sizeof(random))) {
    static uint64_t counter = 0;
    random = ++counter;
  }
  char suffix[64];
  snprintf(suffix, sizeof(suffix), ".%ld.%016llx.tmp", static_cast<long>(getpid()),
           static_cast<unsigned long long>(random));
  return "." + std::string(name) + suffix;
}

bool WriteAll(int fd, std::string_view data) {
  while (!data.empty()) {
    const ssize_t wrote = write(fd, data.data(), data.size());
    if (wrote < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    data.remove_prefix(static_cast<size_t>(wrote));
  }
  return true;
}

std::string Failure(std::string_view what, const std::string& path, int error) {
  return std::string(what) + " " + path + ": " + strerror(error);
}

bool Replace(int directory, const std::string& folder, const std::string& name, std::string_view contents,
             std::string* error) {
  std::string temp;
  int fd = -1;
  for (int attempt = 0; attempt < kTempAttempts && fd < 0; ++attempt) {
    temp = TempName(name);
    fd = openat(directory, temp.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0644);
    if (fd < 0 && errno != EEXIST) break;
  }
  if (fd < 0) {
    *error = Failure("Couldn't create a temporary file in", folder, errno);
    return false;
  }
  const bool wrote = WriteAll(fd, contents) && fsync(fd) == 0;
  const int write_error = errno;
  const bool closed = close(fd) == 0;
  const int close_error = errno;
  if (!wrote || !closed || renameat(directory, temp.c_str(), directory, name.c_str()) != 0) {
    const int code = !wrote ? write_error : !closed ? close_error : errno;
    unlinkat(directory, temp.c_str(), 0);
    *error = Failure("Couldn't write", Join(folder, name), code);
    return false;
  }
  return true;
}

}

std::string_view StatusName(ReadStatus status) {
  switch (status) {
    case ReadStatus::kOk:
      return "ok";
    case ReadStatus::kMissing:
      return "missing";
    case ReadStatus::kNotFile:
      return "notFile";
    case ReadStatus::kTooBig:
      return "tooBig";
    case ReadStatus::kUnreadable:
      break;
  }
  return "unreadable";
}

bool IsThemeFile(std::string_view name) {
  constexpr std::string_view kPrefix = "themes/";
  constexpr std::string_view kSuffix = ".json";
  if (name.size() <= kPrefix.size() + kSuffix.size()) return false;
  if (name.substr(0, kPrefix.size()) != kPrefix || name.substr(name.size() - kSuffix.size()) != kSuffix) return false;
  const std::string_view theme = name.substr(kPrefix.size(), name.size() - kPrefix.size() - kSuffix.size());
  if (theme.front() == '_' || theme.front() == '-') return false;
  return std::all_of(theme.begin(), theme.end(), IsThemeNameCharacter);
}

bool IsWatchable(std::string_view name) {
  return name == kConfigFile || IsThemeFile(name);
}

bool IsSchemaName(std::string_view name) {
  return std::any_of(std::begin(kSchemaNames), std::end(kSchemaNames),
                     [&](const char* schema) { return name == schema; });
}

bool IsUtf8(std::string_view text) {
  size_t at = 0;
  while (at < text.size()) {
    const unsigned char lead = static_cast<unsigned char>(text[at]);
    if (lead < 0x80) {
      ++at;
      continue;
    }
    size_t length = 0;
    uint32_t point = 0;
    uint32_t smallest = 0;
    if ((lead & 0xE0) == 0xC0) {
      length = 2;
      point = lead & 0x1F;
      smallest = 0x80;
    } else if ((lead & 0xF0) == 0xE0) {
      length = 3;
      point = lead & 0x0F;
      smallest = 0x800;
    } else if ((lead & 0xF8) == 0xF0) {
      length = 4;
      point = lead & 0x07;
      smallest = 0x10000;
    } else {
      return false;
    }
    if (text.size() - at < length) return false;
    for (size_t i = 1; i < length; ++i) {
      const unsigned char next = static_cast<unsigned char>(text[at + i]);
      if ((next & 0xC0) != 0x80) return false;
      point = (point << 6) | (next & 0x3F);
    }
    if (point < smallest || point > 0x10FFFF || (point >= 0xD800 && point <= 0xDFFF)) return false;
    at += length;
  }
  return true;
}

FileRead ReadRegularFileAt(int directory, const std::string& path) {
  const int fd = openat(directory, path.c_str(), O_RDONLY | O_NONBLOCK | O_CLOEXEC | O_NOCTTY);
  if (fd < 0) return {errno == ENOENT || errno == ENOTDIR ? ReadStatus::kMissing : ReadStatus::kUnreadable, {}};
  FileRead result;
  struct stat info;
  if (fstat(fd, &info) != 0) {
    result.status = ReadStatus::kUnreadable;
  } else if (!S_ISREG(info.st_mode)) {
    result.status = ReadStatus::kNotFile;
  } else if (info.st_size > static_cast<off_t>(kReadLimit)) {
    result.status = ReadStatus::kTooBig;
  } else {
    std::string data;
    char buffer[kReadChunk];
    result.status = ReadStatus::kOk;
    while (data.size() <= kReadLimit) {
      const ssize_t count = read(fd, buffer, std::min(sizeof(buffer), kReadLimit + 1 - data.size()));
      if (count < 0) {
        if (errno == EINTR) continue;
        result.status = ReadStatus::kUnreadable;
        break;
      }
      if (count == 0) break;
      data.append(buffer, static_cast<size_t>(count));
    }
    if (result.status == ReadStatus::kOk && data.size() > kReadLimit) result.status = ReadStatus::kTooBig;
    if (result.status == ReadStatus::kOk && !IsUtf8(data)) result.status = ReadStatus::kUnreadable;
    if (result.status == ReadStatus::kOk) result.text = std::move(data);
  }
  close(fd);
  return result;
}

FileRead Read(const std::string& folder, std::string_view name) {
  if (!IsWatchable(name)) return {ReadStatus::kUnreadable, {}};
  return ReadRegularFileAt(AT_FDCWD, Join(folder, name));
}

SchemaWrite WriteSchemas(const std::string& schema_folder, const std::string& config_folder,
                         const std::map<std::string, std::string>& files) {
  SchemaWrite result;
  if (mkdir(schema_folder.c_str(), 0755) != 0 && errno != EEXIST) {
    result.error = Failure("Couldn't create", schema_folder, errno);
    return result;
  }
  std::vector<std::string> folders = {schema_folder};
  struct stat info;
  if (stat(config_folder.c_str(), &info) == 0 && S_ISDIR(info.st_mode)) folders.push_back(config_folder);
  for (const std::string& folder : folders) {
    const int directory = open(folder.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (directory < 0) {
      result.error = Failure("Couldn't open", folder, errno);
      return result;
    }
    for (const auto& [name, contents] : files) {
      if (!IsSchemaName(name)) continue;
      const FileRead current = ReadRegularFileAt(directory, name);
      if (current.status == ReadStatus::kOk && current.text == contents) continue;
      if (!Replace(directory, folder, name, contents, &result.error)) {
        close(directory);
        return result;
      }
      result.written.push_back(Join(folder, name));
    }
    close(directory);
  }
  return result;
}

Watcher::Watcher(std::string folder)
    : lexical_(Normalized(std::move(folder))), fd_(inotify_init1(IN_NONBLOCK | IN_CLOEXEC)) {}

Watcher::~Watcher() {
  if (fd_ >= 0) close(fd_);
}

void Watcher::SetNames(const std::vector<std::string>& names) {
  names_.clear();
  for (const std::string& name : names) {
    if (names_.size() >= kMaxWatchedNames) break;
    if (IsWatchable(name) && std::find(names_.begin(), names_.end(), name) == names_.end()) names_.push_back(name);
  }
  if (fd_ >= 0) Apply(Compute());
}

Watcher::Targets Watcher::Compute() const {
  Targets next;
  const auto track = [&next](const std::string& path) {
    Resolution resolution = Resolve(path);
    next.exact.insert(resolution.dependencies.begin(), resolution.dependencies.end());
    if (resolution.real) next.exact.insert(*resolution.real);
    return resolution.real;
  };
  next.folder = track(lexical_);
  next.topology = NearestExisting(Dirname(lexical_));
  next.topology_child = ChildBelow(next.topology, lexical_);
  if (!next.folder) {
    for (const std::string& path : next.exact) next.directories.insert(Dirname(path));
    return next;
  }
  const std::string& folder = *next.folder;
  const std::string inside = folder == "/" ? "/" : folder + "/";
  next.directories.insert(folder);
  for (const std::string& name : names_) {
    const std::string entry = Join(folder, name);
    next.exact.insert(entry);
    for (std::string parent = Dirname(entry); parent != folder && parent.compare(0, inside.size(), inside) == 0;
         parent = Dirname(parent)) {
      next.exact.insert(parent);
      track(parent);
    }
    track(entry);
  }
  for (const std::string& path : next.exact) next.directories.insert(Dirname(path));
  return next;
}

void Watcher::Apply(const Targets& next) {
  std::set<std::string> wanted = next.directories;
  wanted.insert(next.topology);
  std::map<std::string, int> wd_by_path;
  std::map<int, std::set<std::string>> paths_by_wd;
  for (const std::string& path : wanted) {
    const int wd = inotify_add_watch(fd_, path.c_str(), kWatchMask);
    if (wd < 0) continue;
    wd_by_path[path] = wd;
    paths_by_wd[wd].insert(path);
  }
  for (const auto& [wd, paths] : paths_by_wd_) {
    if (!paths_by_wd.contains(wd)) Unwatch(wd);
  }
  targets_ = next;
  wd_by_path_ = std::move(wd_by_path);
  paths_by_wd_ = std::move(paths_by_wd);
  directories_.clear();
  for (const auto& [path, wd] : wd_by_path_) directories_.insert(path);
}

void Watcher::Unwatch(int wd) {
  inotify_rm_watch(fd_, wd);
}

bool Watcher::Drain() {
  if (fd_ < 0) return false;
  bool relevant = false;
  bool rebuild = false;
  alignas(inotify_event) char buffer[16 * (sizeof(inotify_event) + NAME_MAX + 1)];
  while (true) {
    const ssize_t got = read(fd_, buffer, sizeof(buffer));
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) break;
    for (ssize_t at = 0; at + static_cast<ssize_t>(sizeof(inotify_event)) <= got;) {
      const auto* event = reinterpret_cast<const inotify_event*>(buffer + at);
      at += static_cast<ssize_t>(sizeof(inotify_event) + event->len);
      if (event->mask & IN_Q_OVERFLOW) {
        relevant = rebuild = true;
        continue;
      }
      const auto found = paths_by_wd_.find(event->wd);
      if (found == paths_by_wd_.end()) continue;
      if ((event->mask & kSelfEvents) || (!event->len && (event->mask & IN_ATTRIB))) {
        rebuild = true;
        for (const std::string& path : found->second) {
          if (targets_.directories.contains(path)) relevant = true;
        }
        continue;
      }
      const std::string_view name = event->len ? std::string_view(event->name, strnlen(event->name, event->len))
                                               : std::string_view();
      for (const std::string& path : found->second) {
        if (targets_.exact.contains(Join(path, name))) relevant = rebuild = true;
        if (path == targets_.topology && name == targets_.topology_child) rebuild = true;
      }
    }
  }
  if (!rebuild) return relevant;
  const std::optional<std::string> before = targets_.folder;
  Apply(Compute());
  return relevant || before != targets_.folder;
}

}
