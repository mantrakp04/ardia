import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class ContextMenuArea: ExpoView {
  let onContextMenu = EventDispatcher()
  var captureDescendants = false

  override func hitTest(_ point: NSPoint) -> NSView? {
    let hit = super.hitTest(point)
    guard captureDescendants, hit != nil, let event = NSApp.currentEvent else { return hit }
    let secondary = event.type == .rightMouseDown || (event.type == .leftMouseDown && event.modifierFlags.contains(.control))
    return secondary ? self : hit
  }

  override func rightMouseDown(with event: NSEvent) {
    onContextMenu([:])
  }

  override func mouseDown(with event: NSEvent) {
    if event.modifierFlags.contains(.control) {
      onContextMenu([:])
      return
    }
    super.mouseDown(with: event)
  }

  override func menu(for event: NSEvent) -> NSMenu? { nil }
}
