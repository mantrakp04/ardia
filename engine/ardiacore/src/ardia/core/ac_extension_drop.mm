#include "ardia/core/ac_extension_drop.h"

#include <memory>
#include <optional>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "chrome/browser/extensions/extension_install_prompt.h"
#include "chrome/browser/extensions/extension_management.h"
#include "chrome/browser/profiles/profile.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/drop_data.h"
#include "extensions/browser/crx_installer.h"
#include "extensions/browser/install/crx_install_error.h"
#include "extensions/browser/install_prompt_data.h"
#include "ardia/core/ac_browser.h"

namespace ardiacore {

namespace {

std::vector<base::FilePath> ExtensionFiles(const content::DropData& drop) {
  std::vector<base::FilePath> files;
  for (const ui::FileInfo& file : drop.filenames) {
    if (!file.path.MatchesExtension(FILE_PATH_LITERAL(".crx"))) {
      return {};
    }
    files.push_back(file.path);
  }
  return files;
}

void Installed(base::WeakPtr<content::WebContents> contents,
               const std::optional<extensions::CrxInstallError>& error) {
  if (!error ||
      error->detail() == extensions::CrxInstallErrorDetail::USER_CANCELED ||
      error->detail() == extensions::CrxInstallErrorDetail::USER_ABORTED) {
    return;
  }
  HostExtensionInstallFailed(contents.get(), error->message());
}

}

bool InstallDroppedExtensions(content::WebContents* contents,
                              const content::DropData& drop) {
  const std::vector<base::FilePath> files = ExtensionFiles(drop);
  if (files.empty() || !contents) {
    return false;
  }
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  if (!profile || profile->IsOffTheRecord() ||
      extensions::ExtensionManagementFactory::GetForBrowserContext(profile)
          ->BlocklistedByDefault()) {
    return false;
  }
  for (const base::FilePath& file : files) {
    scoped_refptr<extensions::CrxInstaller> installer =
        extensions::CrxInstaller::Create(
            profile, std::make_unique<ExtensionInstallPrompt>(
                         contents,
                         std::make_unique<extensions::InstallPromptData>(
                             extensions::InstallPromptData::UNSET_PROMPT_TYPE)));
    installer->set_error_on_unsupported_requirements(true);
    installer->set_off_store_install_allow_reason(
        extensions::CrxInstaller::OffStoreInstallAllowedFromSettingsPage);
    installer->set_install_immediately(true);
    installer->AddInstallerCallback(
        base::BindOnce(&Installed, contents->GetWeakPtr()));
    installer->InstallCrx(file);
  }
  return true;
}

}
