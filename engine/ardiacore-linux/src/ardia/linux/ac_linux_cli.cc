#include "ardia/linux/ac_linux_cli.h"

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <unistd.h>

#include <set>
#include <utility>

#include "ardia/linux/ac_linux_control_core.h"
#include "ardia/linux/ac_linux_launch_config.h"
#include "base/environment.h"
#include "base/files/file_util.h"
#include "base/files/scoped_file.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/process/kill.h"
#include "base/process/launch.h"
#include "base/process/process.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "base/task/bind_post_task.h"
#include "base/task/thread_pool.h"
#include "base/threading/scoped_blocking_call.h"
#include "base/time/time.h"
#include "build/build_config.h"
#include "components/version_info/version_info.h"
#include "content/public/browser/browser_thread.h"
#include "net/base/filename_util.h"
#include "url/gurl.h"

extern char** environ;

namespace ardiacore {

namespace {

constexpr base::TimeDelta kInstallDeadline = base::Seconds(300);
constexpr base::TimeDelta kKillGrace = base::Seconds(5);
constexpr base::TimeDelta kDrainLimit = base::Seconds(10);
constexpr base::TimeDelta kReapLimit = base::Seconds(5);
constexpr int kPollMilliseconds = 250;
constexpr size_t kDigestFileLimit = 4096;
constexpr char kInstallerName[] = "ardia-cli-install.sh";
constexpr char kDigestName[] = "ardia-cli.sha256";

#if defined(ARCH_CPU_ARM64)
constexpr char kArchive[] = "linux-arm64";
#else
constexpr char kArchive[] = "linux-x64";
#endif

bool Digits(std::string_view text) {
  if (text.empty()) return false;
  for (const char c : text) {
    if (c < '0' || c > '9') return false;
  }
  return true;
}

std::optional<std::string> ReadInstalledVersion(std::optional<base::FilePath> home) {
  base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::MAY_BLOCK);
  if (!home) return std::nullopt;
  base::FilePath target;
  if (!base::ReadSymbolicLink(home->Append("current"), &target)) return std::nullopt;
  std::string version = target.StripTrailingSeparators().BaseName().value();
  if (version.empty() || version == "." || version == "/") return std::nullopt;
  return version;
}

base::DictValue Failure(const std::string& message, const std::string& app_version) {
  return base::DictValue()
      .Set("ok", false)
      .Set("error", message)
      .Set("lines", base::ListValue())
      .Set("appVersion", app_version);
}

class LineSplitter {
 public:
  std::vector<std::string> Append(std::string_view data) {
    pending_.append(data);
    std::vector<std::string> lines;
    size_t newline;
    while ((newline = pending_.find('\n')) != std::string::npos) {
      lines.push_back(ardia::linux_control::ValidUtf8(std::string_view(pending_).substr(0, newline)));
      pending_.erase(0, newline + 1);
    }
    for (const std::string& line : lines) all_.push_back(line);
    return lines;
  }

  std::vector<std::string> Flush() {
    if (pending_.empty()) return {};
    std::string line = ardia::linux_control::ValidUtf8(pending_);
    pending_.clear();
    all_.push_back(line);
    return {line};
  }

  const std::vector<std::string>& all() const { return all_; }

 private:
  std::string pending_;
  std::vector<std::string> all_;
};

base::EnvironmentMap InstallerEnvironment(const LinuxCliInstallPlan& plan, const std::optional<std::string>& url) {
  base::EnvironmentMap environment;
  for (char** entry = environ; entry && *entry; ++entry) {
    const std::string_view pair(*entry);
    const size_t equals = pair.find('=');
    if (equals == std::string_view::npos || equals == 0) continue;
    const std::string name(pair.substr(0, equals));
    if (base::StartsWith(name, "ARDIA_")) continue;
    environment[name] = std::string(pair.substr(equals + 1));
  }
  if (plan.home) environment["ARDIA_CLI_HOME"] = *plan.home;
  if (plan.bin_dir) environment["ARDIA_CLI_BIN_DIR"] = *plan.bin_dir;
  if (url) environment["ARDIA_CLI_URL"] = *url;
  return environment;
}

base::DictValue RunInstaller(LinuxCliInstallPlan plan, base::RepeatingCallback<void(std::string)> on_line) {
  base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::WILL_BLOCK);
  const std::string& version = plan.app_version;
  if (plan.isolated && (!plan.home || !plan.bin_dir)) {
    return Failure("A test instance installs only with ARDIA_CLI_HOME and ARDIA_CLI_BIN_DIR set.", version);
  }
  if (!LinuxCliReleaseVersion(version)) {
    return Failure("This build's version (" + version + ") has no ardia command release.", version);
  }
  const base::FilePath cli = plan.package_directory.Append("cli");
  const base::FilePath script = base::MakeAbsoluteFilePath(cli.Append(kInstallerName));
  if (plan.package_directory.empty() || script.empty() || access(script.value().c_str(), R_OK) != 0) {
    return Failure("The installer isn't in this build of Ardia.", version);
  }
  std::vector<std::string> arguments = {"/bin/sh", script.value(), "--version", version};
  std::string digest_text;
  if (base::ReadFileToStringWithMaxSize(cli.Append(kDigestName), &digest_text, kDigestFileLimit)) {
    if (const auto digest = LinuxCliDigest(digest_text)) {
      arguments.push_back("--sha256");
      arguments.push_back(*digest);
    }
  }
  std::optional<std::string> url = plan.url;
  if (!url) {
    const base::FilePath archive = cli.Append("ardia-cli-" + version + "-" + kArchive + ".tar.gz");
    if (base::PathExists(archive)) url = net::FilePathToFileURL(archive).spec();
  }

