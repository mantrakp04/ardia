#include "ardia/linux/ac_linux_memory_pressure.h"

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <sys/statfs.h>
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <charconv>
#include <cmath>
#include <utility>

namespace ardiacore {
namespace {

constexpr long kProcMagic = 0x9fa0;
constexpr long kCgroup2Magic = 0x63677270;
constexpr char kTrigger[] = "some 150000 2000000";
constexpr uint64_t kShortestWindowUs = 500000;
constexpr int kArmedWaitMs = 30000;
constexpr int kPolledWaitMs = 5000;
constexpr int kElevatedWaitMs = 2000;
constexpr int kMeasureWaitMs = 1000;
constexpr int kPollFailuresMax = 3;

void Sleep(int timeout_ms) {
  if (timeout_ms <= 0) return;
  timespec remaining{timeout_ms / 1000, static_cast<long>(timeout_ms % 1000) * 1000000L};
  while (nanosleep(&remaining, &remaining) != 0 && errno == EINTR) {
  }
}

struct Stall {
  double some = 0;
  double full = 0;
};

std::optional<std::string_view> Field(std::string_view line, std::string_view name) {
  for (size_t start = 0; start < line.size();) {
    size_t end = line.find(' ', start);
    if (end == std::string_view::npos) end = line.size();
    std::string_view token = line.substr(start, end - start);
    if (token.size() > name.size() && token.substr(0, name.size()) == name && token[name.size()] == '=')
      return token.substr(name.size() + 1);
    start = end + 1;
  }
  return std::nullopt;
}

std::optional<double> Average(std::string_view line) {
  auto text = Field(line, "avg10");
  if (!text || text->empty()) return std::nullopt;
  double value = 0;
  auto [end, error] = std::from_chars(text->data(), text->data() + text->size(), value);
  if (error != std::errc() || end != text->data() + text->size() || !std::isfinite(value) || value < 0 || value > 100)
    return std::nullopt;
  return value;
}

std::optional<uint64_t> Total(std::string_view line) {
  auto text = Field(line, "total");
  if (!text || text->empty()) return std::nullopt;
  uint64_t value = 0;
  auto [end, error] = std::from_chars(text->data(), text->data() + text->size(), value);
  if (error != std::errc() || end != text->data() + text->size()) return std::nullopt;
  return value;
}

LinuxMemoryLevel Classify(const Stall& stall, LinuxMemoryLevel current) {
  if (stall.full >= 0.10 || stall.some >= 0.40) return LinuxMemoryLevel::kCritical;
  if (current == LinuxMemoryLevel::kCritical && (stall.full >= 0.05 || stall.some >= 0.20))
    return LinuxMemoryLevel::kCritical;
  if (stall.some >= 0.10) return LinuxMemoryLevel::kWarning;
  if (current != LinuxMemoryLevel::kNormal && stall.some >= 0.05) return LinuxMemoryLevel::kWarning;
  return LinuxMemoryLevel::kNormal;
}

std::optional<LinuxPsiTotals> ReadPsi(int fd) {
  char buffer[512];
  ssize_t length;
  do {
    length = pread(fd, buffer, sizeof(buffer) - 1, 0);
  } while (length < 0 && errno == EINTR);
  if (length <= 0) return std::nullopt;
  return ParseLinuxPsi(std::string_view(buffer, static_cast<size_t>(length)));
}

bool Armable(int fd) {
  struct statfs info;
  if (fstatfs(fd, &info) != 0) return false;
  return static_cast<long>(info.f_type) == kProcMagic || static_cast<long>(info.f_type) == kCgroup2Magic;
}

bool Arm(int fd) {
  ssize_t written;
  do {
    written = write(fd, kTrigger, sizeof(kTrigger));
  } while (written < 0 && errno == EINTR);
  return written == static_cast<ssize_t>(sizeof(kTrigger));
}

int OpenSource(const std::string& path, bool* armed) {
  *armed = false;
  int fd = open(path.c_str(), O_RDWR | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW);
  if (fd >= 0 && Armable(fd)) {
    if (ReadPsi(fd) && Arm(fd)) {
      *armed = true;
      return fd;
    }
    close(fd);
    fd = -1;
  } else if (fd >= 0) {
    close(fd);
    fd = -1;
  }
  fd = open(path.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) return -1;
  if (!ReadPsi(fd)) {
    close(fd);
    return -1;
  }
  return fd;
}

}

std::optional<LinuxPsiTotals> ParseLinuxPsi(std::string_view text) {
  std::optional<LinuxPsiTotals> totals;
  for (size_t start = 0; start < text.size();) {
    size_t end = text.find('\n', start);
    if (end == std::string_view::npos) end = text.size();
    std::string_view line = text.substr(start, end - start);
    start = end + 1;
    const bool some = line.substr(0, 5) == "some ";
    const bool full = line.substr(0, 5) == "full ";
    if (!some && !full) continue;
    auto average = Average(line);
    auto total = Total(line);
    if (!average || !total) return std::nullopt;
    if (some) {
      if (!totals) totals.emplace();
      totals->some = *total;
      totals->some_avg10 = *average;
    } else {
      if (!totals) return std::nullopt;
      totals->full = *total;
      totals->full_avg10 = *average;
    }
  }
  return totals;
}

std::string_view LinuxMemoryLevelName(LinuxMemoryLevel level) {
  switch (level) {
    case LinuxMemoryLevel::kNormal: return "normal";
    case LinuxMemoryLevel::kWarning: return "warning";
    case LinuxMemoryLevel::kCritical: return "critical";
  }
  return "normal";
}

LinuxMemoryLevel LinuxMemoryPressureTracker::Observe(const LinuxPsiTotals& totals, uint64_t now_us,
                                                      bool triggered) {
  if (triggered) {
    level_ = std::max(level_, LinuxMemoryLevel::kWarning);
    baseline_ = totals;
    baseline_us_ = now_us;
    measuring_ = true;
    return level_;
  }
  if (!baseline_) {
    level_ = Classify({totals.some_avg10 / 100.0, totals.full_avg10.value_or(0) / 100.0}, level_);
    baseline_ = totals;
    baseline_us_ = now_us;
    return level_;
  }
  if (totals.some < baseline_->some || (totals.full && baseline_->full && *totals.full < *baseline_->full) ||
      now_us < baseline_us_) {
    baseline_ = totals;
    baseline_us_ = now_us;
    measuring_ = false;
    return level_;
  }
  const uint64_t window = now_us - baseline_us_;
  if (window < kShortestWindowUs) return level_;
  Stall stall;
  stall.some = static_cast<double>(totals.some - baseline_->some) / static_cast<double>(window);
  if (totals.full && baseline_->full)
    stall.full = static_cast<double>(*totals.full - *baseline_->full) / static_cast<double>(window);
  level_ = Classify(stall, level_);
  baseline_ = totals;
  baseline_us_ = now_us;
  measuring_ = false;
  return level_;
}

int LinuxMemoryPressureTracker::NextWaitMs(bool armed) const {
  if (measuring_) return kMeasureWaitMs;
  if (level_ != LinuxMemoryLevel::kNormal) return kElevatedWaitMs;
  return armed ? kArmedWaitMs : kPolledWaitMs;
}

std::optional<std::string> LinuxOwnCgroup(std::string_view proc_self_cgroup) {
  for (size_t start = 0; start < proc_self_cgroup.size();) {
    size_t end = proc_self_cgroup.find('\n', start);
    if (end == std::string_view::npos) end = proc_self_cgroup.size();
    std::string_view line = proc_self_cgroup.substr(start, end - start);
    start = end + 1;
    if (line.substr(0, 3) != "0::") continue;
    std::string_view path = line.substr(3);
    if (path.empty() || path[0] != '/') return std::nullopt;
    for (size_t at = 0; at < path.size();) {
      size_t next = path.find('/', at + 1);
      if (next == std::string_view::npos) next = path.size();
      std::string_view part = path.substr(at + 1, next - at - 1);
      if (part == "." || part == "..") return std::nullopt;
      at = next;
    }
    return std::string(path);
  }
  return std::nullopt;
}

std::vector<std::string> LinuxMemoryPressureFiles(std::string_view cgroup_mount, std::string_view proc_root,
                                                  std::string_view proc_self_cgroup) {
  std::vector<std::string> files;
  auto cgroup = LinuxOwnCgroup(proc_self_cgroup);
  if (cgroup && *cgroup != "/") files.push_back(std::string(cgroup_mount) + *cgroup + "/memory.pressure");
  files.push_back(std::string(proc_root) + "/pressure/memory");
  return files;
}

LinuxMemoryPressureWatch LinuxMemoryPressureWatch::Open(const std::vector<std::string>& paths) {
  LinuxMemoryPressureWatch watch;
  for (const auto& path : paths) {
    Source source;
    source.fd = OpenSource(path, &source.armed);
    if (source.fd >= 0) watch.sources_.push_back(std::move(source));
  }
  return watch;
}

LinuxMemoryPressureWatch::LinuxMemoryPressureWatch(LinuxMemoryPressureWatch&& other) noexcept
    : sources_(std::exchange(other.sources_, {})) {}

LinuxMemoryPressureWatch& LinuxMemoryPressureWatch::operator=(LinuxMemoryPressureWatch&& other) noexcept {
  if (this != &other) {
    Close();
    sources_ = std::exchange(other.sources_, {});
  }
  return *this;
}

LinuxMemoryPressureWatch::~LinuxMemoryPressureWatch() { Close(); }

void LinuxMemoryPressureWatch::Close() {
  for (auto& source : sources_) close(source.fd);
  sources_.clear();
}

bool LinuxMemoryPressureWatch::armed() const {
  return std::any_of(sources_.begin(), sources_.end(), [](const Source& source) { return source.armed; });
}

LinuxMemoryLevel LinuxMemoryPressureWatch::Sample(uint64_t now_us) {
  LinuxMemoryLevel level = LinuxMemoryLevel::kNormal;
  for (auto it = sources_.begin(); it != sources_.end();) {
    auto totals = ReadPsi(it->fd);
    if (!totals) {
      close(it->fd);
      it = sources_.erase(it);
      continue;
    }
    level = std::max(level, it->tracker.Observe(*totals, now_us, std::exchange(it->triggered, false)));
    ++it;
  }
  return level;
}

int LinuxMemoryPressureWatch::NextWaitMs() const {
  int wait = kArmedWaitMs;
  for (const auto& source : sources_) wait = std::min(wait, source.tracker.NextWaitMs(source.armed));
  return wait;
}

bool LinuxMemoryPressureWatch::Wait(int timeout_ms, int (*poll_fn)(pollfd*, nfds_t, int)) {
  std::vector<pollfd> fds;
  std::vector<size_t> owners;
  for (size_t index = 0; index < sources_.size(); ++index) {
    if (!sources_[index].armed) continue;
    fds.push_back({sources_[index].fd, POLLPRI, 0});
    owners.push_back(index);
  }
  if (fds.empty()) {
    Sleep(timeout_ms);
    return true;
  }
  int ready;
  do {
    ready = poll_fn(fds.data(), fds.size(), timeout_ms);
  } while (ready < 0 && errno == EINTR);
  if (ready < 0) {
    if (++failures_ >= kPollFailuresMax) Close();
    Sleep(timeout_ms);
    return false;
  }
  failures_ = 0;
  for (size_t index = 0; index < fds.size(); ++index) {
    Source& source = sources_[owners[index]];
    if (fds[index].revents & (POLLERR | POLLNVAL | POLLHUP)) source.armed = false;
    else if (fds[index].revents & POLLPRI) source.triggered = true;
  }
  return true;
}

uint64_t LinuxMonotonicMicroseconds() {
  timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return static_cast<uint64_t>(now.tv_sec) * 1000000u + static_cast<uint64_t>(now.tv_nsec) / 1000u;
}

}
