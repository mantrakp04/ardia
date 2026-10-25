// Copyright 2026 Ardia. Apache-2.0.

#include <algorithm>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "chrome/browser/ardia/ac_tab_restore.h"

#include "base/base64.h"
#include "base/containers/span.h"
#include "base/files/file_enumerator.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/json/json_writer.h"
#include "base/no_destructor.h"
#include "base/pickle.h"
#include "base/rand_util.h"
#include "base/scoped_multi_source_observation.h"
#include "base/scoped_observation.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/extensions/extension_tab_util.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "chrome/browser/history/history_service_factory.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/profiles/profile_manager_observer.h"
#include "chrome/browser/sessions/session_common_utils.h"
#include "chrome/browser/sessions/tab_restore_service_factory.h"
#include "components/history/core/browser/history_service.h"
#include "components/history/core/browser/history_service_observer.h"
#include "components/history/core/browser/history_types.h"
#include "components/keyed_service/core/service_access_type.h"
#include "components/sessions/content/content_serialized_navigation_builder.h"
#include "components/sessions/content/content_serialized_navigation_driver.h"
#include "components/sessions/content/extended_info_handler.h"
#include "components/sessions/core/serialized_navigation_entry.h"
#include "components/sessions/core/session_constants.h"
#include "components/sessions/core/tab_restore_service.h"
#include "components/sessions/core/tab_restore_service_observer.h"
#include "components/sessions/core/tab_restore_types.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "url/gurl.h"

