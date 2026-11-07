#include "ardia/linux/ac_linux_user_scripts.h"

#include <sys/stat.h>

#include <algorithm>
#include <limits>
#include <memory>
#include <set>
#include <utility>

#include "ardia/linux/ac_linux_user_scripts_store.h"
#include "base/containers/fixed_flat_set.h"
#include "base/files/file_path_watcher.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/json/json_reader.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/task/bind_post_task.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/threading/scoped_blocking_call.h"
#include "base/threading/sequence_bound.h"
#include "base/time/time.h"
#include "content/public/browser/browser_thread.h"

namespace ardiacore {

namespace {

namespace store = ardia::linux_user_scripts;

constexpr base::TimeDelta kSettle = base::Milliseconds(100);
constexpr base::TimeDelta kRewatch = base::Seconds(1);

constexpr auto kTopKeys = base::MakeFixedFlatSet<std::string_view>(
    {"content_scripts", "description", "manifest_version", "name", "version"});
constexpr auto kEntryKeys = base::MakeFixedFlatSet<std::string_view>(
    {"all_frames", "css", "exclude_globs", "exclude_matches", "include_globs", "js", "match_about_blank",
     "match_origin_as_fallback", "matches", "run_at", "world"});
constexpr std::string_view kStringListKeys[] = {"matches", "exclude_matches", "include_globs",
                                                "exclude_globs", "js", "css"};
constexpr std::string_view kFlagKeys[] = {"all_frames", "match_about_blank", "match_origin_as_fallback"};
constexpr std::string_view kFileKeys[] = {"js", "css"};
constexpr auto kRunAts =
    base::MakeFixedFlatSet<std::string_view>({"document_end", "document_idle", "document_start"});
constexpr auto kWorlds = base::MakeFixedFlatSet<std::string_view>({"ISOLATED", "MAIN"});

template <typename Allowed>
std::optional<std::string> ExtraKey(const base::DictValue& dict, const Allowed& allowed) {
  for (const auto [key, value] : dict) {
    if (!allowed.contains(key)) return key;
  }
  return std::nullopt;
}

std::optional<std::string> EntryProblem(int extension_fd, const base::DictValue& entry, const std::string& at) {
  if (auto extra = ExtraKey(entry, kEntryKeys)) return at + " may not contain \"" + *extra + "\"";
  for (const std::string_view key : kStringListKeys) {
    const base::Value* value = entry.Find(key);
    if (!value) continue;
    const base::ListValue* list = value->GetIfList();
    if (!list || !std::all_of(list->begin(), list->end(), [](const base::Value& item) { return item.is_string(); })) {
      return at + "." + std::string(key) + " must be a list of strings";
    }
  }
  for (const std::string_view key : kFlagKeys) {
    const base::Value* value = entry.Find(key);
    if (value && !value->is_bool()) return at + "." + std::string(key) + " must be true or false";
  }
  const base::Value* run_at = entry.Find("run_at");
  if (run_at && !(run_at->is_string() && kRunAts.contains(run_at->GetString()))) {
    return at + ".run_at must be document_start, document_end or document_idle";
  }
  const base::Value* world = entry.Find("world");
  if (world && !(world->is_string() && kWorlds.contains(world->GetString()))) {
    return at + ".world must be ISOLATED or MAIN";
  }
  for (const std::string_view key : kFileKeys) {
    const base::ListValue* files = entry.FindList(key);
    if (!files) continue;
    for (const base::Value& file : *files) {
      if (auto problem = store::CheckFile(extension_fd, file.GetString(), at + "." + std::string(key))) {
        return problem;
      }
    }
  }
  return std::nullopt;
}

base::Value GenerationValue(int64_t generation) {
  if (generation >= std::numeric_limits<int>::min() && generation <= std::numeric_limits<int>::max()) {
    return base::Value(static_cast<int>(generation));
  }
  return base::Value(static_cast<double>(generation));
}

base::Value FolderValue(const store::Folder& folder) {
  if (folder.path && !base::IsStringUTF8(*folder.path)) {
    return base::Value(base::DictValue()
                           .Set("state", "invalid")
                           .Set("generation", GenerationValue(folder.generation.value_or(0)))
                           .Set("error", "Ardia's data folder path isn't UTF-8")
                           .Set("token", folder.token));
  }
  base::DictValue value;
  value.Set("state", folder.state);
  if (folder.generation) value.Set("generation", GenerationValue(*folder.generation));
  if (folder.path) value.Set("path", *folder.path);
  if (folder.error) {
    value.Set("error", base::IsStringUTF8(*folder.error) ? *folder.error : std::string("The extension is invalid"));
  }
  if (folder.state != "busy") value.Set("token", folder.token);
  return base::Value(std::move(value));
}

base::Value ReadFolder(const std::string& data_directory) {
  base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::MAY_BLOCK);
  return FolderValue(store::Read(data_directory, &LinuxUserScriptsManifestProblem));
}

base::Value ReadStatusText(const std::string& data_directory) {
  base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::MAY_BLOCK);
  std::optional<std::string> text = store::ReadStatus(data_directory);
  if (!text || !base::IsStringUTF8(*text)) return base::Value();
  return base::Value(std::move(*text));
}

