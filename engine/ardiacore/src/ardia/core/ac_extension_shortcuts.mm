#include "ardia/core/ac_extension_shortcuts.h"

#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>


#include "base/apple/owned_objc.h"
#include "base/apple/scoped_cftyperef.h"
#include "base/functional/bind.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "base/no_destructor.h"
#include "chrome/browser/extensions/commands/command_service.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/tab_list/tab_list_interface.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/input/native_web_keyboard_event.h"
#include "components/remote_cocoa/app_shim/native_widget_ns_window_bridge.h"
#include "content/public/browser/web_contents.h"
#include "extensions/common/api/extension_action/action_info.h"
#include "extensions/common/command.h"
#include "extensions/common/extension.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_browser_window.h"
#include "ardia/core/ac_hooks.h"
#include "ui/base/accelerators/global_accelerator_listener/global_accelerator_listener.h"
#import "ui/base/cocoa/command_dispatcher.h"
#include "ui/content_accelerators/accelerator_util.h"
#import "ui/events/keycodes/keyboard_code_conversion_mac.h"
#include "ui/events/keycodes/keyboard_codes.h"

@interface ACExtensionShortcutDispatcher : NSObject <CommandDispatcherDelegate>
@end

@implementation ACExtensionShortcutDispatcher

- (ui::PerformKeyEquivalentResult)prePerformKeyEquivalent:(NSEvent*)event
                                                   window:(NSWindow*)window {
  ardiacore::WindowHost* host = ardiacore::WindowHost::ForNSWindow(window);
  Profile* profile = host ? host->active_profile() : nullptr;
  Browser* browser = profile ? host->ExistingBrowserFor(profile) : nullptr;
  ardiacore::ACBrowserWindow* browser_window =
      browser ? ardiacore::ACBrowserWindow::FromWindow(
                    BrowserWindow::FromBrowser(browser))
              : nullptr;
  return browser_window && browser_window->HandleExtensionKeyEquivalent(event)
             ? ui::PerformKeyEquivalentResult::kHandled
             : ui::PerformKeyEquivalentResult::kUnhandled;
}

- (ui::PerformKeyEquivalentResult)postPerformKeyEquivalent:(NSEvent*)event
                                                    window:(NSWindow*)window
                                              isRedispatch:(BOOL)isRedispatch {
  return ui::PerformKeyEquivalentResult::kUnhandled;
}

@end

namespace ardiacore {

namespace {

struct GlobalShortcutState {
  bool host_ready = false;
  bool reregister_pending = false;
  bool retry_scheduled = false;
};

GlobalShortcutState& GlobalShortcuts() {
  static GlobalShortcutState state;
  return state;
}

NSString* CharacterString(unichar character) {
  return character ? [NSString stringWithCharacters:&character length:1] : @"";
}

unichar TranslatedCharacter(int key_code, UInt32 carbon_modifiers) {
  base::apple::ScopedCFTypeRef<TISInputSourceRef> input_source(
      TISCopyCurrentKeyboardLayoutInputSource());
  UInt32 dead_key_state = 0;
  return ui::TranslatedUnicodeCharFromKeyCode(
      input_source.get(), static_cast<UInt16>(key_code), kUCKeyActionDown,
      (carbon_modifiers >> 8) & 0xFF, LMGetKbdLast(), &dead_key_state);
}

bool HotKeyIsReserved(const ui::Accelerator& accelerator) {
  const NSEventModifierFlags modifiers =
      (accelerator.IsCtrlDown() ? NSEventModifierFlagControl : 0) |
      (accelerator.IsCmdDown() ? NSEventModifierFlagCommand : 0) |
      (accelerator.IsAltDown() ? NSEventModifierFlagOption : 0) |
      (accelerator.IsShiftDown() ? NSEventModifierFlagShift : 0);
  unichar fixed_shifted = 0;
  unichar fixed_character = 0;
  const int fixed_key_code = ui::MacKeyCodeForWindowsKeyCode(
      accelerator.key_code(), modifiers & NSEventModifierFlagShift, &fixed_shifted,
      &fixed_character);
  unichar target = 0;
  ui::MacKeyCodeForWindowsKeyCode(accelerator.key_code(), 0, nullptr, &target);
  if (target >= 0xF700 && target <= 0xF8FF) {
    return HostReservesKey(CharacterString(target), CharacterString(target), modifiers);
  }
  if (!target) {
    return fixed_key_code != -1 &&
           HostReservesKey(CharacterString(fixed_shifted),
                           CharacterString(fixed_character), modifiers);
  }
  int key_code = -1;
  for (int i = 0; i < 128; ++i) {
    auto [translated, dead] = ui::NsKeyCodeAndModifiersToCharacter(i, 0);
    if (translated == target && !dead) {
      key_code = i;
      break;
    }
  }
  if (key_code == -1) {
    key_code = fixed_key_code;
  }
  if (key_code == -1) {
    return false;
  }
  const UInt32 command_layer = accelerator.IsCmdDown() ? cmdKey : 0;
  const UInt32 shift = accelerator.IsShiftDown() ? shiftKey : 0;
  return HostReservesKey(CharacterString(TranslatedCharacter(key_code, command_layer | shift)),
                         CharacterString(TranslatedCharacter(key_code, command_layer)),
                         modifiers);
}

void ReregisterGlobalShortcuts();

void RetryPendingReregister() {
  GlobalShortcuts().retry_scheduled = false;
  if (GlobalShortcuts().reregister_pending) {
    ReregisterGlobalShortcuts();
  }
}

void ReregisterGlobalShortcuts() {
  ui::GlobalAcceleratorListener* global = ui::GlobalAcceleratorListener::GetInstance();
  if (global && global->IsShortcutHandlingSuspended()) {
    GlobalShortcuts().reregister_pending = true;
    if (!GlobalShortcuts().retry_scheduled) {
      GlobalShortcuts().retry_scheduled = true;
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
          FROM_HERE, base::BindOnce(&RetryPendingReregister), base::Seconds(1));
    }
    return;
  }
  GlobalShortcuts().reregister_pending = false;
  if (!g_browser_process || !g_browser_process->profile_manager()) {
    return;
  }
  for (Profile* profile : g_browser_process->profile_manager()->GetLoadedProfiles()) {
    extensions::ArdiaReregisterGlobalCommands(profile);
  }
}

}

