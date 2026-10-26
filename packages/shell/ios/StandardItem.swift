import AppKit

final class StandardItem: NSMenuItem, Rebindable {
  let shortcutId: String
  let defaultTitle: String
  let defaultKey: String
  let defaultModifiers: NSEvent.ModifierFlags

  init(_ title: String, _ action: Selector, key: String = "", _ mods: NSEvent.ModifierFlags = .command) {
    shortcutId = "std:" + NSStringFromSelector(action)
    defaultTitle = title
    defaultKey = key
    defaultModifiers = mods
    let shortcut = MainMenu.keyEquivalent(key, mods)
    super.init(title: title, action: action, keyEquivalent: shortcut.key)
    keyEquivalentModifierMask = shortcut.mods
    identifier = NSUserInterfaceItemIdentifier("ardia.shortcut." + shortcutId)
  }

  override init(title: String, action: Selector?, keyEquivalent: String) {
    shortcutId = "std:" + (action.map(NSStringFromSelector) ?? title)
    defaultTitle = title
    defaultKey = keyEquivalent
    defaultModifiers = .command
    super.init(title: title, action: action, keyEquivalent: keyEquivalent)
    identifier = NSUserInterfaceItemIdentifier("ardia.shortcut." + shortcutId)
  }

  required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}
