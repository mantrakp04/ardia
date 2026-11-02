#import "ArdiaChromeWindowInternal.h"
#import "ArdiaWindowController.h"

#import <objc/message.h>

using namespace ardia_window;

namespace {

NSString *const kQuitIdentifier = @"ardia.shortcut.std:quit:";
NSString *const kFullScreenIdentifier = @"ardia.shortcut.std:toggleFullScreen:";

NSSet<NSString *> *ReservedIdentifiers() {
  static NSSet<NSString *> *reserved = [NSSet setWithArray:@[
    @"ardia.command.closeTab", @"ardia.shortcut.std:closeWindow:", @"ardia.command.newIncognitoWindow", @"ardia.command.newTab",
    @"ardia.command.newWindow", @"ardia.command.reopenClosedTab", @"ardia.command.nextTab", @"ardia.command.previousTab",
    @"ardia.command.tabSwitcher", kQuitIdentifier, @"ardia.command.copyUrl", @"ardia.command.devTools", @"ardia.command.toggleDevTools",
    @"ardia.command.searchTabs"
  ]];
  return reserved;
}

NSSet<NSString *> *ReservedIdentifiersInFullScreenShowingBrowser() {
  static NSSet<NSString *> *reserved = [ReservedIdentifiers() setByAddingObject:kFullScreenIdentifier];
  return reserved;
}

NSSet<NSString *> *ReservedIdentifiersInFullScreenShowingPage() {
  static NSSet<NSString *> *reserved = [NSSet setWithArray:@[ kQuitIdentifier, kFullScreenIdentifier ]];
  return reserved;
}

bool ShowsBrowserInFullScreen(NSWindow *window) {
  ArdiaCoreWindow *coreWindow = [ArdiaWindowController forNSWindow:window].coreWindow;
  return coreWindow && ![ArdiaWindowFullScreen ofWindow:coreWindow create:NO].pageFullScreen;
}

NSSet<NSString *> *ReservedIdentifiersIn(NSWindow *window) {
  if (!IsWindowFullScreen(window)) return ReservedIdentifiers();
  return ShowsBrowserInFullScreen(window) ? ReservedIdentifiersInFullScreenShowingBrowser() : ReservedIdentifiersInFullScreenShowingPage();
}

constexpr NSEventModifierFlags kKeyModifiers =
    NSEventModifierFlagCommand | NSEventModifierFlagShift | NSEventModifierFlagOption | NSEventModifierFlagControl | NSEventModifierFlagFunction;

bool IsFunctionKey(NSString *key) {
  const unichar first = key.length ? [key characterAtIndex:0] : 0;
  return first >= 0xF700 && first <= 0xF8FF;
}

NSEventModifierFlags ModifiersOfKey(NSString *key, NSEventModifierFlags mods) {
  mods &= kKeyModifiers;
  return IsFunctionKey(key) ? mods & ~NSEventModifierFlagFunction : mods;
}

NSMenuItem *MenuItemWithIdentifier(NSMenu *menu, NSString *key, NSEventModifierFlags mods, NSSet<NSString *> *identifiers) {
  const NSEventModifierFlags wanted = ModifiersOfKey(key, mods);
  for (NSMenuItem *item in menu.itemArray) {
    if (item.submenu) {
      if (item.submenu == NSApp.servicesMenu) continue;
      if (NSMenuItem *found = MenuItemWithIdentifier(item.submenu, key, mods, identifiers)) return found;
      continue;
    }
    if (!item.identifier || ![identifiers containsObject:item.identifier] || !item.keyEquivalent.length || item.isAlternate) continue;
    if (item.isHidden && !item.allowsKeyEquivalentWhenHidden) continue;
    NSEventModifierFlags itemMods = ModifiersOfKey(item.keyEquivalent, item.keyEquivalentModifierMask);
    if (![item.keyEquivalent isEqualToString:item.keyEquivalent.lowercaseString]) itemMods |= NSEventModifierFlagShift;
    if (itemMods == wanted && [item.keyEquivalent.lowercaseString isEqualToString:key]) return item;
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
  const bool fKey = first >= NSF1FunctionKey && first <= NSF35FunctionKey;
  const bool globeKey = (mods & NSEventModifierFlagFunction) && !IsFunctionKey(key);
  if (!fKey && !globeKey && !(mods & (NSEventModifierFlagCommand | NSEventModifierFlagControl))) return nil;
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
  return MenuItemForEvent(event, ReservedIdentifiersIn(event.window));
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
  const bool typing = [focused isKindOfClass:NSView.class] && [ArdiaCorePageView isEditingText:(NSView *)focused];
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
