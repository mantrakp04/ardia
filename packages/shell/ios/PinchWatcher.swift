import AppKit

final class PinchWatcher {
  static let shared = PinchWatcher()

  var emit: ((String, [String: Any]) -> Void)?
  private var monitor: Any?
  private var total: CGFloat = 0
  private var windowId: String?
  private var lastSent: CGFloat = 0

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
    }
    guard let windowId else { return }
    total += event.magnification
    let ended = event.phase.contains(.ended) || event.phase.contains(.cancelled)
    if ended {
      emit?("onWindowEvent", ["type": "pinch", "id": windowId, "phase": event.phase.contains(.cancelled) ? "cancelled" : "ended", "total": total])
      self.windowId = nil
      total = 0
      return
    }
    guard abs(total - lastSent) >= 0.004 else { return }
    lastSent = total
    emit?("onWindowEvent", ["type": "pinch", "id": windowId, "phase": "changed", "total": total])
  }
}
