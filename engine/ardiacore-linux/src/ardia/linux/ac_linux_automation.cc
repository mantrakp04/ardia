#include "ardia/linux/ac_linux_automation.h"

#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <sys/file.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

#include <map>
#include <memory>
#include <optional>
#include <set>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_control_core.h"
#include "base/files/file_descriptor_watcher_posix.h"
#include "base/files/scoped_file.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/json/json_reader.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/posix/eintr_wrapper.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/threading/sequence_bound.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/lifetime/termination_notification.h"
#include "content/public/browser/browser_thread.h"

namespace ardiacore {

namespace {

namespace control = ardia::linux_control;

void AutomationLine(int generation, int connection, std::string line);
void AutomationClosed(int connection);
void AutomationWritten(std::vector<control::Ticket> tickets);

std::string ErrnoText() {
  return strerror(errno);
}

struct SocketState {
  bool on = false;
  int generation = 0;
  std::string path;
  std::string reason;
};

base::DictValue StatusValue(const SocketState& started) {
  base::DictValue status;
  status.Set("state", started.on ? "on" : "off");
  status.Set("generation", started.generation);
  status.Set("path", started.path);
  if (!started.reason.empty()) status.Set("reason", started.reason);
  return status;
}

class Connection {
 public:
  using LineCallback = base::RepeatingCallback<void(int, std::string)>;
  using ClosedCallback = base::RepeatingCallback<void(int)>;
  using WrittenCallback = base::RepeatingCallback<void(std::vector<control::Ticket>)>;

  Connection(int id, base::ScopedFD fd, LineCallback on_line, ClosedCallback on_closed, WrittenCallback on_written)
      : id_(id), fd_(std::move(fd)), on_line_(std::move(on_line)), on_closed_(std::move(on_closed)),
        on_written_(std::move(on_written)), buffer_(control::kReadSize, '\0') {}
  Connection(const Connection&) = delete;
  Connection& operator=(const Connection&) = delete;

  void Open() {
    read_watch_ = base::FileDescriptorWatcher::WatchReadable(
        fd_.get(), base::BindRepeating(&Connection::ReadAvailable, base::Unretained(this)));
  }

  void Reply(std::string data, control::Ticket ticket) {
    std::vector<control::Ticket> own;
    if (ticket.number > 0) own.push_back(ticket);
    if (closed_) return Report(std::move(own));
    reader_.Replied();
    if (!output_.AddReply(std::move(data), std::move(ticket))) {
      Report(std::move(own));
      return Close();
    }
    if (!write_watch_) Flush();
  }

  void Event(std::string data) {
    if (closed_) return;
    if (!output_.AddEvent(std::move(data))) return Close();
    if (!write_watch_) Flush();
  }

  void Close() {
    if (closed_) return;
    closed_ = true;
    deadline_.Stop();
    read_watch_.reset();
    write_watch_.reset();
    std::vector<control::Ticket> unwritten = output_.TakeFinishedTickets();
    for (control::Ticket& ticket : output_.WaitingTickets()) unwritten.push_back(std::move(ticket));
    output_ = control::Output();
    reader_.Clear();
    fd_.reset();
    on_closed_.Run(id_);
    Report(std::move(unwritten));
  }

 private:
  void Report(std::vector<control::Ticket> tickets) {
    if (!tickets.empty()) on_written_.Run(std::move(tickets));
  }

  void Flush() {
    const control::Output::WriteResult result = output_.Write(fd_.get());
    Report(output_.TakeFinishedTickets());
    switch (result) {
      case control::Output::WriteResult::kDrained:
        write_watch_.reset();
        break;
      case control::Output::WriteResult::kBlocked:
        if (!write_watch_) {
          write_watch_ = base::FileDescriptorWatcher::WatchWritable(
              fd_.get(), base::BindRepeating(&Connection::Flush, base::Unretained(this)));
        }
        break;
      case control::Output::WriteResult::kFailed:
        Close();
        break;
    }
  }

