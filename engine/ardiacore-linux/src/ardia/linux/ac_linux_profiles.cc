#include "ardia/linux/ac_linux_profiles.h"

#include <algorithm>

namespace ardiacore::linux_profiles {
namespace {

bool AsciiLetter(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

bool AsciiDigit(char c) {
  return c >= '0' && c <= '9';
}

bool ValidToken(std::string_view value) {
  if (value.empty() || value.size() > kMaxProfileTokenLength || !AsciiLetter(value.front())) return false;
  for (const char c : value) {
    if (!AsciiLetter(c) && !AsciiDigit(c) && c != '-' && c != '_') return false;
  }
  return true;
}

bool DefaultAlias(std::string_view value) {
  if (value.size() != 7) return false;
  constexpr std::string_view kDefault = "default";
  for (size_t i = 0; i < value.size(); ++i) {
    const char c = value[i] >= 'A' && value[i] <= 'Z' ? static_cast<char>(value[i] - 'A' + 'a') : value[i];
    if (c != kDefault[i]) return false;
  }
  return true;
}

std::optional<ProfileName> ParseRegular(std::string_view value) {
  if (value.empty() || value == "default") return ProfileName{ProfileKind::kDefault, "", "", ""};
  if (DefaultAlias(value) || !ValidToken(value)) return std::nullopt;
  return ProfileName{ProfileKind::kIsolated, std::string(value), std::string(value), ""};
}

}

std::optional<ProfileName> ParseProfileName(std::string_view value) {
  if (!value.starts_with(kPrivatePrefix)) return ParseRegular(value);
  const std::string_view rest = value.substr(kPrivatePrefix.size());
  const size_t at = rest.find('@');
  if (at == std::string_view::npos) return std::nullopt;
  const std::string_view window = rest.substr(0, at);
  const auto original = ParseRegular(rest.substr(at + 1));
  if (!ValidToken(window) || !original) return std::nullopt;
  ProfileName name;
  name.kind = ProfileKind::kPrivate;
  name.window = std::string(window);
  name.original = original->id;
  name.id = std::string(kPrivatePrefix) + name.window + "@" + name.original;
  return name;
}

StartupProfiles PinnedStartupProfiles(const StartupProfiles& current, std::string_view app_directory) {
  StartupProfiles pinned;
  pinned.last_used = std::string(app_directory);
  if (!current.last_active.empty()) pinned.last_active.emplace_back(app_directory);
  pinned.picker_on_startup = false;
  return pinned;
}

std::string ProfileDirectoryName(std::string_view isolated_id) {
  return isolated_id.empty() ? std::string() : "Profile " + std::string(isolated_id);
}

std::string_view ProfileErrorCode(ProfileError error) {
  switch (error) {
    case ProfileError::kNone: return "";
    case ProfileError::kInvalid: return "ERR_PROFILE_INVALID";
    case ProfileError::kDeleted: return "ERR_PROFILE_DELETED";
    case ProfileError::kReleased: return "ERR_PROFILE_RELEASED";
    case ProfileError::kUnavailable: return "ERR_PROFILE_UNAVAILABLE";
    case ProfileError::kWindowMismatch: return "ERR_PROFILE_WINDOW";
    case ProfileError::kPrivateService: return "ERR_PROFILE_PRIVATE";
    case ProfileError::kPrivateEnding: return "ERR_PROFILE_ENDING";
  }
  return "ERR_PROFILE_UNAVAILABLE";
}

std::string_view ProfileErrorMessage(ProfileError error) {
  switch (error) {
    case ProfileError::kNone: return "";
    case ProfileError::kInvalid: return "The profile identity is not valid on Linux";
    case ProfileError::kDeleted: return "This profile was deleted";
    case ProfileError::kReleased: return "This private session has ended";
    case ProfileError::kUnavailable: return "Chrome could not open this profile";
    case ProfileError::kWindowMismatch: return "This window hosts a different profile";
    case ProfileError::kPrivateService: return "This service is unavailable in private windows";
    case ProfileError::kPrivateEnding: return "The previous private session is still closing";
  }
  return "Chrome could not open this profile";
}

bool PrivateWindow(const WindowAccess& window) {
  const auto name = ParseProfileName(window.page_profile);
  return !name || name->kind == ProfileKind::kPrivate;
}

bool WindowReachableBy(const WindowAccess& window, const WindowRequester& requester) {
  if (!PrivateWindow(window)) return true;
  if (requester.host == 0) return false;
  if (requester.host == window.host) return true;
  return window.opener_host != 0 && requester.host == window.opener_host &&
         requester.generation == window.opener_generation;
}

bool WindowFocusableBy(const WindowAccess& window, const WindowRequester& requester) {
  if (requester.host == 0) return false;
  const auto name = ParseProfileName(window.page_profile);
  return name && (name->kind == ProfileKind::kPrivate || WindowReachableBy(window, requester));
}

bool WindowListedAsPrivate(const WindowAccess& window, const WindowRequester& requester) {
  const auto name = ParseProfileName(window.page_profile);
  return requester.host != 0 && requester.host != window.host && name && name->kind == ProfileKind::kPrivate;
}

int NextPrivateOrdinal(const std::vector<int>& taken) {
  int ordinal = 1;
  while (std::find(taken.begin(), taken.end(), ordinal) != taken.end()) ++ordinal;
  return ordinal;
}

bool ProfileOpensWindow(const ProfileName& name, bool incognito, bool utility) {
  if (utility) return name.kind == ProfileKind::kDefault && !incognito;
  return incognito == (name.kind == ProfileKind::kPrivate);
}

}
