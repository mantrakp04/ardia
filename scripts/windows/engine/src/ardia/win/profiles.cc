#include "ardia/win/profiles.h"

#include <optional>
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

constexpr char kEscape = '_';
constexpr char kHexDigits[] = "0123456789abcdef";

bool KeptAsIs(char c) {
  return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
}

int HexValue(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  return -1;
}

std::optional<std::string> UnescapedDirectory(std::string_view directory) {
  std::string name;
  for (size_t i = 0; i < directory.size(); ++i) {
    const char c = directory[i];
    if (KeptAsIs(c)) {
      name.push_back(c);
      continue;
    }
    if (c != kEscape || i + 2 >= directory.size()) {
      return std::nullopt;
    }
    const int high = HexValue(directory[i + 1]);
    const int low = HexValue(directory[i + 2]);
    if (high < 0 || low < 0) {
      return std::nullopt;
    }
    name.push_back(static_cast<char>(high * 16 + low));
    i += 2;
  }
  return name;
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
    if (KeptAsIs(c)) {
      parsed.directory.push_back(c);
    } else {
      const unsigned char byte = static_cast<unsigned char>(c);
      parsed.directory.push_back(kEscape);
      parsed.directory.push_back(kHexDigits[byte >> 4]);
      parsed.directory.push_back(kHexDigits[byte & 0xf]);
    }
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
  if (!directory.starts_with(prefix)) {
    return std::string();
  }
  std::string_view escaped = std::string_view(directory).substr(prefix.size());
  return UnescapedDirectory(escaped).value_or(std::string(escaped));
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