  void ReadAvailable() {
    if (closed_) return;
    const ssize_t count = read(fd_.get(), buffer_.data(), buffer_.size());
    if (count > 0) return Take(std::string_view(buffer_.data(), static_cast<size_t>(count)));
    if (count < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) return;
    Close();
  }

  void Take(std::string_view bytes) {
    const auto result = reader_.Take(bytes, [this](std::string line) { on_line_.Run(id_, std::move(line)); });
    if (result == control::LineReader::Result::kClose) return Close();
    if (!reader_.partial() || reader_.consumed_last()) deadline_.Stop();
    if (reader_.partial() && !deadline_.IsRunning()) {
      deadline_.Start(FROM_HERE, base::Seconds(control::kLineDeadlineSeconds),
                      base::BindOnce(&Connection::DeadlinePassed, base::Unretained(this)));
    }
  }

  void DeadlinePassed() {
    if (!closed_ && reader_.partial()) Close();
  }

  const int id_;
  base::ScopedFD fd_;
  LineCallback on_line_;
  ClosedCallback on_closed_;
  WrittenCallback on_written_;
  std::string buffer_;
  std::unique_ptr<base::FileDescriptorWatcher::Controller> read_watch_;
  std::unique_ptr<base::FileDescriptorWatcher::Controller> write_watch_;
  control::LineReader reader_;
  control::Output output_;
  base::OneShotTimer deadline_;
  bool closed_ = false;
};

class ControlIo {
 public:
  explicit ControlIo(scoped_refptr<base::SequencedTaskRunner> ui) : ui_(std::move(ui)) {}
  ControlIo(const ControlIo&) = delete;
  ControlIo& operator=(const ControlIo&) = delete;

  SocketState Start(const base::FilePath& data_directory) {
    if (bound_) return SocketState{true, generation_, bound_->path, std::string()};
    if (data_directory.empty()) return Refuse("Ardia has no data folder.", std::string());
    const std::string directory = data_directory.value();
    const std::string path = data_directory.Append(control::kSocketName).value();
    if (const std::string problem = control::UnsafeFolder(directory); !problem.empty()) return Refuse(problem, path);
    if (!control::PathFits(path)) {
      return Refuse("The socket path is longer than " + std::to_string(control::kMaxPathBytes) + " bytes: " + path, path);
    }
    const std::string lock_path = data_directory.Append(control::kLockName).value();
    base::ScopedFD lock(HANDLE_EINTR(open(lock_path.c_str(), O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600)));
    if (!lock.is_valid()) return Refuse("Couldn't open the socket's lock file (" + ErrnoText() + ").", path);
    if (flock(lock.get(), LOCK_EX | LOCK_NB) != 0) return Refuse("Another Ardia is serving this data folder.", path);
    struct stat old;
    if (lstat(path.c_str(), &old) == 0) {
      if (!S_ISSOCK(old.st_mode)) return Refuse(path + " exists and isn't a socket, so it was left alone.", path);
      unlink(path.c_str());
    }
    base::ScopedFD fd(socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0));
    if (!fd.is_valid()) return Refuse("Couldn't make a socket (" + ErrnoText() + ").", path);
    struct stat made;
    std::string problem;
    if (!control::BindPrivately(fd.get(), directory, path, &made, &problem) ||
        listen(fd.get(), static_cast<int>(control::kMaxConnections)) != 0) {
      if (problem.empty()) problem = ErrnoText();
      return Refuse("Couldn't listen on " + path + " (" + problem + ").", path);
    }
    ++generation_;
    listen_ = std::move(fd);
    lock_ = std::move(lock);
    bound_ = Bound{path, made.st_dev, made.st_ino};
    accept_watch_ = base::FileDescriptorWatcher::WatchReadable(
        listen_.get(), base::BindRepeating(&ControlIo::AcceptAll, base::Unretained(this)));
    return SocketState{true, generation_, path, std::string()};
  }

