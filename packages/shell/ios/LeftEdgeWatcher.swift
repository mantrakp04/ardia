import AppKit

final class LeftEdgeWatcher {
  static let shared = LeftEdgeWatcher()
  static let reach: CGFloat = 24

  var pointerOverride: NSPoint?
  private var watched: [String: CGFloat] = [:]
  private var over: Set<String> = []
  private var unreported: Set<String> = []
  private var localMonitor: Any?
  private var globalMonitor: Any?
  private var observers: [NSObjectProtocol] = []
  private var dockApp: NSRunningApplication?
  private var lastHitWindow = 0
  private var lastHitIsDock = false
  #if DEBUG
  private(set) var wakes: [String: Int] = ["global": 0, "local": 0]
  var stats: [String: Any] { ["wakes": wakes, "global": globalMonitor != nil, "local": localMonitor != nil, "watched": watched.count] }
  func resetStats() { wakes = ["global": 0, "local": 0] }
  #endif

  private static let pointerEvents: NSEvent.EventTypeMask = [
    .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .leftMouseUp, .rightMouseUp, .otherMouseUp,
  ]

  func watch(id: String, on: Bool, hold: CGFloat) {
    watched[id] = on ? max(0, hold) : nil
    if on { unreported.insert(id) } else { over.remove(id) }
    if watched.isEmpty { return stop() }
    start()
    checkPointer()
  }

  func checkPointer() {
    if let pointerOverride { return check(pointerOverride, live: false) }
    check(NSEvent.mouseLocation, live: true)
  }

  private func check(_ point: NSPoint, live: Bool) {
    lazy var onDock = live && NSApp.isActive && isOnDock(point)
    for (id, hold) in watched {
      guard let window = WindowManager.shared.window(id) else {
        watched[id] = nil
        over.remove(id)
        unreported.remove(id)
        continue
      }
      let inColumn = point.x < window.frame.minX + hold && window.screen?.frame.contains(point) == true
      let now = isOver(point, of: window, hold: hold, live: live)
        || (inColumn && over.contains(id) && onDock)
        || (inColumn && isOver(point, of: window, hold: hold, live: false) && onDock && isTopBeneathDock(point, of: window))
      let fresh = unreported.remove(id) != nil
      guard fresh || now != over.contains(id) else { continue }
      if now { over.insert(id) } else { over.remove(id) }
      let frame = window.frame
      ShellEvents.send(.window, ["type": "leftEdge", "id": id, "over": now, "point": [point.x - frame.minX, frame.maxY - point.y]])
    }
    if watched.isEmpty { return stop() }
    updateGlobalMonitor()
  }

  private func isOver(_ point: NSPoint, of window: NSWindow, hold: CGFloat, live: Bool) -> Bool {
    guard window.isVisible, !window.isMiniaturized, !window.styleMask.contains(.fullScreen), let screen = window.screen else { return false }
    let frame = window.frame
    guard point.y >= frame.minY, point.y < frame.maxY else { return false }
    if point.x >= frame.minX, point.x < frame.minX + hold {
      guard live else { return true }
      let hit = NSApp.window(withWindowNumber: Self.windowNumber(at: point))
      return hit === window || hit?.parent === window
    }
    guard point.x < frame.minX, point.x >= max(screen.frame.minX, frame.minX - Self.reach) else { return false }
    guard live else { return true }
    let edge = NSPoint(x: frame.minX + 1, y: point.y)
    guard Self.windowNumber(at: edge) == window.windowNumber else { return false }
    let under = Self.windowNumber(at: point)
    if under != window.windowNumber, NSApp.window(withWindowNumber: under) != nil { return false }
    return NSApp.isActive || Self.besideScreenEdge(window, screen)
  }

  private static func windowNumber(at point: NSPoint, below start: Int = 0) -> Int {
    var number = NSWindow.windowNumber(at: point, belowWindowWithWindowNumber: start)
    while let passThrough = NSApp.window(withWindowNumber: number), passThrough.ignoresMouseEvents {
      let below = NSWindow.windowNumber(at: point, belowWindowWithWindowNumber: number)
      guard below != number else { break }
      number = below
    }
    return number
  }

