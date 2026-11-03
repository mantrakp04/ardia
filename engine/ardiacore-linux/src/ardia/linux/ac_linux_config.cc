#include "ardia/linux/ac_linux_config.h"

#include <map>
#include <memory>
#include <set>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_config_core.h"
#include "ardia/linux/ac_linux_launch_config.h"
#include "base/files/file_descriptor_watcher_posix.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/threading/scoped_blocking_call.h"
#include "base/threading/sequence_bound.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "content/public/browser/browser_thread.h"

namespace ardiacore {

namespace {

namespace core = ardia::linux_config;

constexpr base::TimeDelta kChangeLatency = base::Milliseconds(50);

using Done = base::OnceCallback<void(bool, base::Value)>;

class ConfigWatchIo {
 public:
  ConfigWatchIo(std::string folder, scoped_refptr<base::SequencedTaskRunner> ui, base::RepeatingClosure changed)
      : folder_(std::move(folder)), ui_(std::move(ui)), changed_(std::move(changed)) {}

  void SetNames(std::vector<std::string> names) {
    base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::MAY_BLOCK);
    if (names.empty()) {
      readable_.reset();
      watcher_.reset();
      timer_.Stop();
      return;
    }
    if (!watcher_) {
      watcher_ = std::make_unique<core::Watcher>(folder_);
      if (watcher_->fd() < 0) {
        PLOG(WARNING) << "[ardia config] couldn't watch " << folder_;
        watcher_.reset();
        return;
      }
      readable_ = base::FileDescriptorWatcher::WatchReadable(
          watcher_->fd(), base::BindRepeating(&ConfigWatchIo::Readable, base::Unretained(this)));
    }
    watcher_->SetNames(names);
  }

 private:
  void Readable() {
    base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::MAY_BLOCK);
    if (!watcher_ || !watcher_->Drain() || timer_.IsRunning()) return;
    timer_.Start(FROM_HERE, kChangeLatency, base::BindOnce(&ConfigWatchIo::Fire, base::Unretained(this)));
  }

  void Fire() { ui_->PostTask(FROM_HERE, changed_); }

  const std::string folder_;
  const scoped_refptr<base::SequencedTaskRunner> ui_;
  const base::RepeatingClosure changed_;
  std::unique_ptr<core::Watcher> watcher_;
  std::unique_ptr<base::FileDescriptorWatcher::Controller> readable_;
  base::OneShotTimer timer_;
};

base::Value ReadValue(core::FileRead read) {
  base::DictValue result;
  result.Set("status", core::StatusName(read.status));
  if (read.status == core::ReadStatus::kOk) result.Set("text", std::move(read.text));
  return base::Value(std::move(result));
}

class ConfigService {
 public:
  static ConfigService& Get() {
    static base::NoDestructor<ConfigService> service;
    return *service;
  }

  void Init(LinuxModuleSink sink) { sink_ = std::move(sink); }

  void Watch(const std::string& caller, const base::FilePath& folder, std::vector<std::string> names, Done done) {
    if (io_.is_null()) {
      io_ = base::SequenceBound<ConfigWatchIo>(
          base::ThreadPool::CreateSequencedTaskRunner(
              {base::MayBlock(), base::TaskPriority::USER_VISIBLE, base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN}),
          folder.value(), base::SequencedTaskRunner::GetCurrentDefault(),
          base::BindRepeating(&ConfigService::Changed, base::Unretained(this)));
    }
    subscribers_[caller] = std::move(names);
    io_.AsyncCall(&ConfigWatchIo::SetNames)
        .WithArgs(Union())
        .Then(base::BindOnce([](Done done) { std::move(done).Run(true, base::Value()); }, std::move(done)));
  }

  void CallerGone(const std::string& caller) {
    if (subscribers_.erase(caller) && !io_.is_null()) io_.AsyncCall(&ConfigWatchIo::SetNames).WithArgs(Union());
  }

 private:
  friend class base::NoDestructor<ConfigService>;
  ConfigService() = default;

  std::vector<std::string> Union() const {
    std::set<std::string> names;
    for (const auto& [caller, watched] : subscribers_) names.insert(watched.begin(), watched.end());
    return std::vector<std::string>(names.begin(), names.end());
  }

