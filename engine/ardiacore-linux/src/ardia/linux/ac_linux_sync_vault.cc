#include "ardia/linux/ac_linux_sync_vault.h"

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <ctime>
#include <set>
#include <utility>

namespace ardia::linux_sync {
namespace {

constexpr unsigned kRenameNoReplace = 1;
constexpr mode_t kDirectoryMode = 0700;
constexpr mode_t kFileMode = 0600;
constexpr int kDirectoryFlags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC;

RemoveTreeHook remove_tree_hook = nullptr;

class Fd {
 public:
  explicit Fd(int fd = -1) : fd_(fd) {}
  Fd(Fd&& other) noexcept : fd_(std::exchange(other.fd_, -1)) {}
  Fd& operator=(Fd&& other) noexcept {
    if (this != &other) {
      Reset();
      fd_ = std::exchange(other.fd_, -1);
    }
    return *this;
  }
  Fd(const Fd&) = delete;
  Fd& operator=(const Fd&) = delete;
  ~Fd() { Reset(); }

  int get() const { return fd_; }
  bool valid() const { return fd_ >= 0; }

 private:
  void Reset() {
    if (fd_ >= 0) close(fd_);
    fd_ = -1;
  }

  int fd_;
};

std::string Join(const std::string& directory, std::string_view name) {
  std::string path = directory;
  if (path.empty() || path.back() != '/') path.push_back('/');
  path.append(name);
  return path;
}

std::string ErrorText(std::string_view what, int error) {
  return std::string(what) + ": " + std::strerror(error);
}

Fd OpenFolder(const std::string& folder) {
  return Fd(open(folder.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC));
}

Fd OpenChild(const Fd& parent, const std::string& name, bool create) {
  if (!parent.valid()) return Fd();
  if (create && mkdirat(parent.get(), name.c_str(), kDirectoryMode) != 0 && errno != EEXIST) return Fd();
  return Fd(openat(parent.get(), name.c_str(), kDirectoryFlags));
}

bool EnsureFolder(const std::string& folder) {
  std::string partial;
  size_t at = 0;
  while (at < folder.size()) {
    const size_t next = folder.find('/', at + 1);
    partial = folder.substr(0, next == std::string::npos ? folder.size() : next);
    at = next == std::string::npos ? folder.size() : next;
    if (partial.empty() || partial == "/") continue;
    if (mkdir(partial.c_str(), kDirectoryMode) != 0 && errno != EEXIST) return false;
  }
  return DirectoryExists(folder);
}

void SyncDirectory(const Fd& directory) {
  if (directory.valid()) fsync(directory.get());
}

bool WriteAll(int fd, const Bytes& data) {
  size_t written = 0;
  while (written < data.size()) {
    const ssize_t n = write(fd, data.data() + written, data.size() - written);
    if (n < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    written += static_cast<size_t>(n);
  }
  return true;
}

std::optional<Bytes> ReadOpenFile(int fd, const struct stat& info, size_t limit) {
  if (!S_ISREG(info.st_mode) || static_cast<uint64_t>(info.st_size) > limit) return std::nullopt;
  Bytes data(static_cast<size_t>(info.st_size));
  size_t got = 0;
  while (got < data.size()) {
    const ssize_t n = read(fd, data.data() + got, data.size() - got);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) break;
    got += static_cast<size_t>(n);
  }
  if (got != data.size()) return std::nullopt;
  return data;
}

std::vector<std::string> NamesAt(const Fd& directory) {
  std::vector<std::string> names;
  if (!directory.valid()) return names;
  const int copy = fcntl(directory.get(), F_DUPFD_CLOEXEC, 0);
  if (copy < 0) return names;
  DIR* dir = fdopendir(copy);
  if (!dir) {
    close(copy);
    return names;
  }
  rewinddir(dir);
  while (const dirent* entry = readdir(dir)) {
    const std::string_view name(entry->d_name);
    if (name != "." && name != "..") names.emplace_back(name);
  }
  closedir(dir);
  std::sort(names.begin(), names.end());
  return names;
}

std::vector<std::string> Names(const std::string& directory) {
  return NamesAt(OpenFolder(directory));
}

bool EndsWith(std::string_view text, std::string_view suffix) {
  return text.size() >= suffix.size() && text.substr(text.size() - suffix.size()) == suffix;
}

bool StartsWith(std::string_view text, std::string_view prefix) {
  return text.substr(0, prefix.size()) == prefix;
}

void RemoveStaleStaging(const Fd& directory, int64_t now) {
  for (const auto& name : NamesAt(directory)) {
    if (!StartsWith(name, kStagingPrefix)) continue;
    struct stat info;
    if (fstatat(directory.get(), name.c_str(), &info, AT_SYMLINK_NOFOLLOW) == 0 && S_ISREG(info.st_mode) &&
        now - info.st_mtime >= kStaleStagingSeconds)
      unlinkat(directory.get(), name.c_str(), 0);
  }
}

int RenameNoReplaceAt(const Fd& directory, const std::string& from, const std::string& to) {
  const int fd = directory.get();
  if (syscall(SYS_renameat2, fd, from.c_str(), fd, to.c_str(), kRenameNoReplace) == 0) return 0;
  if (errno != EINVAL && errno != ENOSYS && errno != ENOTSUP && errno != EOPNOTSUPP) return errno;
  if (linkat(fd, from.c_str(), fd, to.c_str(), 0) == 0) {
    unlinkat(fd, from.c_str(), 0);
    return 0;
  }
  if (errno == EEXIST) return EEXIST;
  struct stat info;
  if (fstatat(fd, to.c_str(), &info, AT_SYMLINK_NOFOLLOW) == 0) return EEXIST;
  return renameat(fd, from.c_str(), fd, to.c_str()) == 0 ? 0 : errno;
}

bool RemoveContents(const Fd& directory, const std::string& path) {
  bool ok = true;
  for (const auto& name : NamesAt(directory)) {
    const std::string child_path = Join(path, name);
    if (remove_tree_hook) remove_tree_hook(child_path);
    Fd child(openat(directory.get(), name.c_str(), kDirectoryFlags));
    if (child.valid()) {
      ok = RemoveContents(child, child_path) && ok;
      ok = (unlinkat(directory.get(), name.c_str(), AT_REMOVEDIR) == 0 || errno == ENOENT) && ok;
    } else {
      ok = (unlinkat(directory.get(), name.c_str(), 0) == 0 || errno == ENOENT) && ok;
    }
  }
  return ok;
}

}

void SetRemoveTreeHookForTesting(RemoveTreeHook hook) {
  remove_tree_hook = hook;
}

int64_t NowSeconds() {
  return static_cast<int64_t>(std::time(nullptr));
}

bool ValidFolderPath(std::string_view path) {
  return !path.empty() && path.size() <= kMaxFolderPathBytes && path.front() == '/' &&
         path.find('\0') == std::string_view::npos;
}

bool DirectoryExists(const std::string& path) {
  struct stat info;
  return stat(path.c_str(), &info) == 0 && S_ISDIR(info.st_mode);
}

bool HasSyncData(const std::string& folder) {
  const auto names = Names(folder);
  return std::any_of(names.begin(), names.end(), [](const std::string& name) { return IsTag(name); });
}

FolderFacts InspectFolder(const std::string& path) {
  FolderFacts facts;
  facts.exists = ValidFolderPath(path) && DirectoryExists(path);
  facts.writable = facts.exists && access(path.c_str(), W_OK | X_OK) == 0;
  facts.has_sync_data = facts.exists && HasSyncData(path);
  return facts;
}

Vault::Vault(std::string folder, const SyncKeys& keys) : folder_(std::move(folder)), keys_(keys) {}

std::string Vault::ChainPath() const {
  return Join(folder_, keys_.chain_tag());
}

std::string Vault::ScopePath(std::string_view scope) const {
  return Join(ChainPath(), keys_.ScopeTag(scope));
}

bool Vault::ChainExists() const {
  return OpenChild(OpenFolder(folder_), keys_.chain_tag(), false).valid();
}

VaultError Vault::CreateChain() const {
  if (!ValidFolderPath(folder_)) return {"The sync folder path isn't valid"};
  if (!EnsureFolder(folder_)) return {ErrorText("Couldn't create the sync folder", errno)};
  const Fd folder = OpenFolder(folder_);
  if (!OpenChild(folder, keys_.chain_tag(), true).valid())
    return {ErrorText("Couldn't create the sync data folder", errno)};
  SyncDirectory(folder);
  return {};
}

VaultError Vault::Write(std::string_view scope, const Bytes& payload, std::string* id) const {
  *id = NewFileId();
  if (!IsTag(*id)) return {"Couldn't make a file name"};
  return WriteAs(scope, payload, *id);
}

VaultError Vault::WriteAs(std::string_view scope, const Bytes& payload, const std::string& id) const {
  if (!IsTag(id)) return {"Invalid sync file name"};
  if (!ValidFolderPath(folder_)) return {"The sync folder isn't available"};
  const Fd folder = OpenFolder(folder_);
  if (!folder.valid()) return {"The sync folder isn't available"};
  const std::string scope_tag = keys_.ScopeTag(scope);
  auto sealed = keys_.Seal(payload, scope_tag, id);
  if (!sealed) return {"Couldn't seal the sync file"};
  const Fd chain = OpenChild(folder, keys_.chain_tag(), true);
  const Fd directory = OpenChild(chain, scope_tag, true);
  if (!directory.valid()) return {ErrorText("Couldn't open the sync data folder", errno)};
  RemoveStaleStaging(directory, NowSeconds());
  uint8_t random[10];
  if (!RandomBytes(random, sizeof(random))) return {"Couldn't make a staging name"};
  const std::string staging = kStagingPrefix + Base32(random, sizeof(random));
  const std::string destination = id + kFileExtension;
  const int fd = openat(directory.get(), staging.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, kFileMode);
  if (fd < 0) return {ErrorText("Couldn't write a sync file", errno)};
  const bool written = WriteAll(fd, *sealed) && fsync(fd) == 0;
  const int write_error = errno;
  const bool closed = close(fd) == 0;
  if (!written || !closed) {
    unlinkat(directory.get(), staging.c_str(), 0);
    return {ErrorText("Couldn't write a sync file", written ? errno : write_error)};
  }
  if (const int error = RenameNoReplaceAt(directory, staging, destination); error != 0) {
    unlinkat(directory.get(), staging.c_str(), 0);
    return {ErrorText("Couldn't move a sync file into place", error)};
  }
  SyncDirectory(directory);
  return {};
}

Listing Vault::Read(std::string_view scope, const std::vector<std::string>& known_ids, int64_t now_seconds) const {
  Listing listing;
  const std::string scope_tag = keys_.ScopeTag(scope);
  const Fd directory = OpenChild(OpenChild(OpenFolder(folder_), keys_.chain_tag(), false), scope_tag, false);
  if (!directory.valid()) return listing;
  const std::set<std::string, std::less<>> known(known_ids.begin(), known_ids.end());
  const auto names = NamesAt(directory);
  std::set<std::string, std::less<>> whole;
  for (const auto& name : names) {
    if (EndsWith(name, kFileExtension)) whole.insert(name.substr(0, name.size() - (sizeof(kFileExtension) - 1)));
  }
  std::set<std::string, std::less<>> present;
  auto mark_present = [&](const std::string& id) {
    if (present.insert(id).second) listing.present.push_back(id);
  };
  const std::string syncthing_tail = std::string(kFileExtension) + kSyncthingSuffix;
  for (const auto& name : names) {
    if (StartsWith(name, kSyncthingPrefix) && EndsWith(name, syncthing_tail)) {
      const std::string id = name.substr(sizeof(kSyncthingPrefix) - 1,
                                         name.size() - (sizeof(kSyncthingPrefix) - 1) - syncthing_tail.size());
      if (!IsTag(id) || whole.contains(id) || present.contains(id)) continue;
      mark_present(id);
      if (!known.contains(id)) listing.pending.push_back(id);
      continue;
    }
    if (!EndsWith(name, kFileExtension)) continue;
    const std::string id = name.substr(0, name.size() - (sizeof(kFileExtension) - 1));
    if (!IsTag(id)) continue;
    mark_present(id);
    if (known.contains(id)) continue;
    const Fd file(openat(directory.get(), name.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW));
    struct stat info;
    const bool stated = file.valid() ? fstat(file.get(), &info) == 0
                                     : fstatat(directory.get(), name.c_str(), &info, AT_SYMLINK_NOFOLLOW) == 0;
    auto data = file.valid() && stated ? ReadOpenFile(file.get(), info, kMaxSyncFileBytes) : std::nullopt;
    Bytes payload;
    if (data && keys_.Open(*data, scope_tag, id, &payload) == OpenError::kNone) {
      listing.files.push_back({id, std::move(payload)});
      continue;
    }
    const int64_t modified = stated ? static_cast<int64_t>(info.st_mtime) : now_seconds;
    listing.damaged.push_back({id, static_cast<double>(std::max<int64_t>(0, now_seconds - modified))});
  }
  return listing;
}

void Vault::Remove(std::string_view scope, const std::vector<std::string>& ids) const {
  const Fd directory = OpenChild(OpenChild(OpenFolder(folder_), keys_.chain_tag(), false), keys_.ScopeTag(scope), false);
  if (!directory.valid()) return;
  for (const auto& id : ids) {
    if (!IsTag(id)) continue;
    unlinkat(directory.get(), (id + kFileExtension).c_str(), 0);
  }
}

VaultError Vault::DeleteChain() const {
  const Fd folder = OpenFolder(folder_);
  if (!folder.valid()) return {};
  const std::string& name = keys_.chain_tag();
  struct stat info;
  if (fstatat(folder.get(), name.c_str(), &info, AT_SYMLINK_NOFOLLOW) != 0) return {};
  const Fd chain(openat(folder.get(), name.c_str(), kDirectoryFlags));
  bool ok = true;
  if (chain.valid()) {
    ok = RemoveContents(chain, ChainPath());
    ok = unlinkat(folder.get(), name.c_str(), AT_REMOVEDIR) == 0 && ok;
  } else {
    ok = unlinkat(folder.get(), name.c_str(), 0) == 0;
  }
  if (!ok) return {ErrorText("Couldn't delete the sync data", errno)};
  SyncDirectory(folder);
  return {};
}

}
