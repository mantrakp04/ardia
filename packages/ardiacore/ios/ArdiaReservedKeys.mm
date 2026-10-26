#import "ArdiaChromeWindowInternal.h"

#import <objc/message.h>

using namespace ardia_window;

namespace {

NSSet<NSString *> *ReservedIdentifiers() {
  static NSSet<NSString *> *reserved = [NSSet setWithArray:@[
    @"ardia.command.newTab", @"ardia.command.reopenClosedTab", @"ardia.command.closeTab", @"ardia.command.newWindow",
    @"ardia.command.newIncognitoWindow", @"ardia.command.tabSwitcher", @"ardia.command.nextTab", @"ardia.command.previousTab",
    @"ardia.shortcut.std:closeWindow:", @"ardia.shortcut.std:quit:"
  ]];
  return reserved;
}

NSMenuItem *MenuItemWithIdentifier(NSMenu *menu, NSString *key, NSEventModifierFlags mods, NSSet<NSString *> *reserved) {
  const NSEventModifierFlags relevant = NSEventModifierFlagCommand | NSEventModifierFlagShift | NSEventModifierFlagOption | NSEventModifierFlagControl;
  for (NSMenuItem *item in menu.itemArray) {
    if (item.submenu) {
      if (item.submenu == NSApp.servicesMenu) continue;
      if (NSMenuItem *found = MenuItemWithIdentifier(item.submenu, key, mods, reserved)) return found;
      continue;
    }
    if (!item.identifier || ![reserved containsObject:item.identifier] || !item.keyEquivalent.length) continue;
    if (item.isHidden && !item.allowsKeyEquivalentWhenHidden) continue;
    NSEventModifierFlags itemMods = item.keyEquivalentModifierMask & relevant;
    if (![item.keyEquivalent isEqualToString:item.keyEquivalent.lowercaseString]) itemMods |= NSEventModifierFlagShift;
    if (itemMods == (mods & relevant) && [item.keyEquivalent.lowercaseString isEqualToString:key]) return item;
  }
  return nil;
}

NSMenuItem *ReservedMenuItem(NSMenu *menu, NSString *key, NSEventModifierFlags mods) {
  return MenuItemWithIdentifier(menu, key, mods, ReservedIdentifiers());
}

NSMenuItem *MenuItemForEvent(NSEvent *event, NSSet<NSString *> *identifiers) {
  const NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  NSString *key = event.charactersIgnoringModifiers.lowercaseString;
  const unichar first = key.length ? [key characterAtIndex:0] : 0;
  const bool functionKey = first >= NSF1FunctionKey && first <= NSF35FunctionKey;
  if (!functionKey && !(mods & (NSEventModifierFlagCommand | NSEventModifierFlagControl))) return nil;
  if ([key isEqualToString:@"\x19"]) key = @"\t";
  if (NSMenuItem *item = MenuItemWithIdentifier(NSApp.mainMenu, key, mods, identifiers)) return item;
  NSString *unshifted = [event charactersByApplyingModifiers:0].lowercaseString;
  if (!unshifted.length || [unshifted isEqualToString:key]) return nil;
  return MenuItemWithIdentifier(NSApp.mainMenu, unshifted, mods, identifiers);
}

struct SidebarKeyPress {
  NSTimeInterval at = 0;
  NSInteger window = 0;
};

SidebarKeyPress gSidebarKeyPressForPage;

bool IsSidebarKey(NSEvent *event) {
  static NSSet<NSString *> *sidebar = [NSSet setWithObject:@"ardia.command.toggleSidebar"];
  return event.type == NSEventTypeKeyDown && MenuItemForEvent(event, sidebar) != nil;
}

}

namespace ardia_window {

NSMenuItem *ReservedMenuItemForEvent(NSEvent *event) {
  return MenuItemForEvent(event, ReservedIdentifiers());
}

bool IsReservedKey(NSEvent *event) {
  return ReservedMenuItemForEvent(event) != nil;
}

bool IsSecondSidebarKeyPress(NSEvent *event) {
  if (!IsSidebarKey(event) || event.isARepeat) return false;
  const SidebarKeyPress first = gSidebarKeyPressForPage;
  const bool second = first.at > 0 && first.window == event.windowNumber && event.timestamp - first.at <= NSEvent.doubleClickInterval;
  gSidebarKeyPressForPage = second ? SidebarKeyPress{} : SidebarKeyPress{event.timestamp, event.windowNumber};
  return second;
}

bool KeepsUnhandledSidebarKeyInPage(NSWindow *window, NSEvent *event) {
  if (!IsSidebarKey(event)) return false;
  NSResponder *focused = window.firstResponder;
  const SEL textInputType = NSSelectorFromString(@"textInputType");
  const bool typing = [NSStringFromClass(focused.class) isEqualToString:@"RenderWidgetHostViewCocoa"] && [focused respondsToSelector:textInputType] &&
                      ((int (*)(id, SEL))objc_msgSend)(focused, textInputType) != 0;
  if (!typing) gSidebarKeyPressForPage = SidebarKeyPress{};
  return typing;
}

}

namespace ardia_host {

bool IsReservedKeyEvent(NSEvent *event) {
  return IsReservedKey(event);
}

bool IsReservedBinding(NSString *key, NSString *unshiftedKey, NSEventModifierFlags modifiers) {
  if (key.length && ReservedMenuItem(NSApp.mainMenu, key.lowercaseString, modifiers)) return true;
  return unshiftedKey.length && ReservedMenuItem(NSApp.mainMenu, unshiftedKey.lowercaseString, modifiers);
}

}
