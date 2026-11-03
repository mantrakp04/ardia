#include "ardia/linux/ac_linux_user_scripts_store.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#include <limits>
#include <random>
#include <utility>
#include <vector>

namespace ardia::linux_user_scripts {

namespace {

class Fd {
 public:
  explicit Fd(int fd = -1) : fd_(fd) {}
  Fd(const Fd&) = delete;
  Fd& operator=(const Fd&) = delete;
  Fd(Fd&& other) : fd_(std::exchange(other.fd_, -1)) {}
  Fd& operator=(Fd&& other) {
    if (this != &other) {
      Reset();
      fd_ = std::exchange(other.fd_, -1);
    }
    return *this;
  }
  ~Fd() {
    if (fd_ >= 0) close(fd_);
  }
  int get() const { return fd_; }
  bool valid() const { return fd_ >= 0; }
  void Reset() {
    if (fd_ >= 0) close(std::exchange(fd_, -1));
  }

 private:
  int fd_;
};

enum class ReadOutcome { kRead, kMissing, kTooLarge, kFailed };

ReadOutcome ReadRegular(int dir_fd, const char* name, size_t limit, std::string* contents) {
  Fd file(openat(dir_fd, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK | O_NOCTTY));
  if (!file.valid()) return ReadOutcome::kMissing;
  struct stat info;
  if (fstat(file.get(), &info) != 0 || !S_ISREG(info.st_mode)) return ReadOutcome::kMissing;
  if (info.st_size < 0 || static_cast<uint64_t>(info.st_size) > limit) return ReadOutcome::kTooLarge;
  std::string text;
  char buffer[65536];
  while (true) {
    const ssize_t got = read(file.get(), buffer, sizeof(buffer));
    if (got < 0 && errno == EINTR) continue;
    if (got < 0) return ReadOutcome::kFailed;
    if (got == 0) break;
    text.append(buffer, static_cast<size_t>(got));
    if (text.size() > limit) return ReadOutcome::kTooLarge;
  }
  *contents = std::move(text);
  return ReadOutcome::kRead;
}

std::optional<std::string> ReadText(int dir_fd, const char* name) {
  std::string text;
  if (dir_fd < 0 || ReadRegular(dir_fd, name, kGenerationLimit, &text) != ReadOutcome::kRead) return std::nullopt;
  return text;
}

std::string Hex(std::string_view bytes) {
  static constexpr char kDigits[] = "0123456789abcdef";
  std::string hex;
  hex.reserve(bytes.size() * 2);
  for (const unsigned char c : bytes) {
    hex += kDigits[c >> 4];
    hex += kDigits[c & 15];
  }
  return hex;
}

std::string GenerationMark(int dir_fd, const char* name) {
  const std::optional<std::string> text = ReadText(dir_fd, name);
  return text ? Hex(*text) : "-";
}

std::optional<int64_t> ReadGeneration(int dir_fd, const char* name) {
  const std::optional<std::string> text = ReadText(dir_fd, name);
  return text ? ParseGeneration(*text) : std::nullopt;
}

Fd OpenFolder(const std::string& path) {
  return Fd(open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
}

Fd OpenFolderAt(int dir_fd, const char* name) {
  if (dir_fd < 0) return Fd();
  return Fd(openat(dir_fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
}

std::string RealPath(const std::string& path) {
  char resolved[PATH_MAX];
  if (!realpath(path.c_str(), resolved)) return path;
  return resolved;
}

Folder Invalid(std::optional<int64_t> generation, const std::string& path, std::string error) {
  return Folder{"invalid", generation.value_or(0), path, std::move(error), {}};
}

Folder Snapshot(const std::string& data_directory, const std::string& scripts, const ManifestCheck& check) {
  const std::string path = RealPath(data_directory) + "/" + kScriptsName + "/extension";
  Fd folder = OpenFolder(scripts);
  const std::optional<int64_t> written = ReadGeneration(folder.get(), "generation");
  struct stat info;
  if (!folder.valid() || lstat(scripts.c_str(), &info) != 0 || !S_ISDIR(info.st_mode)) {
    return Invalid(written, path, "Scripts isn't a plain folder");
  }
  if (fstatat(folder.get(), "extension", &info, AT_SYMLINK_NOFOLLOW) != 0) {
    if (!written) return Folder{"empty", std::nullopt, std::nullopt, std::nullopt, {}};
    return Folder{"absent", *written, path, std::nullopt, {}};
  }
  if (!S_ISDIR(info.st_mode)) return Invalid(written, path, "Scripts/extension isn't a plain folder");
  Fd extension = OpenFolderAt(folder.get(), "extension");
  if (!extension.valid()) return Invalid(written, path, "Scripts/extension isn't a plain folder");
  const std::optional<int64_t> inner = ReadGeneration(extension.get(), "generation");
  if (!inner) return Folder{"pending", std::nullopt, std::nullopt, std::nullopt, {}};
  if (written && *inner < *written) return Folder{"pending", *written, std::nullopt, std::nullopt, {}};
  std::string manifest;
  switch (ReadRegular(extension.get(), "manifest.json", kManifestLimit, &manifest)) {
    case ReadOutcome::kRead:
      break;
    case ReadOutcome::kTooLarge:
      return Invalid(inner, path, "manifest.json is too large");
    case ReadOutcome::kMissing:
    case ReadOutcome::kFailed:
      return Invalid(inner, path, "manifest.json is missing or isn't a plain file");
  }
  if (std::optional<std::string> refused = check(extension.get(), manifest)) {
    return Invalid(inner, path, std::move(*refused));
  }
  return Folder{"ready", *inner, path, std::nullopt, {}};
}

std::string Token(const std::string& scripts) {
  struct stat info;
  std::string token = lstat(scripts.c_str(), &info) == 0
      ? std::to_string(info.st_mtim.tv_sec) + "." + std::to_string(info.st_mtim.tv_nsec) + ":" + std::to_string(info.st_ino)
      : "-";
  Fd folder = OpenFolder(scripts);
  Fd extension = OpenFolderAt(folder.get(), "extension");
  token += "|" + GenerationMark(folder.get(), "generation");
  token += "|" + GenerationMark(extension.get(), "generation");
  token += "|";
  token += folder.valid() && fstatat(folder.get(), "extension", &info, AT_SYMLINK_NOFOLLOW) == 0
      ? std::to_string(info.st_ino)
      : "-";
  return token;
}

std::string TemporaryName() {
  static constexpr char kDigits[] = "0123456789abcdef";
  std::random_device random;
  std::string name = ".status.json.";
  for (int i = 0; i < 12; ++i) name += kDigits[random() & 15];
  return name;
}

bool WriteAll(int fd, std::string_view data) {
  while (!data.empty()) {
    const ssize_t wrote = write(fd, data.data(), data.size());
    if (wrote < 0 && errno == EINTR) continue;
    if (wrote <= 0) return false;
    data.remove_prefix(static_cast<size_t>(wrote));
  }
  return true;
}

}

std::string ScriptsPath(const std::string& data_directory) {
  return data_directory + "/" + kScriptsName;
}

std::optional<int64_t> ParseGeneration(std::string_view text) {
  constexpr std::string_view kSpace = " \t\n\r\v\f";
  const size_t first = text.find_first_not_of(kSpace);
  if (first == std::string_view::npos) return std::nullopt;
  text = text.substr(first, text.find_last_not_of(kSpace) - first + 1);
  bool negative = false;
  if (text.front() == '+' || text.front() == '-') {
    negative = text.front() == '-';
    text.remove_prefix(1);
  }
  if (text.empty()) return std::nullopt;
  uint64_t magnitude = 0;
  const uint64_t limit = negative ? static_cast<uint64_t>(std::numeric_limits<int64_t>::max()) + 1
                                  : static_cast<uint64_t>(std::numeric_limits<int64_t>::max());
  for (const char c : text) {
    if (c < '0' || c > '9') return std::nullopt;
    const uint64_t digit = static_cast<uint64_t>(c - '0');
    if (magnitude > (limit - digit) / 10) return std::nullopt;
    magnitude = magnitude * 10 + digit;
  }
  if (!negative) return static_cast<int64_t>(magnitude);
  return magnitude == static_cast<uint64_t>(std::numeric_limits<int64_t>::max()) + 1
      ? std::numeric_limits<int64_t>::min()
      : -static_cast<int64_t>(magnitude);
}

std::optional<std::string> CheckFile(int extension_fd, std::string_view relative, std::string_view at) {
  const std::string quoted = std::string(at) + ": \"" + std::string(relative) + "\"";
  std::vector<std::string_view> parts;
  size_t start = 0;
  while (true) {
    const size_t slash = relative.find('/', start);
    parts.push_back(relative.substr(start, slash == std::string_view::npos ? std::string_view::npos : slash - start));
    if (slash == std::string_view::npos) break;
    start = slash + 1;
  }
  bool malformed = relative.empty() || relative.find('\0') != std::string_view::npos ||
                   relative.find('\\') != std::string_view::npos;
  for (const std::string_view part : parts) malformed = malformed || part.empty() || part == "." || part == "..";
  if (malformed) return quoted + " must be a plain relative path inside the extension";
  Fd held;
  int parent = extension_fd;
  for (size_t index = 0; index < parts.size(); ++index) {
    const std::string part(parts[index]);
    struct stat info;
    if (fstatat(parent, part.c_str(), &info, AT_SYMLINK_NOFOLLOW) != 0) return quoted + " is missing";
    const bool last = index == parts.size() - 1;
    if (last ? !S_ISREG(info.st_mode) : !S_ISDIR(info.st_mode)) return quoted + " must be a plain file, not a link";
    if (last) break;
    Fd child = OpenFolderAt(parent, part.c_str());
    if (!child.valid()) return quoted + " must be a plain file, not a link";
    held = std::move(child);
    parent = held.get();
  }
  return std::nullopt;
}

Folder Read(const std::string& data_directory, const ManifestCheck& check) {
  const std::string scripts = ScriptsPath(data_directory);
  mkdir(scripts.c_str(), 0755);
  Fd lock(open((scripts + "/.lock").c_str(), O_RDONLY | O_CREAT | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK | O_NOCTTY, 0644));
  struct stat lock_info;
  if (!lock.valid() || fstat(lock.get(), &lock_info) != 0 || !S_ISREG(lock_info.st_mode)) {
    return Folder{"busy", std::nullopt, std::nullopt, std::nullopt, {}};
  }
  bool locked = false;
  for (int attempt = 0; attempt < kLockAttempts; ++attempt) {
    if (flock(lock.get(), LOCK_SH | LOCK_NB) == 0) {
      locked = true;
      break;
    }
    if (errno != EWOULDBLOCK || attempt == kLockAttempts - 1) break;
    usleep(kLockRetryMicroseconds);
  }
  if (!locked) return Folder{"busy", std::nullopt, std::nullopt, std::nullopt, {}};
  Folder folder = Snapshot(data_directory, scripts, check);
  folder.token = Token(scripts);
  flock(lock.get(), LOCK_UN);
  return folder;
}

std::string Signature(const std::string& data_directory) {
  const std::string scripts = ScriptsPath(data_directory);
  Fd folder = OpenFolder(scripts);
  std::string signature = GenerationMark(folder.get(), "generation") + "|";
  struct stat info;
  if (folder.valid() && fstatat(folder.get(), "extension", &info, AT_SYMLINK_NOFOLLOW) == 0) {
    signature += std::to_string(info.st_ino) + ":" + std::to_string(info.st_mode);
  } else {
    signature += "-";
  }
  return signature;
}

std::optional<std::string> ReadStatus(const std::string& data_directory) {
  Fd folder = OpenFolder(ScriptsPath(data_directory));
  std::string text;
  if (!folder.valid() || ReadRegular(folder.get(), "status.json", kStatusLimit, &text) != ReadOutcome::kRead) {
    return std::nullopt;
  }
  return text;
}

std::optional<std::string> WriteStatus(const std::string& data_directory, std::string_view json) {
  if (json.size() > kStatusLimit) return "status.json is too large";
  const std::string scripts = ScriptsPath(data_directory);
  mkdir(scripts.c_str(), 0755);
  Fd folder = OpenFolder(scripts);
  if (!folder.valid()) return "Scripts isn't a plain folder";
  const std::string temporary = TemporaryName();
  Fd file(openat(folder.get(), temporary.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0644));
  if (!file.valid()) return std::string("Couldn't write status.json: ") + strerror(errno);
  const bool wrote = WriteAll(file.get(), json);
  const int saved = errno;
  file.Reset();
  if (!wrote) {
    unlinkat(folder.get(), temporary.c_str(), 0);
    return std::string("Couldn't write status.json: ") + strerror(saved);
  }
  if (renameat(folder.get(), temporary.c_str(), folder.get(), "status.json") != 0) {
    const int failed = errno;
    unlinkat(folder.get(), temporary.c_str(), 0);
    return std::string("Couldn't write status.json: ") + strerror(failed);
  }
  return std::nullopt;
}

}
