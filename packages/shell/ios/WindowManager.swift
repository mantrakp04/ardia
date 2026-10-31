import AppKit
import ArdiaCore

final class WindowManager: NSObject, NSWindowDelegate {
  static let shared = WindowManager()

  private struct PendingOpen {
    let id: String
    var options: OpenWindowOptions
  }

  private var managed: [String: ManagedWindow] = [:]
  private var pending: [PendingOpen] = []
  private var lightsCenters: [String: NSPoint] = [:]
  private weak var lastPlaced: NSWindow?
  private static let lastFrameKey = "ArdiaLastWindowFrame"
  private var lastFrame = UserDefaults.standard.string(forKey: WindowManager.lastFrameKey) ?? UserDefaults.standard.string(forKey: "NSWindow Frame BrowserWindow")
  private static let behindTimeout = 1.5
  private static let revealTimeout = 0.6
  private let typeAhead = TypeAheadHold()
  private(set) lazy var fullScreen = FullScreenRestore(windows: self)

  func window(_ id: String) -> NSWindow? { managed[id]?.window }

  var windowIds: [String] { Array(managed.keys) }

  func isFullScreen(_ id: String) -> Bool { managed[id]?.isFullScreen == true }

  private func kind(of window: NSWindow?) -> WindowKind? { id(of: window).flatMap { managed[$0]?.kind } }

  private func isBrowserWindow(_ window: NSWindow?) -> Bool { kind(of: window)?.isBrowser == true }

  func isMainWindow(_ window: NSWindow?) -> Bool { kind(of: window) == .browser }

  var keyWindowKind: WindowKind? { keyWindowId.flatMap { managed[$0]?.kind } }

  func id(of window: NSWindow?) -> String? {
    guard let window else { return nil }
    return managed.first { $0.value.window === window }?.key
  }

  var keyWindowId: String? { id(of: NSApp.keyWindow) ?? id(of: NSApp.mainWindow) }

  func closeForeignKeyWindow() -> Bool {
    guard keyWindowId == nil, let key = NSApp.keyWindow, !(key is NSPanel), key.styleMask.contains(.closable)
    else { return false }
    key.performClose(nil)
    return true
  }

  var keyBrowserWindow: NSWindow? { keyWindowId.flatMap { window($0) } }

  var closableWindow: NSWindow? {
    [NSApp.keyWindow, NSApp.mainWindow].compactMap { $0 }.first { $0.styleMask.contains(.closable) }
  }

  func toggleKeepOnTop() {
    guard let window = keyBrowserWindow else { return }
    window.level = window.level == .floating ? .normal : .floating
  }

  func reopen() {
    ShellEvents.send(.app, ["type": "reopen"])
  }

  func runtimeGone() {
    pending = []
    QuitFlow.shared.replyToTerminate(false)
  }

