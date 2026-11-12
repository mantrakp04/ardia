import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class PointerWatcher: NSObject {
  private weak var view: NSView?
  private var area: NSTrackingArea?

  init(_ view: NSView) {
    self.view = view
    super.init()
    let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
    view.addTrackingArea(area)
    self.area = area
  }

  deinit {
    if let area { view?.removeTrackingArea(area) }
  }

  @objc(mouseMoved:) func mouseMoved(with event: NSEvent) {
    guard let window = event.window else { return }
    ServerWindowDrag.pointerMoved(in: window, at: event.locationInWindow)
  }

  @objc(mouseEntered:) func mouseEntered(with event: NSEvent) { mouseMoved(with: event) }
  @objc(mouseExited:) func mouseExited(with event: NSEvent) {}
}