  void Stop() {
    if (!bound_) return;
    const Bound bound = *std::exchange(bound_, std::nullopt);
    std::vector<int> ids;
    for (const auto& [id, connection] : connections_) ids.push_back(id);
    for (const int id : ids) {
      if (const auto found = connections_.find(id); found != connections_.end()) found->second->Close();
    }
    connections_.clear();
    accept_watch_.reset();
    listen_.reset();
    struct stat now;
    if (lstat(bound.path.c_str(), &now) == 0 && S_ISSOCK(now.st_mode) && now.st_dev == bound.device &&
        now.st_ino == bound.inode) {
      unlink(bound.path.c_str());
    }
    lock_.reset();
  }

  void Reply(int connection, std::string data, control::Ticket ticket) {
    if (const auto found = connections_.find(connection); found != connections_.end()) {
      return found->second->Reply(std::move(data), std::move(ticket));
    }
    if (ticket.number > 0) Written({std::move(ticket)});
  }

  void Event(std::vector<int> targets, std::string data) {
    for (const int id : targets) {
      if (const auto found = connections_.find(id); found != connections_.end()) found->second->Event(data);
    }
  }

  void Close(int connection) {
    if (const auto found = connections_.find(connection); found != connections_.end()) found->second->Close();
  }

 private:
  struct Bound {
    std::string path;
    dev_t device;
    ino_t inode;
  };

  SocketState Refuse(const std::string& reason, const std::string& path) {
    LOG(WARNING) << "[control] the ardia command's socket didn't start: " << reason;
    return SocketState{false, generation_, path, reason};
  }

  void AcceptAll() {
    for (int index = 0; index < control::kAcceptsPerCallback && bound_; ++index) {
      base::ScopedFD fd(HANDLE_EINTR(accept4(listen_.get(), nullptr, nullptr, SOCK_NONBLOCK | SOCK_CLOEXEC)));
      if (!fd.is_valid()) return;
      ucred peer = {};
      socklen_t length = sizeof(peer);
      if (getsockopt(fd.get(), SOL_SOCKET, SO_PEERCRED, &peer, &length) != 0 || length != sizeof(peer) ||
          peer.uid != geteuid() || connections_.size() >= control::kMaxConnections) {
        continue;
      }
      const int id = ++next_connection_;
      auto connection = std::make_unique<Connection>(
          id, std::move(fd), base::BindRepeating(&ControlIo::Line, base::Unretained(this), generation_),
          base::BindRepeating(&ControlIo::Closed, base::Unretained(this)),
          base::BindRepeating(&ControlIo::Written, base::Unretained(this)));
      Connection* opened = connection.get();
      connections_[id] = std::move(connection);
      opened->Open();
    }
  }

  void Line(int generation, int connection, std::string line) {
    ui_->PostTask(FROM_HERE, base::BindOnce(&AutomationLine, generation, connection, std::move(line)));
  }

  void Closed(int connection) {
    const auto found = connections_.find(connection);
    if (found == connections_.end()) return;
    base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, std::move(found->second));
    connections_.erase(found);
    ui_->PostTask(FROM_HERE, base::BindOnce(&AutomationClosed, connection));
  }

  void Written(std::vector<control::Ticket> tickets) {
    if (tickets.empty()) return;
    ui_->PostTask(FROM_HERE, base::BindOnce(&AutomationWritten, std::move(tickets)));
  }

  scoped_refptr<base::SequencedTaskRunner> ui_;
  base::ScopedFD listen_;
  base::ScopedFD lock_;
  std::unique_ptr<base::FileDescriptorWatcher::Controller> accept_watch_;
  std::optional<Bound> bound_;
  std::map<int, std::unique_ptr<Connection>> connections_;
  int next_connection_ = 0;
  int generation_ = 0;
};