  private func isOnDock(_ point: NSPoint) -> Bool {
    isDock(Self.windowNumber(at: point))
  }

  private func isTopBeneathDock(_ point: NSPoint, of window: NSWindow) -> Bool {
    let probe = NSPoint(x: max(point.x, window.frame.minX + 1), y: point.y)
    var number = Self.windowNumber(at: probe)
    while isDock(number) {
      let below = Self.windowNumber(at: probe, below: number)
      guard below != number else { break }
      number = below
    }
    let hit = NSApp.window(withWindowNumber: number)
    return hit === window || hit?.parent === window
  }

  private func isDock(_ number: Int) -> Bool {
    guard number > 0, NSApp.window(withWindowNumber: number) == nil else { return false }
    if number != lastHitWindow {
      lastHitWindow = number
      lastHitIsDock = isDockWindow(number)
    }
    return lastHitIsDock
  }

  private func isDockWindow(_ number: Int) -> Bool {
    if dockApp?.isTerminated ?? true {
      dockApp = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock").first
    }
    guard let dockApp,
      let info = CGWindowListCopyWindowInfo(.optionIncludingWindow, CGWindowID(number)) as? [[String: Any]],
      let owner = info.first?[kCGWindowOwnerPID as String] as? pid_t,
      let layer = info.first?[kCGWindowLayer as String] as? Int
    else { return false }
    return owner == dockApp.processIdentifier && layer >= Int(CGWindowLevelForKey(.dockWindow))
  }

  private static func besideScreenEdge(_ window: NSWindow, _ screen: NSScreen) -> Bool {
    window.frame.minX - screen.frame.minX <= reach
  }

  private var needsGlobalMonitor: Bool {
    if NSApp.isActive || !over.isEmpty { return true }
    return watched.contains { id, hold in
      guard let window = WindowManager.shared.window(id) else { return false }
      if hold > 0 { return true }
      guard let screen = window.screen else { return false }
      return Self.besideScreenEdge(window, screen)
    }
  }

  private func updateGlobalMonitor() {
    let needed = !watched.isEmpty && needsGlobalMonitor
    guard needed != (globalMonitor != nil) else { return }
    if let globalMonitor {
      NSEvent.removeMonitor(globalMonitor)
      self.globalMonitor = nil
      return
    }
    globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: Self.pointerEvents, handler: { [weak self] _ in
      #if DEBUG
      self?.wakes["global", default: 0] += 1
      #endif
      self?.checkPointer()
    })
  }

  private func isWatched(_ window: NSWindow) -> Bool {
    watched.keys.contains { WindowManager.shared.window($0) === window }
  }

  private func start() {
    if localMonitor == nil {
      localMonitor = NSEvent.addLocalMonitorForEvents(matching: Self.pointerEvents, handler: { [weak self] event in
        #if DEBUG
        self?.wakes["local", default: 0] += 1
        #endif
        self?.checkPointer()
        return event
      })
    }
    if observers.isEmpty {
      let center = NotificationCenter.default
      for name in [NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification] {
        observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          self?.checkPointer()
        })
      }
      observers.append(center.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
        self?.updateGlobalMonitor()
      })
      for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification, NSWindow.didChangeScreenNotification] {
        observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
          guard let self, let window = note.object as? NSWindow, self.isWatched(window) else { return }
          self.updateGlobalMonitor()
        })
      }
    }
    updateGlobalMonitor()
  }

  func reset() {
    watched = [:]
    over = []
    unreported = []
    pointerOverride = nil
    stop()
  }

  private func stop() {
    for monitor in [localMonitor, globalMonitor].compactMap({ $0 }) { NSEvent.removeMonitor(monitor) }
    localMonitor = nil
    globalMonitor = nil
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers = []
  }
}
