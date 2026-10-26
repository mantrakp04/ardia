import AppKit

final class CommandItem: NSMenuItem, Rebindable {
  let command: String
  let arg: String?
  let defaultTitle: String
  var windowless = false
  var tracksChecked = true
  var hidesWhenDisabled = false
  private(set) var commandAlternateOf: CommandItem?
  let defaultKey: String
  let defaultModifiers: NSEvent.ModifierFlags

  var stateKey: String { arg.map { "\(command):\($0)" } ?? command }
  var shortcutId: String { stateKey }

  init(_ title: String, _ command: String, arg: String? = nil, key: String = "", _ mods: NSEvent.ModifierFlags = .command) {
    self.command = command
    self.arg = arg
    defaultTitle = title
    defaultKey = key
    defaultModifiers = mods
    let shortcut = MainMenu.keyEquivalent(key, mods)
    super.init(title: title, action: #selector(MenuTarget.performCommand(_:)), keyEquivalent: shortcut.key)
    keyEquivalentModifierMask = shortcut.mods
    identifier = NSUserInterfaceItemIdentifier("ardia.command." + command)
    target = MenuTarget.shared
    tag = Self.chromeMenuTag
  }

  static let chromeMenuTag = 1

  required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  func hiddenShortcut() -> CommandItem {
    isHidden = true
    allowsKeyEquivalentWhenHidden = true
    return self
  }

  func hiddenWhenDisabled() -> CommandItem {
    hidesWhenDisabled = true
    allowsKeyEquivalentWhenHidden = true
    return self
  }

  func alternate() -> CommandItem {
    isAlternate = true
    return self
  }

  func commandAlternate(of primary: CommandItem) -> CommandItem {
    commandAlternateOf = primary
    isAlternate = true
    return self
  }

  func followPrimaryShortcut(bound: Set<String>) {
    guard let primary = commandAlternateOf else { return }
    let mods = primary.keyEquivalentModifierMask.union(.command)
    if keyEquivalent != primary.keyEquivalent { keyEquivalent = primary.keyEquivalent }
    if keyEquivalentModifierMask != mods { keyEquivalentModifierMask = mods }
    let collides = !primary.keyEquivalent.isEmpty && bound.contains(MainMenu.comboKey(primary.keyEquivalent, mods))
    let hidden = primary.keyEquivalentModifierMask.contains(.command) || collides
    if isHidden != hidden { isHidden = hidden }
  }
}