  void Changed() {
    if (!sink_) return;
    for (const auto& [caller, names] : subscribers_) sink_.Run(caller, "onFilesChanged", base::Value(base::DictValue()));
  }

  LinuxModuleSink sink_;
  std::map<std::string, std::vector<std::string>> subscribers_;
  base::SequenceBound<ConfigWatchIo> io_;
};

constexpr base::TaskTraits kFileTraits(base::MayBlock(), base::TaskPriority::USER_BLOCKING,
                                          base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN);

void ReadFile(const base::FilePath& folder, const base::ListValue& args, Done done) {
  if (args.size() != 1 || !args[0].is_string()) {
    return std::move(done).Run(false, base::Value("ArdiaConfig.readFile takes one file name"));
  }
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, kFileTraits,
      base::BindOnce(
          [](std::string folder, std::string name) {
            base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::MAY_BLOCK);
            return core::Read(folder, name);
          },
          folder.value(), args[0].GetString()),
      base::BindOnce([](Done done, core::FileRead read) { std::move(done).Run(true, ReadValue(std::move(read))); },
                     std::move(done)));
}

void Watch(const std::string& caller, const base::FilePath& folder, const base::ListValue& args, Done done) {
  if (args.size() != 1 || !args[0].is_list()) {
    return std::move(done).Run(false, base::Value("ArdiaConfig.watch takes a list of file names"));
  }
  std::vector<std::string> names;
  for (const base::Value& name : args[0].GetList()) {
    if (!name.is_string()) return std::move(done).Run(false, base::Value("Config file names must be text"));
    if (core::IsWatchable(name.GetString()) && names.size() < core::kMaxWatchedNames) names.push_back(name.GetString());
  }
  ConfigService::Get().Watch(caller, folder, std::move(names), std::move(done));
}

void WriteSchemas(const base::FilePath& user_data_directory, const base::FilePath& folder,
                  const base::ListValue& args, Done done) {
  if (args.size() != 1 || !args[0].is_dict()) {
    return std::move(done).Run(false, base::Value("ArdiaConfig.writeSchemas takes the schema files"));
  }
  std::map<std::string, std::string> files;
  for (const auto [name, contents] : args[0].GetDict()) {
    if (!core::IsSchemaName(name)) continue;
    if (!contents.is_string()) return std::move(done).Run(false, base::Value("Schema contents must be text"));
    files.emplace(name, contents.GetString());
  }
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, kFileTraits,
      base::BindOnce(
          [](std::string schemas, std::string folder, std::map<std::string, std::string> files) {
            base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::MAY_BLOCK);
            return core::WriteSchemas(schemas, folder, files);
          },
          user_data_directory.Append(core::kSchemaFolder).value(), folder.value(), std::move(files)),
      base::BindOnce(
          [](Done done, core::SchemaWrite write) {
            if (!write.error.empty()) return std::move(done).Run(false, base::Value(std::move(write.error)));
            base::ListValue written;
            for (std::string& path : write.written) written.Append(std::move(path));
            std::move(done).Run(true, base::Value(std::move(written)));
          },
          std::move(done)));
}

}

void InitLinuxConfig(LinuxModuleSink sink) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  ConfigService::Get().Init(std::move(sink));
}

bool LinuxConfigInvokes(std::string_view method) {
  for (const char* capability : kLinuxConfigCapabilities) {
    if (method == capability) return true;
  }
  return false;
}

void LinuxConfigInvoke(const std::string& caller, const base::FilePath& user_data_directory, std::string_view method,
                       const base::ListValue& args, Done done) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  const base::FilePath folder = LinuxConfigFolder(user_data_directory);
  if (method == "ArdiaConfig.readFile") return ReadFile(folder, args, std::move(done));
  if (method == "ArdiaConfig.watch") return Watch(caller, folder, args, std::move(done));
  if (method == "ArdiaConfig.writeSchemas") return WriteSchemas(user_data_directory, folder, args, std::move(done));
  std::move(done).Run(false, base::Value("Unknown config method"));
}

void LinuxConfigCallerGone(const std::string& caller) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  ConfigService::Get().CallerGone(caller);
}

}
