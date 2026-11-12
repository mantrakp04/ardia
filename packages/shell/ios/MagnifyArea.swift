import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class MagnifyArea: ExpoView {
  let onMagnify = EventDispatcher()
  var enabled = true
  private static let areas = NSHashTable<MagnifyArea>.weakObjects()
  private static weak var owner: MagnifyArea?
  private static var claimed = false
  private static var total = 0.0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    _ = installMagnifyMonitor
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { Self.areas.add(self) } else { Self.areas.remove(self) }
  }

  private static func area(at location: NSPoint, in window: NSWindow) -> MagnifyArea? {
    guard let hit = window.contentView?.superview?.hitTest(location) else { return nil }
    return areas.allObjects.first { $0.enabled && $0.window === window && !$0.isHiddenOrHasHiddenAncestor && hit.isDescendant(of: $0) }
  }

  static func route(window: NSWindow?, location: NSPoint, phase: NSEvent.Phase, magnification: Double) -> Bool {
    if phase.contains(.began) {
      owner = window.flatMap { area(at: location, in: $0) }
      claimed = owner != nil
      total = 0
    }
    guard claimed else { return false }
    total += magnification
    let finished = phase.contains(.ended) || phase.contains(.cancelled)
    let name = phase.contains(.ended) ? "ended" : phase.contains(.cancelled) ? "cancelled" : phase.contains(.began) ? "began" : "changed"
    owner?.onMagnify(["phase": name, "magnification": total])
    if finished {
      owner = nil
      claimed = false
    }
    return true
  }

  static func devMagnify(windowId: String, x: Double, y: Double, steps: [[String: Any]]) -> [String: Any] {
    guard let window = WindowManager.shared.window(windowId), let content = window.contentView else { return ["error": "no window \(windowId)"] }
    let location = content.convert(SyntheticInput.contentPoint(x: x, top: y, in: content), to: nil)
    let hit = content.superview?.hitTest(location)
    let phases: [String: NSEvent.Phase] = ["began": .began, "changed": .changed, "ended": .ended, "cancelled": .cancelled]
    var claims: [Bool] = []
    for step in steps {
      let phase = phases[step["phase"] as? String ?? ""] ?? .changed
      claims.append(route(window: window, location: location, phase: phase, magnification: step["magnification"] as? Double ?? 0))
    }
    return ["claimed": claims, "hit": hit.map { String(describing: type(of: $0)) } ?? "nil"]
  }
}

let installMagnifyMonitor: Void = {
  _ = NSEvent.addLocalMonitorForEvents(matching: [.magnify]) { event in
    MagnifyArea.route(window: event.window, location: event.locationInWindow, phase: event.phase, magnification: Double(event.magnification)) ? nil : event
  }
}()
