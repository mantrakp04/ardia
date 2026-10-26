// Copyright 2026 Ardia. Apache-2.0.

#include <optional>
#include <utility>

#include "base/functional/bind.h"
#include "base/memory/scoped_refptr.h"
#include "base/task/sequenced_task_runner.h"
#include "base/values.h"
#include "chrome/browser/ardia/ac_extensions_sync_internal.h"
#include "extensions/browser/crx_installer.h"
#include "extensions/browser/delayed_install_manager.h"
#include "extensions/browser/extension_prefs.h"
#include "extensions/browser/install/crx_install_error.h"
#include "extensions/common/extension.h"

namespace ardia {
namespace extensions_sync_internal {

namespace {

using extensions::Extension;

}

void ExtensionSync::TrackSyncInstaller(extensions::CrxInstaller* installer) {
  sync_installers_[installer] = base::WrapRefCounted(installer);
  installer->AddInstallerCallback(base::BindOnce(
      &ExtensionSync::SyncInstallerDone, weak_factory_.GetWeakPtr(),
      reinterpret_cast<uintptr_t>(installer)));
}

void ExtensionSync::Installing(extensions::CrxInstaller* installer,
                               const Extension* extension) {
  if (!extension) {
    return;
  }
  if (sync_installers_.contains(installer)) {
    completing_[installer] = base::WrapRefCounted(extension);
    return;
  }
  scoped_refptr<const Extension> manual = base::WrapRefCounted(extension);
  manual_.push_back(manual);
  base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&ExtensionSync::ManualSettled,
                                weak_factory_.GetWeakPtr(), manual));
}

void ExtensionSync::SyncInstallerDone(
    uintptr_t key,
    const std::optional<extensions::CrxInstallError>& error) {
  auto* identity = reinterpret_cast<extensions::CrxInstaller*>(key);
  auto found = sync_installers_.find(identity);
  if (found == sync_installers_.end()) {
    return;
  }
  scoped_refptr<extensions::CrxInstaller> installer = found->second;
  sync_installers_.erase(found);
  scoped_refptr<const Extension> own;
  if (auto completing = completing_.find(identity);
      completing != completing_.end()) {
    own = completing->second;
    completing_.erase(completing);
  }
  if (error || !own || Installed(profile(), own->id())) {
    return;
  }
  if (extensions::DelayedInstallManager::Get(profile())
          ->GetPendingExtensionUpdate(own->id()) == own.get()) {
    Prefs()->UpdateExtensionPref(own->id(), kSyncDelayed, base::Value(true));
  }
}

void ExtensionSync::ManualSettled(scoped_refptr<const Extension> manual) {
  std::erase(manual_, manual);
  bool delayed = false;
  if (extensions::DelayedInstallManager::Get(profile())
              ->GetPendingExtensionUpdate(manual->id()) == manual.get() &&
      Prefs()->ReadPrefAsBoolean(manual->id(), kSyncDelayed, &delayed)) {
    Prefs()->UpdateExtensionPref(manual->id(), kSyncDelayed, std::nullopt);
  }
}

bool ExtensionSync::FromSyncInstaller(const Extension* extension) {
  for (const auto& manual : manual_) {
    if (manual.get() == extension) {
      return false;
    }
  }
  for (const auto& [installer, installing] : completing_) {
    if (installing.get() == extension) {
      return true;
    }
  }
  bool delayed = false;
  return Prefs()->ReadPrefAsBoolean(extension->id(), kSyncDelayed, &delayed) &&
         delayed;
}

}
}