  int output[2];
  int errors[2];
  if (pipe2(output, O_CLOEXEC) != 0) return Failure("Couldn't run the installer: no pipe.", version);
  base::ScopedFD output_read(output[0]);
  base::ScopedFD output_write(output[1]);
  if (pipe2(errors, O_CLOEXEC) != 0) return Failure("Couldn't run the installer: no pipe.", version);
  base::ScopedFD errors_read(errors[0]);
  base::ScopedFD errors_write(errors[1]);

  base::LaunchOptions options;
  options.clear_environment = true;
  options.environment = InstallerEnvironment(plan, url);
  base::FilePath temp;
  options.current_directory = base::GetTempDir(&temp) ? temp : base::FilePath("/tmp");
  options.fds_to_remap.emplace_back(output_write.get(), STDOUT_FILENO);
  options.fds_to_remap.emplace_back(errors_write.get(), STDERR_FILENO);
  options.new_process_group = true;
  base::Process process = base::LaunchProcess(arguments, options);
  output_write.reset();
  errors_write.reset();
  if (!process.IsValid()) return Failure("Couldn't run the installer.", version);

  LineSplitter collected;
  LineSplitter error_text;
  base::ScopedFD* pipes[] = {&output_read, &errors_read};
  const base::TimeTicks deadline = base::TimeTicks::Now() + kInstallDeadline;
  const base::TimeTicks drain_end = deadline + kKillGrace + kDrainLimit;
  const pid_t group = process.Pid();
  std::optional<base::TimeTicks> kill_at;
  std::optional<base::TimeTicks> exited_at;
  std::optional<int> exit_code;
  bool timed_out = false;
  std::string buffer(65536, '\0');
  while (true) {
    pollfd watched[2];
    int count = 0;
    for (base::ScopedFD* pipe : pipes) {
      if (pipe->is_valid()) watched[count++] = pollfd{pipe->get(), POLLIN, 0};
    }
    const int ready = poll(count ? watched : nullptr, static_cast<nfds_t>(count), kPollMilliseconds);
    if (ready < 0 && errno != EINTR) break;
    for (int index = 0; ready > 0 && index < count; ++index) {
      if (!(watched[index].revents & (POLLIN | POLLHUP | POLLERR))) continue;
      base::ScopedFD* pipe = watched[index].fd == output_read.get() ? &output_read : &errors_read;
      const ssize_t got = read(pipe->get(), buffer.data(), buffer.size());
      if (got > 0) {
        const std::string_view data(buffer.data(), static_cast<size_t>(got));
        if (pipe == &output_read) {
          for (std::string& line : collected.Append(data)) on_line.Run(std::move(line));
        } else {
          error_text.Append(data);
        }
      } else if (got == 0 || (errno != EINTR && errno != EAGAIN)) {
        pipe->reset();
      }
    }
    const base::TimeTicks now = base::TimeTicks::Now();
    if (!exit_code) {
      int code = 0;
      if (process.WaitForExitWithTimeout(base::TimeDelta(), &code)) {
        exit_code = code;
        exited_at = now;
      }
    }
    if (exit_code && (ready == 0 || (!output_read.is_valid() && !errors_read.is_valid()))) break;
    if (exited_at && now - *exited_at >= kDrainLimit) break;
    if (now >= drain_end) break;
    if (!kill_at && now >= deadline) {
      timed_out = true;
      kill(-group, SIGTERM);
      kill_at = now + kKillGrace;
    } else if (kill_at && now >= *kill_at) {
      kill(-group, SIGKILL);
      kill_at = drain_end;
    }
  }
  if (timed_out) kill(-group, SIGKILL);
  for (std::string& line : collected.Flush()) on_line.Run(std::move(line));
  error_text.Flush();
  if (!exit_code) {
    int code = 0;
    kill(-group, SIGKILL);
    if (process.WaitForExitWithTimeout(kReapLimit, &code)) {
      exit_code = code;
    } else {
      base::EnsureProcessGetsReaped(std::move(process));
      exit_code = -1;
    }
  }
  if (timed_out) {
    base::DictValue failure = Failure("The installer didn't finish in " +
                                      std::to_string(kInstallDeadline.InSeconds()) + " s, so it was stopped.", version);
    base::ListValue listed;
    for (const std::string& line : collected.all()) listed.Append(line);
    failure.Set("lines", std::move(listed));
    failure.Set("status", *exit_code);
    const std::optional<std::string> installed = ReadInstalledVersion(LinuxCliHome(plan));
    failure.Set("installedVersion", installed ? base::Value(*installed) : base::Value());
    return failure;
  }
  return LinuxCliInstallResult(collected.all(), *exit_code, error_text.all(), version,
                               ReadInstalledVersion(LinuxCliHome(plan)));
}

