#include "ardia/linux/ac_linux_profile_service.h"

#include <functional>
#include <memory>
#include <utility>

#include "base/check.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/scoped_multi_source_observation.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "base/values.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_change_registrar.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/browser_thread.h"

namespace ardiacore {
namespace {

using linux_profiles::ProfileError;
using Registry = linux_profiles::ProfileRegistry<Profile>;

bool ProfileDirectoryWritable(const base::FilePath& path) {
  return base::CreateDirectory(path) && base::PathIsWritable(path);
}

class ChromeProfiles : public Registry::Backend, public ProfileObserver {
 public:
  Registry& registry() { return registry_; }

  bool Watch(Profile* profile) override {
    if (!profile || profile->ShutdownStarted()) return false;
    if (!observations_.IsObservingSource(profile)) observations_.AddObservation(profile);
    return true;
  }

  void Load(const std::string& directory, std::function<void(Profile*)> done) override {
    ProfileManager* manager = g_browser_process ? g_browser_process->profile_manager() : nullptr;
    Profile* app = registry_.Default();
    if (!manager || !app || directory.empty()) return done(nullptr);
    const base::FilePath user_data = app->GetPath().DirName();
    const base::FilePath path = user_data.AppendASCII(directory);
    if (user_data != manager->user_data_dir() || path.DirName() != user_data) return done(nullptr);
    if (manager->GetProfileByPath(path)) return CreateProfile(path, std::move(done), true);
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE,
        {base::MayBlock(), base::TaskPriority::USER_VISIBLE, base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN},
        base::BindOnce(&ProfileDirectoryWritable, path),
        base::BindOnce(&ChromeProfiles::CreateProfile, path, std::move(done)));
  }

  Profile* ExistingOffTheRecord(Profile* original) override {
    if (!Usable(original) || original->IsOffTheRecord() || !original->HasPrimaryOTRProfile()) return nullptr;
    return original->GetPrimaryOTRProfile(false);
  }

  Profile* CreateOffTheRecord(Profile* original) override {
    if (!Usable(original) || original->IsOffTheRecord()) return nullptr;
    return original->GetPrimaryOTRProfile(true);
  }

  void Later(std::function<void()> task) override {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE, base::BindOnce([](std::function<void()> task) { task(); }, std::move(task)),
        base::Milliseconds(100));
  }

  bool Usable(Profile* profile) const override {
    return profile && !profile->ShutdownStarted();
  }

  bool OffTheRecordProfile(Profile* profile) const override {
    return profile && profile->IsOffTheRecord();
  }

 private:
  static void CreateProfile(const base::FilePath& path, std::function<void(Profile*)> done, bool writable) {
    ProfileManager* manager = g_browser_process ? g_browser_process->profile_manager() : nullptr;
    if (!writable || !manager) return done(nullptr);
    manager->CreateProfileAsync(
        path, base::BindOnce(
                  [](std::function<void(Profile*)> done, Profile* profile) { done(profile); },
                  std::move(done)));
  }

  void OnProfileWillBeDestroyed(Profile* profile) override {
    registry_.Forget(profile);
    if (observations_.IsObservingSource(profile)) observations_.RemoveObservation(profile);
  }

  Registry registry_{*this};
  base::ScopedMultiSourceObservation<Profile, ProfileObserver> observations_{this};
};

ChromeProfiles& Profiles() {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  static base::NoDestructor<ChromeProfiles> profiles;
  return *profiles;
}


void PinStartupProfile(const std::string& app_directory) {
  PrefService* local_state = g_browser_process ? g_browser_process->local_state() : nullptr;
  if (!local_state) return;
  linux_profiles::StartupProfiles current;
  current.last_used = local_state->GetFilePath(prefs::kProfileLastUsed).AsUTF8Unsafe();
  for (const base::Value& entry : local_state->GetList(prefs::kProfilesLastActive)) {
    if (entry.is_string()) current.last_active.push_back(entry.GetString());
  }
  current.picker_on_startup = local_state->GetBoolean(prefs::kBrowserShowProfilePickerOnStartup);
  const auto pinned = linux_profiles::PinnedStartupProfiles(current, app_directory);
  if (pinned.last_used != current.last_used) {
    local_state->SetFilePath(prefs::kProfileLastUsed, base::FilePath::FromUTF8Unsafe(pinned.last_used));
  }
  if (pinned.last_active != current.last_active) {
    base::ListValue active;
    for (const auto& entry : pinned.last_active) active.Append(entry);
    local_state->SetList(prefs::kProfilesLastActive, std::move(active));
  }
  if (pinned.picker_on_startup != current.picker_on_startup &&
      local_state->IsUserModifiablePreference(prefs::kBrowserShowProfilePickerOnStartup)) {
    local_state->SetBoolean(prefs::kBrowserShowProfilePickerOnStartup, pinned.picker_on_startup);
  }
}

void PinStartupProfileFor(Profile* app) {
  PrefService* local_state = g_browser_process ? g_browser_process->local_state() : nullptr;
  if (!local_state) return;
  static base::NoDestructor<PrefChangeRegistrar> registrar;
  const std::string app_directory = app->GetBaseName().AsUTF8Unsafe();
  registrar->RemoveAll();
  if (!registrar->prefs()) registrar->Init(local_state);
  for (const char* pref : {prefs::kProfileLastUsed, prefs::kProfilesLastActive,
                           prefs::kBrowserShowProfilePickerOnStartup}) {
    registrar->Add(pref, base::BindRepeating(&PinStartupProfile, app_directory));
  }
  PinStartupProfile(app_directory);
}

}

bool SetLinuxAppProfile(Profile* profile) {
  if (!Profiles().registry().SetDefault(profile)) return false;
  PinStartupProfileFor(profile);
  return true;
}

Profile* LinuxProfile(std::string_view id) {
  return Profiles().registry().Lookup(id);
}

bool LinuxProfileHosts(std::string_view id, const Profile* window_profile) {
  return Profiles().registry().Hosts(id, window_profile);
}

void ResolveLinuxProfile(std::string_view id, LinuxProfileDone done) {
  auto once = std::make_shared<LinuxProfileDone>(std::move(done));
  Profiles().registry().Resolve(id, [once](Profile* profile, ProfileError error) {
    if (*once) std::move(*once).Run(profile, error);
  });
}

std::optional<std::string> LinuxProfileName(const Profile* profile) {
  return Profiles().registry().NameOf(profile);
}

std::optional<std::string> LinuxProfileNameForPath(std::string_view path) {
  ProfileManager* manager = g_browser_process ? g_browser_process->profile_manager() : nullptr;
  if (!manager || path.empty()) return std::nullopt;
  Profile* profile = manager->GetProfileByPath(base::FilePath(path));
  if (!profile || profile->IsOffTheRecord()) return std::nullopt;
  return LinuxProfileName(profile);
}

bool ReleaseLinuxProfile(std::string_view id) {
  return Profiles().registry().Release(id);
}

}