std::optional<std::string> WriteStatusText(const std::string& data_directory, const std::string& json) {
  base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::MAY_BLOCK);
  return store::WriteStatus(data_directory, json);
}

class ScriptsWatcher {
 public:
  ScriptsWatcher(std::string data_directory, base::RepeatingClosure changed)
      : data_directory_(std::move(data_directory)), changed_(std::move(changed)) {
    base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::MAY_BLOCK);
    mkdir(store::ScriptsPath(data_directory_).c_str(), 0755);
    last_ = store::Signature(data_directory_);
    Arm();
  }
  ScriptsWatcher(const ScriptsWatcher&) = delete;
  ScriptsWatcher& operator=(const ScriptsWatcher&) = delete;

 private:
  void Arm() {
    base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::MAY_BLOCK);
    mkdir(store::ScriptsPath(data_directory_).c_str(), 0755);
    watcher_ = std::make_unique<base::FilePathWatcher>();
    if (!watcher_->Watch(base::FilePath(store::ScriptsPath(data_directory_)),
                         base::FilePathWatcher::Type::kNonRecursive,
                         base::BindRepeating(&ScriptsWatcher::Changed, weak_factory_.GetWeakPtr()))) {
      Later(&ScriptsWatcher::Rearm, kRewatch);
    }
  }

  void Rearm() {
    Arm();
    Notice();
  }

  void Changed(const base::FilePath&, bool error) {
    if (error) return Later(&ScriptsWatcher::Rearm, kRewatch);
    if (settling_) return;
    settling_ = true;
    Later(&ScriptsWatcher::Settled, kSettle);
  }

  void Settled() {
    settling_ = false;
    Notice();
  }

  void Notice() {
    base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::MAY_BLOCK);
    std::string now = store::Signature(data_directory_);
    if (now == last_) return;
    last_ = std::move(now);
    changed_.Run();
  }

  void Later(void (ScriptsWatcher::*step)(), base::TimeDelta delay) {
    base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE, base::BindOnce(step, weak_factory_.GetWeakPtr()), delay);
  }

  const std::string data_directory_;
  const base::RepeatingClosure changed_;
  std::unique_ptr<base::FilePathWatcher> watcher_;
  std::string last_;
  bool settling_ = false;
  base::WeakPtrFactory<ScriptsWatcher> weak_factory_{this};
};

class UserScriptsService {
 public:
  static UserScriptsService& Get() {
    static base::NoDestructor<UserScriptsService> service;
    return *service;
  }

  void Init(const base::FilePath& data_directory, LinuxModuleSink sink) {
    data_directory_ = data_directory.value();
    sink_ = std::move(sink);
  }

  bool ready() const { return !data_directory_.empty(); }

  void Watch(const std::string& caller, bool on) {
    if (on) {
      watchers_.insert(caller);
    } else {
      watchers_.erase(caller);
    }
    Update();
  }

  void Gone(const std::string& caller) {
    if (watchers_.erase(caller)) Update();
  }

