import AppKit
import ArdiaCore

extension MainMenu {
  private static let modifierNames: [(String, NSEvent.ModifierFlags)] = [
    ("control", .control), ("option", .option), ("shift", .shift), ("command", .command), ("function", .function),
  ]
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

  private static func modifiers(_ names: some Sequence<String>) -> NSEvent.ModifierFlags {
    let names = Set(names)
    return NSEvent.ModifierFlags(modifierNames.filter { names.contains($0.0) }.map(\.1))
  }

  static func comboKey(_ key: String, _ mods: NSEvent.ModifierFlags) -> String {
    let relevant = mods.intersection([.control, .option, .shift, .command, .function])
    let shift: NSEvent.ModifierFlags = key != key.lowercased() ? .shift : []
    return "\(key.lowercased())|\(relevant.union(shift).rawValue)"
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

  private static func setShortcut(_ item: NSMenuItem, _ key: String, _ mods: NSEvent.ModifierFlags) {
    let shortcut = keyEquivalent(key, key.isEmpty ? [] : mods)
    if item.keyEquivalent != shortcut.key { item.keyEquivalent = shortcut.key }
    if item.keyEquivalentModifierMask != shortcut.mods { item.keyEquivalentModifierMask = shortcut.mods }
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
      NotificationCenter.default.post(name: .ardiaMenuShortcutsChanged, object: nil)
    }
  }

  static func applyShortcuts(_ overrides: [String: [String]]) {
    defer { announceShortcuts() }
    let groups = shortcutGroups()
    let liveIds = Set(groups.map(\.id))
    let taken = Set(overrides.compactMap { id, o -> String? in
      guard liveIds.contains(id), let key = o.first, !key.isEmpty else { return nil }
      return comboKey(key, modifiers(o.dropFirst()))
    })
    for (id, group) in groups {
      let carriesOverride: (Rebindable) -> Bool = { $0 === group.primary || !$0.isHidden }
      for item in group.items {
        if let o = overrides[id] {
          if carriesOverride(item) { setShortcut(item, o.first ?? "", modifiers(o.dropFirst())) } else { setShortcut(item, "", []) }
        } else if !item.defaultKey.isEmpty, taken.contains(comboKey(item.defaultKey, item.defaultModifiers)) {
          setShortcut(item, "", [])
        } else {
          setShortcut(item, item.defaultKey, item.defaultModifiers)
        }
      }
    }
    var bound = Set<String>()
    walk(NSApp.mainMenu) { item, _ in
      guard !item.keyEquivalent.isEmpty, (item as? CommandItem)?.commandAlternateOf == nil else { return }
      bound.insert(comboKey(item.keyEquivalent, item.keyEquivalentModifierMask))
    }
    for case let item as CommandItem in profiles.items { item.followPrimaryShortcut(bound: bound) }
  }

  static func shortcutList() -> [[String: Any]] {
    var list: [[String: Any]] = []
    func names(_ mods: NSEvent.ModifierFlags) -> [String] {
      modifierNames.filter { mods.contains($0.1) }.map(\.0)
    }
    for (id, group) in shortcutGroups() {
      let item = group.primary
      if let command = item as? CommandItem, dynamicCommands.contains(command.command) { continue }
      guard !item.defaultTitle.isEmpty else { continue }
      let current = shortcut(of: item)
      let defaultCombo = comboKey(item.defaultKey, item.defaultModifiers)
      var aliases: [[String]] = []
      var seen: Set<String> = [defaultCombo]
      for other in group.items where other !== item && !other.defaultKey.isEmpty {
        if seen.insert(comboKey(other.defaultKey, other.defaultModifiers)).inserted {
          aliases.append([other.defaultKey] + names(other.defaultModifiers))
        }
      }
      list.append([
        "id": id, "title": item.defaultTitle, "path": group.path, "key": current.key,
        "modifiers": current.key.isEmpty ? [] : names(current.mods), "defaultKey": item.defaultKey,
        "defaultModifiers": item.defaultKey.isEmpty ? [] : names(item.defaultModifiers), "remappable": true,
        "aliases": aliases,
      ])
    }
    var seen = Set<String>()
    walk(NSApp.mainMenu) { item, path in
      guard !(item is Rebindable), !item.isHidden, !item.title.isEmpty, !item.keyEquivalent.isEmpty, item.action != nil else { return }
      let id = "system:" + (path + [item.title]).joined(separator: " > ")
      guard seen.insert(id).inserted else { return }
      let current = shortcut(of: item)
      let mods = names(current.mods)
      list.append([
        "id": id, "title": item.title, "path": path, "key": current.key, "modifiers": mods,
        "defaultKey": current.key, "defaultModifiers": mods, "remappable": false, "aliases": [[String]](),
      ])
    }
    return list
  }
}
