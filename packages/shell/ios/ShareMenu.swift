import AppKit

final class ShareMenu: NSObject, NSMenuDelegate, NSMenuItemValidation {
  static let shared = ShareMenu()
  private weak var picker: CommandItem?

  func menuHasKeyEquivalent(
    _ menu: NSMenu, for event: NSEvent, target: AutoreleasingUnsafeMutablePointer<AnyObject?>,
    action: UnsafeMutablePointer<Selector?>
  ) -> Bool {
    guard let item = menu.items.first as? CommandItem, !item.keyEquivalent.isEmpty, !MenuState.current.disabled.contains("share")
    else { return false }
    let held: NSEvent.ModifierFlags = [.command, .option, .control, .shift]
    let itemMods = item.keyEquivalentModifierMask.intersection(held)
      .union(item.keyEquivalent != item.keyEquivalent.lowercased() ? .shift : [])
    guard event.charactersIgnoringModifiers?.lowercased() == item.keyEquivalent.lowercased(),
      event.modifierFlags.intersection(held) == itemMods
    else { return false }
    picker = item
    target.pointee = self
    action.pointee = #selector(pressPicker(_:))
    return true
  }

  @objc func pressPicker(_ sender: Any?) {
    if let picker { MenuTarget.shared.performCommand(picker) }
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    let fixed = menu.items.firstIndex(where: \.isSeparatorItem).map { $0 + 1 } ?? 0
    while menu.items.count > fixed { menu.removeItem(at: fixed) }
    SharePicker.menuItems(target: self, action: #selector(share(_:)), choice: { "via:\($0)" }).forEach(menu.addItem)
  }

  @objc func share(_ sender: NSMenuItem) {
    MenuTarget.shared.dispatch("share", sender.representedObject as? String, windowId: WindowManager.shared.keyWindowId)
  }

  @objc func openSharingSettings(_ sender: Any?) {
    if let url = URL(string: "x-apple.systempreferences:com.apple.ExtensionsPreferences?extensionPointIdentifier=com.apple.share-services") {
      NSWorkspace.shared.open(url)
    }
  }

  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    item.action == #selector(openSharingSettings(_:)) || !MenuState.current.disabled.contains("share")
  }
}
