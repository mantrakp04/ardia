#include "ardia/win/profiles.h"

#include <utility>

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"

namespace ardia_win {

namespace {

constexpr char kDirectoryPrefix[] = "Ardia ";

bool Safe(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
         (c >= '0' && c <= '9') || c == '-' || c == '_';
}

void Deliver(bool off_the_record,
             base::OnceCallback<void(Profile*)> callback,
             Profile* profile) {
  if (profile && off_the_record) {
    profile = profile->GetPrimaryOTRProfile(true);
  }
  std::move(callback).Run(profile);
}

}

ProfileName ParseProfileName(std::string_view name) {
  ProfileName parsed;
  size_t at = name.find('@');
  std::string_view original = name;
  if (at != std::string_view::npos) {
    parsed.off_the_record = true;
    original = name.substr(at + 1);
  }
  if (original.empty()) {
    return parsed;
  }
  parsed.directory = kDirectoryPrefix;
  for (char c : original) {
    parsed.directory.push_back(Safe(c) ? c : '_');
  }
  return parsed;
}

base::FilePath ProfilePath(const ProfileName& name) {
  ProfileManager* manager = g_browser_process->profile_manager();
  if (name.directory.empty()) {
    return manager->user_data_dir().Append(
        ProfileManager::GetInitialProfileDir());
  }
  return manager->user_data_dir().Append(base::UTF8ToWide(name.directory));
}

void WithProfile(std::string_view name,
                 base::OnceCallback<void(Profile*)> callback) {
  ProfileName parsed = ParseProfileName(name);
  ProfileManager* manager = g_browser_process->profile_manager();
  base::FilePath path = ProfilePath(parsed);
  if (Profile* loaded = manager->GetProfileByPath(path)) {
    Deliver(parsed.off_the_record, std::move(callback), loaded);
    return;
  }
  manager->CreateProfileAsync(
      path,
      base::BindOnce(&Deliver, parsed.off_the_record, std::move(callback)));
}

std::string NameOfProfilePath(const base::FilePath& path) {
  std::string directory = base::WideToUTF8(path.BaseName().value());
  std::string_view prefix = kDirectoryPrefix;
  if (directory.starts_with(prefix)) {
    return directory.substr(prefix.size());
  }
  return std::string();
}

std::string NameOfProfile(Profile* profile) {
  if (!profile) {
    return std::string();
  }
  std::string original =
      NameOfProfilePath(profile->GetOriginalProfile()->GetPath());
  if (profile->IsOffTheRecord()) {
    return "private@" + original;
  }
  return original;
}

}
