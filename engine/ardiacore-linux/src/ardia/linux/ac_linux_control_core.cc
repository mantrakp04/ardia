#include "ardia/linux/ac_linux_control_core.h"

#include <errno.h>
#include <string.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#include <cstring>

#include <utility>

namespace ardia::linux_control {

namespace {

size_t ValidSequence(std::string_view text, size_t at) {
  const auto byte = [&](size_t index) { return static_cast<unsigned char>(text[index]); };
  const unsigned char lead = byte(at);
  if (lead < 0x80) return 1;
  size_t length = 0;
  unsigned char low = 0x80;
  unsigned char high = 0xBF;
  if (lead >= 0xC2 && lead <= 0xDF) {
    length = 2;
  } else if (lead >= 0xE0 && lead <= 0xEF) {
    length = 3;
    if (lead == 0xE0) low = 0xA0;
    if (lead == 0xED) high = 0x9F;
  } else if (lead >= 0xF0 && lead <= 0xF4) {
    length = 4;
    if (lead == 0xF0) low = 0x90;
    if (lead == 0xF4) high = 0x8F;
  } else {
    return 0;
  }
  if (at + length > text.size()) return 0;
  if (byte(at + 1) < low || byte(at + 1) > high) return 0;
  for (size_t index = 2; index < length; ++index) {
    if (byte(at + index) < 0x80 || byte(at + index) > 0xBF) return 0;
  }
  return length;
}

}

std::string ValidUtf8(std::string_view bytes) {
  std::string text;
  text.reserve(bytes.size());
  size_t at = 0;
  while (at < bytes.size()) {
    const size_t length = ValidSequence(bytes, at);
    if (length == 0) {
      text.append("\xEF\xBF\xBD");
      ++at;
      continue;
    }
    text.append(bytes.substr(at, length));
    at += length;
  }
  return text;
}

bool Output::AddReply(std::string data, Ticket ticket) {
  return Append(Chunk{std::move(data), false, std::move(ticket)});
}

bool Output::AddEvent(std::string data) {
  if (waiting_events_ >= kMaxWaitingEvents) {
    const std::ptrdiff_t index = OldestWaitingEvent();
    if (index >= 0) {
      bytes_ -= chunks_[index].data.size();
      chunks_.erase(chunks_.begin() + index);
      --waiting_events_;
      ++dropped_;
    }
  }
  ++waiting_events_;
  if (Append(Chunk{std::move(data), true, Ticket{}})) return true;
  --waiting_events_;
  return false;
}

Output::WriteResult Output::Write(int fd) {
  while (!chunks_.empty()) {
    if (!StartHead()) return WriteResult::kFailed;
    const std::string& data = chunks_.front().data;
    const ssize_t written = send(fd, data.data() + offset_, data.size() - offset_, MSG_NOSIGNAL | MSG_DONTWAIT);
    if (written < 0) {
      if (errno == EINTR) continue;
      return errno == EAGAIN || errno == EWOULDBLOCK ? WriteResult::kBlocked : WriteResult::kFailed;
    }
    offset_ += static_cast<size_t>(written);
    bytes_ -= static_cast<size_t>(written);
    if (offset_ == data.size()) {
      if (chunks_.front().ticket.number > 0) finished_.push_back(std::move(chunks_.front().ticket));
      chunks_.pop_front();
      offset_ = 0;
      head_started_ = false;
    }
  }
  return WriteResult::kDrained;
}

std::vector<Ticket> Output::TakeFinishedTickets() {
  return std::exchange(finished_, {});
}

std::vector<Ticket> Output::WaitingTickets() const {
  std::vector<Ticket> waiting;
  for (const Chunk& chunk : chunks_) {
    if (chunk.ticket.number > 0) waiting.push_back(chunk.ticket);
  }
  return waiting;
}

std::string Output::Marking(std::string_view line, int dropped) {
  if (line.size() < 2 || line[0] != '{' || line[1] == '}') return std::string(line);
  std::string marked = "{\"dropped\":" + std::to_string(dropped) + ",";
  marked.append(line.substr(1));
  return marked;
}

bool Output::Append(Chunk chunk) {
  if (bytes_ + chunk.data.size() > kMaxOutputBytes) return false;
  bytes_ += chunk.data.size();
  chunks_.push_back(std::move(chunk));
  return true;
}

bool Output::StartHead() {
  if (head_started_) return true;
  head_started_ = true;
  Chunk& head = chunks_.front();
  if (!head.event) return true;
  --waiting_events_;
  if (dropped_ <= 0) return true;
  std::string marked = Marking(head.data, dropped_);
  const size_t grown = marked.size() - head.data.size();
  if (bytes_ + grown > kMaxOutputBytes) return false;
  bytes_ += grown;
  head.data = std::move(marked);
  dropped_ = 0;
  return true;
}

std::ptrdiff_t Output::OldestWaitingEvent() const {
  for (size_t index = 0; index < chunks_.size(); ++index) {
    if (chunks_[index].event && !(index == 0 && head_started_)) return static_cast<std::ptrdiff_t>(index);
  }
  return -1;
}

LineReader::Result LineReader::Take(std::string_view bytes, const std::function<void(std::string)>& on_line) {
  const size_t scan_from = input_.size();
  input_.append(bytes);
  size_t line_start = 0;
  size_t index = scan_from;
  consumed_last_ = false;
  while (true) {
    const size_t newline = input_.find('\n', index);
    if (newline == std::string::npos) break;
    if (newline - line_start > kMaxLine) return Result::kClose;
    if (++pending_requests_ > kMaxPendingRequests) return Result::kClose;
    on_line(ValidUtf8(std::string_view(input_).substr(line_start, newline - line_start)));
    line_start = newline + 1;
    index = line_start;
    consumed_last_ = true;
  }
  if (line_start > 0) input_.erase(0, line_start);
  if (input_.size() > kMaxLine) return Result::kClose;
  return Result::kOpen;
}

std::string Framed(std::string_view line) {
  std::string data(line);
  data.push_back('\n');
  return data;
}

bool PathFits(std::string_view path) {
  return path.size() <= kMaxPathBytes;
}

std::string UnsafeFolder(const std::string& directory) {
  struct stat info;
  if (lstat(directory.c_str(), &info) != 0) {
    return "Couldn't read the data folder " + directory + " (" + strerror(errno) + ").";
  }
  if (!S_ISDIR(info.st_mode)) return "The data folder " + directory + " isn't a real folder.";
  if (info.st_uid != geteuid()) return "The data folder " + directory + " belongs to another user.";
  if (info.st_mode & (S_IWGRP | S_IWOTH)) return "Others can write to the data folder " + directory + ".";
  return std::string();
}

bool BindPrivately(int fd, const std::string& directory, const std::string& path, struct stat* made, std::string* error) {
  std::string pattern = directory + "/.ac.XXXXXX";
  std::vector<char> name(pattern.begin(), pattern.end());
  name.push_back('\0');
  if (!mkdtemp(name.data())) {
    *error = strerror(errno);
    return false;
  }
  const std::string staging(name.data());
  const std::string staged = staging + "/s";
  sockaddr_un address = {};
  bool ok = staged.size() < sizeof(address.sun_path);
  if (!ok) *error = "the staging path is too long";
  struct stat bound;
  if (ok) {
    address.sun_family = AF_UNIX;
    memcpy(address.sun_path, staged.data(), staged.size());
    ok = bind(fd, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) == 0 &&
         chmod(staged.c_str(), 0600) == 0 && lstat(staged.c_str(), &bound) == 0;
    if (!ok) *error = strerror(errno);
  }
  if (ok && (!S_ISSOCK(bound.st_mode) || (bound.st_mode & 0777) != 0600 || bound.st_uid != geteuid())) {
    ok = false;
    *error = "the staged socket isn't a private socket";
  }
  if (ok && rename(staged.c_str(), path.c_str()) != 0) {
    ok = false;
    *error = strerror(errno);
  }
  if (ok && (lstat(path.c_str(), made) != 0 || made->st_dev != bound.st_dev || made->st_ino != bound.st_ino)) {
    ok = false;
    *error = "the socket moved while it was put in place";
  }
  unlink(staged.c_str());
  rmdir(staging.c_str());
  return ok;
}

}
