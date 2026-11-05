// Copyright 2026 Ardia. Apache-2.0.

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "ardia/core/ac_content_hooks.h"
#include "base/base64url.h"
#include "base/command_line.h"
#include "base/containers/span.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/json/json_writer.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/posix/eintr_wrapper.h"
#include "base/process/process_handle.h"
#include "base/rand_util.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/strcat.h"
#include "base/strings/string_util.h"
#include "base/synchronization/lock.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/ardia/ac_cli_token_policy.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/lifetime/termination_notification.h"
#include "chrome/common/chrome_paths.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_change_registrar.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/devtools_socket_factory.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/content_switches.h"
#include "crypto/secure_util.h"
#include "net/base/net_errors.h"
#include "net/log/net_log_source.h"
#include "net/socket/tcp_server_socket.h"

namespace ardia {
namespace {

constexpr char kControlFileName[] = "ArdiaControl.json";
constexpr char kTopic[] = "cliControl";
constexpr int kBacklog = 10;
constexpr base::TimeDelta kStartDeadline = base::Seconds(5);
constexpr char kPolicyError[] =
    "Remote debugging is turned off by your administrator.";

base::Lock& PublishLock() {
  static base::NoDestructor<base::Lock> lock;
  return *lock;
}

uint64_t g_live_generation = 0;

void SetLiveGeneration(uint64_t generation) {
  base::AutoLock hold(PublishLock());
  g_live_generation = generation;
}

class LoopbackSocketFactory : public content::DevToolsSocketFactory {
 public:
  std::unique_ptr<net::ServerSocket> CreateForHttpServer() override {
    auto socket =
        std::make_unique<net::TCPServerSocket>(nullptr, net::NetLogSource());
    if (socket->ListenWithAddressAndPort("127.0.0.1", 0, kBacklog) !=
        net::OK) {
      return nullptr;
    }
    return socket;
  }

  std::unique_ptr<net::ServerSocket> CreateForTethering(
      std::string* name) override {
    return nullptr;
  }
};

base::FilePath ControlFilePath() {
  base::FilePath dir;
  if (!base::PathService::Get(chrome::DIR_USER_DATA, &dir)) {
    return base::FilePath();
  }
  return dir.Append(kControlFileName);
}

std::string ErrnoText() {
  return base::ToLowerASCII(strerror(errno));
}

std::string WriteControlFile(const base::FilePath& path,
                             const std::string& contents,
                             uint64_t generation) {
  if (path.empty()) {
    return "Ardia has no data folder.";
  }
  const base::FilePath temp = path.DirName().Append(
      "." + path.BaseName().value() + "." +
      base::HexEncode(base::RandBytesAsVector(8)));
  const int fd = HANDLE_EINTR(
      open(temp.value().c_str(),
           O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600));
  if (fd < 0) {
    return base::StrCat({"Couldn't write ", path.value(), ": ", ErrnoText()});
  }
  bool written = base::WriteFileDescriptor(fd, contents) && fsync(fd) == 0;
  std::string error = written ? std::string() : ErrnoText();
  if (IGNORE_EINTR(close(fd)) != 0 && written) {
    written = false;
    error = ErrnoText();
  }
  if (!written) {
    unlink(temp.value().c_str());
    return base::StrCat({"Couldn't write ", path.value(), ": ", error});
  }
  {
    base::AutoLock hold(PublishLock());
    if (g_live_generation != generation) {
      unlink(temp.value().c_str());
      return "The control server stopped.";
    }
    if (rename(temp.value().c_str(), path.value().c_str()) != 0) {
      error = ErrnoText();
      unlink(temp.value().c_str());
      return base::StrCat({"Couldn't write ", path.value(), ": ", error});
    }
  }
  return std::string();
}

void DeleteControlFile(const base::FilePath& path) {
  if (!path.empty() && unlink(path.value().c_str()) != 0 && errno != ENOENT &&
      errno != EISDIR && errno != EPERM) {
    PLOG(ERROR) << "[ardia] can't delete " << path;
  }
}

bool ServerStartedBySwitch() {
  return base::CommandLine::ForCurrentProcess()->HasSwitch(
      ::switches::kRemoteDebuggingPort);
}

class ControlServer {
 public:
  enum class State { kStopped, kStarting, kPublishing, kRunning, kStopping };

  static ControlServer& Get() {
    static base::NoDestructor<ControlServer> server;
    return *server;
  }

  ControlServer() {
    g_ardia_devtools_token_factory = &IsOurFactory;
    g_ardia_devtools_token_accepts = &Accepts;
    g_ardia_devtools_token_server = &ServerChanged;
    g_ardia_devtools_active_target = &ActiveTarget;
    g_ardia_devtools_token_client = &TokenClientFor;
    g_ardia_devtools_may_attach = &TokenClientMayAttach;
    g_ardia_devtools_may_input = &TokenClientMayInput;
    terminating_ = browser_shutdown::AddAppTerminatingCallback(
        base::BindOnce(&ControlServer::Quit, base::Unretained(this)));
    if (PrefService* local_state = LocalState()) {
      policy_.Init(local_state);
      policy_.Add(prefs::kDevToolsRemoteDebuggingAllowed,
                  base::BindRepeating(&ControlServer::PolicyChanged,
                                      base::Unretained(this)));
    }
    if (!ServerStartedBySwitch()) {
      FileRunner()->PostTask(FROM_HERE,
                             base::BindOnce(&DeleteControlFile, file_path_));
    }
  }

