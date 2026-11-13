#include <fcntl.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <dirent.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#include <cassert>
#include <cstdio>
#include <string>
#include <vector>

#include "ardia/linux/ac_linux_control_core.cc"

namespace control = ardia::linux_control;

namespace {

std::vector<std::string> Lines(control::LineReader& reader, std::string_view bytes, control::LineReader::Result* result) {
  std::vector<std::string> lines;
  *result = reader.Take(bytes, [&](std::string line) { lines.push_back(std::move(line)); });
  return lines;
}

std::string Drain(int fd) {
  std::string all;
  char buffer[65536];
  while (true) {
    const ssize_t got = recv(fd, buffer, sizeof(buffer), MSG_DONTWAIT);
    if (got <= 0) break;
    all.append(buffer, static_cast<size_t>(got));
  }
  return all;
}

std::vector<std::string> Split(const std::string& text) {
  std::vector<std::string> lines;
  size_t start = 0;
  size_t newline;
  while ((newline = text.find('\n', start)) != std::string::npos) {
    lines.push_back(text.substr(start, newline - start));
    start = newline + 1;
  }
  return lines;
}

void Pair(int fds[2]) {
  assert(socketpair(AF_UNIX, SOCK_STREAM, 0, fds) == 0);
  const int size = 4 * 1024 * 1024;
  setsockopt(fds[0], SOL_SOCKET, SO_SNDBUF, &size, sizeof(size));
  setsockopt(fds[1], SOL_SOCKET, SO_RCVBUF, &size, sizeof(size));
}

void Marking() {
  assert(control::Output::Marking("{\"event\":\"tab.opened\"}", 3) == "{\"dropped\":3,\"event\":\"tab.opened\"}");
  assert(control::Output::Marking("{}", 3) == "{}");
  assert(control::Output::Marking("[1]", 3) == "[1]");
  assert(control::Output::Marking("{", 3) == "{");
}

void Drops() {
  control::Output output;
  for (int index = 0; index < 1005; ++index) {
    assert(output.AddEvent("{\"n\":" + std::to_string(index) + "}\n"));
  }
  assert(output.waiting_events() == 1000);
  assert(output.dropped() == 5);
  assert(output.AddReply("{\"id\":1,\"result\":true}\n", control::Ticket{"a", 7}));
  int fds[2];
  Pair(fds);
  std::string received;
  while (!output.empty()) {
    const auto result = output.Write(fds[0]);
    assert(result != control::Output::WriteResult::kFailed);
    received += Drain(fds[1]);
  }
  received += Drain(fds[1]);
  const auto lines = Split(received);
  assert(lines.size() == 1001);
  assert(lines.front() == "{\"dropped\":5,\"n\":5}");
  assert(lines[1] == "{\"n\":6}");
  assert(lines.back() == "{\"id\":1,\"result\":true}");
  const auto finished = output.TakeFinishedTickets();
  assert(finished.size() == 1 && finished[0] == (control::Ticket{"a", 7}));
  assert(output.dropped() == 0);
  assert(output.bytes() == 0);
  close(fds[0]);
  close(fds[1]);
}

void RepliesAreNeverDropped() {
  control::Output output;
  assert(output.AddReply("{\"id\":1}\n", control::Ticket{"a", 1}));
  for (int index = 0; index < 1200; ++index) assert(output.AddEvent("{\"e\":1}\n"));
  assert(output.AddReply("{\"id\":2}\n", control::Ticket{"b", 2}));
  const auto waiting = output.WaitingTickets();
  assert(waiting.size() == 2);
  assert(waiting[0] == (control::Ticket{"a", 1}));
  assert(waiting[1] == (control::Ticket{"b", 2}));
  assert(output.waiting_events() == 1000);
}

void ByteLimit() {
  control::Output output;
  assert(output.AddReply(std::string(control::kMaxOutputBytes, 'x'), control::Ticket{}));
  assert(!output.AddReply("y", control::Ticket{"a", 1}));
  assert(!output.AddEvent("y"));
  assert(output.waiting_events() == 0);
}

void PartialHead() {
  int fds[2];
  assert(socketpair(AF_UNIX, SOCK_STREAM, 0, fds) == 0);
  const int small = 4096;
  setsockopt(fds[0], SOL_SOCKET, SO_SNDBUF, &small, sizeof(small));
  control::Output output;
  assert(output.AddEvent("{\"big\":\"" + std::string(256 * 1024, 'x') + "\"}\n"));
  assert(output.Write(fds[0]) == control::Output::WriteResult::kBlocked);
  for (int index = 0; index < 1001; ++index) assert(output.AddEvent("{\"n\":1}\n"));
  assert(output.dropped() == 1);
  std::string received;
  while (!output.empty()) {
    assert(output.Write(fds[0]) != control::Output::WriteResult::kFailed);
    received += Drain(fds[1]);
  }
  received += Drain(fds[1]);
  const auto lines = Split(received);
  assert(lines.size() == 1001);
  assert(lines.front().rfind("{\"big\":\"", 0) == 0);
  assert(lines[1] == "{\"dropped\":1,\"n\":1}");
  close(fds[0]);
  close(fds[1]);
}

void FailedWrite() {
  int fds[2];
  assert(socketpair(AF_UNIX, SOCK_STREAM, 0, fds) == 0);
  close(fds[1]);
  control::Output output;
  assert(output.AddReply("{\"id\":1}\n", control::Ticket{"a", 3}));
  assert(output.Write(fds[0]) == control::Output::WriteResult::kFailed);
  assert(output.TakeFinishedTickets().empty());
  assert(output.WaitingTickets().size() == 1);
  close(fds[0]);
}

void Framing() {
  control::LineReader reader;
  control::LineReader::Result result;
  auto lines = Lines(reader, "{\"id\":1}\n{\"id\":2}\n{\"id\"", &result);
  assert(result == control::LineReader::Result::kOpen);
  assert(lines.size() == 2 && lines[0] == "{\"id\":1}" && lines[1] == "{\"id\":2}");
  assert(reader.partial() && reader.consumed_last());
  lines = Lines(reader, ":3}", &result);
  assert(lines.empty() && reader.partial() && !reader.consumed_last());
  lines = Lines(reader, "\n", &result);
  assert(lines.size() == 1 && lines[0] == "{\"id\":3}");
  assert(!reader.partial());
  assert(reader.pending_requests() == 3);
  lines = Lines(reader, "\n", &result);
  assert(lines.size() == 1 && lines[0].empty());
  assert(control::Framed("{}") == "{}\n");
}

void LongLines() {
  control::LineReader fits;
  control::LineReader::Result result;
  auto lines = Lines(fits, std::string(control::kMaxLine, 'a') + "\n", &result);
  assert(result == control::LineReader::Result::kOpen && lines.size() == 1);
  control::LineReader too_long;
  lines = Lines(too_long, std::string(control::kMaxLine + 1, 'a') + "\n", &result);
  assert(result == control::LineReader::Result::kClose && lines.empty());
  control::LineReader unfinished;
  Lines(unfinished, std::string(control::kMaxLine, 'a'), &result);
  assert(result == control::LineReader::Result::kOpen);
  Lines(unfinished, "a", &result);
  assert(result == control::LineReader::Result::kClose);
}

void Pending() {
  control::LineReader reader;
  control::LineReader::Result result;
  std::string many;
  for (int index = 0; index < control::kMaxPendingRequests; ++index) many += "{}\n";
  auto lines = Lines(reader, many, &result);
  assert(result == control::LineReader::Result::kOpen && lines.size() == 32);
  reader.Replied();
  lines = Lines(reader, "{}\n", &result);
  assert(result == control::LineReader::Result::kOpen && lines.size() == 1);
  lines = Lines(reader, "{}\n", &result);
  assert(result == control::LineReader::Result::kClose && lines.empty());
  control::LineReader idle;
  idle.Replied();
  assert(idle.pending_requests() == 0);
}

void Utf8() {
  assert(control::ValidUtf8("caf\xC3\xA9") == "caf\xC3\xA9");
  assert(control::ValidUtf8("a\xFF" "b") == "a\xEF\xBF\xBD" "b");
  assert(control::ValidUtf8("\xED\xA0\x80") == "\xEF\xBF\xBD\xEF\xBF\xBD\xEF\xBF\xBD");
  assert(control::ValidUtf8("\xF0\x9F\x98\x80") == "\xF0\x9F\x98\x80");
  assert(control::ValidUtf8("\xE2\x82") == "\xEF\xBF\xBD\xEF\xBF\xBD");
}

void Folders(const char* root) {
  const std::string base(root);
  const std::string safe = base + "/safe";
  assert(mkdir(safe.c_str(), 0700) == 0);
  assert(control::UnsafeFolder(safe).empty());
  const std::string shared = base + "/shared";
  assert(mkdir(shared.c_str(), 0700) == 0);
  assert(chmod(shared.c_str(), 0770) == 0);
  assert(control::UnsafeFolder(shared) == "Others can write to the data folder " + shared + ".");
  const std::string link = base + "/link";
  assert(symlink(safe.c_str(), link.c_str()) == 0);
  assert(control::UnsafeFolder(link) == "The data folder " + link + " isn't a real folder.");
  assert(control::UnsafeFolder(base + "/missing").rfind("Couldn't read the data folder", 0) == 0);
  assert(control::PathFits(std::string(107, 'a')));
  assert(!control::PathFits(std::string(108, 'a')));
}

void Bind(const char* root) {
  const std::string directory(root);
  const std::string path = directory + "/ArdiaControl.sock";
  umask(022);
  const int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  struct stat made;
  std::string error;
  assert(control::BindPrivately(fd, directory, path, &made, &error));
  assert(umask(022) == 022);
  assert(listen(fd, 4) == 0);
  struct stat now;
  assert(lstat(path.c_str(), &now) == 0 && S_ISSOCK(now.st_mode) && (now.st_mode & 0777) == 0600);
  assert(now.st_ino == made.st_ino && now.st_dev == made.st_dev);
  DIR* listing = opendir(root);
  int entries = 0;
  while (dirent* entry = readdir(listing)) {
    if (std::string(entry->d_name) != "." && std::string(entry->d_name) != "..") ++entries;
  }
  closedir(listing);
  assert(entries == 1);
  const int client = socket(AF_UNIX, SOCK_STREAM, 0);
  sockaddr_un address = {};
  address.sun_family = AF_UNIX;
  memcpy(address.sun_path, path.data(), path.size());
  assert(connect(client, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) == 0);
  close(client);
  close(fd);
  const int missing = socket(AF_UNIX, SOCK_STREAM, 0);
  assert(!control::BindPrivately(missing, directory + "/missing", directory + "/missing/s", &made, &error));
  assert(!error.empty());
  close(missing);
}

}

int main(int argc, char** argv) {
  assert(argc >= 2);
  const std::string name = argv[1];
  if (name == "marking") Marking();
  else if (name == "drops") Drops();
  else if (name == "replies") RepliesAreNeverDropped();
  else if (name == "bytes") ByteLimit();
  else if (name == "partial-head") PartialHead();
  else if (name == "failed-write") FailedWrite();
  else if (name == "framing") Framing();
  else if (name == "long-lines") LongLines();
  else if (name == "pending") Pending();
  else if (name == "utf8") Utf8();
  else if (name == "folders") Folders(argv[2]);
  else if (name == "bind") Bind(argv[2]);
  else return 2;
  return 0;
}
