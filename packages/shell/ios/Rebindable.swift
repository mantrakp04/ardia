import AppKit

protocol Rebindable: NSMenuItem {
  var shortcutId: String { get }
  var defaultTitle: String { get }
  var defaultKey: String { get }
  var defaultModifiers: NSEvent.ModifierFlags { get }
}