LinuxCliInstallPlan CurrentPlan() {
  LinuxCliInstallPlan plan;
  const LinuxCliEnvironment& cli = LinuxCli();
  plan.app_version = LinuxAppVersion();
  plan.package_directory = LinuxPackage().directory;
  plan.home = cli.home;
  plan.bin_dir = cli.bin_dir;
  plan.url = cli.url;
  plan.default_home = cli.default_home;
  plan.isolated = cli.isolated;
  return plan;
}

class CliService {
 public:
  static CliService& Get() {
    static base::NoDestructor<CliService> service;
    return *service;
  }

  void Init(LinuxModuleSink sink, LinuxModuleBroadcast broadcast) {
    sink_ = std::move(sink);
    broadcast_ = std::move(broadcast);
    Refresh(base::DoNothing());
  }

  void Refresh(base::OnceCallback<void(std::optional<std::string>)> done) {
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_VISIBLE, base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN},
        base::BindOnce(&ReadInstalledVersion, LinuxCliHome(CurrentPlan())),
        base::BindOnce(&CliService::Refreshed, base::Unretained(this), std::move(done)));
  }

  void Install(const std::string& caller, base::OnceCallback<void(bool, base::Value)> done) {
    waiting_.push_back(std::move(done));
    listeners_.insert(caller);
    if (waiting_.size() > 1) return;
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE,
        {base::MayBlock(), base::WithBaseSyncPrimitives(), base::TaskPriority::USER_VISIBLE,
         base::TaskShutdownBehavior::CONTINUE_ON_SHUTDOWN},
        base::BindOnce(&RunInstaller, CurrentPlan(),
                       base::BindPostTaskToCurrentDefault(
                           base::BindRepeating(&CliService::Line, base::Unretained(this)))),
        base::BindOnce(&CliService::Finished, base::Unretained(this)));
  }

  std::optional<base::Value> BootstrapVersion() const {
    if (!known_) return std::nullopt;
    return installed_ ? base::Value(*installed_) : base::Value();
  }

 private:
  void Refreshed(base::OnceCallback<void(std::optional<std::string>)> done, std::optional<std::string> version) {
    Remember(version);
    std::move(done).Run(std::move(version));
  }

  void Remember(const std::optional<std::string>& version) {
    const bool changed = !known_ || installed_ != version;
    known_ = true;
    installed_ = version;
    if (changed && broadcast_) {
      broadcast_.Run("onInstalledVersion", base::Value(base::DictValue().Set(
          "version", version ? base::Value(*version) : base::Value())));
    }
  }

  void Line(std::string line) {
    for (const std::string& caller : listeners_) {
      sink_.Run(caller, "onInstallLine", base::Value(base::DictValue().Set("line", line)));
    }
  }

  void Finished(base::DictValue result) {
    if (const base::Value* installed = result.Find("installedVersion")) {
      Remember(installed->is_string() ? std::optional<std::string>(installed->GetString()) : std::nullopt);
    }
    auto waiting = std::move(waiting_);
    waiting_.clear();
    listeners_.clear();
    for (auto& done : waiting) std::move(done).Run(true, base::Value(result.Clone()));
  }

  LinuxModuleSink sink_ = base::DoNothing();
  LinuxModuleBroadcast broadcast_;
  std::vector<base::OnceCallback<void(bool, base::Value)>> waiting_;
  std::set<std::string> listeners_;
  bool known_ = false;
  std::optional<std::string> installed_;
};

}

