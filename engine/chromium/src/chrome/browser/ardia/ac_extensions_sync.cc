// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_engine.h"

#include <algorithm>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/task/sequenced_task_runner.h"
#include "base/values.h"
#include "chrome/browser/ardia/ac_extensions_sync_internal.h"
#include "chrome/browser/extensions/extension_util.h"
#include "chrome/browser/extensions/sync/extension_sync_util.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/toolbar/toolbar_actions_model.h"
#include "components/crx_file/id_util.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/browser_context.h"
#include "extensions/browser/disable_reason.h"
#include "extensions/browser/extension_prefs.h"
#include "extensions/browser/extension_registrar.h"
#include "extensions/browser/extension_system.h"
#include "extensions/browser/extension_util.h"
#include "extensions/browser/management_policy.h"
#include "extensions/browser/pending_extension_info.h"
#include "extensions/browser/pending_extension_manager.h"
#include "extensions/browser/permissions/permissions_updater.h"
#include "extensions/browser/pref_names.h"
#include "extensions/browser/uninstall_reason.h"
#include "extensions/common/extension.h"

extern void (*g_ardia_sync_installer_created)(
    content::BrowserContext* context,
    const std::string& extension_id,
    extensions::CrxInstaller* installer);
extern void (*g_ardia_crx_installing)(content::BrowserContext* context,
                                      extensions::CrxInstaller* installer,
                                      const extensions::Extension* extension);

