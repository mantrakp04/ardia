import AppKit

final class StandardItem: NSMenuItem, Rebindable {
  let shortcutId: String
  let defaultTitle: String
  let defaultKey: String
  let defaultModifiers: NSEvent.ModifierFlags

  convenience init(_ title: String, _ action: Selector) {
    let key = CommandTable.keys["std:" + NSStringFromSelector(action)]?.first
    self.init(title, action, key: key?.key ?? "", key?.mods ?? .command)
  }

  init(_ title: String, _ action: Selector, key: String, _ mods: NSEvent.ModifierFlags) {
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

  func aliasItems() -> [StandardItem] {
    guard let action else { return [] }
    return (CommandTable.keys[shortcutId] ?? []).dropFirst().map {
      let item = StandardItem(defaultTitle, action, key: $0.key, $0.mods)
      item.target = target
      item.isHidden = true
      item.allowsKeyEquivalentWhenHidden = true
      return item
    }
  }

  required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}
