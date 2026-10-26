// Copyright 2026 Ardia. Apache-2.0.

#include <algorithm>
#include <memory>
#include <string>
#include <vector>

#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "base/version.h"
#include "chrome/browser/ardia/ac_extensions_sync_internal.h"
#include "chrome/browser/profiles/profile.h"
#include "extensions/browser/disable_reason.h"
#include "extensions/browser/extension_prefs.h"
#include "extensions/common/extension.h"
#include "extensions/common/manifest_handlers/permissions_parser.h"
#include "extensions/common/permissions/api_permission_set.h"
#include "extensions/common/permissions/permission_message_provider.h"
#include "extensions/common/permissions/permission_set.h"

namespace ardia {
namespace extensions_sync_internal {

namespace {

using extensions::Extension;
using extensions::ExtensionPrefs;
using extensions::ExtensionRegistry;
namespace reason = extensions::disable_reason;

const extensions::PermissionSet& Required(const Extension* extension) {
  return extensions::PermissionsParser::GetRequiredPermissions(extension);
}

}

bool Approved(Profile* profile, const Extension* extension) {
  ExtensionPrefs* prefs = ExtensionPrefs::Get(profile);
  if (prefs->HasDisableReason(extension->id(),
                              reason::DISABLE_PERMISSIONS_INCREASE)) {
    return false;
  }
  std::unique_ptr<const extensions::PermissionSet> granted =
      prefs->GetGrantedPermissions(extension->id());
  std::unique_ptr<const extensions::PermissionSet> runtime =
      prefs->GetRuntimeGrantedPermissions(extension->id());
  if (!granted) {
    granted = std::make_unique<extensions::PermissionSet>();
  }
  if (!runtime) {
    runtime = std::make_unique<extensions::PermissionSet>();
  }
  std::unique_ptr<const extensions::PermissionSet> total =
      extensions::PermissionSet::CreateUnion(*granted, *runtime);
  return !extensions::PermissionMessageProvider::Get()->IsPrivilegeIncrease(
      *total, Required(extension), extension->GetType());
}

std::string PermissionFingerprint(const Extension* extension) {
  std::vector<std::string> parts;
  for (const extensions::PermissionID& permission :
       extensions::PermissionMessageProvider::Get()->GetAllPermissionIDs(
           Required(extension), extension->GetType())) {
    parts.push_back(base::NumberToString(static_cast<int>(permission.id())) +
                    ":" + base::UTF16ToUTF8(permission.parameter()));
  }
  std::sort(parts.begin(), parts.end());
  return base::JoinString(parts, "\n");
}

bool Approval::Matches(const Extension* extension) const {
  return version.IsValid() && extension->version() == version &&
         std::ranges::find(fingerprints, PermissionFingerprint(extension)) !=
             fingerprints.end();
}

Approval ApprovalFrom(const base::DictValue* dict) {
  Approval approval;
  if (!dict) {
    return approval;
  }
  const std::string* version = dict->FindString("v");
  const base::ListValue* fingerprints = dict->FindList("fps");
  if (!version || !fingerprints) {
    return approval;
  }
  approval.version = base::Version(*version);
  for (const base::Value& fingerprint : *fingerprints) {
    if (fingerprint.is_string()) {
      approval.fingerprints.push_back(fingerprint.GetString());
    }
  }
  return approval;
}

}
}
