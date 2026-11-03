#ifndef ARDIA_LINUX_AC_LINUX_CONTROL_CORE_H_
#define ARDIA_LINUX_AC_LINUX_CONTROL_CORE_H_

#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <string>
#include <string_view>
#include <vector>

#include <sys/stat.h>

namespace ardia::linux_control {

inline constexpr char kSocketName[] = "ArdiaControl.sock";
inline constexpr char kLockName[] = "ArdiaControl.sock.lock";
inline constexpr size_t kMaxConnections = 16;
inline constexpr size_t kMaxPathBytes = 107;
inline constexpr int kAcceptsPerCallback = 8;
inline constexpr size_t kMaxLine = 1048576;
inline constexpr int kMaxPendingRequests = 32;
inline constexpr int kLineDeadlineSeconds = 30;
inline constexpr size_t kReadSize = 65536;
inline constexpr size_t kMaxOutputBytes = 4 * 1024 * 1024;
inline constexpr int kMaxWaitingEvents = 1000;

struct Ticket {
  std::string owner;
  int number = 0;
  bool operator==(const Ticket&) const = default;
};

class Output {
 public:
  enum class WriteResult { kDrained, kBlocked, kFailed };

  bool AddReply(std::string data, Ticket ticket);
  bool AddEvent(std::string data);
  WriteResult Write(int fd);
  std::vector<Ticket> TakeFinishedTickets();
  std::vector<Ticket> WaitingTickets() const;

  bool empty() const { return chunks_.empty(); }
  size_t bytes() const { return bytes_; }
  int waiting_events() const { return waiting_events_; }
  int dropped() const { return dropped_; }

  static std::string Marking(std::string_view line, int dropped);

 private:
  struct Chunk {
    std::string data;
    bool event = false;
    Ticket ticket;
  };

  bool Append(Chunk chunk);
  bool StartHead();
  std::ptrdiff_t OldestWaitingEvent() const;

  std::deque<Chunk> chunks_;
  bool head_started_ = false;
  size_t offset_ = 0;
  size_t bytes_ = 0;
  int waiting_events_ = 0;
  int dropped_ = 0;
  std::vector<Ticket> finished_;
};

class LineReader {
 public:
  enum class Result { kOpen, kClose };

  Result Take(std::string_view bytes, const std::function<void(std::string)>& on_line);
  void Replied() {
    if (pending_requests_ > 0) --pending_requests_;
  }
  void Clear() { input_.clear(); }

  bool partial() const { return !input_.empty(); }
  bool consumed_last() const { return consumed_last_; }
  int pending_requests() const { return pending_requests_; }

 private:
  std::string input_;
  int pending_requests_ = 0;
  bool consumed_last_ = false;
};

std::string ValidUtf8(std::string_view bytes);

std::string Framed(std::string_view line);

bool PathFits(std::string_view path);

std::string UnsafeFolder(const std::string& directory);

bool BindPrivately(int fd, const std::string& directory, const std::string& path, struct stat* made, std::string* error);

}

#endif