std::optional<std::string> RunWindow(std::string_view line, bool* targets_run) {
  *targets_run = false;
  if (line.find("\"run\"") == std::string_view::npos) return std::nullopt;
  const auto parsed = base::JSONReader::Read(line, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) return std::nullopt;
  const std::string* method = parsed->GetDict().FindString("method");
  if (!method || *method != "run") return std::nullopt;
  *targets_run = true;
  const base::DictValue* params = parsed->GetDict().FindDict("params");
  const std::string* window = params ? params->FindString("window") : nullptr;
  if (!window) return std::nullopt;
  return *window;
}

class Automation {
 public:
  static Automation& Get() {
    static base::NoDestructor<Automation> automation;
    return *automation;
  }

  Automation()
      : io_(base::ThreadPool::CreateSequencedTaskRunner({base::MayBlock(), base::TaskPriority::USER_BLOCKING,
                                                         base::TaskShutdownBehavior::BLOCK_SHUTDOWN}),
            base::SingleThreadTaskRunner::GetCurrentDefault()) {
    terminating_ = browser_shutdown::AddAppTerminatingCallback(
        base::BindOnce(&Automation::Quit, base::Unretained(this)));
  }

  void Init(LinuxModuleSink sink, LinuxCallerRank rank) {
    sink_ = std::move(sink);
    rank_ = std::move(rank);
  }

  void Start(const LinuxAutomationCaller& caller, base::OnceCallback<void(base::DictValue)> done) {
    if (quitting_) return std::move(done).Run(StatusValue(SocketState{false, generation_, path_, "Ardia is quitting."}));
    if (!caller.eligible) {
      return std::move(done).Run(StatusValue(
          SocketState{false, generation_, path_, "Only a browser window serves the ardia command's socket."}));
    }
    participants_[caller.key] = caller.window;
    if (state_ == State::kOn) return std::move(done).Run(StatusValue(SocketState{true, generation_, path_, std::string()}));
    starting_[epoch_].push_back(Waiter{caller.key, caller.window, std::move(done)});
    if (state_ == State::kStarting) return;
    state_ = State::kStarting;
    io_.AsyncCall(&ControlIo::Start)
        .WithArgs(caller.data_directory)
        .Then(base::BindOnce(&Automation::StartFinished, base::Unretained(this), epoch_));
  }

  void Stop(base::OnceClosure done) { FullStop(std::move(done)); }

  void Reply(const std::string& caller, int connection, const std::string& line, int ticket) {
    const auto route = routes_.find(connection);
    if (state_ == State::kOn && route != routes_.end()) {
      auto outstanding = route->second.outstanding.find(caller);
      if (outstanding != route->second.outstanding.end() && outstanding->second > 0) {
        if (--outstanding->second == 0) route->second.outstanding.erase(outstanding);
        io_.AsyncCall(&ControlIo::Reply).WithArgs(connection, control::Framed(line), control::Ticket{caller, ticket});
        return;
      }
    }
    if (ticket > 0) SendWritten(caller, {ticket});
  }

  void Broadcast(const std::string& caller, const std::vector<int>& connections, const std::string& line) {
    if (state_ != State::kOn) return;
    std::vector<int> targets;
    for (const int connection : connections) {
      const auto route = routes_.find(connection);
      if (route != routes_.end() && route->second.home == caller) targets.push_back(connection);
    }
    if (!targets.empty()) io_.AsyncCall(&ControlIo::Event).WithArgs(std::move(targets), control::Framed(line));
  }

  void CallerGone(const std::string& caller) {
    for (auto& [epoch, waiters] : starting_) {
      std::erase_if(waiters, [&](const Waiter& waiter) { return waiter.caller == caller; });
    }
    if (!participants_.erase(caller)) return;
    for (auto route = routes_.begin(); route != routes_.end();) {
      if (route->second.home == caller || route->second.outstanding.contains(caller)) {
        const int connection = route->first;
        route = routes_.erase(route);
        CloseConnection(connection);
      } else {
        ++route;
      }
    }
    if (participants_.empty()) FullStop(base::DoNothing());
  }