namespace ardia {
namespace extensions_sync_internal {

namespace {

using extensions::Extension;
using extensions::ExtensionPrefs;
using extensions::ExtensionRegistry;
namespace reason = extensions::disable_reason;

bool Pinned(Profile* profile, const std::string& id) {
  const extensions::ExtensionIdList pinned =
      ExtensionPrefs::Get(profile)->GetPinnedExtensions();
  return std::ranges::find(pinned, id) != pinned.end();
}

bool ForcePinned(Profile* profile, const std::string& id) {
  ToolbarActionsModel* model = ToolbarActionsModel::Get(profile);
  return model && model->IsActionForcePinned(id);
}

bool UserIntent(extensions::UninstallReason why) {
  return why == extensions::UNINSTALL_REASON_USER_INITIATED ||
         why == extensions::UNINSTALL_REASON_MANAGEMENT_API ||
         why == extensions::UNINSTALL_REASON_CHROME_WEBSTORE;
}

void SyncInstallerCreated(content::BrowserContext* context,
                          const std::string& id,
                          extensions::CrxInstaller* installer);
void CrxInstalling(content::BrowserContext* context,
                   extensions::CrxInstaller* installer,
                   const extensions::Extension* extension);

}

bool Syncable(content::BrowserContext* context, const Extension* extension) {
  return extension && extension->is_extension() && !extension->is_theme() &&
         extension->from_webstore() &&
         extensions::sync_util::ShouldSync(context, extension);
}

bool PendingFromSync(Profile* profile, const std::string& id) {
  const extensions::PendingExtensionInfo* info =
      extensions::PendingExtensionManager::Get(profile)->GetById(id);
  return info && info->is_from_sync();
}

const Extension* Installed(Profile* profile, const std::string& id) {
  return ExtensionRegistry::Get(profile)->GetExtensionById(
      id, ExtensionRegistry::EVERYTHING);
}

extensions::ManagementPolicy* Policy(Profile* profile) {
  return extensions::ExtensionSystem::Get(profile)->management_policy();
}

void SetPinned(Profile* profile, const std::string& id, bool pin) {
  if (ForcePinned(profile, id) || Pinned(profile, id) == pin) {
    return;
  }
  ExtensionPrefs* prefs = ExtensionPrefs::Get(profile);
  extensions::ExtensionIdList pinned = prefs->GetPinnedExtensions();
  if (pin) {
    pinned.push_back(id);
  } else {
    std::erase(pinned, id);
  }
  prefs->SetPinnedExtensions(pinned);
}

ExtensionSync::ExtensionSync(Profile* profile) : ProfileState(profile) {
  if (!g_ardia_sync_installer_created) {
    g_ardia_sync_installer_created = &SyncInstallerCreated;
  }
  if (!g_ardia_crx_installing) {
    g_ardia_crx_installing = &CrxInstalling;
  }
  observation_.Observe(ExtensionRegistry::Get(profile));
  for (const auto& extension :
       ExtensionRegistry::Get(profile)->GenerateInstalledExtensionsSet()) {
    if (Prefs()->ReadPrefAsDict(extension->id(), kSyncDesired)) {
      SettleSoon(extension->id());
    }
  }
}

ExtensionSync::~ExtensionSync() {
  Release();
}

base::DictValue ExtensionSync::State() {
  Profile* p = profile();
  extensions::ExtensionRegistrar* registrar =
      extensions::ExtensionRegistrar::Get(p);
  base::ListValue list;
  for (const auto& extension :
       ExtensionRegistry::Get(p)->GenerateInstalledExtensionsSet()) {
    const std::string& id = extension->id();
    const bool syncable = Syncable(p, extension.get());
    base::DictValue entry;
    entry.Set("id", id);
    entry.Set("syncable", syncable);
    if (syncable) {
      entry.Set("version", extension->version().GetString());
      entry.Set("approved", Approved(p, extension.get()));
      entry.Set("fingerprint", PermissionFingerprint(extension.get()));
      entry.Set("enabled", registrar->IsExtensionEnabled(id));
      entry.Set("userDisabled",
                Prefs()->HasDisableReason(id, reason::DISABLE_USER_ACTION));
      entry.Set("incognito", extensions::util::IsIncognitoEnabled(id, p));
      entry.Set("pinned", Pinned(p, id));
    }
    list.Append(std::move(entry));
  }
  base::ListValue pending;
  for (const std::string& id : extensions::PendingExtensionManager::Get(p)
                                   ->GetPendingIdsForUpdateCheck()) {
    if (PendingFromSync(p, id)) {
      pending.Append(id);
    }
  }
  base::ListValue settling;
  for (const std::string& id : settling_) {
    settling.Append(id);
  }
  base::ListValue queued;
  if (const base::DictValue* all =
          &p->GetPrefs()->GetDict(extensions::pref_names::kExtensions)) {
    for (const auto [id, entry] : *all) {
      if (entry.is_dict() && entry.GetDict().FindDict(kSyncDesired) &&
          !Installed(p, id)) {
        queued.Append(id);
      }
    }
  }
  base::ListValue intents;
  for (auto& [id, kind] : intents_) {
    intents.Append(base::DictValue().Set("id", id).Set("kind", kind));
  }
  intents_.clear();
  return base::DictValue()
      .Set("ready", extensions::ExtensionSystem::Get(p)->is_ready())
      .Set("extensions", std::move(list))
      .Set("pending", std::move(pending))
      .Set("settling", std::move(settling))
      .Set("queued", std::move(queued))
      .Set("intents", std::move(intents));
}

ExtensionPrefs* ExtensionSync::Prefs() {
  return ExtensionPrefs::Get(profile());
}

void ExtensionSync::Release() {
  observation_.Reset();
  completing_.clear();
  manual_.clear();
  sync_installers_.clear();
  weak_factory_.InvalidateWeakPtrs();
}

void ExtensionSync::OnShutdown(ExtensionRegistry* registry) {
  observation_.Reset();
}

void ExtensionSync::OnExtensionInstalled(content::BrowserContext* context,
                                         const Extension* extension,
                                         bool is_update) {
  const std::string id = extension->id();
  const bool from_sync = FromSyncInstaller(extension);
  bool delayed = false;
  if (Prefs()->ReadPrefAsBoolean(id, kSyncDelayed, &delayed)) {
    Prefs()->UpdateExtensionPref(id, kSyncDelayed, std::nullopt);
  }
  const bool desired = Prefs()->ReadPrefAsDict(id, kSyncDesired) != nullptr;
  if (from_sync) {
    if (desired) {
      SettleSoon(id);
    }
    return;
  }
  if (desired) {
    Prefs()->UpdateExtensionPref(id, kSyncDesired, std::nullopt);
  }
  if (is_update && Prefs()->ReadPrefAsDict(id, kSyncApproval)) {
    SettleSoon(id);
  }
  if (!is_update && Syncable(profile(), extension)) {
    Intent(id, "installed");
  }
}

void ExtensionSync::OnExtensionUninstalled(content::BrowserContext* context,
                                           const Extension* extension,
                                           extensions::UninstallReason why) {
  if (UserIntent(why) && Syncable(profile(), extension)) {
    Intent(extension->id(), "uninstalled");
  }
}

void ExtensionSync::Intent(const std::string& id, const std::string& kind) {
  intents_[id] = kind;
  Emit("extensions.sync", profile(),
       base::DictValue().Set("id", id).Set("kind", kind));
}

void ExtensionSync::SettleSoon(const std::string& id) {
  settling_.insert(id);
  base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE,
      base::BindOnce(&ExtensionSync::Settle, weak_factory_.GetWeakPtr(), id));
}

void ExtensionSync::Settle(const std::string& id) {
  settling_.erase(id);
  std::optional<base::DictValue> desired;
  if (const base::DictValue* stored =
          Prefs()->ReadPrefAsDict(id, kSyncDesired)) {
    desired = stored->Clone();
  }
  const Approval stored_approval =
      ApprovalFrom(Prefs()->ReadPrefAsDict(id, kSyncApproval));
  const Approval approval =
      desired ? ApprovalFrom(desired->FindDict("approval")) : stored_approval;
  const Extension* extension = Installed(profile(), id);
  if (!extension || !Syncable(profile(), extension)) {
    return;
  }
  Prefs()->UpdateExtensionPref(id, kSyncDesired, std::nullopt);
  if (approval.Matches(extension)) {
    GrantApproved(extension);
  }
  extension = Installed(profile(), id);
  if (extension && stored_approval.version.IsValid() &&
      extension->version().CompareTo(stored_approval.version) >= 0) {
    Prefs()->UpdateExtensionPref(id, kSyncApproval, std::nullopt);
  }
  if (!extension) {
    return;
  }
  const base::DictValue* record =
      desired ? desired->FindDict("record") : nullptr;
  if (std::optional<bool> pin =
          record ? record->FindBool("pin") : std::nullopt) {
    SetPinned(profile(), id, *pin);
  }
}

void ExtensionSync::GrantApproved(const Extension* extension) {
  const std::string id = extension->id();
  ExtensionPrefs* prefs = Prefs();
  if (!prefs->HasDisableReason(id, reason::DISABLE_PERMISSIONS_INCREASE)) {
    return;
  }
  extensions::PermissionsUpdater(profile()).GrantActivePermissions(extension);
  prefs->RemoveDisableReason(id, reason::DISABLE_PERMISSIONS_INCREASE);
  if (prefs->GetDisableReasons(id).empty() &&
      !Policy(profile())->MustRemainDisabled(extension, nullptr)) {
    extensions::ExtensionRegistrar::Get(profile())->EnableExtension(id);
  }
}

namespace {

void SyncInstallerCreated(content::BrowserContext* context,
                          const std::string& id,
                          extensions::CrxInstaller* installer) {
  Profile* profile = Profile::FromBrowserContext(context);
  if (profile && !profile->IsOffTheRecord()) {
    StateFor<ExtensionSync>(profile).TrackSyncInstaller(installer);
  }
}

void CrxInstalling(content::BrowserContext* context,
                   extensions::CrxInstaller* installer,
                   const extensions::Extension* extension) {
  Profile* profile = Profile::FromBrowserContext(context);
  if (profile && !profile->IsOffTheRecord()) {
    StateFor<ExtensionSync>(profile).Installing(installer, extension);
  }
}

}

}
}

using ardia::Call;

AC_PROFILE_CALL(ac_extensions_sync_state) {
  call.TakeReply().Send(
      ardia::StateFor<ardia::extensions_sync_internal::ExtensionSync>(
          call.profile())
          .State());
}

AC_PROFILE_CALL(ac_extensions_sync_apply) {
  const std::string id = call.String("id");
  if (!crx_file::id_util::IdIsValid(id)) {
    return call.TakeReply().Error("not an extension id");
  }
  call.TakeReply().Send(
      ardia::StateFor<ardia::extensions_sync_internal::ExtensionSync>(
          call.profile())
          .Apply(id, call.args()));
}
