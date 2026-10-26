import AppKit

final class ShareMenu: NSObject, NSMenuDelegate, NSMenuItemValidation {
  static let shared = ShareMenu()

  func menuHasKeyEquivalent(
    _ menu: NSMenu, for event: NSEvent, target: AutoreleasingUnsafeMutablePointer<AnyObject?>,
    action: UnsafeMutablePointer<Selector?>
  ) -> Bool {
    false
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    SharePicker.menuItems(target: self, action: #selector(share(_:)), choice: { "via:\($0)" }).forEach(menu.addItem)
  }

  @objc func share(_ sender: NSMenuItem) {
    MenuTarget.shared.handler?("share", sender.representedObject as? String, WindowManager.shared.keyWindowId)
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
