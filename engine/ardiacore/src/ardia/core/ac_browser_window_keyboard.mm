#include "ardia/core/ac_browser_window.h"

#import <AppKit/AppKit.h>

#include "components/input/native_web_keyboard_event.h"
#include "content/public/browser/keyboard_event_processing_result.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_extension_shortcuts.h"
#import "ardia/core/ardiacore_internal.h"
#include "ui/base/accelerators/accelerator.h"
#include "ui/content_accelerators/accelerator_util.h"

namespace ardiacore {

bool ACBrowserWindow::HandleExtensionKeyEquivalent(NSEvent* event) {
  if (!extension_shortcuts_ || !host_ || event.type != NSEventTypeKeyDown) {
    return false;
  }
  const ui::Accelerator accelerator = ExtensionShortcuts::AcceleratorFor(event);
  return extension_shortcuts_->Run(accelerator);
}

namespace {

bool MenuHasKeyEquivalent(NSMenu* menu, NSEvent* event) {
  const NSEventModifierFlags mask =
      NSEventModifierFlagCommand | NSEventModifierFlagOption |
      NSEventModifierFlagControl | NSEventModifierFlagShift;
  const NSEventModifierFlags flags = event.modifierFlags & mask;
  NSString* chars = event.charactersIgnoringModifiers.lowercaseString;
  for (NSMenuItem* item in menu.itemArray) {
    if (item.hasSubmenu) {
      if (MenuHasKeyEquivalent(item.submenu, event)) {
        return true;
      }
      continue;
    }
    NSString* key = item.keyEquivalent;
    if (!key.length) {
      continue;
    }
    NSEventModifierFlags item_flags = item.keyEquivalentModifierMask & mask;
    if (![key isEqualToString:key.lowercaseString]) {
      item_flags |= NSEventModifierFlagShift;
    }
    if (item_flags == flags && [key.lowercaseString isEqualToString:chars]) {
      return true;
    }
  }
  return false;
}

NSEvent* UnhandledKeyDown(const input::NativeWebKeyboardEvent& event) {
  if (event.skip_if_unhandled ||
      event.GetType() == input::NativeWebKeyboardEvent::Type::kChar) {
    return nil;
  }
  NSEvent* ns_event = event.os_event.Get();
  return ns_event.type == NSEventTypeKeyDown ? ns_event : nil;
}

}

content::KeyboardEventProcessingResult ACBrowserWindow::PreHandleKeyboardEvent(
    const input::NativeWebKeyboardEvent& event) {
  NSEvent* ns_event = event.os_event.Get();
  if (!ns_event || ns_event.type != NSEventTypeKeyDown || !host_) {
    return content::KeyboardEventProcessingResult::NOT_HANDLED;
  }
  ArdiaCoreWindow* owner = host_->owner();
  id<ArdiaCoreWindowDelegate> delegate = owner.delegate;
  if ([delegate respondsToSelector:@selector(window:preHandleKeyEvent:)] &&
      [delegate window:owner preHandleKeyEvent:ns_event]) {
    return content::KeyboardEventProcessingResult::HANDLED;
  }
  if (extension_shortcuts_ &&
      extension_shortcuts_->Run(ui::GetAcceleratorFromNativeWebKeyboardEvent(event))) {
    return content::KeyboardEventProcessingResult::HANDLED;
  }
  if ((ns_event.modifierFlags & NSEventModifierFlagCommand) &&
      MenuHasKeyEquivalent(NSApp.mainMenu, ns_event)) {
    return content::KeyboardEventProcessingResult::NOT_HANDLED_IS_SHORTCUT;
  }
  return content::KeyboardEventProcessingResult::NOT_HANDLED;
}

bool ACBrowserWindow::HandleKeyboardEvent(
    const input::NativeWebKeyboardEvent& event) {
  NSEvent* ns_event = UnhandledKeyDown(event);
  if (!ns_event || !host_) {
    return false;
  }
  ArdiaCoreWindow* owner = host_->owner();
  id<ArdiaCoreWindowDelegate> delegate = owner.delegate;
  if ([delegate respondsToSelector:@selector(window:handleKeyEvent:)] &&
      [delegate window:owner handleKeyEvent:ns_event]) {
    return true;
  }
  if (!(ns_event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl |
                                  NSEventModifierFlagFunction))) {
    return false;
  }
  return [NSApp.mainMenu performKeyEquivalent:ns_event];
}

}
