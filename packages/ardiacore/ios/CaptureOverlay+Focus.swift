import AppKit

extension CaptureOverlay {
  var holdsKeys: Bool {
    guard let focused = window?.firstResponder as? NSView else { return true }
    guard let host = superview else { return focused === self }
    return focused.isDescendant(of: host)
  }

  static func handCursorBack(in window: NSWindow?) {
    NSCursor.arrow.set()
    guard let window, let frame = window.contentView?.superview else { return }
    let point = window.mouseLocationOutsideOfEventStream
    guard let view = frame.hitTest(frame.convert(point, from: nil)),
      let update = NSEvent.enterExitEvent(
        with: .cursorUpdate, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0, trackingNumber: 0, userData: nil)
    else { return }
    window.invalidateCursorRects(for: view)
    view.cursorUpdate(with: update)
  }
}
