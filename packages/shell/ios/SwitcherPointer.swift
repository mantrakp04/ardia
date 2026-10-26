import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class SwitcherPointer {
  private let lock = NSLock()
  private var origin: NSPoint?
  private var hasMoved = false

  func start(_ point: NSPoint?) {
    lock.lock()
    origin = point
    hasMoved = false
    lock.unlock()
  }

  func moved(to point: NSPoint) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard let origin else { return true }
    if hypot(point.x - origin.x, point.y - origin.y) >= 1 { hasMoved = true }
    return hasMoved
  }
}
