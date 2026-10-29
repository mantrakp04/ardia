import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

let installWindowMoveFallback: Void = {
  guard WindowMove.replacesNativeDrag else { return }
  let selector = #selector(NSWindow.performDrag(with:))
  guard let method = class_getInstanceMethod(NSWindow.self, selector) else { return }
  typealias PerformDrag = @convention(c) (NSWindow, Selector, NSEvent) -> Void
  let original = unsafeBitCast(method_getImplementation(method), to: PerformDrag.self)
  let block: @convention(block) (NSWindow, NSEvent) -> Void = { window, event in
    if WindowMove.windowServerMoves(window, from: event) { return }
    if !WindowMove.follow(window, from: event) { original(window, selector, event) }
  }
  method_setImplementation(method, imp_implementationWithBlock(block))
}()

enum WindowMove {
  static let replacesNativeDrag = ProcessInfo.processInfo.isOperatingSystemAtLeast(OperatingSystemVersion(majorVersion: 27, minorVersion: 0, patchVersion: 0))
  private static var following = false
  private static let staleAfter: TimeInterval = 0.012

  static func windowServerMoves(_ window: NSWindow, from event: NSEvent) -> Bool {
    event.type == .leftMouseDown && event.clickCount < 2 && event.window === window && window.isMovable
      && !window.styleMask.contains(.fullScreen) && ServerWindowDrag.serverOwnsPress(window, at: event.locationInWindow)
  }

  static func follow(_ window: NSWindow, from event: NSEvent) -> Bool {
    guard !following, event.type == .leftMouseDown, event.clickCount < 2,
          window.isMovable, !window.styleMask.contains(.fullScreen), window.isVisible
    else { return false }
    following = true
    defer { following = false }
    let start = screenPoint(event)
    let origin = window.frame.origin
    var wasActive = NSApp.isActive
    func move(to event: NSEvent) {
      let target = place(window, origin, start, screenPoint(event))
      guard !near(window.frame.origin, target) else { return }
      window.setFrameOrigin(target)
    }
    while window.isVisible {
      if NSApp.isActive { wasActive = true } else if wasActive { return true }
      guard var next = nextGestureEvent() else {
        if NSEvent.pressedMouseButtons & 1 == 0 { return true }
        continue
      }
      var latest: NSEvent?
      while next.type == .leftMouseDragged, next.windowNumber == window.windowNumber {
        latest = next
        guard ProcessInfo.processInfo.systemUptime - next.timestamp > staleAfter,
              let queued = NSApp.nextEvent(matching: gestureEvents, until: .distantPast, inMode: .eventTracking, dequeue: true)
        else { break }
        next = queued
      }
      if next.type == .leftMouseUp, next.windowNumber == window.windowNumber { latest = next }
      if let latest { move(to: latest) }
      if next.type != .leftMouseDragged || next.windowNumber != window.windowNumber {
        NSApp.postEvent(next, atStart: true)
        return true
      }
    }
    return true
  }

  private static let gestureEvents: NSEvent.EventTypeMask = [.leftMouseDown, .leftMouseDragged, .leftMouseUp]

  private static func nextGestureEvent() -> NSEvent? {
    let pressed = NSEvent.pressedMouseButtons & 1 != 0
    return NSApp.nextEvent(matching: gestureEvents, until: pressed ? Date(timeIntervalSinceNow: 0.1) : .distantPast, inMode: .eventTracking, dequeue: true)
  }

  private static func place(_ window: NSWindow, _ origin: NSPoint, _ start: NSPoint, _ pointer: NSPoint) -> NSPoint {
    let target = NSRect(origin: NSPoint(x: origin.x + pointer.x - start.x, y: origin.y + pointer.y - start.y), size: window.frame.size)
    guard let screen = NSScreen.screens.first(where: { NSMouseInRect(pointer, $0.frame, false) }) ?? window.screen else { return NSPoint(x: target.minX.rounded(), y: target.minY.rounded()) }
    let constrained = window.constrainFrameRect(target, to: screen)
    return NSPoint(x: constrained.minX.rounded(), y: (constrained.maxY - target.height).rounded())
  }

  private static func screenPoint(_ event: NSEvent) -> NSPoint {
    guard let location = event.cgEvent?.location, let primary = NSScreen.screens.first else { return NSEvent.mouseLocation }
    return NSPoint(x: location.x, y: primary.frame.maxY - location.y)
  }

  private static func near(_ a: NSPoint, _ b: NSPoint) -> Bool { abs(a.x - b.x) < 0.5 && abs(a.y - b.y) < 0.5 }
}