  func open(id: String, _ options: OpenWindowOptions, focus: Bool) {
    if let existing = window(id) {
      if focus { existing.makeKeyAndOrderFront(nil) }
      return
    }
    let behind = options.behind
    if let behind, !focus, let above = managed[behind], !above.contentShown {
      if let index = pending.firstIndex(where: { $0.id == id }) { pending[index].options = options } else { pending.append(PendingOpen(id: id, options: options)) }
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.behindTimeout) { [weak self] in self?.openPending(behind: behind) }
      return
    }
    let kind = options.kind, title = options.title, frame = options.frame, claim = options.claim
    let small = kind == .small
    if kind != .browser && !small { return openAux(id: id, kind: kind, title: title) }
    guard let makeWindow = WindowHost.makeWindow, let makeContentView = WindowHost.makeContentView else { return }
    if !small, ArdiaChromeWindowHost.takeDismissedAppWindow(id) {
      ShellEvents.send(.window, ["type": "close", "id": id])
      return
    }
    if small, let claim, ArdiaChromeWindowHost.takeDismissedAppWindow(claim) {
      ShellEvents.send(.window, ["type": "close", "id": id])
      return
    }
    if let chromeWindow = ChromeWindows.makeWindow(profile: options.profile, chromeWindow: small ? nil : options.chromeWindow, appWindow: small ? claim : id) {
      if options.incognito { chromeWindow.appearance = NSAppearance(named: .darkAqua) }
      let entry = ManagedWindow(id: id, kind: kind, window: chromeWindow)
      let root = makeContentView(id)
      ArdiaChromeWindowHost.embedRootView(root, in: chromeWindow)
      if !chromeWindow.isVisible {
        chromeWindow.alphaValue = 0
        entry.reveal = .waiting(then: [], entrance: small || options.animated ? !small || frame == nil : nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.revealTimeout) { [weak self, weak entry] in
          if let self, let entry { self.reveal(entry) }
        }
      }
      entry.keepContentSized(in: root)
      entry.watchContent(of: root) { [weak self] entry, root in self?.contentAppeared(entry, root: root) }
      ChromeWindows.onSwap { [weak self] from, to in self?.adopt(from: from, to: to) }
      observeDelegateNotifications(chromeWindow)
      if small { configureSmall(chromeWindow) }
      return show(entry, frame: frame, title: title, focus: focus, small: small, smallSize: options.size, smallPointer: options.pointer, behind: behind)
    }
    let window = makeWindow()
    let controller = NSViewController()
    controller.view = makeContentView(id)
    controller.view.frame = NSRect(origin: .zero, size: window.contentRect(forFrameRect: window.frame).size)
    window.contentViewController = controller
    window.delegate = self
    if options.incognito { window.appearance = NSAppearance(named: .darkAqua) }
    if small { configureSmall(window) }
    show(ManagedWindow(id: id, kind: kind, window: window), frame: frame, title: title, focus: focus, small: small, smallSize: options.size, smallPointer: options.pointer)
  }

  private func show(
    _ entry: ManagedWindow, frame: CGRect?, title: String, focus: Bool, small: Bool, smallSize: CGSize?, smallPointer: NSPoint?,
    behind: String? = nil
  ) {
    let window = entry.window, id = entry.id
    if let center = lightsCenters[id] { ChromeWindows.setTrafficLightsCenter(center, in: window) }
    window.title = title
    if small, frame == nil { placeSmall(window, size: smallSize, pointer: smallPointer) } else if frame != nil || !window.isVisible { place(window, frame: frame) }
    relayoutRoot(window)
    managed[id] = entry
    if !small { lastPlaced = window }
    if window.isMiniaturized {
      observeFrame(window)
      return reportFrame(window)
    }
    if focus, entry.isWaitingToReveal {
      window.orderFront(nil)
      typeAhead.keyOnReveal = window
      typeAhead.hold(in: window)
      entry.whenRevealed { [weak self, weak entry, weak window] in
        guard let self, let entry, let window, self.managed[id] === entry, entry.window === window, self.typeAhead.keyOnReveal === window else { return }
        self.typeAhead.keyOnReveal = nil
        window.makeKeyAndOrderFront(nil)
        self.typeAhead.keyed(window)
      }
    } else if focus {
      window.makeKeyAndOrderFront(nil)
    } else if let behind, let above = self.window(behind), above !== window, above.isVisible {
      window.order(.below, relativeTo: above.windowNumber)
    } else if let key = NSApp.keyWindow, key !== window {
      window.order(.below, relativeTo: key.windowNumber)
    } else {
      window.orderFront(nil)
    }
    observeFrame(window)
    reportFrame(window)
    fullScreen.windowShown(id)
  }

  private func reveal(_ entry: ManagedWindow) {
    guard let (waiting, entrance) = entry.takeReveal() else { return }
    if let entrance {
      WindowMotion.enter(entry.window, style: motionStyle(entry.kind), scales: entrance)
    } else {
      entry.window.alphaValue = 1
    }
    CATransaction.flush()
    waiting.forEach { $0() }
  }

  private func contentAppeared(_ entry: ManagedWindow, root: NSView) {
    reveal(entry)
    if !entry.contentShown, managed[entry.id] === entry {
      entry.contentShown = true
      if pending.contains(where: { $0.options.behind == entry.id }) {
        CATransaction.flush()
        openPending(behind: entry.id)
      }
    }
    entry.keepContentSized(in: root)
  }

  private func openPending(behind: String) {
    for id in pending.filter({ $0.options.behind == behind }).map(\.id) {
      guard let index = pending.firstIndex(where: { $0.id == id }) else { continue }
      let options = pending.remove(at: index).options
      managed[behind]?.contentShown = true
      open(id: id, options, focus: false)
    }
  }

  func whenRevealed(_ id: String, _ then: @escaping () -> Void) {
    guard let entry = managed[id] else { return then() }
    entry.whenRevealed(then)
  }

  private func observeFrame(_ window: NSWindow) {
    for name in [NSWindow.didMoveNotification, NSWindow.didEndLiveResizeNotification] {
      NotificationCenter.default.addObserver(self, selector: #selector(frameChanged(_:)), name: name, object: window)
    }
    NotificationCenter.default.addObserver(self, selector: #selector(sizeChanged(_:)), name: NSWindow.didResizeNotification, object: window)
    for name in [NSWindow.didEnterFullScreenNotification, NSWindow.didExitFullScreenNotification] {
      NotificationCenter.default.addObserver(self, selector: #selector(fullScreenChanged(_:)), name: name, object: window)
    }
  }

  private func observeDelegateNotifications(_ window: NSWindow) {
    for (name, selector) in [
      (NSWindow.didBecomeKeyNotification, #selector(windowDidBecomeKey(_:))),
      (NSWindow.willCloseNotification, #selector(windowWillClose(_:))),
    ] {
      NotificationCenter.default.addObserver(self, selector: selector, name: name, object: window)
    }
  }

  func setTrafficLightsCenter(id: String, center: NSPoint?) {
    lightsCenters[id] = center
    guard let window = window(id) else { return }
    ChromeWindows.setTrafficLightsCenter(center, in: window)
  }

  private func adopt(from: NSWindow, to: NSWindow) {
    guard let id = id(of: from), let entry = managed[id] else { return }
    NotificationCenter.default.removeObserver(self, name: nil, object: from)
    entry.window = to
    if lastPlaced === from { lastPlaced = to }
    observeDelegateNotifications(to)
    observeFrame(to)
    reportFrame(to)
  }

  private func openAux(id: String, kind: WindowKind, title: String) {
    guard let makeContentView = WindowHost.makeContentView else { return }
    let settings = kind == .settings
    let size = settings ? NSSize(width: 820, height: 640) : NSSize(width: 640, height: 600)
    var style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .fullSizeContentView]
    if settings { style.insert(.resizable) }
    let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: style, backing: .buffered, defer: false)
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.title = title
    window.isReleasedWhenClosed = false
    window.minSize = settings ? NSSize(width: 720, height: 480) : size
    window.tabbingMode = .disallowed
    let controller = UtilityContentController()
    let root = makeContentView(id)
    controller.view = root
    controller.view.frame = NSRect(origin: .zero, size: size)
    window.contentViewController = controller
    window.setContentSize(size)
    window.delegate = self
    let entry = ManagedWindow(id: id, kind: kind, window: window)
    managed[id] = entry
    if !window.setFrameUsingName(Self.auxFrameName(kind)) { window.center() }
    for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
      NotificationCenter.default.addObserver(self, selector: #selector(auxFrameChanged(_:)), name: name, object: window)
    }
    entry.keepContentSized(in: root)
    entry.watchContent(of: root) { entry, root in entry.keepContentSized(in: root) }
    relayoutRoot(window)
    window.makeKeyAndOrderFront(nil)
  }

  private static let auxFrameSaveDelay: TimeInterval = 0.3

  private static func auxFrameName(_ kind: WindowKind) -> String { "Ardia\(kind.rawValue.capitalized)" }

  @objc private func auxFrameChanged(_ notification: Notification) {
    guard let window = notification.object as? NSWindow else { return }
    NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(saveAuxFrame(_:)), object: window)
    perform(#selector(saveAuxFrame(_:)), with: window, afterDelay: Self.auxFrameSaveDelay)
  }

  @objc private func saveAuxFrame(_ window: NSWindow) {
    guard let kind = kind(of: window), !kind.isBrowser else { return }
    window.saveFrame(usingName: Self.auxFrameName(kind))
  }

  private func configureSmall(_ window: NSWindow) {
    window.identifier = NSUserInterfaceItemIdentifier("ardia.window.small")
    window.minSize = NSSize(width: 420, height: 300)
    window.tabbingMode = .disallowed
    window.collectionBehavior.insert(.moveToActiveSpace)
  }

  private func placeSmall(_ window: NSWindow, size: CGSize?, pointer: NSPoint?) {
    let mouse = pointer ?? NSEvent.mouseLocation
    let pointed = (pointer == nil && NSApp.isActive ? NSApp.keyWindow?.screen : nil)
      ?? NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    let otherAppFrames = Self.otherAppWindowFrames()
    let showsNoOtherAppFullScreen = { (screen: NSScreen) in Self.displayBounds(screen).map(otherAppFrames.contains) != true }
    let screen = pointed.map { showsNoOtherAppFullScreen($0) ? $0 : NSScreen.screens.first(where: showsNoOtherAppFullScreen) ?? $0 }
    guard let visible = screen?.visibleFrame else { return window.center() }
    let width = min(max(size?.width ?? 900, window.minSize.width), visible.width)
    let height = min(max(size?.height ?? 640, window.minSize.height), visible.height)
    let lift = min(visible.height * 0.05, (visible.height - height) / 2)
    let origin = NSPoint(x: (visible.midX - width / 2).rounded(), y: (visible.midY - height / 2 + lift).rounded())
    window.setFrame(NSRect(origin: origin, size: NSSize(width: width.rounded(), height: height.rounded())), display: false)
  }

  private static func displayBounds(_ screen: NSScreen) -> CGRect? {
    (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID).map(CGDisplayBounds)
  }

  private static func otherAppWindowFrames() -> [CGRect] {
    let ownPid = ProcessInfo.processInfo.processIdentifier
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return windows.compactMap { info in
      guard info[kCGWindowLayer as String] as? Int == 0, info[kCGWindowOwnerPID as String] as? pid_t != ownPid,
            let bounds = info[kCGWindowBounds as String] as? NSDictionary else { return nil }
      return CGRect(dictionaryRepresentation: bounds)
    }
  }

  private func place(_ window: NSWindow, frame: CGRect?) {
    if let frame {
      window.setFrame(frame, display: false)
      if let screen = window.screen ?? NSScreen.main {
        window.setFrame(window.constrainFrameRect(window.frame, to: screen), display: false)
      }
    } else if let source = [NSApp.keyWindow, NSApp.mainWindow, lastPlaced].compactMap({ $0 }).first(where: { isMainWindow($0) })
                ?? managed.values.map(\.window).first(where: { $0.isVisible && isMainWindow($0) }) {
      window.setFrame(NSRect(origin: .zero, size: source.frame.size), display: false)
      let topLeft = NSPoint(x: source.frame.minX, y: source.frame.maxY)
      window.setFrameTopLeftPoint(window.cascadeTopLeft(from: topLeft))
    } else if let lastFrame {
      window.setFrame(from: lastFrame)
    } else {
      window.center()
    }
  }

  func animateClose(id: String, after replacement: String?, done: @escaping () -> Void) {
    guard let entry = managed[id] else { return done() }
    if entry.exit != nil { return entry.exit!.append(done) }
    let window = entry.window
    guard entry.kind.isBrowser, window.isVisible, !window.isMiniaturized, !window.styleMask.contains(.fullScreen), !entry.isWaitingToReveal
    else { return done() }
    entry.exit = [done]
    if replacement == nil, window.isKeyWindow { nextKeyWindow(after: window)?.makeKey() }
    if typeAhead.keyOnReveal === window { typeAhead.keyOnReveal = nil }
    if typeAhead.window === window { typeAhead.end(send: false) }
    let finish: () -> Void = { entry.takeExit()?.forEach { $0() } }
    if let replacement, replacement != id, managed[replacement] != nil {
      return whenRevealed(replacement) {
        DispatchQueue.main.asyncAfter(deadline: .now() + WindowMotion.Style.little.entranceDuration) { [weak window] in
          window?.orderOut(nil)
          finish()
        }
      }
    }
    WindowMotion.exit(window, style: motionStyle(entry.kind), then: finish)
  }

  private func motionStyle(_ kind: WindowKind) -> WindowMotion.Style { kind == .small ? .little : .main }

  private func nextKeyWindow(after closing: NSWindow) -> NSWindow? {
    NSApp.orderedWindows.first {
      $0 !== closing && $0.isVisible && !$0.isMiniaturized && $0.canBecomeKey && isBrowserWindow($0) && id(of: $0).flatMap { managed[$0]?.exit } == nil
    }
  }

  func close(id: String) {
    if let index = pending.firstIndex(where: { $0.id == id }) {
      pending.remove(at: index)
      return
    }
    guard let entry = managed[id] else { return }
    let window = entry.window
    guard ArdiaChromeWindowHost.rootView(of: window) != nil else {
      entry.closingFromJS = true
      return window.close()
    }
    managed[id] = nil
    NotificationCenter.default.removeObserver(self, name: nil, object: window)
    window.animationBehavior = .none
    window.orderOut(nil)
    CATransaction.flush()
    forget(entry)
    ArdiaChromeWindowHost.close(window)
    DispatchQueue.main.async { ArdiaChromeWindowHost.removeRootView(of: window) }
  }

  private func forget(_ entry: ManagedWindow) {
    entry.stopWatchingContent()
    lightsCenters[entry.id] = nil
    entry.takeReveal()?.then.forEach { $0() }
    entry.takeExit()?.forEach { $0() }
  }

  func focus(id: String) {
    if let index = pending.firstIndex(where: { $0.id == id }) {
      return open(id: id, pending.remove(at: index).options, focus: true)
    }
    window(id)?.makeKeyAndOrderFront(nil)
  }

  func setTitle(id: String, title: String) {
    if let index = pending.firstIndex(where: { $0.id == id }) { pending[index].options.title = title }
    guard let window = window(id), window.title != title else { return }
    window.title = title
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    guard isBrowserWindow(sender), let id = id(of: sender), ShellEvents.isAttached(.app) else { return true }
    return !ShellEvents.send(.window, ["type": "closeRequest", "id": id])
  }

  func windowDidBecomeKey(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, let id = id(of: window) else { return }
    if isMainWindow(window) { lastPlaced = window }
    ShellEvents.send(.window, ["type": "focus", "id": id])
  }

  func windowWillClose(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, let id = id(of: window), let entry = managed[id] else { return }
    let closedByJS = entry.closingFromJS
    managed[id] = nil
    NotificationCenter.default.removeObserver(self, name: nil, object: window)
    if !entry.kind.isBrowser {
      NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(saveAuxFrame(_:)), object: window)
      window.saveFrame(usingName: Self.auxFrameName(entry.kind))
    }
    forget(entry)
    if !closedByJS {
      ShellEvents.send(.window, ["type": "close", "id": id])
    }
    DispatchQueue.main.async {
      if ArdiaChromeWindowHost.rootView(of: window) != nil { return ArdiaChromeWindowHost.removeRootView(of: window) }
      window.contentViewController = nil
    }
  }

  @objc func fullScreenChanged(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, let id = id(of: window), let entry = managed[id] else { return }
    let entered = notification.name == NSWindow.didEnterFullScreenNotification
    entry.isFullScreen = entered
    if isMainWindow(window) {
      ShellEvents.send(.window, ["type": "fullScreen", "id": id, "on": entered && !ArdiaChromeWindowHost.windowFullScreenIs(forPage: window)])
    }
    if entered { fullScreen.entered(id) }
  }

  private static let resizeReportDelay: TimeInterval = 0.25

  @objc private func sizeChanged(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, !window.inLiveResize else { return }
    relayoutRoot(window)
    NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(reportResized(_:)), object: window)
    perform(#selector(reportResized(_:)), with: window, afterDelay: Self.resizeReportDelay)
  }

  @objc private func reportResized(_ window: NSWindow) {
    reportFrame(window)
  }

  private func relayoutRoot(_ window: NSWindow) {
    guard let root = ArdiaChromeWindowHost.rootView(of: window) ?? window.contentView else { return }
    root.needsLayout = true
    for view in root.subviews { view.needsLayout = true }
    root.layoutSubtreeIfNeeded()
  }

  @objc private func frameChanged(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, !window.inLiveResize else { return }
    NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(reportMoved(_:)), object: window)
    perform(#selector(reportMoved(_:)), with: window, afterDelay: 0, inModes: [.default])
  }

  @objc private func reportMoved(_ window: NSWindow) {
    reportFrame(window)
  }

  private func reportFrame(_ window: NSWindow) {
    guard let id = id(of: window), !window.styleMask.contains(.fullScreen), window.parent == nil else { return }
    if isMainWindow(window) {
      lastFrame = window.frameDescriptor
      UserDefaults.standard.set(lastFrame, forKey: Self.lastFrameKey)
    }
    let f = window.frame
    ShellEvents.send(.window, ["type": "frame", "id": id, "frame": [f.minX, f.minY, f.width, f.height]])
  }
}