  void Read(base::OnceCallback<void(bool, base::Value)> done) {
    work_->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce(&ReadFolder, data_directory_),
                                      base::BindOnce(&Resolve, std::move(done)));
  }

  void ReadStatus(base::OnceCallback<void(bool, base::Value)> done) {
    work_->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce(&ReadStatusText, data_directory_),
                                      base::BindOnce(&Resolve, std::move(done)));
  }

  void WriteStatus(std::string json, base::OnceCallback<void(bool, base::Value)> done) {
    work_->PostTaskAndReplyWithResult(
        FROM_HERE, base::BindOnce(&WriteStatusText, data_directory_, std::move(json)),
        base::BindOnce(
            [](base::OnceCallback<void(bool, base::Value)> done, std::optional<std::string> error) {
              if (error) return std::move(done).Run(false, base::Value(std::move(*error)));
              std::move(done).Run(true, base::Value());
            },
            std::move(done)));
  }

 private:
  static void Resolve(base::OnceCallback<void(bool, base::Value)> done, base::Value value) {
    std::move(done).Run(true, std::move(value));
  }

  void Update() {
    if (watchers_.empty()) {
      watcher_.Reset();
      return;
    }
    if (!watcher_.is_null()) return;
    watcher_ = base::SequenceBound<ScriptsWatcher>(
        work_, data_directory_,
        base::BindPostTaskToCurrentDefault(
            base::BindRepeating(&UserScriptsService::Changed, base::Unretained(this))));
  }

  void Changed() {
    for (const std::string& caller : watchers_) sink_.Run(caller, "onChange", base::Value(base::DictValue()));
  }

  std::string data_directory_;
  LinuxModuleSink sink_ = base::DoNothing();
  std::set<std::string> watchers_;
  scoped_refptr<base::SequencedTaskRunner> work_ = base::ThreadPool::CreateSequencedTaskRunner(
      {base::MayBlock(), base::TaskPriority::USER_VISIBLE, base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN});
  base::SequenceBound<ScriptsWatcher> watcher_;
};

}

std::optional<std::string> LinuxUserScriptsManifestProblem(int extension_fd, const std::string& manifest_text) {
  std::optional<base::Value> parsed = base::JSONReader::Read(manifest_text, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) return "manifest.json isn't a JSON object";
  const base::DictValue& manifest = parsed->GetDict();
  if (auto extra = ExtraKey(manifest, kTopKeys)) return "manifest.json may not contain \"" + *extra + "\"";
  const base::Value* version = manifest.Find("manifest_version");
  if (!version || !(version->is_int() || version->is_double()) || version->GetDouble() != 3) {
    return "manifest_version must be 3";
  }
  if (!manifest.FindString("name")) return "name must be a string";
  if (!manifest.FindString("version")) return "version must be a string";
  const base::Value* description = manifest.Find("description");
  if (description && !description->is_string()) return "description must be a string";
  const base::ListValue* entries = manifest.FindList("content_scripts");
  if (!entries) return "content_scripts must be a list";
  for (size_t index = 0; index < entries->size(); ++index) {
    const std::string at = "content_scripts[" + base::NumberToString(index) + "]";
    const base::DictValue* entry = (*entries)[index].GetIfDict();
    if (!entry) return at + " must be an object";
    if (auto problem = EntryProblem(extension_fd, *entry, at)) return problem;
  }
  return std::nullopt;
}

void InitLinuxUserScripts(const base::FilePath& data_directory, LinuxModuleSink sink) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  UserScriptsService::Get().Init(data_directory, std::move(sink));
}

bool LinuxUserScriptsInvokes(std::string_view method) {
  for (const char* capability : kLinuxUserScriptsCapabilities) {
    if (method == capability) return true;
  }
  return false;
}

void LinuxUserScriptsInvoke(const LinuxUserScriptsCaller& caller, std::string_view method, const base::ListValue& args,
                            base::OnceCallback<void(bool, base::Value)> done) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  UserScriptsService& service = UserScriptsService::Get();
  if (!service.ready()) return std::move(done).Run(false, base::Value("Ardia has no data folder"));
  if (!caller.eligible) {
    return std::move(done).Run(false, base::Value("Userscripts are applied from a regular browser window"));
  }
  if (method == "ArdiaUserScripts.watch") {
    if (args.size() != 1 || !args[0].is_bool()) {
      return std::move(done).Run(false, base::Value("ArdiaUserScripts.watch takes one boolean"));
    }
    service.Watch(caller.key, args[0].GetBool());
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaUserScripts.writeStatus") {
    if (args.size() != 1 || !args[0].is_string()) {
      return std::move(done).Run(false, base::Value("ArdiaUserScripts.writeStatus takes one JSON string"));
    }
    return service.WriteStatus(args[0].GetString(), std::move(done));
  }
  if (!args.empty()) return std::move(done).Run(false, base::Value("This userscripts method takes no arguments"));
  if (method == "ArdiaUserScripts.read") return service.Read(std::move(done));
  if (method == "ArdiaUserScripts.readStatus") return service.ReadStatus(std::move(done));
  std::move(done).Run(false, base::Value("Unknown userscripts method"));
}

void LinuxUserScriptsCallerGone(const std::string& caller) {
  UserScriptsService::Get().Gone(caller);
}

}
