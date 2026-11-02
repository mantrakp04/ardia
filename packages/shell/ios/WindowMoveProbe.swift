import AppKit

#if DEBUG
enum WindowMoveProbe {
  private static var buttonsDown = false

  private static func dirtyViews(_ view: NSView) -> Int {
    view.subviews.reduce(view.needsLayout || view.needsDisplay ? 1 : 0) { $0 + dirtyViews($1) }
  }

  private static func settle(_ window: NSWindow) {
    window.contentView?.superview?.layoutSubtreeIfNeeded()
    window.displayIfNeeded()
    CATransaction.flush()
  }

  static func steps(_ window: NSWindow, count: Int, dx: CGFloat, dy: CGFloat, interval: TimeInterval, done: @escaping ([String: Any]) -> Void) {
    guard let frameView = window.contentView?.superview else { return done(["error": "no frame view"]) }
    let start = window.frame.origin
    var times: [Double] = []
    var dirtySteps = 0
    var dirtyTotal = 0
    var moveNotes = 0
    let observer = NotificationCenter.default.addObserver(forName: NSWindow.didMoveNotification, object: window, queue: nil) { _ in moveNotes += 1 }
    var step = 0
    settle(window)
    let timer = Timer(timeInterval: interval, repeats: true) { timer in
      step += 1
      let began = CACurrentMediaTime()
      window.setFrameOrigin(NSPoint(x: start.x + dx * CGFloat(step), y: start.y + dy * CGFloat(step)))
      times.append((CACurrentMediaTime() - began) * 1000)
      let dirty = dirtyViews(frameView)
      dirtyTotal += dirty
      if dirty > 0 || window.viewsNeedDisplay { dirtySteps += 1 }
      settle(window)
      guard step >= count else { return }
      timer.invalidate()
      NotificationCenter.default.removeObserver(observer)
      window.setFrameOrigin(start)
      let sorted = times.sorted()
      done([
        "steps": count, "moveNotifications": moveNotes, "stepsLeavingDirtyViews": dirtySteps, "dirtyViews": dirtyTotal,
        "medianMs": sorted[sorted.count / 2], "maxMs": sorted.last ?? 0,
      ])
    }
    RunLoop.main.add(timer, forMode: .common)
  }

  private static func installButtons() -> (() -> Void)? {
    let selector = #selector(getter: NSEvent.pressedMouseButtons)
    guard let method = class_getClassMethod(NSEvent.self, selector) else { return nil }
    let original = method_getImplementation(method)
    let block: @convention(block) (AnyClass) -> Int = { _ in buttonsDown ? 1 : 0 }
    method_setImplementation(method, imp_implementationWithBlock(block))
    return { method_setImplementation(method, original) }
  }

  private static func mouse(_ type: NSEvent.EventType, _ window: NSWindow, screen: NSPoint) -> NSEvent? {
    let local = NSPoint(x: screen.x - window.frame.minX, y: screen.y - window.frame.minY)
    return NSEvent.mouseEvent(
      with: type, location: local, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
      context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1)
  }

  static func drag(
    _ window: NSWindow, x: CGFloat, top: CGFloat, count: Int, dx: CGFloat, dy: CGFloat, interval: TimeInterval,
    done: @escaping ([String: Any]) -> Void
  ) {
    guard let frameView = window.contentView?.superview, let restoreButtons = installButtons() else { return done(["error": "no frame view"]) }
    let origin = window.frame.origin
    let local = NSPoint(x: x, y: frameView.bounds.height - top)
    let pointer = NSPoint(x: origin.x + local.x, y: origin.y + local.y)
    let hit = frameView.hitTest(local).map { String(describing: type(of: $0)) } ?? "nil"
    let serverOwns = ServerWindowDrag.serverOwnsPress(window, at: local)
    var origins: [[Double]] = []
    var backSteps = 0
    var step = 0
    buttonsDown = true
    guard let down = mouse(.leftMouseDown, window, screen: pointer) else { return done(["error": "no event"]) }
    NSApp.postEvent(down, atStart: false)
    let timer = Timer(timeInterval: interval, repeats: true) { timer in
      let now = window.frame.origin
      if let last = origins.last, (now.x - last[0]) * dx + (now.y - last[1]) * dy < 0 { backSteps += 1 }
      origins.append([now.x, now.y])
      step += 1
      let at = NSPoint(x: pointer.x + dx * CGFloat(step), y: pointer.y + dy * CGFloat(step))
      if step <= count, let drag = mouse(.leftMouseDragged, window, screen: at) { return NSApp.postEvent(drag, atStart: false) }
      timer.invalidate()
      buttonsDown = false
      if let up = mouse(.leftMouseUp, window, screen: at) { NSApp.postEvent(up, atStart: false) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
        restoreButtons()
        let end = window.frame.origin
        window.setFrameOrigin(origin)
        done([
          "hit": hit, "serverOwnsPress": serverOwns, "moved": [end.x - origin.x, end.y - origin.y],
          "pointerTravel": [dx * CGFloat(count), dy * CGFloat(count)], "backSteps": backSteps, "samples": origins.count,
        ])
      }
    }
    RunLoop.main.add(timer, forMode: .common)
  }
}
#endif
