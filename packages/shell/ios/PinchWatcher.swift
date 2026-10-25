import AppKit

final class PinchWatcher {
  static let shared = PinchWatcher()

  var emit: ((String, [String: Any]) -> Void)?
  private var monitor: Any?
  private var total: CGFloat = 0
  private var windowId: String?
  private var lastSent: CGFloat = 0
  private var onPage = false

  func watch(_ on: Bool) {
    if on, monitor == nil {
      monitor = NSEvent.addLocalMonitorForEvents(matching: .magnify) { [weak self] event in
        self?.track(event)
        return event
      }
    } else if !on, let monitor {
      NSEvent.removeMonitor(monitor)
      self.monitor = nil
    }
  }

  private func track(_ event: NSEvent) {
    if event.phase.contains(.began) {
      total = 0
      lastSent = 0
      windowId = event.window.flatMap { WindowManager.shared.id(of: $0) }
      onPage = Self.overPage(event)
    }
    guard let windowId else { return }
    total += event.magnification
    let ended = event.phase.contains(.ended) || event.phase.contains(.cancelled)
    if ended {
      emit?("onWindowEvent", ["type": "pinch", "id": windowId, "phase": event.phase.contains(.cancelled) ? "cancelled" : "ended", "total": total, "onPage": onPage])
      self.windowId = nil
      total = 0
      return
    }
    guard abs(total - lastSent) >= 0.004 else { return }
    lastSent = total
    emit?("onWindowEvent", ["type": "pinch", "id": windowId, "phase": "changed", "total": total, "onPage": onPage])
  }

  private static func overPage(_ event: NSEvent) -> Bool {
    guard let window = event.window, let root = window.contentView?.superview ?? window.contentView else { return false }
    var view = root.hitTest(event.locationInWindow)
    while let current = view {
      let name = String(describing: type(of: current))
      if name == "ArdiaCoreWebView" || name == "RenderWidgetHostViewCocoa" { return true }
      view = current.superview
    }
    return false
  }
}