  void Enable(Reply reply) {
    if (ServerStartedBySwitch() || quitting_) {
      return reply.Send(Status());
    }
    if (!Allowed()) {
      error_ = kPolicyError;
      return reply.Send(Status());
    }
    if (state_ == State::kRunning) {
      return reply.Send(Status());
    }
    pending_.push_back(std::move(reply));
    if (Active()) {
      return;
    }
    if (PrefService* local_state = LocalState()) {
      local_state->ClearPref(prefs::kDevToolsRemoteDebuggingEnabled);
    }
    ++generation_;
    SetLiveGeneration(generation_);
    error_.clear();
    std::vector<uint8_t> secret = base::RandBytesAsVector(32);
    token_.clear();
    base::Base64UrlEncode(secret, base::Base64UrlEncodePolicy::OMIT_PADDING,
                          &token_);
    auto factory = std::make_unique<LoopbackSocketFactory>();
    factory_ = factory.get();
    state_ = State::kStarting;
    deadline_.Start(FROM_HERE, kStartDeadline,
                    base::BindOnce(&ControlServer::StartTimedOut,
                                   base::Unretained(this), generation_));
    content::DevToolsAgentHost::StartRemoteDebuggingServer(
        std::move(factory), base::FilePath(), base::FilePath(),
        content::DevToolsAgentHost::RemoteDebuggingServerMode::kDefault);
    Announce();
  }

  void Disable() {
    if (ServerStartedBySwitch()) {
      return;
    }
    if (state_ != State::kStopped) {
      error_.clear();
    }
    Stop();
  }

  base::DictValue Status() const {
    base::DictValue status;
    if (ServerStartedBySwitch()) {
      status.Set("state", "external");
      return status;
    }
    switch (state_) {
      case State::kStopped:
      case State::kStopping:
        status.Set("state", "off");
        break;
      case State::kStarting:
      case State::kPublishing:
        status.Set("state", "starting");
        break;
      case State::kRunning:
        status.Set("state", "on");
        status.Set("port", port_);
        break;
    }
    status.Set("connections", static_cast<int>(connections_));
    status.Set("generation", static_cast<int>(generation_));
    status.Set("file", file_path_.value());
    if (!error_.empty()) {
      status.Set("reason", error_);
    }
    return status;
  }

 private:
  static PrefService* LocalState() {
    return g_browser_process ? g_browser_process->local_state() : nullptr;
  }

  static bool Allowed() {
    PrefService* local_state = LocalState();
    return local_state &&
           local_state->GetBoolean(prefs::kDevToolsRemoteDebuggingAllowed);
  }

  bool Active() const {
    return state_ == State::kStarting || state_ == State::kPublishing ||
           state_ == State::kRunning;
  }

  static bool IsOurFactory(const content::DevToolsSocketFactory* factory) {
    ControlServer& self = Get();
    return factory && factory == self.factory_ &&
           self.state_ == State::kStarting;
  }

  static std::unique_ptr<ArdiaDevToolsTokenClient> TokenClientFor(
      const content::DevToolsSocketFactory* factory,
      content::DevToolsAgentHostClient* client,
      content::DevToolsAgentHost* host) {
    ControlServer& self = Get();
    if (!factory || factory != self.factory_ ||
        self.state_ != State::kRunning) {
      return nullptr;
    }
    return CreateTokenClient(client, host);
  }

  static bool Accepts(const content::DevToolsSocketFactory* factory,
                      std::string_view token) {
    ControlServer& self = Get();
    if (!factory || factory != self.factory_ ||
        self.state_ != State::kRunning || self.token_.empty() ||
        token.size() != self.token_.size()) {
      return false;
    }
    return crypto::SecureMemEqual(base::as_byte_span(token),
                                  base::as_byte_span(self.token_));
  }

 public:
  void SetActiveTab(std::optional<int> tab_id) {
    active_.reset();
    if (!tab_id) {
      return;
    }
    if (content::WebContents* contents = TabWithId(*tab_id)) {
      active_ = contents->GetWeakPtr();
    }
  }

  static bool ActiveTarget(const content::DevToolsSocketFactory* factory,
                           std::string_view token,
                           std::string* target_id) {
    if (!Accepts(factory, token)) {
      return false;
    }
    target_id->clear();
    if (content::WebContents* contents = Get().active_.get()) {
      *target_id =
          content::DevToolsAgentHost::GetOrCreateFor(contents)->GetId();
    }
    return true;
  }

 private:
  static void ServerChanged(const content::DevToolsSocketFactory* factory,
                            std::string_view browser_path,
                            int port,
                            size_t connections) {
    Get().OnServerChanged(factory, browser_path, port, connections);
  }