LinuxCliInstallPlan::LinuxCliInstallPlan() = default;
LinuxCliInstallPlan::LinuxCliInstallPlan(const LinuxCliInstallPlan&) = default;
LinuxCliInstallPlan::LinuxCliInstallPlan(LinuxCliInstallPlan&&) = default;
LinuxCliInstallPlan::~LinuxCliInstallPlan() = default;

std::string LinuxAppVersion() {
  const auto& version = LinuxPackage().version;
  return version ? *version : std::string(version_info::GetVersionNumber());
}

bool LinuxCliReleaseVersion(std::string_view version) {
  const size_t dash = version.find('-');
  const std::string_view core = version.substr(0, dash);
  const std::vector<std::string_view> numbers =
      base::SplitStringPiece(core, ".", base::KEEP_WHITESPACE, base::SPLIT_WANT_ALL);
  if (numbers.size() != 3) return false;
  for (const std::string_view number : numbers) {
    if (!Digits(number)) return false;
  }
  if (dash == std::string_view::npos) return true;
  const std::string_view suffix = version.substr(dash + 1);
  const size_t dot = suffix.find('.');
  if (dot == std::string_view::npos || dot == 0) return false;
  for (const char c : suffix.substr(0, dot)) {
    if (c < 'a' || c > 'z') return false;
  }
  return Digits(suffix.substr(dot + 1));
}

std::optional<std::string> LinuxCliDigest(std::string_view text) {
  const std::vector<std::string_view> tokens =
      base::SplitStringPiece(text, " \t\r\n\f\v", base::TRIM_WHITESPACE, base::SPLIT_WANT_NONEMPTY);
  if (tokens.empty()) return std::nullopt;
  const std::string digest = base::ToLowerASCII(tokens.front());
  if (digest.size() != 64) return std::nullopt;
  for (const char c : digest) {
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return std::nullopt;
  }
  return digest;
}

std::optional<base::FilePath> LinuxCliHome(const LinuxCliInstallPlan& plan) {
  if (plan.home) return base::FilePath(*plan.home);
  if (plan.isolated || !plan.default_home) return std::nullopt;
  return base::FilePath(*plan.default_home);
}

base::DictValue LinuxCliInstallResult(const std::vector<std::string>& lines, int status,
                                      const std::vector<std::string>& errors, const std::string& app_version,
                                      const std::optional<std::string>& installed) {
  base::DictValue result;
  base::ListValue listed;
  for (const std::string& line : lines) listed.Append(line);
  result.Set("lines", std::move(listed));
  result.Set("appVersion", app_version);
  result.Set("status", status);
  std::optional<std::string> error;
  bool has_bin = false;
  for (const std::string& line : lines) {
    if (base::StartsWith(line, "installed ")) {
      result.Set("binPath", line.substr(10));
      has_bin = true;
    }
    if (base::StartsWith(line, "version ")) result.Set("version", line.substr(8));
    if (base::StartsWith(line, "path ")) result.Set("rcFile", line.substr(5));
    if (base::StartsWith(line, "error ")) error = line.substr(6);
  }
  if (status != 0 && !error) {
    for (auto line = errors.rbegin(); line != errors.rend(); ++line) {
      if (!line->empty()) {
        error = *line;
        break;
      }
    }
    if (!error) error = "The installer stopped (exit " + std::to_string(status) + ").";
  }
  if (error) result.Set("error", *error);
  result.Set("ok", status == 0 && has_bin && !error);
  result.Set("installedVersion", installed ? base::Value(*installed) : base::Value());
  return result;
}

void InitLinuxCli(LinuxModuleSink sink, LinuxModuleBroadcast broadcast) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  CliService::Get().Init(std::move(sink), std::move(broadcast));
}

bool LinuxCliInvokes(std::string_view method) {
  for (const char* capability : kLinuxCliCapabilities) {
    if (method == capability) return true;
  }
  return false;
}

void LinuxCliInvoke(const std::string& caller, std::string_view method, const base::ListValue& args,
                    base::OnceCallback<void(bool, base::Value)> done) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  if (!args.empty()) return std::move(done).Run(false, base::Value("The ardia command's methods take no arguments"));
  if (method == "ArdiaCli.installedVersion") {
    return CliService::Get().Refresh(base::BindOnce(
        [](base::OnceCallback<void(bool, base::Value)> done, std::optional<std::string> version) {
          std::move(done).Run(true, version ? base::Value(*version) : base::Value());
        }, std::move(done)));
  }
  if (method == "ArdiaCli.install") return CliService::Get().Install(caller, std::move(done));
  std::move(done).Run(false, base::Value("Unknown ardia command method"));
}

std::optional<base::Value> LinuxCliBootstrapVersion() {
  return CliService::Get().BootstrapVersion();
}

}
