#include "ardia/linux/ac_linux_extension_keybindings.h"

#include "chrome/browser/extensions/commands/command_service.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/tab_list/tab_list_interface.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "content/public/browser/web_contents.h"
#include "extensions/common/api/extension_action/action_info.h"
#include "extensions/common/command.h"
#include "extensions/browser/extension_util.h"
#include "extensions/common/extension.h"
#include "ui/events/event_constants.h"

namespace ardia {

namespace shortcuts = linux_extension_shortcuts;

namespace {

constexpr int kShortcutModifiers = ui::EF_SHIFT_DOWN | ui::EF_CONTROL_DOWN | ui::EF_ALT_DOWN | ui::EF_COMMAND_DOWN;

}

LinuxExtensionKeybindings::LinuxExtensionKeybindings(BrowserWindowInterface* browser, ActionShortcut action_shortcut)
    : ExtensionKeybindingRegistry(browser->GetProfile(), TabListInterface::From(browser), ALL_EXTENSIONS),
      browser_(browser),
      action_shortcut_(std::move(action_shortcut)) {
  Init();
}

LinuxExtensionKeybindings::~LinuxExtensionKeybindings() = default;

shortcuts::Key LinuxExtensionKeybindings::KeyOf(const ui::Accelerator& accelerator) {
  return shortcuts::Key{static_cast<int>(accelerator.key_code()), accelerator.modifiers() & kShortcutModifiers};
}

bool LinuxExtensionKeybindings::Handle(const ui::Accelerator& accelerator, bool reserved_by_ardia) {
  const shortcuts::Decision decision = book_.Decide(KeyOf(accelerator), accelerator.IsRepeat(), reserved_by_ardia);
  switch (decision.route) {
    case shortcuts::Route::kNone:
      return false;
    case shortcuts::Route::kSwallow:
      return true;
    case shortcuts::Route::kCommand:
      return NotifyEventTargets(ui::Accelerator(accelerator.key_code(), accelerator.modifiers() & kShortcutModifiers));
    case shortcuts::Route::kAction: {
      content::WebContents* contents = browser_ ? browser_->GetTabStripModel()->GetActiveWebContents() : nullptr;
      return contents && action_shortcut_.Run(contents, decision.extension_id);
    }
  }
  return false;
}

bool LinuxExtensionKeybindings::PopulateCommands(const extensions::Extension* extension, ui::CommandMap* commands) {
  if (browser_context()->IsOffTheRecord() &&
      !extensions::util::IsIncognitoEnabled(extension->id(), browser_context())) {
    return false;
  }
  extensions::CommandService* service = extensions::CommandService::Get(browser_context());
  const bool named = service->GetNamedCommands(extension->id(), extensions::CommandService::ACTIVE,
                                               extensions::CommandService::REGULAR, commands);
  extensions::Command action;
  const bool has_action = service->GetExtensionActionCommand(
      extension->id(), extensions::ActionInfo::Type::kAction, extensions::CommandService::ACTIVE, &action, nullptr);
  if (has_action) (*commands)[action.command_name()] = action;
  return named || has_action;
}

bool LinuxExtensionKeybindings::RegisterAccelerator(const ui::Accelerator& accelerator,
                                                    const extensions::ExtensionId& extension_id,
                                                    const std::string& command_name) {
  book_.Register(KeyOf(accelerator), extension_id, command_name);
  return true;
}

void LinuxExtensionKeybindings::UnregisterAccelerator(const ui::Accelerator& accelerator) {
  book_.Unregister(KeyOf(accelerator));
}

bool LinuxExtensionKeybindings::ShouldIgnoreCommand(const std::string&) const {
  return false;
}

}