  void Line(int generation, int connection, std::string line) {
    if (state_ != State::kOn || generation != generation_ || closing_.contains(connection)) return;
    auto route = routes_.find(connection);
    if (route == routes_.end()) {
      const std::string home = MostRecent();
      if (home.empty()) {
        CloseConnection(connection);
        return;
      }
      route = routes_.emplace(connection, Route{home, {}}).first;
    }
    std::string target = route->second.home;
    if (!participants_.contains(target)) {
      routes_.erase(route);
      CloseConnection(connection);
      return;
    }
    bool run = false;
    const std::optional<std::string> window = RunWindow(line, &run);
    if (run && window) {
      for (const auto& [key, owned] : participants_) {
        if (owned == *window) target = key;
      }
    } else if (run) {
      if (std::string focused = MostRecent(); !focused.empty()) target = std::move(focused);
    }
    ++route->second.outstanding[target];
    sink_.Run(target, "onRequest",
              base::Value(base::DictValue()
                              .Set("connection", connection)
                              .Set("generation", generation)
                              .Set("line", std::move(line))));
  }

  void Closed(int connection) {
    closing_.erase(connection);
    const auto route = routes_.find(connection);
    if (route == routes_.end()) return;
    const std::string home = route->second.home;
    routes_.erase(route);
    sink_.Run(home, "onClose", base::Value(base::DictValue().Set("connection", connection)));
  }

  void Written(std::vector<control::Ticket> tickets) {
    std::map<std::string, std::vector<int>> grouped;
    for (const control::Ticket& ticket : tickets) grouped[ticket.owner].push_back(ticket.number);
    for (auto& [owner, numbers] : grouped) SendWritten(owner, numbers);
  }

 private:
  enum class State { kStopped, kStarting, kOn };

  struct Route {
    std::string home;
    std::map<std::string, int> outstanding;
  };

  struct Waiter {
    std::string caller;
    std::string window;
    base::OnceCallback<void(base::DictValue)> done;
  };

  void CloseConnection(int connection) {
    closing_.insert(connection);
    io_.AsyncCall(&ControlIo::Close).WithArgs(connection);
  }

  void StartFinished(uint64_t epoch, SocketState result) {
    std::vector<Waiter> waiting = std::move(starting_[epoch]);
    starting_.erase(epoch);
    if (epoch != epoch_) {
      for (Waiter& waiter : waiting) Rejoin(std::move(waiter));
      return;
    }
    if (state_ == State::kStarting) {
      if (result.on) {
        state_ = State::kOn;
        generation_ = result.generation;
        path_ = result.path;
      } else {
        state_ = State::kStopped;
        participants_.clear();
        path_ = result.path;
      }
    }
    for (Waiter& waiter : waiting) std::move(waiter.done).Run(StatusValue(result));
  }

  void Rejoin(Waiter waiter) {
    if (state_ == State::kStopped || quitting_) {
      return std::move(waiter.done).Run(
          StatusValue(SocketState{false, generation_, path_, "The control socket was stopped while it started."}));
    }
    participants_[waiter.caller] = waiter.window;
    if (state_ == State::kOn) {
      return std::move(waiter.done).Run(StatusValue(SocketState{true, generation_, path_, std::string()}));
    }
    starting_[epoch_].push_back(std::move(waiter));
  }

  void FullStop(base::OnceClosure done) {
    if (state_ != State::kStopped) {
      ++epoch_;
      state_ = State::kStopped;
      participants_.clear();
      routes_.clear();
      closing_.clear();
    }
    io_.AsyncCall(&ControlIo::Stop).Then(std::move(done));
  }

  void Quit() {
    quitting_ = true;
    FullStop(base::DoNothing());
  }

