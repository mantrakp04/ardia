// Copyright 2026 Ardia. Apache-2.0.

#include <set>
#include <string>
#include <string_view>
#include <utility>

#include "base/values.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "chrome/browser/profiles/profile.h"
#include "components/prefs/pref_service.h"
#include "extensions/browser/disable_reason.h"
#include "extensions/browser/extension_prefs.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/common/extension.h"
#include "extensions/common/manifest.h"
#include "services/preferences/public/cpp/tracked/pref_names.h"

namespace ardia {
namespace {

constexpr std::string_view kExtensionSettingsPrefix = "extensions.settings.";

std::string_view DisableReasonName(
    extensions::disable_reason::DisableReason reason) {
  namespace reasons = extensions::disable_reason;
  switch (reason) {
    case reasons::DISABLE_USER_ACTION:
      return "user";
    case reasons::DISABLE_PERMISSIONS_INCREASE:
      return "permissions";
    case reasons::DISABLE_CORRUPTED:
    case reasons::DISABLE_NOT_VERIFIED:
      return "corrupted";
    case reasons::DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION:
      return "developer";
    case reasons::DISABLE_UNSUPPORTED_MANIFEST_VERSION:
    case reasons::DISABLE_UNSUPPORTED_REQUIREMENT:
      return "unsupported";
    case reasons::DISABLE_BLOCKED_BY_POLICY:
    case reasons::DISABLE_NOT_ALLOWLISTED:
    case reasons::DISABLE_UPDATE_REQUIRED_BY_POLICY:
    case reasons::DISABLE_PUBLISHED_IN_STORE_REQUIRED_BY_POLICY:
      return "policy";
    case reasons::DISABLE_EXTERNAL_EXTENSION:
    case reasons::DISABLE_SIDELOAD_WIPEOUT:
      return "external";
    case reasons::DISABLE_RELOAD:
      return "reload";
    default:
      return "other";
  }
}

int ExtensionsDroppedAtLoad(Profile* profile) {
  int dropped = 0;
  for (const base::Value& path :
       profile->GetPrefs()->GetList(user_prefs::kTrackedPreferencesReset)) {
    if (path.is_string() &&
        path.GetString().starts_with(kExtensionSettingsPrefix)) {
      ++dropped;
    }
  }
  return dropped;
}

bool IsUserExtension(const extensions::Extension& extension) {
  return extension.is_extension() &&
         !extensions::Manifest::IsComponentLocation(extension.location());
}

}
}

AC_PROFILE_CALL(ac_extensions_load_health) {
  Profile* profile = call.profile();
  extensions::ExtensionRegistry* registry =
      extensions::ExtensionRegistry::Get(profile);
  extensions::ExtensionPrefs* prefs = extensions::ExtensionPrefs::Get(profile);
  int enabled = 0;
  for (const auto& extension : registry->enabled_extensions()) {
    if (ardia::IsUserExtension(*extension)) {
      ++enabled;
    }
  }
  base::DictValue disabled;
  for (const auto& extension : registry->disabled_extensions()) {
    if (!ardia::IsUserExtension(*extension)) {
      continue;
    }
    std::set<std::string_view> buckets;
    for (const auto reason : prefs->GetDisableReasons(extension->id())) {
      buckets.insert(ardia::DisableReasonName(reason));
    }
    for (const std::string_view bucket : buckets) {
      const std::string name(bucket);
      disabled.Set(name, disabled.FindInt(name).value_or(0) + 1);
    }
  }
  call.TakeReply().Send(
      base::DictValue()
          .Set("dropped", ardia::ExtensionsDroppedAtLoad(profile))
          .Set("enabled", enabled)
          .Set("disabled", std::move(disabled)));
}
