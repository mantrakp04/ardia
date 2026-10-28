import AppKit
import ArdiaCore

final class WindowManager: NSObject, NSWindowDelegate {
  static let shared = WindowManager()

  private(set) var windows: [String: NSWindow] = [:]
  var emit: ((String, [String: Any]) -> Void)?
  private var closingFromJS = Set<String>()
  private weak var lastPlaced: NSWindow?
  private static let lastFrameKey = "ArdiaLastWindowFrame"
  private var lastFrame = UserDefaults.standard.string(forKey: WindowManager.lastFrameKey) ?? UserDefaults.standard.string(forKey: "NSWindow Frame BrowserWindow")
  private(set) var auxKinds: [String: String] = [:]
  private(set) var smallIds = Set<String>()

  private func isBrowserWindow(_ window: NSWindow?) -> Bool {
    guard let id = id(of: window) else { return false }
    return auxKinds[id] == nil
  }

  func isMainWindow(_ window: NSWindow?) -> Bool {
    guard let id = id(of: window) else { return false }
    return auxKinds[id] == nil && !smallIds.contains(id)
  }

  func id(of window: NSWindow?) -> String? {
    guard let window else { return nil }
    return windows.first { $0.value === window }?.key
  }

  var keyWindowId: String? { id(of: NSApp.keyWindow) ?? id(of: NSApp.mainWindow) }

  func closeForeignKeyWindow() -> Bool {
    guard keyWindowId == nil, let key = NSApp.keyWindow, !(key is NSPanel), key.styleMask.contains(.closable)
    else { return false }
    key.performClose(nil)
    return true
  }

  var keyBrowserWindow: NSWindow? { keyWindowId.flatMap { windows[$0] } }

  var closableWindow: NSWindow? {
    [NSApp.keyWindow, NSApp.mainWindow].compactMap { $0 }.first { $0.styleMask.contains(.closable) }
  }

  func toggleKeepOnTop() {
    guard let window = keyBrowserWindow else { return }
    window.level = window.level == .floating ? .normal : .floating
  }

  struct PendingOpen {
    var frame: [Double]?, incognito: Bool, title: String, kind: String, profile: String?, size: [Double]?, behind: String
    var chromeWindow: String?
    var claim: String?
    var pointer: NSPoint?
    var animated: Bool
  }
  var pendingOpens: [String: PendingOpen] = [:]
  var pendingOrder: [String] = []
  private var contentShown = Set<String>()
  private var firstContentObservers: [String: NSObjectProtocol] = [:]
  private static let behindTimeout = 1.5