  std::string MostRecent() const {
    std::string best;
    uint64_t best_rank = 0;
    for (const auto& [key, window] : participants_) {
      const uint64_t rank = rank_ ? rank_.Run(key) : 0;
      if (best.empty() || rank > best_rank) {
        best = key;
        best_rank = rank;
      }
    }
    return best;
  }

  void SendWritten(const std::string& owner, const std::vector<int>& numbers) {
    base::ListValue list;
    for (const int number : numbers) list.Append(number);
    sink_.Run(owner, "onWritten", base::Value(base::DictValue().Set("tickets", std::move(list))));
  }

  base::SequenceBound<ControlIo> io_;
  LinuxModuleSink sink_ = base::DoNothing();
  LinuxCallerRank rank_;
  State state_ = State::kStopped;
  uint64_t epoch_ = 1;
  int generation_ = 0;
  std::string path_;
  bool quitting_ = false;
  std::map<std::string, std::string> participants_;
  std::map<int, Route> routes_;
  std::set<int> closing_;
  std::map<uint64_t, std::vector<Waiter>> starting_;
  base::CallbackListSubscription terminating_;
};

void AutomationLine(int generation, int connection, std::string line) {
  Automation::Get().Line(generation, connection, std::move(line));
}

void AutomationClosed(int connection) {
  Automation::Get().Closed(connection);
}

void AutomationWritten(std::vector<control::Ticket> tickets) {
  Automation::Get().Written(std::move(tickets));
}

}

void InitLinuxAutomation(LinuxModuleSink sink, LinuxCallerRank rank) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  Automation::Get().Init(std::move(sink), std::move(rank));
}

bool LinuxAutomationInvokes(std::string_view method) {
  for (const char* capability : kLinuxAutomationCapabilities) {
    if (method == capability) return true;
  }
  return false;
}

void LinuxAutomationInvoke(const LinuxAutomationCaller& caller, std::string_view method, const base::ListValue& args,
                           base::OnceCallback<void(bool, base::Value)> done) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  Automation& automation = Automation::Get();
  if (method == "ArdiaAutomation.start") {
    if (!args.empty()) return std::move(done).Run(false, base::Value("ArdiaAutomation.start takes no arguments"));
    return automation.Start(caller, base::BindOnce(
        [](base::OnceCallback<void(bool, base::Value)> done, base::DictValue status) {
          std::move(done).Run(true, base::Value(std::move(status)));
        }, std::move(done)));
  }
  if (method == "ArdiaAutomation.stop") {
    if (!args.empty()) return std::move(done).Run(false, base::Value("ArdiaAutomation.stop takes no arguments"));
    return automation.Stop(base::BindOnce(
        [](base::OnceCallback<void(bool, base::Value)> done) { std::move(done).Run(true, base::Value()); },
        std::move(done)));
  }
  if (method == "ArdiaAutomation.reply") {
    if (args.size() != 3 || !args[0].is_int() || !args[1].is_string() || !args[2].is_int()) {
      return std::move(done).Run(false, base::Value("ArdiaAutomation.reply takes a connection, a line and a ticket"));
    }
    automation.Reply(caller.key, args[0].GetInt(), args[1].GetString(), args[2].GetInt());
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaAutomation.broadcast") {
    if (args.size() != 2 || !args[0].is_list() || !args[1].is_string()) {
      return std::move(done).Run(false, base::Value("ArdiaAutomation.broadcast takes connections and a line"));
    }
    std::vector<int> connections;
    for (const base::Value& connection : args[0].GetList()) {
      if (!connection.is_int()) return std::move(done).Run(false, base::Value("Connections must be integers"));
      connections.push_back(connection.GetInt());
    }
    automation.Broadcast(caller.key, connections, args[1].GetString());
    return std::move(done).Run(true, base::Value());
  }
  std::move(done).Run(false, base::Value("Unknown automation method"));
}

void LinuxAutomationCallerGone(const std::string& caller) {
  Automation::Get().CallerGone(caller);
}

}
