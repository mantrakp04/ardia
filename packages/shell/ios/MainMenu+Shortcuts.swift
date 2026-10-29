import AppKit
import ArdiaCore

extension MainMenu {
  private static let dynamicCommands: Set<String> = [
    "openBookmark", "restoreClosed", "moveTabToProfile", "moveTabToWindow", "addBookmarkToFolder",
    "addFolderToSidebar", "restoreArcFolders",
  ]

  private static func walk(_ menu: NSMenu?, path: [String] = [], _ visit: (NSMenuItem, [String]) -> Void) {
    for item in menu?.items ?? [] where !item.isSeparatorItem {
      if let submenu = item.submenu {
        if submenu !== NSApp.servicesMenu { walk(submenu, path: path + [item.title], visit) }
      } else {
        visit(item, path)
      }
    }
  }

  private static func shortcut(of item: NSMenuItem) -> (key: String, mods: NSEvent.ModifierFlags) {
    let key = item.keyEquivalent
    guard key.count == 1, key != key.lowercased() else { return (key, item.keyEquivalentModifierMask) }
    return (key.lowercased(), item.keyEquivalentModifierMask.union(.shift))
  }

  private static func switcherItems() -> [CommandItem] {
    var items: [CommandItem] = []
    walk(NSApp.mainMenu) { item, _ in
      if let item = item as? CommandItem, item.command == "tabSwitcher", !item.keyEquivalent.isEmpty { items.append(item) }
    }
    return items
  }

  static func heldModifiers(of item: NSMenuItem) -> NSEvent.ModifierFlags {
    let mods = shortcut(of: item).mods
    let held = mods.intersection([.control, .option, .command])
    return held.isEmpty ? mods.intersection(.shift) : held
  }

  static func isSwitcherKey(_ event: NSEvent) -> Bool {
    var key = (event.charactersIgnoringModifiers ?? "").lowercased()
    if key == "\u{19}" { key = "\t" }
    let mods = event.modifierFlags.intersection([.control, .option, .command, .shift])
    return switcherItems().contains { item in
      let combo = shortcut(of: item)
      return combo.key.lowercased() == key && combo.mods.intersection([.control, .option, .command]) == mods.subtracting(.shift)
    }
  }

  static func functionKey(_ key: Int) -> String { String(Character(UnicodeScalar(UInt16(key))!)) }
  static let leftArrow = functionKey(NSLeftArrowFunctionKey), rightArrow = functionKey(NSRightArrowFunctionKey)
  private static let caretArrows: Set<String> = [
    leftArrow, rightArrow, functionKey(NSUpArrowFunctionKey), functionKey(NSDownArrowFunctionKey),
  ]

  static func movesCaret(_ item: NSMenuItem) -> Bool {
    let mods = item.keyEquivalentModifierMask.intersection([.command, .shift, .option, .control])
    return caretArrows.contains(item.keyEquivalent) && (mods == .command || mods == [.command, .shift])
  }

  static func editsText(_ responder: NSResponder?) -> Bool {
    if responder is NSText { return true }
    let textInputType = NSSelectorFromString("textInputType")
    guard let page = responder, FocusHandoff.isPage(page), page.responds(to: textInputType) else { return false }
    typealias Getter = @convention(c) (AnyObject, Selector) -> Int32
    return unsafeBitCast(page.method(for: textInputType), to: Getter.self)(page, textInputType) != 0
  }

  private struct ShortcutGroup {
    var primary: Rebindable
    var path: [String]
    var items: [Rebindable]
  }

  private static func shortcutGroups() -> [(id: String, group: ShortcutGroup)] {
    var order: [String] = []
    var groups: [String: ShortcutGroup] = [:]
    walk(NSApp.mainMenu) { item, path in
      guard let item = item as? Rebindable, (item as? CommandItem)?.commandAlternateOf == nil else { return }
      let id = item.shortcutId
      if var group = groups[id] {
        group.items.append(item)
        if group.primary.isHidden && !item.isHidden { group.primary = item; group.path = path }
        groups[id] = group
      } else {
        order.append(id)
        groups[id] = ShortcutGroup(primary: item, path: path, items: [item])
      }
    }
    return order.map { ($0, groups[$0]!) }
  }

  static func setShortcut(_ item: NSMenuItem, _ key: String, _ mods: NSEvent.ModifierFlags) {
    let shortcut = keyEquivalent(key, key.isEmpty ? [] : mods)
    if item.keyEquivalent != shortcut.key { item.keyEquivalent = shortcut.key }
    if item.keyEquivalentModifierMask != shortcut.mods { item.keyEquivalentModifierMask = shortcut.mods }
  }

  static func setShortcut(_ item: NSMenuItem, _ stored: [String]?) {
    setShortcut(item, stored?.first ?? "", ModifierName.flags(named: stored?.dropFirst() ?? []))
  }

  private static func isDefault(_ stored: [String], of item: Rebindable) -> Bool {
    let bound = keyEquivalent(stored.first ?? "", ModifierName.flags(named: stored.dropFirst()))
    let fallback = keyEquivalent(item.defaultKey, item.defaultModifiers)
    return !item.defaultKey.isEmpty && bound.key == fallback.key && bound.mods == fallback.mods
  }

  private static var announcedShortcuts: [String]?

  private static func announceShortcuts() {
    guard MenuState.current.fromApp else { return }
    var bound: [String] = []
    walk(NSApp.mainMenu) { item, _ in
      if item is Rebindable { bound.append("\(item.identifier?.rawValue ?? "")=\(item.keyEquivalent)|\(item.keyEquivalentModifierMask.rawValue)") }
    }
    if bound != announcedShortcuts {
      announcedShortcuts = bound
      ArdiaHost.menuShortcutsChanged()
    }
  }

  static func applyShortcuts(_ bindings: [String: [[String]]]) {
    defer { announceShortcuts() }
    for (id, group) in shortcutGroups() {
      guard let bound = bindings[id] else {
        group.items.forEach { setShortcut($0, $0.defaultKey, $0.defaultModifiers) }
        continue
      }
      for item in group.items {
        if item === group.primary || !item.isHidden {
          setShortcut(item, bound.first)
        } else {
          setShortcut(item, bound.dropFirst().first { isDefault($0, of: item) })
        }
      }
    }
    for case let item as CommandItem in profiles.items where item.commandAlternateOf != nil {
      item.applyAlternate(bindings[item.shortcutId] ?? [])
    }
  }

  static func shortcutList() -> [[String: Any]] {
    var list: [[String: Any]] = []
    for (id, group) in shortcutGroups() {
      let item = group.primary
      if let command = item as? CommandItem, dynamicCommands.contains(command.command) { continue }
      guard !item.defaultTitle.isEmpty else { continue }
      list.append(["id": id, "title": item.defaultTitle, "path": group.path, "remappable": true])
    }
    var seen = Set<String>()
    walk(NSApp.mainMenu) { item, path in
      guard !(item is Rebindable), !item.isHidden, !item.title.isEmpty, !item.keyEquivalent.isEmpty, item.action != nil else { return }
      let id = "system:" + (path + [item.title]).joined(separator: " > ")
      guard seen.insert(id).inserted else { return }
      let current = shortcut(of: item)
      list.append([
        "id": id, "title": item.title, "path": path, "remappable": false, "key": current.key,
        "modifiers": ModifierName.names(current.mods),
      ])
    }
    return list
  }
}
