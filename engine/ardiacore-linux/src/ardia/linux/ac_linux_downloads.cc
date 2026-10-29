#include "ardia/linux/ac_linux_downloads.h"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>

namespace ardia::linux_downloads {
namespace {

bool Hex(char c) {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

bool Unreserved(unsigned char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
         c == '-' || c == '.' || c == '_' || c == '~' || c == '/';
}

std::string Escape(std::string_view path) {
  static constexpr char kDigits[] = "0123456789ABCDEF";
  std::string escaped;
  escaped.reserve(path.size());
  for (const unsigned char c : path) {
    if (Unreserved(c)) {
      escaped.push_back(static_cast<char>(c));
    } else {
      escaped.push_back('%');
      escaped.push_back(kDigits[c >> 4]);
      escaped.push_back(kDigits[c & 15]);
    }
  }
  return escaped;
}

bool ControlRequest(std::string_view verb) {
  return verb == "cancel" || verb == "pause" || verb == "resume" || verb == "keep" ||
         verb == "remove";
}

bool MakeDirectories(const std::string& path) {
  if (path.empty() || path[0] != '/') return false;
  for (size_t next = path.find('/', 1);; next = path.find('/', next + 1)) {
    const std::string prefix = next == std::string::npos ? path : path.substr(0, next);
    if (mkdir(prefix.c_str(), 0700) != 0 && errno != EEXIST) return false;
    struct stat info;
    if (stat(prefix.c_str(), &info) != 0 || !S_ISDIR(info.st_mode)) return false;
    if (next == std::string::npos) return true;
  }
}

TrashOutcome Failure(std::string code, std::string message) {
  return {false, std::move(code), std::move(message), {}};
}

std::string Candidate(const std::string& name, int attempt) {
  if (attempt == 1) return name;
  const size_t dot = name.rfind('.');
  const bool extension = dot != std::string::npos && dot > 0;
  const std::string stem = extension ? name.substr(0, dot) : name;
  const std::string suffix = extension ? name.substr(dot) : std::string();
  return stem + "." + std::to_string(attempt) + suffix;
}

bool WriteAll(int fd, const std::string& text) {
  size_t written = 0;
  while (written < text.size()) {
    const ssize_t count = write(fd, text.data() + written, text.size() - written);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return false;
    written += static_cast<size_t>(count);
  }
  return true;
}

}

bool ValidDownloadId(std::string_view id) {
  if (id.size() != 36) return false;
  for (size_t index = 0; index < id.size(); ++index) {
    const bool dash = index == 8 || index == 13 || index == 18 || index == 23;
    if (dash ? id[index] != '-' : !Hex(id[index])) return false;
  }
  return true;
}

bool ValidLocalPath(std::string_view path) {
  if (path.empty() || path.size() > kMaxPathBytes || path[0] != '/') return false;
  if (path.find('\0') != std::string_view::npos) return false;
  if (path == "/") return true;
  if (path.back() == '/') return false;
  size_t start = 1;
  while (start <= path.size()) {
    const size_t end = std::min(path.find('/', start), path.size());
    const std::string_view component = path.substr(start, end - start);
    if (component.empty() || component == "." || component == "..") return false;
    start = end + 1;
  }
  return true;
}

std::string ValidateRequest(std::string_view name, const base::DictValue& input) {
  if (!name.starts_with("downloads.")) return {};
  const std::string_view verb = name.substr(10);
  if (ControlRequest(verb)) {
    const std::string* id = input.FindString("id");
    if (input.size() != 1 || !id || !ValidDownloadId(*id)) return "A valid download id is required";
    return {};
  }
  if (verb == "list" || verb == "settings") {
    return input.size() == 0 ? std::string() : "This download request takes no arguments";
  }
  if (verb == "clear") {
    const base::Value* keep = input.Find("keep");
    const base::Value* before = input.Find("before");
    if (input.size() != 2 || !keep || !before || !keep->is_list() || !(before->is_int() || before->is_double()))
      return "Clearing downloads requires the kept ids and a cutoff";
    if (keep->GetList().size() > kMaxKeptDownloads) return "Too many kept downloads";
    for (const auto& id : keep->GetList()) {
      if (!id.is_string() || !ValidDownloadId(id.GetString())) return "Kept downloads need valid ids";
    }
    const double cutoff = before->GetDouble();
    if (!std::isfinite(cutoff) || cutoff < 0) return "The clearing cutoff must be a time";
    return {};
  }
  if (verb == "setSettings") {
    const base::Value* folder = input.Find("folder");
    const base::Value* ask = input.Find("askWhereToSave");
    if (input.size() != static_cast<size_t>(folder != nullptr) + static_cast<size_t>(ask != nullptr))
      return "Unsupported download setting";
    if (folder && (!folder->is_string() || !ValidLocalPath(folder->GetString())))
      return "The download folder must be an absolute local path";
    if (ask && !ask->is_bool()) return "askWhereToSave must be a boolean";
    return {};
  }
  return {};
}

std::string FileUrl(std::string_view path) {
  return "file://" + Escape(path);
}

std::string BaseName(std::string_view path) {
  const size_t slash = path.rfind('/');
  return std::string(slash == std::string_view::npos ? path : path.substr(slash + 1));
}

std::optional<base::ListValue> FilterSnapshot(const base::Value& reply, bool off_the_record) {
  if (!reply.is_dict()) return std::nullopt;
  const base::Value* downloads = reply.GetDict().Find("downloads");
  if (!downloads || !downloads->is_list()) return std::nullopt;
  base::ListValue kept;
  for (const auto& entry : downloads->GetList()) {
    if (!entry.is_dict()) continue;
    const std::string* id = entry.GetDict().FindString("id");
    const base::Value* flag = entry.GetDict().Find("offTheRecord");
    if (!id || !ValidDownloadId(*id)) continue;
    if (flag && !flag->is_bool()) continue;
    if ((flag && flag->GetBool()) != off_the_record) continue;
    kept.Append(entry.Clone());
  }
  return kept;
}

DownloadRoute RouteDownloads(ardiacore::linux_profiles::ProfileKind requested, bool page_private,
                             bool page_ending, bool hosts_requested) {
  using ardiacore::linux_profiles::ProfileError;
  using ardiacore::linux_profiles::ProfileKind;
  if (requested == ProfileKind::kPrivate) {
    if (!page_private) return {ProfileError::kWindowMismatch, false};
    if (page_ending) return {ProfileError::kPrivateEnding, false};
    if (!hosts_requested) return {ProfileError::kWindowMismatch, false};
    return {ProfileError::kNone, true};
  }
  if (requested == ProfileKind::kIsolated && (page_private || !hosts_requested)) {
    return {ProfileError::kWindowMismatch, false};
  }
  if (page_private) {
    if (page_ending) return {ProfileError::kPrivateEnding, false};
    return {ProfileError::kNone, true};
  }
  return {ProfileError::kNone, false};
}

bool DeliversRemoval(bool private_removal, bool page_private, std::string_view page_original_path,
                     std::string_view removal_path) {
  if (!private_removal) return true;
  return page_private && !removal_path.empty() && page_original_path == removal_path;
}

std::string_view DownloadCommand(std::string_view name) {
  if (name == "downloads.cancel") return "cancel";
  if (name == "downloads.pause") return "pause";
  if (name == "downloads.resume") return "resume";
  if (name == "downloads.keep") return "keep";
  return {};
}

bool IsDownloadControl(std::string_view name) {
  return !DownloadCommand(name).empty();
}

std::vector<std::string> KeptIds(const base::DictValue& input) {
  std::vector<std::string> ids;
  const base::Value* keep = input.Find("keep");
  if (!keep || !keep->is_list()) return ids;
  for (const auto& id : keep->GetList()) {
    if (id.is_string() && ValidDownloadId(id.GetString())) ids.push_back(id.GetString());
  }
  return ids;
}

double ClearCutoff(const base::DictValue& input) {
  const base::Value* before = input.Find("before");
  return before && (before->is_int() || before->is_double()) ? before->GetDouble() : 0;
}

bool IconPathAllowed(std::string_view path, const std::vector<std::string>& targets) {
  if (path.empty() || path.size() > kMaxPathBytes || path.find('\0') != std::string_view::npos) return false;
  if (path.find('/') == std::string_view::npos) return true;
  return PathListed(path, targets);
}

std::vector<bool> ListedPaths(const std::vector<std::string>& paths, const std::vector<std::string>& targets) {
  std::vector<bool> listed;
  listed.reserve(paths.size());
  for (const auto& path : paths) listed.push_back(PathListed(path, targets));
  return listed;
}

OpenBackend ChooseOpenBackend(bool xdg_open) {
  return xdg_open ? OpenBackend::kDesktop : OpenBackend::kUnavailable;
}

DragStart ChooseDragStart(bool window, bool dragging, bool button_down) {
  if (!window) return DragStart::kWindowClosed;
  if (dragging) return DragStart::kDragActive;
  return button_down ? DragStart::kStart : DragStart::kButtonReleased;
}

RevealBackend ChooseRevealBackend(const RevealProbe& probe) {
  if (probe.portal) return RevealBackend::kPortal;
  if (probe.file_manager) return RevealBackend::kFileManager;
  if (probe.xdg_open && probe.folder_handler) return RevealBackend::kOpenFolder;
  return RevealBackend::kUnavailable;
}

std::vector<RevealBackend> RevealOrder(const RevealProbe& probe) {
  std::vector<RevealBackend> order;
  if (probe.portal) order.push_back(RevealBackend::kPortal);
  if (probe.file_manager) order.push_back(RevealBackend::kFileManager);
  if (probe.xdg_open && probe.folder_handler) order.push_back(RevealBackend::kOpenFolder);
  return order;
}

bool OpenFolderLaunched(std::optional<int> exit_code) {
  return !exit_code || *exit_code == 0;
}

std::string RevealFailureMessage(const std::vector<RevealBackend>& tried) {
  std::vector<std::string> names;
  for (const auto backend : tried) {
    if (backend == RevealBackend::kPortal) names.push_back("the desktop portal");
    else if (backend == RevealBackend::kFileManager) names.push_back("the file manager");
    else if (backend == RevealBackend::kOpenFolder) names.push_back("the folder app");
  }
  if (names.empty()) return "No desktop portal, file manager or folder application can show this file";
  std::string text;
  for (size_t index = 0; index < names.size(); ++index) {
    if (index) text += index + 1 == names.size() ? " and " : ", ";
    text += names[index];
  }
  text[0] = static_cast<char>(text[0] - 'a' + 'A');
  return text + " couldn't show this file";
}

LinuxRevealChain::LinuxRevealChain(std::vector<RevealBackend> order) : order_(std::move(order)) {}

std::optional<RevealBackend> LinuxRevealChain::Begin(RevealOutcome* outcome) {
  if (current_ || done_) return std::nullopt;
  return Advance(outcome);
}

std::optional<RevealBackend> LinuxRevealChain::Answer(RevealBackend backend, RevealAnswer answer,
                                                      RevealOutcome* outcome) {
  if (done_ || current_ != backend) return std::nullopt;
  current_.reset();
  if (answer == RevealAnswer::kShown || answer == RevealAnswer::kCancelled) {
    done_ = true;
    *outcome = {true, true, {}, {}};
    return std::nullopt;
  }
  if (answer != RevealAnswer::kUnavailable) tried_.push_back(backend);
  return Advance(outcome);
}

std::optional<RevealBackend> LinuxRevealChain::Advance(RevealOutcome* outcome) {
  if (next_ < order_.size()) {
    current_ = order_[next_++];
    return current_;
  }
  done_ = true;
  *outcome = {true, false, tried_.empty() ? "ERR_REVEAL_UNAVAILABLE" : "ERR_REVEAL_FAILED", RevealFailureMessage(tried_)};
  return std::nullopt;
}

int OpenRevealTarget(const std::string& path) {
  if (!ValidLocalPath(path)) return -1;
  int fd;
  do {
    fd = open(path.c_str(), O_RDONLY | O_CLOEXEC | O_NONBLOCK | O_NOFOLLOW);
  } while (fd < 0 && errno == EINTR);
  if (fd < 0) return -1;
  struct stat info;
  if (fstat(fd, &info) != 0 || !S_ISREG(info.st_mode)) {
    close(fd);
    return -1;
  }
  return fd;
}

bool PathListed(std::string_view path, const std::vector<std::string>& known) {
  if (!ValidLocalPath(path)) return false;
  for (const auto& candidate : known) {
    if (candidate == path) return true;
  }
  return false;
}

std::string TrashDirectory(const char* xdg_data_home, const char* home) {
  if (xdg_data_home && ValidLocalPath(xdg_data_home)) return std::string(xdg_data_home) + "/Trash";
  if (home && ValidLocalPath(home)) {
    return std::string(home == std::string_view("/") ? "" : home) + "/.local/share/Trash";
  }
  return {};
}

namespace {

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

struct SourceEntry {
  Fd parent;
  std::string name;
  struct stat info {};
};

TrashOutcome OpenSource(const std::string& path, SourceEntry* source) {
  if (!ValidLocalPath(path) || path == "/") return Failure("ERR_FILE_PATH", "The file path is invalid");
  const size_t slash = path.rfind('/');
  source->name = path.substr(slash + 1);
  source->parent = Fd(open(slash == 0 ? "/" : path.substr(0, slash).c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC));
  if (!source->parent.valid() || fstatat(source->parent.get(), source->name.c_str(), &source->info, AT_SYMLINK_NOFOLLOW) != 0) {
    return errno == ENOENT || errno == ENOTDIR ? Failure("ERR_FILE_MISSING", "The file no longer exists")
                                               : Failure("ERR_FILE", "The file cannot be read");
  }
  if (!S_ISREG(source->info.st_mode)) return Failure("ERR_FILE_TYPE", "Only regular files can be moved to the trash");
  return {true, {}, {}, {}};
}

Fd OpenDirectoryAt(int parent, const char* name, bool create) {
  if (create && mkdirat(parent, name, 0700) != 0 && errno != EEXIST) return Fd();
  Fd fd(openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  struct stat info;
  if (!fd.valid() || fstat(fd.get(), &info) != 0 || !S_ISDIR(info.st_mode)) return Fd();
  return fd;
}

Fd OpenOwnedDirectoryAt(int parent, const char* name, uid_t uid) {
  Fd fd = OpenDirectoryAt(parent, name, true);
  struct stat info;
  if (!fd.valid() || fstat(fd.get(), &info) != 0 || info.st_uid != uid || (info.st_mode & 0077) != 0) return Fd();
  return fd;
}

Fd OpenStickySharedTrash(int top) {
  Fd fd = OpenDirectoryAt(top, ".Trash", false);
  struct stat info;
  if (!fd.valid() || fstat(fd.get(), &info) != 0 || !(info.st_mode & S_ISVTX)) return Fd();
  return fd;
}

std::string DirectoryPath(int fd, const std::string& fallback) {
  char link[PATH_MAX];
  const std::string proc = "/proc/self/fd/" + std::to_string(fd);
  const ssize_t length = readlink(proc.c_str(), link, sizeof(link) - 1);
  if (length <= 0) return fallback;
  const std::string path(link, static_cast<size_t>(length));
  if (path.empty() || path[0] != '/' || path.find(" (deleted)") != std::string::npos) return fallback;
  return path;
}

struct TrashFolders {
  Fd files;
  Fd info;
  std::string files_path;
};

TrashOutcome TrashInto(const SourceEntry& source, const TrashFolders& trash, const std::string& recorded_path,
                       std::time_t now, const TrashHook& before_move) {
  struct tm local;
  char date[32];
  if (!localtime_r(&now, &local) || !std::strftime(date, sizeof(date), "%Y-%m-%dT%H:%M:%S", &local))
    return Failure("ERR_TRASH", "The deletion date cannot be recorded");
  const std::string record = "[Trash Info]\nPath=" + Escape(recorded_path) + "\nDeletionDate=" + date + "\n";
  if (before_move) before_move(TrashStage::kBeforeRecord);
  for (int attempt = 1; attempt <= 1000; ++attempt) {
    const std::string candidate = Candidate(source.name, attempt);
    if (candidate.size() + 10 > 255) return Failure("ERR_TRASH", "The file name is too long for the trash");
    const std::string info_name = candidate + ".trashinfo";
    const int fd = openat(trash.info.get(), info_name.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) {
      if (errno == EEXIST) continue;
      return Failure("ERR_TRASH", "The trash record cannot be created");
    }
    const bool recorded = WriteAll(fd, record) && fsync(fd) == 0;
    const bool closed = close(fd) == 0;
    if (!recorded || !closed) {
      unlinkat(trash.info.get(), info_name.c_str(), 0);
      return Failure("ERR_TRASH", "The trash record cannot be written");
    }
    if (linkat(source.parent.get(), source.name.c_str(), trash.files.get(), candidate.c_str(), 0) != 0) {
      const int error = errno;
      unlinkat(trash.info.get(), info_name.c_str(), 0);
      if (error == EEXIST) continue;
      if (error == ENOENT) return Failure("ERR_FILE_CHANGED", "The file changed while it was being moved to the trash");
      return error == EXDEV ? Failure("ERR_TRASH_UNAVAILABLE", "The file is on a different file system than the trash")
                            : Failure("ERR_TRASH", "The file cannot be moved to the trash");
    }
    struct stat linked;
    if (fstatat(trash.files.get(), candidate.c_str(), &linked, AT_SYMLINK_NOFOLLOW) != 0 ||
        linked.st_dev != source.info.st_dev || linked.st_ino != source.info.st_ino) {
      unlinkat(trash.files.get(), candidate.c_str(), 0);
      unlinkat(trash.info.get(), info_name.c_str(), 0);
      return Failure("ERR_FILE_CHANGED", "The file changed while it was being moved to the trash");
    }
    if (before_move) before_move(TrashStage::kBeforeRemove);
    struct stat current;
    if (fstatat(source.parent.get(), source.name.c_str(), &current, AT_SYMLINK_NOFOLLOW) != 0 ||
        current.st_dev != source.info.st_dev || current.st_ino != source.info.st_ino) {
      unlinkat(trash.files.get(), candidate.c_str(), 0);
      unlinkat(trash.info.get(), info_name.c_str(), 0);
      return Failure("ERR_FILE_CHANGED", "The file changed while it was being moved to the trash");
    }
    if (unlinkat(source.parent.get(), source.name.c_str(), 0) != 0) {
      unlinkat(trash.files.get(), candidate.c_str(), 0);
      unlinkat(trash.info.get(), info_name.c_str(), 0);
      return Failure("ERR_TRASH", "The original file cannot be removed");
    }
    return {true, {}, {}, DirectoryPath(trash.files.get(), trash.files_path) + "/" + candidate};
  }
  return Failure("ERR_TRASH", "The trash has too many files with this name");
}

std::optional<TrashFolders> OwnedFolders(int trash, uid_t uid, const std::string& path, dev_t device) {
  TrashFolders folders{OpenOwnedDirectoryAt(trash, "files", uid), OpenOwnedDirectoryAt(trash, "info", uid),
                       path + "/files"};
  struct stat files;
  if (!folders.files.valid() || !folders.info.valid() || fstat(folders.files.get(), &files) != 0 ||
      files.st_dev != device)
    return std::nullopt;
  return folders;
}

TrashOutcome TopdirTrash(SourceEntry& source, const std::string& path, const std::string& topdir, uid_t uid,
                         std::time_t now, const TrashHook& before_move) {
  if (!ValidLocalPath(topdir) && topdir != "/") return Failure("ERR_TRASH_UNAVAILABLE", "The file's volume cannot be found");
  const std::string prefix = topdir == "/" ? "/" : topdir + "/";
  if (path.size() <= prefix.size() || path.compare(0, prefix.size(), prefix) != 0)
    return Failure("ERR_FILE_PATH", "The file is not on this volume");
  const std::string relative = path.substr(prefix.size());
  const std::string base = topdir == "/" ? "" : topdir;
  const std::string user = std::to_string(uid);
  Fd top(open(topdir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC));
  if (!top.valid()) return Failure("ERR_TRASH_UNAVAILABLE", "The file's volume cannot be found");
  if (Fd shared = OpenStickySharedTrash(top.get()); shared.valid()) {
    Fd own = OpenOwnedDirectoryAt(shared.get(), user.c_str(), uid);
    if (own.valid()) {
      if (auto folders = OwnedFolders(own.get(), uid, base + "/.Trash/" + user, source.info.st_dev))
        return TrashInto(source, *folders, relative, now, before_move);
    }
  }
  const std::string fallback = ".Trash-" + user;
  Fd own = OpenOwnedDirectoryAt(top.get(), fallback.c_str(), uid);
  if (own.valid()) {
    if (auto folders = OwnedFolders(own.get(), uid, base + "/" + fallback, source.info.st_dev))
      return TrashInto(source, *folders, relative, now, before_move);
  }
  return Failure("ERR_TRASH_UNAVAILABLE", "This volume has no usable trash");
}

}

TrashOutcome MoveToTrash(const std::string& path, const std::string& trash_directory,
                         std::time_t now, const TrashHook& before_move) {
  SourceEntry source;
  if (auto checked = OpenSource(path, &source); !checked.ok) return checked;
  if (trash_directory.empty() || !ValidLocalPath(trash_directory))
    return Failure("ERR_TRASH_UNAVAILABLE", "No desktop trash directory is configured");
  if (!MakeDirectories(trash_directory))
    return Failure("ERR_TRASH_UNAVAILABLE", "The desktop trash directory cannot be created");
  Fd trash(open(trash_directory.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC));
  TrashFolders folders;
  if (trash.valid()) {
    folders.files = OpenDirectoryAt(trash.get(), "files", true);
    folders.info = OpenDirectoryAt(trash.get(), "info", true);
    folders.files_path = trash_directory + "/files";
  }
  struct stat target;
  if (!folders.files.valid() || !folders.info.valid() || fstat(folders.files.get(), &target) != 0)
    return Failure("ERR_TRASH_UNAVAILABLE", "The desktop trash directory cannot be created");
  if (target.st_dev != source.info.st_dev) {
    const std::string resolved = ResolvedFile(path);
    const std::string top = resolved.empty() ? std::string() : MountTop(resolved);
    if (top.empty()) return Failure("ERR_TRASH_UNAVAILABLE", "The file's volume cannot be found");
    SourceEntry far;
    if (auto checked = OpenSource(resolved, &far); !checked.ok) return checked;
    if (far.info.st_dev != source.info.st_dev || far.info.st_ino != source.info.st_ino)
      return Failure("ERR_FILE_CHANGED", "The file changed while it was being moved to the trash");
    return TopdirTrash(far, resolved, top, getuid(), now, before_move);
  }
  return TrashInto(source, folders, path, now, before_move);
}

FolderCheck CheckDownloadFolder(const std::string& path) {
  if (!ValidLocalPath(path)) return {false, "ERR_FILE_PATH", "The folder path is invalid"};
  struct stat info;
  if (stat(path.c_str(), &info) != 0) {
    return errno == ENOENT || errno == ENOTDIR ? FolderCheck{false, "ERR_FOLDER_MISSING", "That folder no longer exists"}
                                               : FolderCheck{false, "ERR_FOLDER", "That folder can't be read"};
  }
  if (!S_ISDIR(info.st_mode)) return {false, "ERR_FOLDER_TYPE", "That isn't a folder"};
  if (access(path.c_str(), W_OK | X_OK) != 0) {
    return {false, "ERR_FOLDER_NOT_WRITABLE", "Ardia can't save downloads in that folder"};
  }
  return {true, {}, {}};
}

std::string ResolvedFile(const std::string& path) {
  if (!ValidLocalPath(path)) return {};
  const size_t slash = path.rfind('/');
  char resolved[PATH_MAX];
  if (!realpath(slash == 0 ? "/" : path.substr(0, slash).c_str(), resolved)) return {};
  const std::string directory = resolved;
  return (directory == "/" ? "" : directory) + path.substr(slash);
}

std::string MountTop(const std::string& path) {
  const size_t slash = path.rfind('/');
  if (slash == std::string::npos) return {};
  char resolved[PATH_MAX];
  if (!realpath(slash == 0 ? "/" : path.substr(0, slash).c_str(), resolved)) return {};
  std::string current = resolved;
  struct stat here;
  if (stat(current.c_str(), &here) != 0) return {};
  while (current != "/") {
    const size_t up = current.rfind('/');
    const std::string parent = up == 0 ? "/" : current.substr(0, up);
    struct stat above;
    if (stat(parent.c_str(), &above) != 0) return {};
    if (above.st_dev != here.st_dev) return current;
    current = parent;
  }
  return current;
}

TrashOutcome MoveToTopdirTrash(const std::string& path, const std::string& topdir, uid_t uid,
                               std::time_t now, const TrashHook& before_move) {
  SourceEntry source;
  if (auto checked = OpenSource(path, &source); !checked.ok) return checked;
  return TopdirTrash(source, path, topdir, uid, now, before_move);
}

}
