import AppKit
import ArdiaCore
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
  if WindowMove.holdsPlacement { WindowMove.holdAppKitPlacement() }
}()

enum WindowMove {
  static let replacesNativeDrag = ProcessInfo.processInfo.isOperatingSystemAtLeast(OperatingSystemVersion(majorVersion: 27, minorVersion: 0, patchVersion: 0))
  private static var following = false
  private static weak var moving: NSWindow?
  private static let staleAfter: TimeInterval = 0.012
  static let holdsPlacement = LaunchConfig.shared.switchOn("serverWindowDrag")

  static func holdAppKitPlacement() {
    typealias Constrain = @convention(c) (NSWindow, Selector, NSRect, NSScreen?) -> NSRect
    let constrain = #selector(NSWindow.constrainFrameRect(_:to:))
    if let method = class_getInstanceMethod(NSWindow.self, constrain) {
      let original = unsafeBitCast(method_getImplementation(method), to: Constrain.self)
      let block: @convention(block) (NSWindow, NSRect, NSScreen?) -> NSRect = { window, rect, screen in
        window === moving ? rect : original(window, constrain, rect, screen)
      }
      method_setImplementation(method, imp_implementationWithBlock(block))
    }
    typealias Adjust = @convention(c) (NSWindow, Selector, NSRect, NSScreen?, UnsafeRawPointer?, Bool) -> Void
    let adjust = NSSelectorFromString("_setFrame:fromAdjustmentToScreen:anchorIfNeeded:animate:")
    if let method = class_getInstanceMethod(NSWindow.self, adjust), encoding(method) == "v68@0:8{CGRect={CGPoint=dd}{CGSize=dd}}16@48^{CGPoint=dd}56B64" {
      let original = unsafeBitCast(method_getImplementation(method), to: Adjust.self)
      let block: @convention(block) (NSWindow, NSRect, NSScreen?, UnsafeRawPointer?, Bool) -> Void = { window, rect, screen, anchor, animate in
        if window !== moving { original(window, adjust, rect, screen, anchor, animate) }
      }
      method_setImplementation(method, imp_implementationWithBlock(block))
    }
    typealias AfterMove = @convention(c) (NSWindow, Selector, NSRect) -> Void
    let afterMove = NSSelectorFromString("_setFrameAfterMove:")
    if let method = class_getInstanceMethod(NSWindow.self, afterMove), encoding(method) == "v48@0:8{CGRect={CGPoint=dd}{CGSize=dd}}16" {
      let original = unsafeBitCast(method_getImplementation(method), to: AfterMove.self)
      let block: @convention(block) (NSWindow, NSRect) -> Void = { window, rect in
        if echoesPlacement(window, rect) || window === moving {
          traceAfterMove(window, rect, "held")
          return
        }
        traceAfterMove(window, rect, "passed")
        original(window, afterMove, rect)
      }
      method_setImplementation(method, imp_implementationWithBlock(block))
    }
  }

  private final class Placements {
    var frames: [NSRect] = []
    var drainsUntil = CFTimeInterval.infinity
  }

  private static let placements = NSMapTable<NSWindow, Placements>.weakToStrongObjects()
  private static let echoDrain: CFTimeInterval = 0.5
  private static let pendingLimit = 1024

  private static func record(_ window: NSWindow) {
    guard holdsPlacement, let pending = placements.object(forKey: window) else { return }
    if pending.frames.count >= pendingLimit { pending.frames.removeFirst(pending.frames.count - pendingLimit + 1) }
    pending.frames.append(window.frame)
  }

  private static func echoesPlacement(_ window: NSWindow, _ rect: NSRect) -> Bool {
    guard let pending = placements.object(forKey: window) else { return false }
    if CACurrentMediaTime() <= pending.drainsUntil, pending.frames.contains(where: { same($0, rect) }) { return true }
    if window !== moving { placements.removeObject(forKey: window) }
    return false
  }

  private static func same(_ a: NSRect, _ b: NSRect) -> Bool {
    abs(a.minX - b.minX) < 0.5 && abs(a.minY - b.minY) < 0.5 && abs(a.width - b.width) < 0.5 && abs(a.height - b.height) < 0.5
  }

  #if DEBUG
  static var afterMoveTrace: [[String: Any]] = []
  static func traceAfterMove(_ window: NSWindow, _ rect: NSRect, _ outcome: String) {
    if afterMoveTrace.count < 4000 {
      afterMoveTrace.append([
        "rect": [rect.minX, rect.minY, rect.width, rect.height], "frameBefore": [window.frame.minX, window.frame.minY, window.frame.width, window.frame.height],
        "outcome": outcome, "following": window === moving, "t": CACurrentMediaTime(),
      ])
    }
  }
  #else
  @inline(__always) static func traceAfterMove(_ window: NSWindow, _ rect: NSRect, _ outcome: String) {}
  #endif

  private static func encoding(_ method: Method) -> String? {
    method_getTypeEncoding(method).map { String(cString: $0) }
  }

  static func windowServerMoves(_ window: NSWindow, from event: NSEvent) -> Bool {
    event.type == .leftMouseDown && event.clickCount < 2 && event.window === window && window.isMovable
      && !window.styleMask.contains(.fullScreen) && ServerWindowDrag.serverOwnsPress(window, at: event.locationInWindow)
  }

  static func follow(_ window: NSWindow, from event: NSEvent) -> Bool {
    guard !following, event.type == .leftMouseDown, event.clickCount < 2,
          window.isMovable, !window.styleMask.contains(.fullScreen), window.isVisible
    else { return false }
    following = true
    moving = window
    if holdsPlacement { placements.setObject(Placements(), forKey: window) }
    defer {
      following = false
      moving = nil
      placements.object(forKey: window)?.drainsUntil = CACurrentMediaTime() + echoDrain
    }
    let start = screenPoint(event)
    let origin = window.frame.origin
    var wasActive = NSApp.isActive
    func move(to event: NSEvent) {
      let target = place(window, origin, start, screenPoint(event))
      guard !near(window.frame.origin, target) else { return }
      window.setFrameOrigin(target)
      record(window)
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
    var target = NSRect(origin: NSPoint(x: origin.x + pointer.x - start.x, y: origin.y + pointer.y - start.y), size: window.frame.size)
    guard holdsPlacement else {
      guard let screen = NSScreen.screens.first(where: { NSMouseInRect(pointer, $0.frame, false) }) ?? window.screen else { return NSPoint(x: target.minX.rounded(), y: target.minY.rounded()) }
      let constrained = window.constrainFrameRect(target, to: screen)
      return NSPoint(x: constrained.minX.rounded(), y: (constrained.maxY - target.height).rounded())
    }
    let screens = NSScreen.screens
    if let screen = screens.first(where: { NSMouseInRect(pointer, $0.frame, false) }) ?? window.screen,
       !screens.contains(where: { $0 !== screen && $0.frame.minY >= screen.frame.maxY - 1 && $0.frame.minX < target.maxX && $0.frame.maxX > target.minX }) {
      target.origin.y = min(target.origin.y, screen.visibleFrame.maxY - target.height)
    }
    return NSPoint(x: target.minX.rounded(), y: target.minY.rounded())
  }

  private static func screenPoint(_ event: NSEvent) -> NSPoint {
    guard let location = event.cgEvent?.location, let primary = NSScreen.screens.first else { return NSEvent.mouseLocation }
    return NSPoint(x: location.x, y: primary.frame.maxY - location.y)
  }

  private static func near(_ a: NSPoint, _ b: NSPoint) -> Bool { abs(a.x - b.x) < 0.5 && abs(a.y - b.y) < 0.5 }
}
