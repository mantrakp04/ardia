#ifndef ARDIA_CORE_AC_EXTENSION_SHORTCUTS_H_
#define ARDIA_CORE_AC_EXTENSION_SHORTCUTS_H_

#include <map>
#include <set>
#include <string>

#include "base/memory/raw_ptr.h"
#include "chrome/browser/extensions/extension_keybinding_registry.h"
#include "extensions/common/extension_id.h"
#include "ui/base/accelerators/accelerator.h"

#import <AppKit/AppKit.h>

class Browser;

namespace ardiacore {

class ExtensionShortcuts : public extensions::ExtensionKeybindingRegistry {
 public:
  explicit ExtensionShortcuts(Browser* browser);
  ExtensionShortcuts(const ExtensionShortcuts&) = delete;
  ExtensionShortcuts& operator=(const ExtensionShortcuts&) = delete;
  ~ExtensionShortcuts() override;

  bool Matches(const ui::Accelerator& accelerator) const;
  bool Run(const ui::Accelerator& accelerator);

  static ui::Accelerator AcceleratorFor(NSEvent* event);

 private:
  bool PopulateCommands(const extensions::Extension* extension,
                        ui::CommandMap* commands) override;
  bool RegisterAccelerator(const ui::Accelerator& accelerator,
                           const extensions::ExtensionId& extension_id,
                           const std::string& command_name) override;
  void UnregisterAccelerator(const ui::Accelerator& accelerator) override;
  void OnShortcutHandlingSuspended(bool suspended) override;
  bool ShouldIgnoreCommand(const std::string& command) const override;
  bool Suspended() const;

  raw_ptr<Browser> browser_;
  std::set<ui::Accelerator> accelerators_;
  std::map<ui::Accelerator, extensions::ExtensionId> action_accelerators_;
  bool suspended_ = false;
};

void InstallExtensionShortcutDispatcher(NSWindow* window);
bool IsReservedGlobalAccelerator(const ui::Accelerator& accelerator);
void ReservedShortcutsChanged();
void GlobalShortcutsResumed();

}

#endif