  func open(
    id: String, frame: [Double]?, incognito: Bool, title: String, focus: Bool, kind: String = "browser", profile: String? = nil,
    size: [Double]? = nil, behind: String? = nil, chromeWindow: String? = nil, claim: String? = nil, pointer: NSPoint? = nil,
    animated: Bool = false
  ) {
    if let existing = windows[id] {
      if focus { existing.makeKeyAndOrderFront(nil) }
      return
    }
    if let behind, !focus, windows[behind] != nil, !contentShown.contains(behind) {
      if pendingOpens[id] == nil { pendingOrder.append(id) }
      pendingOpens[id] = PendingOpen(
        frame: frame, incognito: incognito, title: title, kind: kind, profile: profile, size: size, behind: behind, chromeWindow: chromeWindow,
        claim: claim, pointer: pointer, animated: animated)
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.behindTimeout) { [weak self] in self?.openPending(behind: behind) }
      return
    }
    let small = kind == "small"
    if kind != "browser" && !small { return openAux(id: id, kind: kind, title: title) }
    guard let makeWindow = WindowHost.makeWindow, let makeContentView = WindowHost.makeContentView else { return }
    if !small, ChromeWindows.takeDismissed(appWindow: id) {
      emit?("onWindowEvent", ["type": "close", "id": id])
      return
    }
    if small, let claim, ChromeWindows.takeDismissed(appWindow: claim) {
      emit?("onWindowEvent", ["type": "close", "id": id])
      return
    }
    if small { smallIds.insert(id) }
    if let chromeWindow = ChromeWindows.makeWindow(profile: profile, chromeWindow: small ? nil : chromeWindow, appWindow: small ? claim : id) {
      if incognito { chromeWindow.appearance = NSAppearance(named: .darkAqua) }
      let root = makeContentView(id)
      ChromeWindows.embed(root, in: chromeWindow)
      if small || animated, !chromeWindow.isVisible { entrances[id] = !small || frame == nil }
      holdUntilContent(chromeWindow, id: id, root: root)
      noteFirstContent(id: id, root: root)
      keepContentSizedAcrossReloads(id: id, root: root)
      ChromeWindows.onSwap { [weak self] from, to in self?.adopt(from: from, to: to) }
      observeDelegateNotifications(chromeWindow)
      if small { configureSmall(chromeWindow) }
      return show(chromeWindow, id: id, frame: frame, title: title, focus: focus, smallSize: small ? size ?? [] : nil, smallPointer: pointer, behind: behind)
    }
    let window = makeWindow()
    let controller = NSViewController()
    controller.view = makeContentView(id)
    controller.view.frame = NSRect(origin: .zero, size: window.contentRect(forFrameRect: window.frame).size)
    window.contentViewController = controller
    window.delegate = self
    if incognito { window.appearance = NSAppearance(named: .darkAqua) }
    if small { configureSmall(window) }
    show(window, id: id, frame: frame, title: title, focus: focus, smallSize: small ? size ?? [] : nil, smallPointer: pointer)
  }

  private func show(
    _ window: NSWindow, id: String, frame: [Double]?, title: String, focus: Bool, smallSize: [Double]? = nil, smallPointer: NSPoint? = nil,
    behind: String? = nil
  ) {
    window.title = title
    if let smallSize, frame == nil { placeSmall(window, size: smallSize, pointer: smallPointer) } else if frame != nil || !window.isVisible { place(window, frame: frame) }
    relayoutRoot(window)
    windows[id] = window
    if let center = lightsCenters[id] { ChromeWindows.setTrafficLightsCenter(center, in: window) }
    if smallSize == nil { lastPlaced = window }
    if window.isMiniaturized {
      observeFrame(window)
      return reportFrame(window)
    }
    if focus, unrevealed[id] != nil {
      window.orderFront(nil)
      keyOnReveal = window
      holdTyping(in: window)
      unrevealed[id]!.append { [weak self, weak window] in
        guard let self, let window, self.windows[id] === window, self.keyOnReveal === window else { return }
        self.keyOnReveal = nil
        window.makeKeyAndOrderFront(nil)
        self.typeAheadKeyed(window)
      }
    } else if focus {
      window.makeKeyAndOrderFront(nil)
    } else if let behind, let above = windows[behind], above !== window, above.isVisible {
      window.order(.below, relativeTo: above.windowNumber)
    } else if let key = NSApp.keyWindow, key !== window {
      window.order(.below, relativeTo: key.windowNumber)
    } else {
      window.orderFront(nil)
    }
    observeFrame(window)
    reportFrame(window)
    if fullScreenEntering == nil, fullScreenQueue.first == id { nextFullScreen() }
  }

  var fullScreenIds = Set<String>()
  var fullScreenQueue: [String] = []
  var fullScreenEntering: String?
  var fullScreenFocus: String?
  var fullScreenToggled = false
  var fullScreenTurn = 0
  static let fullScreenOpenWait = 5.0
  static let fullScreenEnterWait = 3.0

  private static let revealTimeout = 0.6
  private var unrevealed: [String: [() -> Void]] = [:]
  private var entrances: [String: Bool] = [:]
  private var exits: [String: [() -> Void]] = [:]

  private func holdUntilContent(_ window: NSWindow, id: String, root: NSView) {
    guard !window.isVisible else { return }
    window.alphaValue = 0
    unrevealed[id] = []
    var observer: NSObjectProtocol?
    let reveal: () -> Void = { [weak self, weak window] in
      if let observer { NotificationCenter.default.removeObserver(observer) }
      observer = nil
      guard let self, let waiting = self.unrevealed.removeValue(forKey: id) else { return }
      if let window, let scales = self.entrances.removeValue(forKey: id) {
        WindowMotion.enter(window, style: self.motionStyle(id), scales: scales)
      } else {
        window?.alphaValue = 1
      }
      CATransaction.flush()
      waiting.forEach { $0() }
    }
    observer = NotificationCenter.default.addObserver(forName: Notification.Name("RCTContentDidAppearNotification"), object: root, queue: .main) {
      _ in reveal()
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.revealTimeout, execute: reveal)
  }

  private func noteFirstContent(id: String, root: NSView) {
    if let old = firstContentObservers.removeValue(forKey: id) { NotificationCenter.default.removeObserver(old) }
    firstContentObservers[id] = NotificationCenter.default.addObserver(
      forName: Notification.Name("RCTContentDidAppearNotification"), object: root, queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      if let observer = self.firstContentObservers.removeValue(forKey: id) { NotificationCenter.default.removeObserver(observer) }
      guard self.windows[id] != nil else { return }
      self.contentShown.insert(id)
      guard self.pendingOrder.contains(where: { self.pendingOpens[$0]?.behind == id }) else { return }
      CATransaction.flush()
      self.openPending(behind: id)
    }
  }

  private func openPending(behind: String) {
    let ids = pendingOrder.filter { pendingOpens[$0]?.behind == behind }
    for id in ids {
      guard let o = pendingOpens.removeValue(forKey: id) else { continue }
      pendingOrder.removeAll { $0 == id }
      contentShown.insert(behind)
      open(
        id: id, frame: o.frame, incognito: o.incognito, title: o.title, focus: false, kind: o.kind, profile: o.profile, size: o.size,
        behind: behind, chromeWindow: o.chromeWindow, claim: o.claim, pointer: o.pointer, animated: o.animated)
    }
  }

  func whenRevealed(_ id: String, _ then: @escaping () -> Void) {
    if unrevealed[id] != nil { unrevealed[id]!.append(then) } else { then() }
  }

  var typeAhead: TypeAhead?
  var typingMonitor: Any?
  weak var keyOnReveal: NSWindow?

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

  private var lightsCenters: [String: NSPoint] = [:]

  func setTrafficLightsCenter(id: String, center: NSPoint?) {
    lightsCenters[id] = center
    guard let window = windows[id] else { return }
    ChromeWindows.setTrafficLightsCenter(center, in: window)
  }

  private func adopt(from: NSWindow, to: NSWindow) {
    guard let id = id(of: from) else { return }
    NotificationCenter.default.removeObserver(self, name: nil, object: from)
    windows[id] = to
    if lastPlaced === from { lastPlaced = to }
    observeDelegateNotifications(to)
    observeFrame(to)
    reportFrame(to)
  }

  private func openAux(id: String, kind: String, title: String) {
    guard let makeContentView = WindowHost.makeContentView else { return }
    let settings = kind == "settings"
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
    auxKinds[id] = kind
    windows[id] = window
    if !window.setFrameUsingName("Ardia\(kind.capitalized)") { window.center() }
    window.setFrameAutosaveName("Ardia\(kind.capitalized)")
    keepContentSizedAcrossReloads(id: id, root: root)
    relayoutRoot(window)
    window.makeKeyAndOrderFront(nil)
  }

  private func configureSmall(_ window: NSWindow) {
    window.identifier = NSUserInterfaceItemIdentifier("ardia.window.small")
    window.minSize = NSSize(width: 420, height: 300)
    window.tabbingMode = .disallowed
    window.collectionBehavior.insert(.moveToActiveSpace)
  }

  private func placeSmall(_ window: NSWindow, size: [Double], pointer: NSPoint?) {
    let mouse = pointer ?? NSEvent.mouseLocation
    let screen = (pointer == nil && NSApp.isActive ? NSApp.keyWindow?.screen : nil)
      ?? NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    guard let visible = screen?.visibleFrame else { return window.center() }
    let width = min(max(size.count == 2 ? size[0] : 900, window.minSize.width), visible.width)
    let height = min(max(size.count == 2 ? size[1] : 640, window.minSize.height), visible.height)
    let lift = min(visible.height * 0.05, (visible.height - height) / 2)
    let origin = NSPoint(x: (visible.midX - width / 2).rounded(), y: (visible.midY - height / 2 + lift).rounded())
    window.setFrame(NSRect(origin: origin, size: NSSize(width: width.rounded(), height: height.rounded())), display: false)
  }

  private func place(_ window: NSWindow, frame: [Double]?) {
    if let frame, frame.count == 4 {
      window.setFrame(NSRect(x: frame[0], y: frame[1], width: frame[2], height: frame[3]), display: false)
      if let screen = window.screen ?? NSScreen.main {
        window.setFrame(window.constrainFrameRect(window.frame, to: screen), display: false)
      }
    } else if let source = [NSApp.keyWindow, NSApp.mainWindow, lastPlaced].compactMap({ $0 }).first(where: { isMainWindow($0) })
                ?? windows.values.first(where: { $0.isVisible && isMainWindow($0) }) {
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
    if exits[id] != nil { return exits[id]!.append(done) }
    guard let window = windows[id], isBrowserWindow(window), window.isVisible, !window.isMiniaturized, !window.styleMask.contains(.fullScreen),
      unrevealed[id] == nil
    else { return done() }
    exits[id] = [done]
    if replacement == nil, window.isKeyWindow { nextKeyWindow(after: window)?.makeKey() }
    if keyOnReveal === window { keyOnReveal = nil }
    if typeAhead?.window === window { endTypeAhead(send: false) }
    let finish: () -> Void = { [weak self] in
      guard let waiting = self?.exits.removeValue(forKey: id) else { return }
      waiting.forEach { $0() }
    }
    if let replacement, replacement != id, windows[replacement] != nil {
      return whenRevealed(replacement) {
        DispatchQueue.main.asyncAfter(deadline: .now() + WindowMotion.Style.little.entranceDuration) { [weak window] in
          window?.orderOut(nil)
          finish()
        }
      }
    }
    WindowMotion.exit(window, style: motionStyle(id), then: finish)
  }

  private func motionStyle(_ id: String) -> WindowMotion.Style { smallIds.contains(id) ? .little : .main }

  private func nextKeyWindow(after closing: NSWindow) -> NSWindow? {
    NSApp.orderedWindows.first { $0 !== closing && $0.isVisible && !$0.isMiniaturized && $0.canBecomeKey && isBrowserWindow($0) && exits[id(of: $0) ?? ""] == nil }
  }

  func close(id: String) {
    if pendingOpens.removeValue(forKey: id) != nil {
      pendingOrder.removeAll { $0 == id }
      return
    }
    entrances[id] = nil
    contentShown.remove(id)
    if let observer = firstContentObservers.removeValue(forKey: id) { NotificationCenter.default.removeObserver(observer) }
    guard let window = windows[id] else { return }
    if ChromeWindows.root(of: window) != nil {
      NotificationCenter.default.removeObserver(self, name: nil, object: window)
      windows[id] = nil
      window.animationBehavior = .none
      window.orderOut(nil)
      CATransaction.flush()
      if let waiting = unrevealed.removeValue(forKey: id) { waiting.forEach { $0() } }
      stopKeepingContentSized(id)
      lightsCenters[id] = nil
      fullScreenIds.remove(id)
      auxKinds[id] = nil
      smallIds.remove(id)
      ChromeWindows.close(window)
      DispatchQueue.main.async { ChromeWindows.removeRoot(of: window) }
      return
    }
    closingFromJS.insert(id)
    window.close()
  }

  func focus(id: String) {
    if let o = pendingOpens.removeValue(forKey: id) {
      pendingOrder.removeAll { $0 == id }
      return open(
        id: id, frame: o.frame, incognito: o.incognito, title: o.title, focus: true, kind: o.kind, profile: o.profile, size: o.size,
        pointer: o.pointer)
    }
    windows[id]?.makeKeyAndOrderFront(nil)
  }

  func setTitle(id: String, title: String) {
    if pendingOpens[id] != nil { pendingOpens[id]!.title = title }
    guard let window = windows[id], window.title != title else { return }
    window.title = title
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    guard let id = id(of: sender), auxKinds[id] == nil, appEventsObserved, let emit else { return true }
    emit("onWindowEvent", ["type": "closeRequest", "id": id])
    return false
  }

  func windowDidBecomeKey(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, let id = id(of: window) else { return }
    if isMainWindow(window) { lastPlaced = window }
    emit?("onWindowEvent", ["type": "focus", "id": id])
  }

  func windowWillClose(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, let id = id(of: window) else { return }
    NotificationCenter.default.removeObserver(self, name: nil, object: window)
    windows[id] = nil
    entrances[id] = nil
    stopKeepingContentSized(id)
    lightsCenters[id] = nil
    fullScreenIds.remove(id)
    auxKinds[id] = nil
    smallIds.remove(id)
    if closingFromJS.remove(id) == nil {
      emit?("onWindowEvent", ["type": "close", "id": id])
    }
    DispatchQueue.main.async {
      if ChromeWindows.root(of: window) != nil { return ChromeWindows.removeRoot(of: window) }
      window.contentViewController = nil
    }
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

  private var contentSizers: [String: NSObjectProtocol] = [:]

  private func keepContentSized(id: String, root: NSView) {
    if let old = contentSizers.removeValue(forKey: id) { NotificationCenter.default.removeObserver(old) }
    guard let content = root.subviews.first(where: { NSStringFromClass(type(of: $0)).hasSuffix("RootContentView") }) else { return }
    content.postsFrameChangedNotifications = true
    contentSizers[id] = NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: content, queue: .main) {
      [weak root, weak content] _ in
      guard let root, let content, content.superview === root, root.window != nil, !root.bounds.isEmpty,
        content.frame.size != root.bounds.size
      else { return }
      root.needsLayout = true
      content.needsLayout = true
    }
  }

  private var contentReloads: [String: NSObjectProtocol] = [:]

  private func keepContentSizedAcrossReloads(id: String, root: NSView) {
    keepContentSized(id: id, root: root)
    contentReloads[id] = NotificationCenter.default.addObserver(forName: Notification.Name("RCTContentDidAppearNotification"), object: root, queue: .main) {
      [weak self, weak root] _ in
      guard let self, let root, self.contentReloads[id] != nil else { return }
      self.keepContentSized(id: id, root: root)
    }
  }

  private func stopKeepingContentSized(_ id: String) {
    for token in [contentSizers.removeValue(forKey: id), contentReloads.removeValue(forKey: id)] {
      if let token { NotificationCenter.default.removeObserver(token) }
    }
  }

  private func relayoutRoot(_ window: NSWindow) {
    guard let root = ChromeWindows.root(of: window) ?? window.contentView else { return }
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
    emit?("onWindowEvent", ["type": "frame", "id": id, "frame": [f.minX, f.minY, f.width, f.height]])
  }

  var appEventsObserved = false
  var runtime: ObjectIdentifier?

  enum QuitStep { case none, saving, waitingForUpdater }
  var quitStep = QuitStep.none
  var quitAttempt = 0

  var saveWait: Timer?
  var lateSaveAlert: NSAlert?
  let background = LaunchConfig.shared.background
}
