// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_EXTENSIONS_SYNC_INTERNAL_H_
#define CHROME_BROWSER_ARDIA_AC_EXTENSIONS_SYNC_INTERNAL_H_

#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/values.h"
#include "base/version.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "extensions/browser/crx_installer.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_registry_observer.h"
#include "extensions/browser/install/crx_install_error.h"
#include "extensions/browser/uninstall_reason.h"
#include "extensions/common/extension.h"

class Profile;

namespace content {
class BrowserContext;
}

namespace extensions {
class ExtensionPrefs;
class ManagementPolicy;
}

namespace ardia {
namespace extensions_sync_internal {

inline constexpr char kSyncDelayed[] = "ardia_sync_delayed";
inline constexpr char kSyncDesired[] = "ardia_sync_desired";
inline constexpr char kSyncApproval[] = "ardia_sync_approval";

bool Syncable(content::BrowserContext* context,
              const extensions::Extension* extension);
bool PendingFromSync(Profile* profile, const std::string& id);
const extensions::Extension* Installed(Profile* profile, const std::string& id);
extensions::ManagementPolicy* Policy(Profile* profile);
void SetPinned(Profile* profile, const std::string& id, bool pin);

bool Approved(Profile* profile, const extensions::Extension* extension);
std::string PermissionFingerprint(const extensions::Extension* extension);

struct Approval {
  base::Version version;
  std::vector<std::string> fingerprints;

  bool Matches(const extensions::Extension* extension) const;
};

Approval ApprovalFrom(const base::DictValue* dict);

class ExtensionSync : public ProfileState,
                      public extensions::ExtensionRegistryObserver {
 public:
  explicit ExtensionSync(Profile* profile);
  ~ExtensionSync() override;

  base::DictValue State();
  base::DictValue Apply(const std::string& id, const base::DictValue& args);

 private:
  extensions::ExtensionPrefs* Prefs();

 public:
  void TrackSyncInstaller(extensions::CrxInstaller* installer);
  void Installing(extensions::CrxInstaller* installer,
                  const extensions::Extension* extension);

 private:
  void SyncInstallerDone(
      uintptr_t key,
      const std::optional<extensions::CrxInstallError>& error);
  void ManualSettled(scoped_refptr<const extensions::Extension> manual);
  bool FromSyncInstaller(const extensions::Extension* extension);
  void Release() override;
  void OnShutdown(extensions::ExtensionRegistry* registry) override;
  void OnExtensionInstalled(content::BrowserContext* context,
                            const extensions::Extension* extension,
                            bool is_update) override;
  void OnExtensionUninstalled(content::BrowserContext* context,
                              const extensions::Extension* extension,
                              extensions::UninstallReason why) override;
  void Intent(const std::string& id, const std::string& kind);
  void SettleSoon(const std::string& id);
  void Settle(const std::string& id);
  void GrantApproved(const extensions::Extension* extension);
  base::DictValue Cancel(const std::string& id);
  void PresetPrefs(const std::string& id, const base::DictValue& record);
  base::DictValue Install(const std::string& id,
                          const base::DictValue& record,
                          const base::DictValue* approval);
  base::DictValue Reconcile(const extensions::Extension* extension,
                            const base::DictValue& record,
                            const base::DictValue* approval_dict);

  std::set<std::string> settling_;
  std::map<std::string, std::string> intents_;
  base::ScopedObservation<extensions::ExtensionRegistry,
                          extensions::ExtensionRegistryObserver>
      observation_{this};
  std::map<extensions::CrxInstaller*, scoped_refptr<extensions::CrxInstaller>>
      sync_installers_;
  std::map<extensions::CrxInstaller*,
           scoped_refptr<const extensions::Extension>>
      completing_;
  std::vector<scoped_refptr<const extensions::Extension>> manual_;
  base::WeakPtrFactory<ExtensionSync> weak_factory_{this};
};

}
}

#endif
