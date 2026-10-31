#ifndef ARDIA_LINUX_AC_LINUX_EXTENSION_KEYBINDINGS_H_
#define ARDIA_LINUX_AC_LINUX_EXTENSION_KEYBINDINGS_H_

#include <string>

#include "ardia/linux/ac_linux_extension_shortcuts.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "chrome/browser/extensions/extension_keybinding_registry.h"
#include "extensions/common/extension_id.h"
#include "ui/base/accelerators/accelerator.h"

class BrowserWindowInterface;

namespace content {
class WebContents;
}

namespace ardia {

class LinuxExtensionKeybindings : public extensions::ExtensionKeybindingRegistry {
 public:
  using ActionShortcut = base::RepeatingCallback<bool(content::WebContents*, const extensions::ExtensionId&)>;

  LinuxExtensionKeybindings(BrowserWindowInterface* browser, ActionShortcut action_shortcut);
  LinuxExtensionKeybindings(const LinuxExtensionKeybindings&) = delete;
  LinuxExtensionKeybindings& operator=(const LinuxExtensionKeybindings&) = delete;
  ~LinuxExtensionKeybindings() override;

  bool Handle(const ui::Accelerator& accelerator, bool reserved_by_ardia);

  static linux_extension_shortcuts::Key KeyOf(const ui::Accelerator& accelerator);

 private:
  bool PopulateCommands(const extensions::Extension* extension, ui::CommandMap* commands) override;
  bool RegisterAccelerator(const ui::Accelerator& accelerator, const extensions::ExtensionId& extension_id,
                           const std::string& command_name) override;
  void UnregisterAccelerator(const ui::Accelerator& accelerator) override;
  bool ShouldIgnoreCommand(const std::string& command) const override;

  raw_ptr<BrowserWindowInterface> browser_;
  ActionShortcut action_shortcut_;
  linux_extension_shortcuts::ShortcutBook book_;
};

}

#endif
