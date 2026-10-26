// Copyright 2026 Ardia. Apache-2.0.

#include <optional>
#include <string>
#include <utility>

#include "base/values.h"
#include "base/version.h"
#include "chrome/browser/ardia/ac_extensions_sync_internal.h"
#include "chrome/browser/extensions/extension_management.h"
#include "chrome/browser/extensions/extension_service.h"
#include "chrome/browser/extensions/extension_util.h"
#include "chrome/browser/profiles/profile.h"
#include "content/public/browser/browser_context.h"
#include "extensions/browser/api/management/management_api.h"
#include "extensions/browser/api/management/management_api_delegate.h"
#include "extensions/browser/disable_reason.h"
#include "extensions/browser/extension_prefs.h"
#include "extensions/browser/extension_registrar.h"
#include "extensions/browser/extension_system.h"
#include "extensions/browser/extension_util.h"
#include "extensions/browser/management_policy.h"
#include "extensions/browser/pending_extension_manager.h"
#include "extensions/common/extension.h"
#include "extensions/common/extension_urls.h"

namespace ardia {
namespace extensions_sync_internal {

namespace {

using extensions::Extension;
using extensions::ExtensionPrefs;
using extensions::ExtensionRegistry;
namespace reason = extensions::disable_reason;

bool AllowSyncInstall(const Extension* extension,
                      content::BrowserContext* context) {
  return Syncable(context, extension);
}

const extensions::ManagementAPIDelegate* Management(Profile* profile) {
  return extensions::ManagementAPI::GetFactoryInstance()
      ->Get(profile)
      ->GetDelegate();
}

void CheckForUpdatesSoon(Profile* profile) {
  if (extensions::ExtensionService* service =
          extensions::ExtensionSystem::Get(profile)->extension_service()) {
    service->CheckForUpdatesSoon();
  }
}

}

base::DictValue ExtensionSync::Apply(const std::string& id,
                                     const base::DictValue& args) {
  const base::DictValue* record = args.FindDict("record");
  if (!record) {
    return base::DictValue().Set("state", "invalid");
  }
  if (record->FindBool("removed").value_or(false)) {
    return Cancel(id);
  }
  const base::DictValue* approval = args.FindDict("approval");
  if (const Extension* extension = Installed(profile(), id)) {
    return Reconcile(extension, *record, approval);
  }
  return Install(id, *record, approval);
}

base::DictValue ExtensionSync::Cancel(const std::string& id) {
  if (Installed(profile(), id)) {
    return base::DictValue().Set("state", "kept");
  }
  if (Prefs()->ReadPrefAsDict(id, kSyncDesired)) {
    Prefs()->UpdateExtensionPref(id, kSyncDesired, std::nullopt);
  }
  if (!PendingFromSync(profile(), id)) {
    return base::DictValue().Set("state", "absent");
  }
  extensions::PendingExtensionManager::Get(profile())->Remove(id);
  return base::DictValue().Set("state", "cancelled");
}

void ExtensionSync::PresetPrefs(const std::string& id,
                                const base::DictValue& record) {
  Profile* p = profile();
  if (!record.FindBool("on").value_or(true)) {
    Prefs()->AddDisableReason(id, reason::DISABLE_USER_ACTION);
  } else {
    Prefs()->RemoveDisableReason(id, reason::DISABLE_USER_ACTION);
  }
  extensions::util::SetIsIncognitoEnabled(
      id, p, record.FindBool("inc").value_or(false));
  SetPinned(p, id, record.FindBool("pin").value_or(false));
}

base::DictValue ExtensionSync::Install(const std::string& id,
                                       const base::DictValue& record,
                                       const base::DictValue* approval) {
  Profile* p = profile();
  if (extensions::ExtensionManagementFactory::GetForBrowserContext(p)
          ->BlocklistedByDefault()) {
    return base::DictValue().Set("state", "blocked");
  }
  extensions::PendingExtensionManager* pending =
      extensions::PendingExtensionManager::Get(p);
  if (pending->IsIdPending(id) && !PendingFromSync(p, id)) {
    return base::DictValue().Set("state", "pending");
  }
  PresetPrefs(id, record);
  base::DictValue desired;
  desired.Set("record", record.Clone());
  if (approval) {
    desired.Set("approval", approval->Clone());
  }
  Prefs()->UpdateExtensionPref(id, kSyncDesired,
                               base::Value(std::move(desired)));
  if (PendingFromSync(p, id)) {
    return base::DictValue().Set("state", "pending");
  }
  if (!pending->AddFromSync(id, extension_urls::GetWebstoreUpdateUrl(),
                            base::Version(), &AllowSyncInstall, false)) {
    Prefs()->UpdateExtensionPref(id, kSyncDesired, std::nullopt);
    return base::DictValue().Set("state", "refused");
  }
  CheckForUpdatesSoon(p);
  return base::DictValue().Set("state", "pending");
}

base::DictValue ExtensionSync::Reconcile(const Extension* extension,
                                         const base::DictValue& record,
                                         const base::DictValue* approval_dict) {
  Profile* p = profile();
  const std::string id = extension->id();
  if (!Syncable(p, extension) ||
      !Policy(p)->UserMayModifySettings(extension, nullptr)) {
    return base::DictValue().Set("state", "kept");
  }
  const Approval approval = ApprovalFrom(approval_dict);
  ExtensionPrefs* prefs = Prefs();
  if (prefs->ReadPrefAsDict(id, kSyncDesired)) {
    prefs->UpdateExtensionPref(id, kSyncDesired, std::nullopt);
  }
  extensions::ExtensionRegistrar* registrar =
      extensions::ExtensionRegistrar::Get(p);
  if (std::optional<bool> on = record.FindBool("on")) {
    if (!*on && !prefs->HasDisableReason(id, reason::DISABLE_USER_ACTION)) {
      if (registrar->IsExtensionEnabled(id)) {
        Management(p)->DisableExtension(p, nullptr, id,
                                        reason::DISABLE_USER_ACTION);
      } else {
        prefs->AddDisableReason(id, reason::DISABLE_USER_ACTION);
      }
    } else if (*on &&
               prefs->HasDisableReason(id, reason::DISABLE_USER_ACTION)) {
      prefs->RemoveDisableReason(id, reason::DISABLE_USER_ACTION);
      const Extension* current = Installed(p, id);
      if (current && !registrar->IsExtensionEnabled(id) &&
          prefs->GetDisableReasons(id).empty() &&
          !Policy(p)->MustRemainDisabled(current, nullptr)) {
        registrar->EnableExtension(id);
      }
    }
  }
  extension = Installed(p, id);
  if (!extension) {
    return base::DictValue().Set("state", "absent");
  }
  if (std::optional<bool> incognito = record.FindBool("inc");
      incognito && extensions::util::CanBeIncognitoEnabled(extension) &&
      extensions::util::IsIncognitoEnabled(id, p) != *incognito) {
    extensions::util::SetIsIncognitoEnabled(id, p, *incognito);
  }
  if (std::optional<bool> pin = record.FindBool("pin")) {
    SetPinned(p, id, *pin);
  }
  extension = Installed(p, id);
  if (extension && approval.Matches(extension)) {
    GrantApproved(extension);
  }
  extension = Installed(p, id);
  if (extension && approval_dict && approval.version.IsValid() &&
      extension->version().CompareTo(approval.version) < 0) {
    prefs->UpdateExtensionPref(id, kSyncApproval,
                               base::Value(approval_dict->Clone()));
    CheckForUpdatesSoon(p);
    return base::DictValue().Set("state", "updating");
  }
  return base::DictValue().Set("state", "installed");
}

}
}