bool IsReservedGlobalAccelerator(const ui::Accelerator& accelerator) {
  return !GlobalShortcuts().host_ready || HotKeyIsReserved(accelerator);
}

void ReservedShortcutsChanged() {
  GlobalShortcuts().host_ready = true;
  ReregisterGlobalShortcuts();
}

void GlobalShortcutsResumed() {
  if (GlobalShortcuts().reregister_pending) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ReregisterGlobalShortcuts));
  }
}

ExtensionShortcuts::ExtensionShortcuts(Browser* browser)
    : ExtensionKeybindingRegistry(browser->GetProfile(),
                                  TabListInterface::From(browser),
                                  ALL_EXTENSIONS),
      browser_(browser) {
  Init();
}

ExtensionShortcuts::~ExtensionShortcuts() = default;

ui::Accelerator ExtensionShortcuts::AcceleratorFor(NSEvent* event) {
  return ui::GetAcceleratorFromNativeWebKeyboardEvent(
      input::NativeWebKeyboardEvent(base::apple::OwnedNSEvent(event)));
}

bool ExtensionShortcuts::Suspended() const {
  if (suspended_) {
    return true;
  }
  ui::GlobalAcceleratorListener* global =
      ui::GlobalAcceleratorListener::GetInstance();
  return global && global->IsShortcutHandlingSuspended();
}

bool ExtensionShortcuts::Matches(const ui::Accelerator& accelerator) const {
  return !Suspended() && accelerators_.contains(accelerator) &&
         !(g_ardia_reserved_accelerator && g_ardia_reserved_accelerator(accelerator));
}

bool ExtensionShortcuts::Run(const ui::Accelerator& accelerator) {
  if (!Matches(accelerator)) {
    return false;
  }
  auto action = action_accelerators_.find(accelerator);
  if (action == action_accelerators_.end()) {
    return NotifyEventTargets(accelerator);
  }
  if (accelerator.IsRepeat()) {
    return true;
  }
  content::WebContents* contents =
      browser_->GetTabStripModel()->GetActiveWebContents();
  return contents && HostExtensionActionShortcut(contents, action->second);
}

bool ExtensionShortcuts::PopulateCommands(const extensions::Extension* extension,
                                          ui::CommandMap* commands) {
  extensions::CommandService* service =
      extensions::CommandService::Get(browser_context());
  bool named = service->GetNamedCommands(
      extension->id(), extensions::CommandService::ACTIVE,
      extensions::CommandService::REGULAR, commands);
  extensions::Command action;
  bool has_action = service->GetExtensionActionCommand(
      extension->id(), extensions::ActionInfo::Type::kAction,
      extensions::CommandService::ACTIVE, &action, nullptr);
  if (has_action) {
    (*commands)[action.command_name()] = action;
  }
  return named || has_action;
}

bool ExtensionShortcuts::RegisterAccelerator(
    const ui::Accelerator& accelerator,
    const extensions::ExtensionId& extension_id,
    const std::string& command_name) {
  accelerators_.insert(accelerator);
  if (extensions::Command::IsActionRelatedCommand(command_name)) {
    action_accelerators_[accelerator] = extension_id;
  }
  return true;
}

void ExtensionShortcuts::UnregisterAccelerator(
    const ui::Accelerator& accelerator) {
  accelerators_.erase(accelerator);
  action_accelerators_.erase(accelerator);
}

void ExtensionShortcuts::OnShortcutHandlingSuspended(bool suspended) {
  suspended_ = suspended;
}

bool ExtensionShortcuts::ShouldIgnoreCommand(const std::string& command) const {
  return false;
}

void InstallExtensionShortcutDispatcher(NSWindow* window) {
  remote_cocoa::NativeWidgetNSWindowBridge* bridge =
      remote_cocoa::NativeWidgetNSWindowBridge::GetFromNSWindow(window);
  if (bridge) {
    bridge->SetCommandDispatcher([[ACExtensionShortcutDispatcher alloc] init],
                                 nil);
  }
}

}