namespace ardia {

namespace {

constexpr int kNavigationStateVersion = 1;
constexpr int kMaxNavigationEntryBytes = 256 * 1024;
constexpr char kTabKey[] = "ac_tab";
constexpr char kTabHistoryDir[] = "Ardia Tab History";
constexpr char kTabHistoryCleared[] = "Ardia Tab History Cleared";
constexpr int kTabHistoryVersion = 1;
constexpr base::TimeDelta kTabHistorySaveDelay = base::Milliseconds(2500);
constexpr base::TimeDelta kTabHistoryKeep = base::Days(90);

using sessions::tab_restore::Entry;
using sessions::tab_restore::Group;
using sessions::tab_restore::Tab;
using sessions::tab_restore::Type;
using sessions::tab_restore::Window;

struct TabKeyData : public base::SupportsUserData::Data {
  explicit TabKeyData(std::string key) : key(std::move(key)) {}
  std::string key;
};
const char kTabKeyData[] = "ac_tab";

class TabKeyHandler : public sessions::ExtendedInfoHandler {
 public:
  std::string GetExtendedInfo(content::NavigationEntry* entry) const override {
    auto* data = static_cast<TabKeyData*>(entry->GetUserData(kTabKeyData));
    return data ? data->key : std::string();
  }
  void RestoreExtendedInfo(const std::string& info,
                           content::NavigationEntry* entry) override {
    entry->SetUserData(kTabKeyData, std::make_unique<TabKeyData>(info));
  }
};

void RegisterTabKey() {
  static bool registered = false;
  if (registered) {
    return;
  }
  registered = true;
  sessions::ContentSerializedNavigationDriver::GetInstance()
      ->RegisterExtendedInfoHandler(kTabKey,
                                    std::make_unique<TabKeyHandler>());
}

std::string PackNavigations(
    int selected,
    base::span<const sessions::SerializedNavigationEntry> navigations) {
  base::Pickle pickle;
  pickle.WriteInt(kNavigationStateVersion);
  pickle.WriteInt(selected);
  pickle.WriteInt(static_cast<int>(navigations.size()));
  for (const auto& navigation : navigations) {
    navigation.WriteToPickle(kMaxNavigationEntryBytes, &pickle);
  }
  return base::Base64Encode(pickle.AsBytes());
}

scoped_refptr<base::SequencedTaskRunner> TabHistoryFiles() {
  static base::NoDestructor<scoped_refptr<base::SequencedTaskRunner>> runner(
      base::ThreadPool::CreateSequencedTaskRunner(
          {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
           base::TaskShutdownBehavior::BLOCK_SHUTDOWN}));
  return *runner;
}

base::FilePath TabHistoryDir(Profile* profile) {
  return profile->GetPath().AppendASCII(kTabHistoryDir);
}

std::optional<std::string> TabHistoryOf(content::WebContents* contents,
                                        const std::string& generation) {
  content::NavigationController& controller = contents->GetController();
  const int current = controller.GetLastCommittedEntryIndex();
  content::NavigationEntry* shown = controller.GetLastCommittedEntry();
  if (current < 0 || !shown || shown->IsInitialEntry()) {
    return std::nullopt;
  }
  const int first = std::max(0, current - sessions::gMaxPersistNavigationCount);
  const int end = std::min(controller.GetEntryCount(),
                           current + sessions::gMaxPersistNavigationCount + 1);
  std::vector<sessions::SerializedNavigationEntry> navigations;
  int selected = -1;
  for (int i = first; i < end; ++i) {
    content::NavigationEntry* entry = controller.GetEntryAtIndex(i);
    if (!entry || entry->IsInitialEntry() ||
        !ShouldTrackURLForRestore(entry->GetVirtualURL())) {
      continue;
    }
    if (i == current) {
      selected = static_cast<int>(navigations.size());
    }
    navigations.push_back(
        sessions::ContentSerializedNavigationBuilder::FromNavigationEntry(
            i, entry));
  }
  if (selected < 0) {
    return std::nullopt;
  }
  return base::WriteJson(
      base::DictValue()
          .Set("version", kTabHistoryVersion)
          .Set("url", shown->GetURL().spec())
          .Set("virtualUrl", shown->GetVirtualURL().spec())
          .Set("generation", generation)
          .Set("state", PackNavigations(selected, navigations)));
}

void WriteTabHistory(base::FilePath path, std::string data) {
  base::FilePath temp = path.AddExtensionASCII("new");
  if (base::CreateDirectory(path.DirName()) && base::WriteFile(temp, data) &&
      !base::ReplaceFile(temp, path, nullptr)) {
    base::DeleteFile(temp);
  }
}

void DeleteTabHistory(base::FilePath path) {
  base::DeleteFile(path);
}

void ClearTabHistory(base::FilePath dir,
                     base::FilePath marker,
                     std::string generation) {
  WriteTabHistory(marker, generation);
  base::DeletePathRecursively(dir);
}

std::string ReadTabHistoryGeneration(base::FilePath marker) {
  std::string generation;
  base::ReadFileToStringWithMaxSize(marker, &generation, 64);
  return std::string(base::TrimWhitespaceASCII(generation, base::TRIM_ALL));
}

base::FilePath TabHistoryMarker(Profile* profile) {
  return profile->GetPath().AppendASCII(kTabHistoryCleared);
}

std::map<base::FilePath, std::string>& TabHistoryGenerations() {
  static base::NoDestructor<std::map<base::FilePath, std::string>> generations;
  return *generations;
}

std::optional<std::string> TabHistoryGeneration(Profile* profile) {
  auto& generations = TabHistoryGenerations();
  auto it = generations.find(profile->GetPath());
  return it == generations.end() ? std::nullopt
                                 : std::optional<std::string>(it->second);
}

class TabKeyBinding;

std::set<TabKeyBinding*>& LiveBindings() {
  static base::NoDestructor<std::set<TabKeyBinding*>> bindings;
  return *bindings;
}

void PruneTabHistory(base::FilePath dir) {
  const base::Time cutoff = base::Time::Now() - kTabHistoryKeep;
  base::FileEnumerator files(dir, false, base::FileEnumerator::FILES);
  for (base::FilePath path = files.Next(); !path.empty(); path = files.Next()) {
    if (files.GetInfo().GetLastModifiedTime() < cutoff) {
      base::DeleteFile(path);
    }
  }
}

void PruneTabHistoryOnce(Profile* profile) {
  static base::NoDestructor<std::set<base::FilePath>> pruned;
  base::FilePath dir = TabHistoryDir(profile);
  if (pruned->insert(dir).second) {
    TabHistoryFiles()->PostTask(FROM_HERE,
                                base::BindOnce(&PruneTabHistory, dir));
  }
}

class TabKeyBinding : public content::WebContentsObserver,
                      public content::WebContentsUserData<TabKeyBinding> {
 public:
  ~TabKeyBinding() override { LiveBindings().erase(this); }

  Profile* profile() const {
    return Profile::FromBrowserContext(web_contents()->GetBrowserContext());
  }

  void Resave() { SaveSoon(); }

  void Bind(std::string key) {
    key_ = std::move(key);
    Stamp();
    SaveSoon();
  }

  void DidStartNavigation(content::NavigationHandle*) override { Stamp(); }
  void NavigationEntryCommitted(const content::LoadCommittedDetails&) override {
    Stamp();
    SaveSoon();
  }
  void NavigationListPruned(const content::PrunedDetails&) override {
    SaveSoon();
  }
  void NavigationEntriesDeleted() override { SaveSoon(); }
  void NavigationEntryChanged(const content::EntryChangedDetails&) override {
    SaveSoon();
  }
  void WebContentsDestroyed() override {
    save_timer_.Stop();
    Profile* profile = SavingProfile();
    if (!profile) {
      return;
    }
    if (browser_shutdown::IsTryingToQuit() ||
        browser_shutdown::HasShutdownStarted() || profile->ShutdownStarted()) {
      if (unsaved_) {
        Save();
      }
      return;
    }
    TabHistoryFiles()->PostTask(
        FROM_HERE, base::BindOnce(&DeleteTabHistory, HistoryFile(profile)));
  }

 private:
  friend class content::WebContentsUserData<TabKeyBinding>;
  explicit TabKeyBinding(content::WebContents* contents)
      : content::WebContentsObserver(contents),
        content::WebContentsUserData<TabKeyBinding>(*contents) {
    LiveBindings().insert(this);
  }

  void StampEntry(content::NavigationEntry* entry) {
    auto* data = static_cast<TabKeyData*>(entry->GetUserData(kTabKeyData));
    if (!data || data->key != key_) {
      entry->SetUserData(kTabKeyData, std::make_unique<TabKeyData>(key_));
    }
  }

  void Stamp() {
    content::NavigationController& controller = web_contents()->GetController();
    for (int i = 0; i < controller.GetEntryCount(); ++i) {
      StampEntry(controller.GetEntryAtIndex(i));
    }
    if (content::NavigationEntry* pending = controller.GetPendingEntry()) {
      StampEntry(pending);
    }
  }

  Profile* SavingProfile() const {
    Profile* profile =
        Profile::FromBrowserContext(web_contents()->GetBrowserContext());
    return profile && !profile->IsOffTheRecord() && !key_.empty() ? profile
                                                                  : nullptr;
  }

  base::FilePath HistoryFile(Profile* profile) const {
    return TabHistoryDir(profile).AppendASCII(base::HexEncode(key_));
  }

  void SaveSoon() {
    unsaved_ = true;
    if (!save_timer_.IsRunning() && SavingProfile()) {
      save_timer_.Start(FROM_HERE, kTabHistorySaveDelay,
                        base::BindOnce(&TabKeyBinding::Save,
                                       base::Unretained(this)));
    }
  }

  void Save() {
    unsaved_ = false;
    Profile* profile = SavingProfile();
    if (!profile) {
      return;
    }
    std::optional<std::string> generation = TabHistoryGeneration(profile);
    if (!generation) {
      SaveSoon();
      return;
    }
    base::FilePath path = HistoryFile(profile);
    std::optional<std::string> history =
        TabHistoryOf(web_contents(), *generation);
    TabHistoryFiles()->PostTask(
        FROM_HERE, history ? base::BindOnce(&WriteTabHistory, std::move(path),
                                            std::move(*history))
                           : base::BindOnce(&DeleteTabHistory, std::move(path)));
  }

  std::string key_;
  bool unsaved_ = false;
  base::OneShotTimer save_timer_;

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(TabKeyBinding);

class TabHistoryCleaner : public history::HistoryServiceObserver,
                          public ProfileManagerObserver {
 public:
  static void Start() { static base::NoDestructor<TabHistoryCleaner> cleaner; }

  TabHistoryCleaner() {
    ProfileManager* manager =
        g_browser_process ? g_browser_process->profile_manager() : nullptr;
    if (!manager) {
      return;
    }
    profiles_.Observe(manager);
    for (Profile* profile : manager->GetLoadedProfiles()) {
      Watch(profile);
    }
  }

  void OnProfileAdded(Profile* profile) override { Watch(profile); }

  void OnProfileManagerDestroying() override {
    history_.RemoveAllObservations();
    dirs_.clear();
    profiles_.Reset();
  }

  void OnHistoryDeletions(history::HistoryService* service,
                          const history::DeletionInfo& info) override {
    auto it = dirs_.find(service);
    if (it == dirs_.end() || info.is_from_expiration()) {
      return;
    }
    Profile* profile = it->second.first;
    std::string generation = base::NumberToString(base::RandUint64());
    TabHistoryGenerations()[profile->GetPath()] = generation;
    TabHistoryFiles()->PostTask(
        FROM_HERE, base::BindOnce(&ClearTabHistory, it->second.second,
                                  TabHistoryMarker(profile), generation));
    for (TabKeyBinding* binding : LiveBindings()) {
      if (binding->profile() == profile) {
        binding->Resave();
      }
    }
  }

  void HistoryServiceBeingDeleted(history::HistoryService* service) override {
    if (history_.IsObservingSource(service)) {
      history_.RemoveObservation(service);
    }
    dirs_.erase(service);
  }

 private:
  void Watch(Profile* profile) {
    if (!profile || profile->IsOffTheRecord()) {
      return;
    }
    history::HistoryService* service = HistoryServiceFactory::GetForProfile(
        profile, ServiceAccessType::EXPLICIT_ACCESS);
    if (!service || history_.IsObservingSource(service)) {
      return;
    }
    dirs_[service] = {profile, TabHistoryDir(profile)};
    history_.AddObservation(service);
    TabHistoryFiles()->PostTaskAndReplyWithResult(
        FROM_HERE,
        base::BindOnce(&ReadTabHistoryGeneration, TabHistoryMarker(profile)),
        base::BindOnce(
            [](base::FilePath path, std::string generation) {
              TabHistoryGenerations().try_emplace(path, std::move(generation));
            },
            profile->GetPath()));
  }

  std::map<history::HistoryService*, std::pair<Profile*, base::FilePath>> dirs_;
  base::ScopedMultiSourceObservation<history::HistoryService,
                                     history::HistoryServiceObserver>
      history_{this};
  base::ScopedObservation<ProfileManager, ProfileManagerObserver> profiles_{
      this};
};

bool HasKey(const Tab& tab, const std::string& key) {
  for (const auto& navigation : tab.navigations) {
    auto it = navigation.extended_info_map().find(kTabKey);
    if (it != navigation.extended_info_map().end() && it->second == key) {
      return true;
    }
  }
  return false;
}

struct Candidate {
  const Tab* tab = nullptr;
  bool top_level = false;
};

void Collect(const Entry& entry, std::vector<Candidate>* out) {
  switch (entry.type) {
    case Type::TAB:
      out->push_back({static_cast<const Tab*>(&entry), true});
      break;
    case Type::WINDOW:
      for (const auto& tab : static_cast<const Window&>(entry).tabs) {
        out->push_back({tab.get(), false});
      }
      break;
    case Type::GROUP:
      for (const auto& tab : static_cast<const Group&>(entry).tabs) {
        out->push_back({tab.get(), false});
      }
      break;
    default:
      break;
  }
}

std::string NavigationState(const Tab& tab) {
  return PackNavigations(tab.normalized_navigation_index(), tab.navigations);
}

void Take(sessions::TabRestoreService* service,
          const std::string& key,
          Reply reply) {
  std::vector<Candidate> candidates;
  for (const auto& entry : service->entries()) {
    Collect(*entry, &candidates);
  }
  const Candidate* best = nullptr;
  for (const auto& candidate : candidates) {
    const Tab& tab = *candidate.tab;
    if (!tab.navigations.empty() && HasKey(tab, key) &&
        (!best || tab.timestamp > best->tab->timestamp)) {
      best = &candidate;
    }
  }
  if (!best) {
    return reply.Send(base::DictValue().Set("state", base::Value()));
  }
  std::string state = NavigationState(*best->tab);
  if (best->top_level) {
    service->RemoveEntryById(best->tab->id);
  }
  reply.Send(base::DictValue().Set("state", std::move(state)));
}

class WhenLoaded : public sessions::TabRestoreServiceObserver {
 public:
  static void Run(sessions::TabRestoreService* service,
                  base::OnceClosure then) {
    if (service->IsLoaded()) {
      return std::move(then).Run();
    }
    new WhenLoaded(service, std::move(then));
    service->LoadTabsFromLastSession();
  }

  void TabRestoreServiceLoaded(sessions::TabRestoreService*) override {
    Finish();
  }
  void TabRestoreServiceDestroyed(sessions::TabRestoreService*) override {
    observation_.Reset();
    delete this;
  }

 private:
  WhenLoaded(sessions::TabRestoreService* service, base::OnceClosure then)
      : then_(std::move(then)) {
    observation_.Observe(service);
  }

  void Finish() {
    observation_.Reset();
    base::OnceClosure then = std::move(then_);
    delete this;
    std::move(then).Run();
  }

  base::OnceClosure then_;
  base::ScopedObservation<sessions::TabRestoreService,
                          sessions::TabRestoreServiceObserver>
      observation_{this};
};

sessions::TabRestoreService* ServiceFor(Profile* profile) {
  return profile && !profile->IsOffTheRecord()
             ? TabRestoreServiceFactory::GetForProfile(profile)
             : nullptr;
}

}

void StartTabHistoryCleaner() {
  TabHistoryCleaner::Start();
}

}

using ardia::Call;
using ardia::Reply;

AC_ENGINE_CALL(ac_tab_restore_take) {
  Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  sessions::TabRestoreService* service =
      ardia::ServiceFor(call.profile());
  if (!service) {
    return call.TakeReply().Error("no tab restore service");
  }
  const std::string key = call.String("key");
  if (key.empty()) {
    return call.TakeReply().Error("no key");
  }
  base::WeakPtr<Profile> profile = call.profile()->GetWeakPtr();
  ardia::WhenLoaded::Run(
      service, base::BindOnce(
                   [](base::WeakPtr<Profile> profile, std::string key,
                      Reply reply) {
                     auto* service =
                         profile ? ardia::ServiceFor(profile.get()) : nullptr;
                     if (!service) {
                       return reply.Error("profile went away");
                     }
                     ardia::Take(service, key, std::move(reply));
                   },
                   profile, key, call.TakeReply()));
}

AC_ENGINE_CALL(ac_tab_restore_load) {
  Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  sessions::TabRestoreService* service =
      ardia::ServiceFor(call.profile());
  if (!service) {
    return call.TakeReply().Error("no tab restore service");
  }
  ardia::WhenLoaded::Run(
      service, base::BindOnce([](Reply reply) { reply.Ok(); }, call.TakeReply()));
}

AC_ENGINE_CALL(ac_tab_history_generation) {
  Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  std::optional<std::string> generation =
      ardia::TabHistoryGeneration(call.profile());
  call.TakeReply().Send(
      generation ? base::DictValue().Set("generation", std::move(*generation))
                 : base::DictValue().Set("fromMarker", true));
}

AC_ENGINE_CALL(ac_tab_restore_tag) {
  Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  const std::string key = call.String("key");
  content::WebContents* contents = nullptr;
  if (key.empty() ||
      !extensions::ExtensionTabUtil::GetTabById(
          static_cast<int>(call.Double("tab", -1)), call.profile(),
          false, &contents) ||
      !contents) {
    return call.TakeReply().Error("no such tab");
  }
  ardia::RegisterTabKey();
  if (!call.profile()->IsOffTheRecord()) {
    ardia::StartTabHistoryCleaner();
    ardia::PruneTabHistoryOnce(call.profile());
  }
  ardia::TabKeyBinding::CreateForWebContents(contents);
  ardia::TabKeyBinding::FromWebContents(contents)->Bind(key);
  call.TakeReply().Ok();
}
