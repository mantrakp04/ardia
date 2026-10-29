#import "ardia/core/public/ArdiaCore.h"

#include <map>
#include <string>
#include <utility>

#include "base/base64.h"
#include "base/containers/span.h"
#include "base/functional/bind.h"
#include "base/memory/ref_counted_memory.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "chrome/browser/profiles/profile.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_install_prompt_client.h"
#include "extensions/browser/install_prompt_data.h"
#include "extensions/common/extension.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_cast_dialog.h"
#include "ardia/core/ac_device_chooser.h"
#include "ardia/core/ac_lifetime.h"
#include "ardia/core/ac_permissions.h"
#import "ardia/core/ardiacore_api_internal.h"
#import "ardia/core/ardiacore_internal.h"

namespace ardiacore {

void HostPermissionRequest(content::WebContents* contents, NSDictionary* request) {
  [g_delegate engine:g_engine
      permissionRequest:request
                    tab:TabBridge::GetOrCreate(contents)->tab()];
}

namespace {

std::string InstallPromptTypeName(extensions::InstallPromptData::PromptType type) {
  switch (type) {
    case extensions::InstallPromptData::INSTALL_PROMPT:
      return "install";
    case extensions::InstallPromptData::RE_ENABLE_PROMPT:
      return "re-enable";
    case extensions::InstallPromptData::PERMISSIONS_PROMPT:
      return "permissions";
    case extensions::InstallPromptData::EXTERNAL_INSTALL_PROMPT:
      return "external";
    case extensions::InstallPromptData::REMOTE_INSTALL_PROMPT:
      return "remote";
    case extensions::InstallPromptData::REPAIR_PROMPT:
      return "repair";
    default:
      return "other";
  }
}

using InstallDone = extensions::ExtensionInstallPromptClient::DoneCallback;

struct PendingInstall {
  InstallDone done;
  base::WeakPtr<Profile> profile;
};

std::map<std::string, PendingInstall>& InstallPrompts() {
  static base::NoDestructor<std::map<std::string, PendingInstall>> prompts;
  return *prompts;
}

}

bool HostExtensionInstallPrompt(Profile* profile,
                                content::WebContents* parent,
                                const extensions::InstallPromptData& prompt,
                                InstallDone* done_callback) {
  const extensions::Extension* extension = prompt.extension();
  if (!extension || !done_callback || done_callback->is_null()) {
    return false;
  }
  if (prompt.type() == extensions::InstallPromptData::EXTERNAL_INSTALL_PROMPT) {
    using Payload = extensions::ExtensionInstallPromptClient::DoneCallbackPayload;
    using Result = extensions::ExtensionInstallPromptClient::Result;
    content::GetUIThreadTaskRunner({})->PostTask(
        FROM_HERE,
        base::BindOnce(std::move(*done_callback), Payload(Result::ABORTED)));
    return true;
  }
  static int last_id = 0;
  const std::string request_id = "install" + std::to_string(++last_id);
  NSMutableArray* permissions = [NSMutableArray array];
  for (size_t i = 0; i < prompt.GetPermissionCount(); ++i) {
    [permissions addObject:NS(prompt.GetPermission(i))];
  }
  NSString* icon = @"";
  if (!prompt.icon().IsEmpty()) {
    if (auto png = prompt.icon().As1xPNGBytes(); png && png->size()) {
      icon = NS("data:image/png;base64," +
                base::Base64Encode(base::span<const uint8_t>(*png)));
    }
  }
  NSDictionary* payload = @{
    @"requestId" : NS(request_id),
    @"id" : NS(extension->id()),
    @"name" : NS(extension->name()),
    @"version" : NS(extension->VersionString()),
    @"type" : NS(InstallPromptTypeName(prompt.type())),
    @"icon" : icon,
    @"permissions" : permissions,
  };
  InstallPrompts()[request_id] = {std::move(*done_callback), profile->GetWeakPtr()};
  ArdiaCoreTab* tab = parent ? TabBridge::GetOrCreate(parent)->tab() : nil;
  ArdiaCoreProfile* owner = [ArdiaCoreProfile wrapperFor:profile->GetOriginalProfile()];
  dispatch_async(dispatch_get_main_queue(), ^{
    [g_delegate engine:g_engine extensionInstallPrompt:payload profile:owner tab:tab];
  });
  return true;
}

void ResolveExtensionInstallPrompt(const std::string& request_id, bool accepted) {
  auto it = InstallPrompts().find(request_id);
  if (it == InstallPrompts().end()) {
    return;
  }
  PendingInstall pending = std::move(it->second);
  InstallPrompts().erase(it);
  if (!pending.profile) {
    return;
  }
  InstallDone done = std::move(pending.done);
  using Payload = extensions::ExtensionInstallPromptClient::DoneCallbackPayload;
  using Result = extensions::ExtensionInstallPromptClient::Result;
  std::move(done).Run(Payload(accepted ? Result::ACCEPTED : Result::USER_CANCELED));
}

void HostExtensionInstallFailed(content::WebContents* contents, const std::u16string& message) {
  ArdiaCoreTab* tab = contents ? TabBridge::GetOrCreate(contents)->tab() : nil;
  [g_delegate engine:g_engine extensionInstallFailed:NS(message) tab:tab];
}

void HostCastRoutes(Profile* profile, NSArray* routes) {
  [g_delegate engine:g_engine castRoutes:routes profile:[ArdiaCoreProfile wrapperFor:profile]];
}

void HostCastDialog(content::WebContents* contents, NSDictionary* state) {
  [g_delegate engine:g_engine castDialog:state tab:TabBridge::GetOrCreate(contents)->tab()];
}

void HostDeviceChooser(content::WebContents* contents, NSDictionary* state) {
  [g_delegate engine:g_engine
       deviceChooser:state
                 tab:TabBridge::GetOrCreate(contents)->tab()];
}

bool HostExtensionSidePanel(content::WebContents* contents,
                            const std::string& extension_id,
                            bool open) {
  [g_delegate engine:g_engine
      extensionSidePanel:@{@"extensionId" : NS(extension_id), @"open" : @(open)}
                     tab:TabBridge::GetOrCreate(contents)->tab()];
  return true;
}

bool HostExtensionActionPopup(content::WebContents* contents,
                              const std::string& extension_id) {
  return [g_delegate engine:g_engine
       extensionActionPopup:@{@"extensionId" : NS(extension_id)}
                        tab:TabBridge::GetOrCreate(contents)->tab()];
}

bool HostReservesKey(NSString* key, NSString* unshifted_key, unsigned long modifiers) {
  return [g_delegate engineIsReservedKey:key unshiftedKey:unshifted_key modifiers:modifiers];
}

bool HostExtensionActionShortcut(content::WebContents* contents,
                                 const std::string& extension_id) {
  return [g_delegate engine:g_engine
      extensionActionShortcut:@{@"extensionId" : NS(extension_id)}
                          tab:TabBridge::GetOrCreate(contents)->tab()];
}

void HostPermissionRequestDismissed(NSString* request_id) {
  [g_delegate engine:g_engine permissionRequestDismissed:request_id];
}

void HostQuitCancelled() {
  [g_delegate engineQuitCancelled];
}

}
