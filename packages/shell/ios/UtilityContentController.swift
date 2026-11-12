import AppKit

final class UtilityContentController: NSViewController {
  override func mouseDown(with event: NSEvent) {
    if canMoveWindow(event) { super.mouseDown(with: event) }
  }

  private func canMoveWindow(_ event: NSEvent) -> Bool {
    guard let frame = view.window?.contentView?.superview, var at = frame.hitTest(event.locationInWindow) else { return true }
    while at !== view {
      if !at.mouseDownCanMoveWindow { return false }
      guard let parent = at.superview else { return true }
      at = parent
    }
    return true
  }
}