  void OnServerChanged(const content::DevToolsSocketFactory* factory,
                       std::string_view browser_path,
                       int port,
                       size_t connections) {
    if (!factory || factory != factory_ || !Active()) {
      return;
    }
    if (port <= 0) {
      const bool failed_to_start = state_ == State::kStarting;
      error_ = failed_to_start ? "Couldn't listen on 127.0.0.1."
                               : "The control server stopped.";
      Reset();
      if (failed_to_start) {
        base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
            FROM_HERE, base::BindOnce(&ControlServer::ClearFailedServer,
                                      base::Unretained(this), generation_));
      }
      Settle();
      return;
    }
    if (state_ == State::kStarting) {
      state_ = State::kPublishing;
      port_ = port;
      connections_ = 0;
      base::DictValue file;
      file.Set("port", port);
      file.Set("browser", std::string(browser_path));
      file.Set("token", token_);
      file.Set("pid", static_cast<int>(base::GetCurrentProcId()));
      file.Set("generation", static_cast<int>(generation_));
      FileRunner()->PostTaskAndReplyWithResult(
          FROM_HERE,
          base::BindOnce(&WriteControlFile, file_path_,
                         base::WriteJson(file).value_or("{}"), generation_),
          base::BindOnce(&ControlServer::Published, base::Unretained(this),
                         generation_));
      return;
    }
    if (state_ == State::kRunning && connections_ != connections) {
      connections_ = connections;
      Announce();
    }
  }

  void Published(uint64_t generation, const std::string& error) {
    if (generation != generation_ || state_ != State::kPublishing) {
      return;
    }
    if (!error.empty()) {
      error_ = error;
      Stop();
      return;
    }
    deadline_.Stop();
    state_ = State::kRunning;
    Settle();
  }

  void Stop() {
    if (Active()) {
      state_ = State::kStopping;
      token_.clear();
      factory_ = nullptr;
      SetLiveGeneration(0);
      content::DevToolsAgentHost::StopRemoteDebuggingServer();
    }
    Reset();
    Settle();
  }

  void Reset() {
    deadline_.Stop();
    state_ = State::kStopped;
    token_.clear();
    factory_ = nullptr;
    SetLiveGeneration(0);
    port_ = 0;
    connections_ = 0;
    FileRunner()->PostTask(FROM_HERE,
                           base::BindOnce(&DeleteControlFile, file_path_));
  }

  void Announce() {
    if (!quitting_) {
      Emit(kTopic, nullptr, Status());
    }
  }

  void Settle() {
    base::DictValue status = Status();
    std::vector<Reply> pending = std::move(pending_);
    pending_.clear();
    for (Reply& reply : pending) {
      reply.Send(status.Clone());
    }
    Announce();
  }

  void StartTimedOut(uint64_t generation) {
    if (generation != generation_ ||
        (state_ != State::kStarting && state_ != State::kPublishing)) {
      return;
    }
    error_ = "The control server didn't start.";
    Stop();
  }

  void ClearFailedServer(uint64_t generation) {
    if (generation == generation_ && state_ == State::kStopped) {
      content::DevToolsAgentHost::StopRemoteDebuggingServer();
    }
  }

  void PolicyChanged() {
    if (!Allowed() && Active()) {
      error_ = kPolicyError;
      Stop();
    }
  }

  void Quit() {
    quitting_ = true;
    policy_.RemoveAll();
    if (!ServerStartedBySwitch()) {
      Stop();
    }
  }

  scoped_refptr<base::SequencedTaskRunner> FileRunner() {
    if (!file_runner_) {
      file_runner_ = base::ThreadPool::CreateSequencedTaskRunner(
          {base::MayBlock(), base::TaskPriority::USER_BLOCKING,
           base::TaskShutdownBehavior::BLOCK_SHUTDOWN});
    }
    return file_runner_;
  }

  State state_ = State::kStopped;
  uint64_t generation_ = 0;
  std::string token_;
  raw_ptr<const content::DevToolsSocketFactory> factory_ = nullptr;
  int port_ = 0;
  size_t connections_ = 0;
  std::string error_;
  bool quitting_ = false;
  const base::FilePath file_path_ = ControlFilePath();
  std::vector<Reply> pending_;
  base::OneShotTimer deadline_;
  base::WeakPtr<content::WebContents> active_;
  PrefChangeRegistrar policy_;
  base::CallbackListSubscription terminating_;
  scoped_refptr<base::SequencedTaskRunner> file_runner_;
};

}
}

AC_ARGS_CALL(ac_cli_control) {
  ardia::Reply out = call.TakeReply();
  const base::DictValue& args = call.args();
  ardia::ControlServer& server = ardia::ControlServer::Get();
  if (const base::Value* active = args.Find("active")) {
    server.SetActiveTab(active->is_int() && active->GetInt() >= 0
                            ? std::optional<int>(active->GetInt())
                            : std::nullopt);
  }
  std::optional<bool> on = args.FindBool("on");
  if (on.value_or(false)) {
    return server.Enable(std::move(out));
  }
  if (on.has_value()) {
    server.Disable();
  }
  out.Send(server.Status());
}
