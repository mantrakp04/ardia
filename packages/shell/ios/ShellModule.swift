import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

public enum OpenURLInbox {
  static var pending: [String] = []
  static var pendingPointer = NSPoint.zero
  static var deliver: (([String], NSPoint) -> Void)?

  public static func receive(_ urls: [URL]) {
    let pointer = NSEvent.mouseLocation
    let strings = urls.map { $0.isFileURL ? $0.absoluteString : $0.absoluteString }
    if let deliver { return deliver(strings, pointer) }
    pending += strings
    pendingPointer = pointer
  }
}

final class BangListFetch: NSObject, URLSessionDataDelegate {
  static let maxBytes = 5_000_000
  private static let listURL = URL(string: "https://services.helium.imput.net/bangs.json")!
  private static var running: Set<BangListFetch> = []
  private static let lock = NSLock()

  private var body = Data()
  private var response: HTTPURLResponse?
  private var failure: String?
  private let done: (Result<[String: Any], Error>) -> Void

  private init(done: @escaping (Result<[String: Any], Error>) -> Void) {
    self.done = done
  }

  private static var url: URL {
    #if DEBUG
    if let override = ProcessInfo.processInfo.environment["ARDIA_BANGS_URL"], let url = URL(string: override) { return url }
    #endif
    return listURL
  }

  static func start(etag: String?, done: @escaping (Result<[String: Any], Error>) -> Void) {
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.httpCookieAcceptPolicy = .never
    config.urlCredentialStorage = nil
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.timeoutIntervalForRequest = 30
    config.timeoutIntervalForResource = 60
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.httpShouldHandleCookies = false
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let etag, !etag.isEmpty, etag.count <= 200, !etag.contains(where: { $0.isNewline }) {
      request.setValue(etag, forHTTPHeaderField: "If-None-Match")
    }
    let fetch = BangListFetch(done: done)
    lock.lock()
    running.insert(fetch)
    lock.unlock()
    let session = URLSession(configuration: config, delegate: fetch, delegateQueue: nil)
    session.dataTask(with: request).resume()
    session.finishTasksAndInvalidate()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    self.response = response as? HTTPURLResponse
    if response.expectedContentLength > Int64(Self.maxBytes) {
      failure = "too large"
      return completionHandler(.cancel)
    }
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard failure == nil else { return }
    if body.count + data.count > Self.maxBytes {
      failure = "too large"
      body = Data()
      dataTask.cancel()
      return
    }
    body.append(data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    defer {
      Self.lock.lock()
      Self.running.remove(self)
      Self.lock.unlock()
    }
    if let failure { return done(.failure(NSError(domain: "ArdiaBangs", code: 1, userInfo: [NSLocalizedDescriptionKey: failure]))) }
    if let error { return done(.failure(error)) }
    guard let response else { return done(.failure(NSError(domain: "ArdiaBangs", code: 2, userInfo: [NSLocalizedDescriptionKey: "no response"]))) }
    let text = response.statusCode == 200 ? String(data: body, encoding: .utf8) : nil
    if response.statusCode == 200 && text == nil {
      return done(.failure(NSError(domain: "ArdiaBangs", code: 3, userInfo: [NSLocalizedDescriptionKey: "not UTF-8"])))
    }
    let orNull = { (value: String?) -> Any in value.map { $0 as Any } ?? NSNull() }
    done(.success([
      "status": response.statusCode,
      "etag": orNull(response.value(forHTTPHeaderField: "ETag")),
      "contentType": orNull(response.value(forHTTPHeaderField: "Content-Type")),
      "body": orNull(text),
      "bytes": body.count,
    ]))
  }
}

enum DocumentStore {
  typealias Done = (Error?) -> Void
  private struct Staged {
    let url: URL
    let generation: UInt64
    let contents: String
    var waiters: [Done]
  }

  private static let queue = DispatchQueue(label: "ardia.documents", qos: .utility)
  private static let lock = NSLock()
  private static var staged: [String: Staged] = [:]
  private static var generation: UInt64 = 0
  private static var closed = false
  private static let flushOnQuit = NotificationCenter.default.addObserver(
    forName: NSApplication.willTerminateNotification, object: nil, queue: nil
  ) { _ in flush() }

  static func read(_ name: String) -> String? {
    guard let url = try? ShellModule.documentURL(name) else { return nil }
    lock.lock()
    let pending = staged[url.lastPathComponent]?.contents
    lock.unlock()
    return pending ?? (try? String(contentsOf: url, encoding: .utf8))
  }

  static func write(_ name: String, _ contents: String, done: Done? = nil) throws {
    _ = flushOnQuit
    let url = try ShellModule.documentURL(name)
    let key = url.lastPathComponent
    lock.lock()
    if closed {
      lock.unlock()
      done?(CocoaError(.fileWriteNoPermission))
      return
    }
    generation += 1
    let mine = generation
    staged[key] = Staged(url: url, generation: mine, contents: contents, waiters: (staged[key]?.waiters ?? []) + (done.map { [$0] } ?? []))
    lock.unlock()
    queue.async { land(key, mine, attempt: 0) }
  }

  static func remove(_ name: String) throws {
    let url = try ShellModule.documentURL(name)
    lock.lock()
    if closed { return lock.unlock() }
    generation += 1
    let waiters = staged.removeValue(forKey: url.lastPathComponent)?.waiters ?? []
    lock.unlock()
    queue.async {
      try? FileManager.default.removeItem(at: url)
      for waiter in waiters { waiter(nil) }
    }
  }

  private static func land(_ key: String, _ generation: UInt64, attempt: Int) {
    lock.lock()
    guard let save = staged[key], save.generation == generation else { return lock.unlock() }
    lock.unlock()
    var failure: Error?
    do {
      try save.contents.write(to: save.url, atomically: true, encoding: .utf8)
    } catch {
      failure = error
    }
    lock.lock()
    var waiters: [Done] = []
    if staged[key]?.generation == generation {
      waiters = staged[key]!.waiters
      if failure == nil { staged[key] = nil } else { staged[key]!.waiters = [] }
    }
    lock.unlock()
    for waiter in waiters { waiter(failure) }
    guard let failure else { return }
    NSLog("Ardia: saving \(key) failed (try \(attempt + 1)): \(failure.localizedDescription)")
    let delay = min(60.0, 2.0 * pow(2.0, Double(min(attempt, 5))))
    queue.asyncAfter(deadline: .now() + delay) { land(key, generation, attempt: attempt + 1) }
  }

  static func close() {
    lock.lock()
    closed = true
    lock.unlock()
  }

  @discardableResult
  static func flush() -> Bool {
    queue.sync {
      lock.lock()
      let keys = Array(staged.keys)
      lock.unlock()
      for key in keys {
        lock.lock()
        let generation = staged[key]?.generation
        lock.unlock()
        if let generation { land(key, generation, attempt: 99) }
      }
    }
    lock.lock()
    defer { lock.unlock() }
    return staged.isEmpty
  }
}

public class ShellModule: Module {
  static func documentURL(_ name: String) throws -> URL {
    let dir: URL
    if let custom = ProcessInfo.processInfo.environment["ARDIA_DATA_DIR"] {
      dir = URL(fileURLWithPath: custom, isDirectory: true)
    } else {
      let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      dir = base.appendingPathComponent(Bundle.main.bundleIdentifier ?? "Ardia", isDirectory: true)
    }
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent((name as NSString).lastPathComponent)
  }

  private var appearanceObservation: NSKeyValueObservation?
  private var sidebarObservers: [(NotificationCenter, NSObjectProtocol)] = []
  private var flagsMonitor: Any?
  private var switcherMonitor: Any?
  private var dragEscapeMonitor: Any?
  private let switcherPointer = SwitcherPointer()

  public func definition() -> ModuleDefinition {
    Name("ArdiaShell")
    Events("onCommand", "onOpenURLs", "onWindowEvent", "onAppEvent")

    OnCreate {
      _ = installTextFieldSelectAll
      _ = installInputSourceKeys
      _ = installScrollViewInsetFix
      _ = installOutsidePressMonitor
      _ = installWindowMoveFallback
      DispatchQueue.main.async { [weak self] in
        MenuTarget.shared.handler = { command, arg, windowId in
          if command == "closeTab", WindowManager.shared.closeForeignKeyWindow() { return }
          self?.sendEvent("onCommand", [
            "command": command, "arg": arg as Any, "windowId": windowId as Any,
            "focusGeneration": FocusHandoff.shared.takeBegun() as Any,
          ])
        }
        WindowManager.shared.emit = { name, body in self?.sendEvent(name, body) }
        FocusHandoff.shared.install()
        if let queue = self?.appContext?.reactBridge?.uiManager.methodQueue {
          FocusHandoff.shared.afterPendingUI = { block in queue.async { DispatchQueue.main.async(execute: block) } }
        }
        LeftEdgeWatcher.shared.emit = { name, body in self?.sendEvent(name, body) }
        WindowManager.shared.runtime = self.map(ObjectIdentifier.init)
        NSApp.mainMenu = MainMenu.build()
        self?.appearanceObservation = NSApp.observe(\.effectiveAppearance) { _, _ in
          self?.sendEvent("onAppEvent", ["type": "appearance", "dark": ShellModule.isDark])
        }
        self?.observeForSidebar()
        let quitCancelled = NotificationCenter.default.addObserver(
          forName: Notification.Name("ArdiaCoreQuitCancelled"), object: nil, queue: .main
        ) { _ in self?.sendEvent("onAppEvent", ["type": "quitCancelled"]) }
        self?.sidebarObservers.append((NotificationCenter.default, quitCancelled))
      }
    }

    OnDestroy { [weak self] in
      guard let self else { return }
      for (center, token) in self.sidebarObservers { center.removeObserver(token) }
      self.sidebarObservers = []
      if let monitor = self.flagsMonitor { NSEvent.removeMonitor(monitor) }
      self.flagsMonitor = nil
      if let monitor = self.switcherMonitor { NSEvent.removeMonitor(monitor) }
      self.switcherMonitor = nil
      if let monitor = self.dragEscapeMonitor { NSEvent.removeMonitor(monitor) }
      self.dragEscapeMonitor = nil
      let gone = ObjectIdentifier(self)
      DispatchQueue.main.async {
        WindowManager.shared.runtimeGone(gone)
        if WindowManager.shared.runtime == nil { LeftEdgeWatcher.shared.reset() }
      }
    }

    OnStartObserving("onAppEvent") {
      DispatchQueue.main.async { WindowManager.shared.appEventsObserved = true }
    }

    OnStartObserving("onOpenURLs") {
      DispatchQueue.main.async { [weak self] in
        OpenURLInbox.deliver = { urls, pointer in self?.sendEvent("onOpenURLs", ["urls": urls, "pointer": [pointer.x, pointer.y]]) }
        if !OpenURLInbox.pending.isEmpty {
          let urls = OpenURLInbox.pending
          OpenURLInbox.pending = []
          OpenURLInbox.deliver?(urls, OpenURLInbox.pendingPointer)
        }
      }
    }

    AsyncFunction("openWindow") { (id: String, options: [String: Any]) in
      WindowManager.shared.open(
        id: id,
        frame: options["frame"] as? [Double],
        incognito: options["incognito"] as? Bool ?? false,
        title: options["title"] as? String ?? "",
        focus: options["focus"] as? Bool ?? true,
        kind: options["kind"] as? String ?? "browser",
        profile: options["profile"] as? String,
        size: options["size"] as? [Double],
        behind: options["behind"] as? String,
        chromeWindow: options["chromeWindow"] as? String,
        claim: options["claim"] as? String,
        pointer: (options["pointer"] as? [Double]).flatMap { $0.count == 2 ? NSPoint(x: $0[0], y: $0[1]) : nil })
    }.runOnQueue(.main)

    AsyncFunction("closeWindow") { (id: String) in WindowManager.shared.close(id: id) }.runOnQueue(.main)
    AsyncFunction("animateWindowClose") { (id: String, after: String?, promise: Promise) in
      WindowManager.shared.animateClose(id: id, after: after) { promise.resolve(nil) }
    }.runOnQueue(.main)
    AsyncFunction("setTrafficLightsCenter") { (id: String, center: [Double]?) in
      WindowManager.shared.setTrafficLightsCenter(id: id, center: center.flatMap { $0.count == 2 ? NSPoint(x: $0[0], y: $0[1]) : nil })
    }.runOnQueue(.main)
    AsyncFunction("watchLeftEdge") { (id: String, on: Bool, hold: Double) in
      LeftEdgeWatcher.shared.watch(id: id, on: on, hold: CGFloat(hold))
    }.runOnQueue(.main)
    AsyncFunction("focusWindow") { (id: String) in WindowManager.shared.focus(id: id) }.runOnQueue(.main)
    AsyncFunction("dragPreviewBegin") { (windowId: String, chip: [Double], grab: [Double]) in
      guard chip.count == 4, grab.count == 2 else { return }
      DragPreview.shared.begin(windowId: windowId, chip: NSRect(x: chip[0], y: chip[1], width: chip[2], height: chip[3]), grab: NSPoint(x: grab[0], y: grab[1]))
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewPage") { (base64: String, frame: [Double]) in
      guard frame.count == 4, let data = Data(base64Encoded: base64) else { return }
      DragPreview.shared.setPage(data, frame: NSRect(x: frame[0], y: frame[1], width: frame[2], height: frame[3]))
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewUpdate") { (shape: String, point: [Double]) in
      guard point.count == 2 else { return }
      DragPreview.shared.update(shape: shape, at: NSPoint(x: point[0], y: point[1]))
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewCancel") { DragPreview.shared.cancel() }.runOnQueue(.main)
    AsyncFunction("raiseView") { (tag: Int, levels: Int, raised: Bool) in
      guard var view = self.appContext?.findView(withTag: tag, ofType: NSView.self) else { return }
      for _ in 0...max(0, levels) {
        guard let parent = view.superview else { return }
        let layers = view.layer.flatMap { layer in parent.layer.flatMap { $0 === layer.superlayer ? (layer, $0) : nil } }
        if raised {
          if parent.subviews.last !== view { parent.addSubview(view, positioned: .above, relativeTo: nil) }
          if let (layer, host) = layers, host.sublayers?.last !== layer { host.addSublayer(layer) }
        } else if let order = parent.value(forKey: "reactSubviews") as? [NSView], let index = order.firstIndex(where: { $0 === view }) {
          if let next = order[(index + 1)...].first(where: { $0.superview === parent }) {
            parent.addSubview(view, positioned: .below, relativeTo: next)
            if let (layer, host) = layers, let below = next.layer, below.superlayer === host { host.insertSublayer(layer, below: below) }
          } else if parent.subviews.last !== view {
            parent.addSubview(view, positioned: .above, relativeTo: nil)
            if let (layer, host) = layers { host.addSublayer(layer) }
          }
        }
        view = parent
      }
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewPlaceholder") { (title: String, favicon: String?) in
      DragPreview.shared.setPlaceholder(title: title, favicon: favicon)
    }.runOnQueue(.main)
    AsyncFunction("windowFrame") { (id: String) -> [Double]? in
      guard let f = WindowManager.shared.windows[id]?.frame else { return nil }
      return [f.minX, f.minY, f.width, f.height]
    }.runOnQueue(.main)
    AsyncFunction("devDragPreviewState") { () -> [String: Any] in
      #if DEBUG
      return DragPreview.shared.debugState
      #else
      return [:]
      #endif
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewEnd") { (windowId: String?, frame: [Double]?) in
      DragPreview.shared.end(windowId: windowId, fallback: frame.flatMap { $0.count == 4 ? NSRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) : nil })
    }.runOnQueue(.main)
    AsyncFunction("setWindowTitle") { (id: String, title: String) in
      WindowManager.shared.setTitle(id: id, title: title)
    }.runOnQueue(.main)
    AsyncFunction("windowIds") { () -> [String] in Array(WindowManager.shared.windows.keys) }.runOnQueue(.main)

    AsyncFunction("setAppearance") { (mode: String) in
      NSApp.appearance = mode == "light" ? NSAppearance(named: .aqua) : mode == "dark" ? NSAppearance(named: .darkAqua) : nil
    }.runOnQueue(.main)

    AsyncFunction("isDarkAppearance") { () -> Bool in ShellModule.isDark }.runOnQueue(.main)

    AsyncFunction("setMenuState") { (state: [String: Any]) in
      MenuState.current = MenuState(state)
      MainMenu.refresh()
    }.runOnQueue(.main)
    AsyncFunction("setMenuBookmarks") { (bookmarks: [String: Any]) in
      MenuState.setBookmarks(bookmarks)
      MainMenu.refresh()
    }.runOnQueue(.main)

    AsyncFunction("replyToTerminate") { (ok: Bool) in WindowManager.shared.replyToTerminate(ok) }.runOnQueue(.main)

    AsyncFunction("confirm") { (options: [String: Any], promise: Promise) in
      let alert = ShellModule.alert(options)
      alert.addButton(withTitle: options["confirmTitle"] as? String ?? "OK")
      alert.addButton(withTitle: options["cancelTitle"] as? String ?? "Cancel")
      if options["destructive"] as? Bool == true { alert.buttons.first?.hasDestructiveAction = true }
      if let suppression = options["suppression"] as? String {
        alert.showsSuppressionButton = true
        alert.suppressionButton?.title = suppression
      }
      ShellModule.present(alert, windowId: options["windowId"] as? String) { response in
        promise.resolve([
          "confirmed": response == .alertFirstButtonReturn,
          "suppressed": alert.suppressionButton?.state == .on,
        ])
      }
    }.runOnQueue(.main)

    AsyncFunction("prompt") { (options: [String: Any], promise: Promise) in
      let alert = ShellModule.alert(options)
      alert.addButton(withTitle: options["confirmTitle"] as? String ?? "OK")
      alert.addButton(withTitle: "Cancel")
      let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
      field.stringValue = options["value"] as? String ?? ""
      field.placeholderString = options["placeholder"] as? String
      alert.accessoryView = field
      alert.window.initialFirstResponder = field
      ShellModule.present(alert, windowId: options["windowId"] as? String) { response in
        let text = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        promise.resolve(response == .alertFirstButtonReturn && !text.isEmpty ? text : nil)
      }
    }.runOnQueue(.main)

    Function("startDictation") {
      DispatchQueue.main.async { NSApp.sendAction(Selector(("startDictation:")), to: nil, from: nil) }
    }

    AsyncFunction("pickFiles") { (promise: Promise) in
      let panel = NSOpenPanel()
      panel.allowsMultipleSelection = true
      panel.canChooseDirectories = false
      panel.begin { response in
        promise.resolve(response == .OK ? panel.urls.map(\.absoluteString) : [])
      }
    }.runOnQueue(.main)

    AsyncFunction("pickFolder") { (current: String?, prompt: String?, promise: Promise) in
      let panel = NSOpenPanel()
      panel.canChooseFiles = false
      panel.canChooseDirectories = true
      panel.canCreateDirectories = true
      panel.allowsMultipleSelection = false
      if let prompt { panel.prompt = prompt }
      if let current { panel.directoryURL = URL(fileURLWithPath: current, isDirectory: true) }
      panel.begin { response in promise.resolve(response == .OK ? panel.url?.path : nil) }
    }.runOnQueue(.main)

    Function("readDocument") { (name: String) -> String? in DocumentStore.read(name) }

    Function("writeDocument") { (name: String, contents: String) in try DocumentStore.write(name, contents) }

    Function("removeDocument") { (name: String) in try DocumentStore.remove(name) }

    AsyncFunction("fetchBangList") { (etag: String?, promise: Promise) in
      BangListFetch.start(etag: etag) { result in
        switch result {
        case .success(let reply): promise.resolve(reply)
        case .failure(let error): promise.reject("ERR_BANG_LIST", error.localizedDescription)
        }
      }
    }

    AsyncFunction("saveDocument") { (name: String, contents: String, promise: Promise) in
      try DocumentStore.write(name, contents) { error in
        if let error { promise.reject("ERR_SAVE_DOCUMENT", error.localizedDescription) } else { promise.resolve(nil) }
      }
    }

    AsyncFunction("cancelFocusMove") { (generation: Int, restoringSource: Bool) in
      FocusHandoff.shared.cancel(generation, restoringSource: restoringSource)
    }.runOnQueue(.main)

    AsyncFunction("claimFocus") { [weak self] (generation: Int, tag: Int) in
      guard let view = self?.appContext?.findView(withTag: tag, ofType: NSView.self) else { return }
      FocusHandoff.shared.claim(generation, destination: view)
    }.runOnQueue(.main)

    AsyncFunction("saveKeyResponder") { (windowId: String) -> Int in
      SavedKeyResponders.shared.save(WindowManager.shared.windows[windowId])
    }.runOnQueue(.main)

    AsyncFunction("restoreKeyResponder") { (token: Int) -> Bool in
      SavedKeyResponders.shared.restore(token)
    }.runOnQueue(.main)

    AsyncFunction("discardKeyResponder") { (token: Int) in
      SavedKeyResponders.shared.discard(token)
    }.runOnQueue(.main)

    AsyncFunction("setSwitcherCapture") { [weak self] (active: Bool) in
      guard let self else { return }
      if let monitor = self.switcherMonitor { NSEvent.removeMonitor(monitor) }
      self.switcherMonitor = nil
      self.switcherPointer.start(active ? NSEvent.mouseLocation : nil)
      guard active else { return }
      let emit: ([String: Any]) -> Void = { [weak self] body in self?.sendEvent("onAppEvent", body) }
      self.switcherMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseUp, .rightMouseUp, .otherMouseUp]) { event in
        guard event.type == .keyDown else {
          emit(["type": "switcherMouseUp"])
          return event
        }
        if MainMenu.isSwitcherKey(event) { return event }
        switch event.keyCode {
        case 53: emit(["type": "switcherKey", "key": "escape"])
        case 124: emit(["type": "switcherKey", "key": "next"])
        case 123: emit(["type": "switcherKey", "key": "previous"])
        default: break
        }
        return nil
      }
    }.runOnQueue(.main)

    AsyncFunction("setDragEscapeCapture") { [weak self] (active: Bool) in
      guard let self else { return }
      if let monitor = self.dragEscapeMonitor { NSEvent.removeMonitor(monitor) }
      self.dragEscapeMonitor = nil
      guard active else { return }
      let emit: ([String: Any]) -> Void = { [weak self] body in self?.sendEvent("onAppEvent", body) }
      self.dragEscapeMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
        let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
        guard event.keyCode == 53 || event.charactersIgnoringModifiers == "\u{1b}", modifiers.isEmpty else { return event }
        emit(["type": "dragEscape"])
        return nil
      }
    }.runOnQueue(.main)

    Function("switcherPointerMoved") { [weak self] () -> Bool in self?.switcherPointer.moved(to: NSEvent.mouseLocation) ?? true }

    Function("copyText") { (text: String) in
      DispatchQueue.main.async {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
      }
    }

    AsyncFunction("showMenu") { (items: [[String: Any]], promise: Promise) in
      let target = MenuChoice()
      let menu = ShellModule.contextMenu(items, target: target)
      menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
      DispatchQueue.main.async { promise.resolve(target.chosen) }
    }.runOnQueue(.main)

    View(WindowDragRegion.self) {
      Events("onRegionDoubleClick", "onRegionClick")
      Prop("titleBarDoubleClick") { (view: WindowDragRegion, on: Bool) in view.titleBarDoubleClick = on }
      Prop("clickable") { (view: WindowDragRegion, on: Bool) in view.clickable = on }
    }
  }

  private func observeForSidebar() {
    let emit: (String) -> Void = { [weak self] type in self?.sendEvent("onAppEvent", ["type": type]) }
    let quiet = { NSApp.modalWindow == nil && !NSApp.windows.contains { $0.attachedSheet != nil || $0.isSheet && $0.isVisible } }
    let workspace = NotificationCenter.default
    sidebarObservers.append((workspace, workspace.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { _ in
      if quiet() { emit("resignActive") }
    }))
    let distributed = DistributedNotificationCenter.default()
    sidebarObservers.append((distributed, distributed.addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in
      if quiet() { emit("screenLocked") }
    }))
    SwitcherHold.onRelease = { emit("switcherReleased") }
    flagsMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { event in
      if SwitcherHold.released(by: event.modifierFlags) { emit("switcherReleased") }
      return event
    }
  }

  static var isDark: Bool {
    NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
  }

  static func alert(_ options: [String: Any]) -> NSAlert {
    let alert = NSAlert()
    alert.messageText = options["title"] as? String ?? ""
    alert.informativeText = options["message"] as? String ?? ""
    return alert
  }

  static func present(_ alert: NSAlert, windowId: String?, completion: @escaping (NSApplication.ModalResponse) -> Void) {
    if let window = windowId.flatMap({ WindowManager.shared.windows[$0] }), window.isVisible {
      alert.beginSheetModal(for: window, completionHandler: completion)
    } else {
      completion(alert.runModal())
    }
  }

  static func contextMenu(_ items: [[String: Any]], target: MenuChoice) -> NSMenu {
    let menu = NSMenu()
    menu.autoenablesItems = false
    let modifierNames: [String: NSEvent.ModifierFlags] = [
      "command": .command, "shift": .shift, "option": .option, "control": .control,
    ]
    for item in items {
      if item["separator"] as? Bool == true {
        menu.addItem(.separator())
        continue
      }
      let entry = NSMenuItem(title: item["title"] as? String ?? "", action: nil, keyEquivalent: item["key"] as? String ?? "")
      if let mods = item["modifiers"] as? [String] {
        entry.keyEquivalentModifierMask = NSEvent.ModifierFlags(mods.compactMap { modifierNames[$0] })
      }
      if let children = item["children"] as? [[String: Any]] {
        entry.submenu = contextMenu(children, target: target)
      } else if item["share"] as? Bool == true {
        let id = item["id"] as? String ?? ""
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        SharePicker.menuItems(target: target, action: #selector(MenuChoice.choose(_:)), choice: { "\(id):via:\($0)" })
          .forEach(submenu.addItem)
        entry.submenu = submenu
      } else {
        entry.action = #selector(MenuChoice.choose(_:))
        entry.target = target
        entry.representedObject = item["id"]
      }
      entry.isAlternate = item["alternate"] as? Bool == true
      entry.isEnabled = item["enabled"] as? Bool ?? true
      entry.state = item["checked"] as? Bool == true ? .on : .off
      if let symbol = item["symbol"] as? String {
        entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
      } else if let hex = item["swatch"] as? String, let light = NSColor(hex: hex) {
        let dark = (item["swatchDark"] as? String).flatMap { NSColor(hex: $0) } ?? light
        entry.image = swatch(NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light })
        if #available(macOS 27.0, *) { entry.preferredImageVisibility = .visible }
      }
      menu.addItem(entry)
    }
    return menu
  }

  static func swatch(_ color: NSColor) -> NSImage {
    NSImage(size: NSSize(width: 12, height: 12), flipped: false) { rect in
      color.setFill()
      NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).fill()
      NSColor.black.withAlphaComponent(0.15).setStroke()
      NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).stroke()
      return true
    }
  }
}

final class MenuChoice: NSObject {
  var chosen: String?
  @objc func choose(_ sender: NSMenuItem) { chosen = sender.representedObject as? String }
}

public enum ShellApp {
  public static func shouldTerminate() -> NSApplication.TerminateReply { WindowManager.shared.shouldTerminate() }
  public static func reopen(hasVisibleWindows: Bool) -> Bool {
    if !hasVisibleWindows { WindowManager.shared.reopen() }
    return true
  }
  public static func dockMenu() -> NSMenu { MainMenu.dockMenu() }
}

public class FadeLabelModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaFadeLabel")

    View(FadeLabel.self) {
      Prop("text") { (view: FadeLabel, v: String) in view.text = v }
      Prop("fontSize") { (view: FadeLabel, v: Double) in view.fontSize = v }
      Prop("weight") { (view: FadeLabel, v: String) in view.weight = v }
      Prop("color") { (view: FadeLabel, hex: String) in view.color = NSColor(hex: hex) ?? .labelColor }
      Prop("fadeWidth") { (view: FadeLabel, v: Double) in view.fadeWidth = v }
    }
  }
}

final class FadeLabel: ExpoView {
  private let field = NSTextField(labelWithString: "")
  private let fade = CAGradientLayer()

  var text = "" { didSet { update() } }
  var fontSize: Double = 13 { didSet { update() } }
  var weight = "regular" { didSet { update() } }
  var color: NSColor = .labelColor { didSet { field.textColor = color } }
  var fadeWidth: Double = 24 { didSet { relayout() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    clipsToBounds = true
    field.lineBreakMode = .byClipping
    field.maximumNumberOfLines = 1
    field.cell?.truncatesLastVisibleLine = false
    field.isSelectable = false
    addSubview(field)
    fade.colors = [NSColor.black.cgColor, NSColor.black.cgColor, NSColor.clear.cgColor]
    fade.startPoint = CGPoint(x: 0, y: 0.5)
    fade.endPoint = CGPoint(x: 1, y: 0.5)
    update()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    relayout()
  }

  private func update() {
    let weights: [String: NSFont.Weight] = [
      "light": .light, "regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold,
    ]
    field.font = .monospacedDigitSystemFont(ofSize: fontSize, weight: weights[weight] ?? .regular)
    field.stringValue = text
    field.textColor = color
    relayout()
  }

  private func relayout() {
    let fitting = field.fittingSize
    field.frame = NSRect(x: 0, y: (bounds.height - fitting.height) / 2, width: max(bounds.width, fitting.width), height: fitting.height)
    field.wantsLayer = true
    guard bounds.width > 0, fitting.width > bounds.width + 0.5 else {
      field.layer?.mask = nil
      return
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    fade.frame = CGRect(x: 0, y: 0, width: bounds.width, height: field.frame.height)
    let start = max(0, 1 - fadeWidth / bounds.width)
    fade.locations = [0, NSNumber(value: start), 1]
    field.layer?.mask = fade
    CATransaction.commit()
  }
}

public class ActivitySpinnerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaActivitySpinner")

    View(ActivitySpinner.self) {}
  }
}

final class ActivitySpinner: ExpoView {
  private let track = CAShapeLayer()
  private let ring = CAShapeLayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    for shape in [track, ring] {
      shape.fillColor = nil
      shape.lineWidth = 1.5
    }
    ring.lineCap = .round
    ring.strokeStart = 0
    ring.strokeEnd = 0.72
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    relayout()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    relayout()
    spin()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    recolor()
  }

  private func relayout() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for shape in [track, ring] where shape.superlayer !== layer { layer.addSublayer(shape) }
    let path = CGPath(ellipseIn: bounds.insetBy(dx: 1.25, dy: 1.25), transform: nil)
    for shape in [track, ring] {
      shape.frame = bounds
      shape.path = path
    }
    CATransaction.commit()
    recolor()
  }

  private func recolor() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      track.strokeColor = NSColor.secondaryLabelColor.withAlphaComponent(0.18).cgColor
      ring.strokeColor = NSColor.secondaryLabelColor.cgColor
    }
  }

  private func spin() {
    guard window != nil, ring.animation(forKey: "activityRotation") == nil else { return }
    let turn = CABasicAnimation(keyPath: "transform.rotation.z")
    turn.fromValue = 0
    turn.toValue = isFlipped ? 2 * Double.pi : -2 * Double.pi
    turn.duration = 1.88
    turn.repeatCount = .infinity
    turn.timingFunction = CAMediaTimingFunction(name: .linear)
    turn.isRemovedOnCompletion = false
    ring.add(turn, forKey: "activityRotation")
  }
}

public class SymbolModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaSymbol")

    View(SymbolView.self) {
      Prop("name") { (view: SymbolView, name: String) in view.name = name }
      Prop("size") { (view: SymbolView, size: Double) in view.pointSize = size }
      Prop("weight") { (view: SymbolView, weight: String) in view.weight = weight }
      Prop("color") { (view: SymbolView, hex: String) in view.tint = NSColor(hex: hex) }
    }
  }
}

enum ServerWindowDrag {
  private static let regions = NSHashTable<NSView>.weakObjects()
  private static let opaqueRectSelector = NSSelectorFromString("_opaqueRectForWindowMoveWhenInTitlebar")
  private static let refreshSelector = NSSelectorFromString("_updateDragRegionForHiddenStateChange")
  private static let enabled = ["1", "all"].contains(ProcessInfo.processInfo.environment["ARDIA_SERVER_WINDOW_DRAG"] ?? "")

  private static let refreshEvery: CFTimeInterval = 0.1
  private static var targets: [ObjectIdentifier: (blocking: [ObjectIdentifier: Bool], open: [NSRect])] = [:]
  private static var refreshedAt: [ObjectIdentifier: CFTimeInterval] = [:]
  private static let watchers = NSMapTable<NSWindow, PointerWatcher>.weakToStrongObjects()

  private static let lastWindow = NSMapTable<NSView, NSWindow>.weakToWeakObjects()

  static func track(_ region: NSView, bridge: AnyObject? = nil) {
    guard enabled, capable else { return }
    if let bridge { observeMounting(bridge) }
    if let old = lastWindow.object(forKey: region), old !== region.window { refresh(old) }
    if let window = region.window {
      regions.add(region)
      lastWindow.setObject(window, forKey: region)
      watch(window)
      refresh(window)
    } else {
      regions.remove(region)
      lastWindow.removeObject(forKey: region)
    }
  }

  static func refresh(_ view: NSView) {
    if let window = view.window { refresh(window) }
  }

  static func refresh(_ window: NSWindow) {
    guard enabled, capable, let content = window.contentView else { return }
    targets[ObjectIdentifier(window)] = nil
    refreshedAt[ObjectIdentifier(window)] = CACurrentMediaTime()
    content.perform(refreshSelector)
  }

  private static func watch(_ window: NSWindow) {
    guard watchers.object(forKey: window) == nil, let frame = window.contentView?.superview else { return }
    watchers.setObject(PointerWatcher(frame), forKey: window)
    let key = ObjectIdentifier(window)
    var closing: NSObjectProtocol?
    closing = NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { _ in
      targets[key] = nil
      refreshedAt[key] = nil
      pending[key]?.cancel()
      pending[key] = nil
      if let closing { NotificationCenter.default.removeObserver(closing) }
    }
  }

  static func pointerMoved(in window: NSWindow, at point: NSPoint) {
    guard point.y >= window.frame.height - band(window) else { return }
    scheduleRefresh(window)
    let now = CACurrentMediaTime()
    if let last = refreshedAt[ObjectIdentifier(window)], now - last < refreshEvery { return }
    refresh(window)
  }

  private static var pending: [ObjectIdentifier: DispatchWorkItem] = [:]

  static func scheduleRefresh(_ window: NSWindow) {
    let key = ObjectIdentifier(window)
    pending[key]?.cancel()
    let work = DispatchWorkItem { [weak window] in
      pending[key] = nil
      if let window { refresh(window) }
    }
    pending[key] = work
    DispatchQueue.main.asyncAfter(deadline: .now() + refreshEvery, execute: work)
  }

  static func scheduleRefreshAll() {
    var seen = Set<ObjectIdentifier>()
    for region in regions.allObjects {
      guard let window = region.window, seen.insert(ObjectIdentifier(window)).inserted else { continue }
      scheduleRefresh(window)
    }
  }

  private static var mounting: MountWatcher?
  private static var eventMonitor: Any?

  private static func observeMounting(_ bridge: AnyObject) {
    guard mounting == nil,
          let manager = bridge.value(forKey: "uiManager") as AnyObject?,
          let coordinator = manager.value(forKey: "observerCoordinator") as AnyObject?
    else { return }
    let watcher = MountWatcher()
    let add = NSSelectorFromString("addObserver:")
    guard coordinator.responds(to: add) else { return }
    _ = coordinator.perform(add, with: watcher)
    mounting = watcher
    eventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseUp, .rightMouseUp, .otherMouseUp, .keyUp, .flagsChanged]) { event in
      if let window = event.window { scheduleRefresh(window) }
      return event
    }
  }

  static func band(_ window: NSWindow) -> CGFloat {
    max(0, window.frame.height - window.contentLayoutRect.height)
  }

  private static func openRects(_ window: NSWindow) -> [NSRect] {
    let height = window.frame.height
    let strip = NSRect(x: 0, y: height - band(window), width: window.frame.width, height: band(window))
    return regions.allObjects.filter { $0.window === window && !$0.isHiddenOrHasHiddenAncestor }
      .map { windowRect($0).intersection(strip) }
      .filter { !$0.isEmpty }
  }

  private static func topLayer(_ window: NSWindow?) -> CALayer? { window?.contentView?.superview?.layer }

  static func windowRect(_ view: NSView) -> NSRect {
    if let layer = view.layer, let top = topLayer(view.window) { return layer.convert(layer.bounds, to: top) }
    return view.convert(view.bounds, to: nil)
  }

  private static func transformed(_ view: NSView) -> Bool {
    guard let layer = view.layer else { return false }
    return !CATransform3DIsIdentity(layer.transform) || !layer.affineTransform().isIdentity
  }

  private static func zOrdered(_ view: NSView) -> [NSView] {
    let sorted = NSSelectorFromString("reactZIndexSortedSubviews")
    if view.responds(to: sorted), let subviews = view.perform(sorted)?.takeUnretainedValue() as? [NSView] { return subviews }
    return view.subviews
  }

  private enum Layer { case region, beneath, above, inert }

  private static func classify(_ window: NSWindow) -> (blocking: [ObjectIdentifier: Bool], open: [NSRect]) {
    let key = ObjectIdentifier(window)
    if let cached = targets[key] { return cached }
    let open = openRects(window)
    var blocking: [ObjectIdentifier: Bool] = [:]
    let rn: AnyClass? = NSClassFromString("RCTView")
    func pointerEvents(_ view: NSView) -> Int {
      guard let rn, view.isKind(of: rn) else { return 0 }
      return (view.value(forKey: "pointerEvents") as? NSNumber)?.intValue ?? 0
    }
    var moving = false
    func visit(_ view: NSView, _ layer: Layer) {
      let frame = windowRect(view)
      guard !moving, !view.isHidden, open.contains(where: { $0.intersects(frame) }) else { return }
      if transformed(view) {
        moving = true
        return
      }
      var children = layer
      switch leadsToRegion(view) ? .region : layer {
      case .region:
        blocking[ObjectIdentifier(view)] = false
        var passed = false
        for child in zOrdered(view) {
          if leadsToRegion(child) {
            passed = true
            visit(child, .region)
          } else {
            visit(child, passed ? .above : .beneath)
          }
        }
        return
      case .beneath, .inert:
        blocking[ObjectIdentifier(view)] = false
      case .above:
        if pointerEvents(view) == 1 {
          blocking[ObjectIdentifier(view)] = false
          children = .inert
        } else if takesPresses(view, in: frame, open) {
          blocking[ObjectIdentifier(view)] = view.alphaValue > 0
          return
        } else {
          blocking[ObjectIdentifier(view)] = false
        }
      }
      for child in zOrdered(view) { visit(child, children) }
    }
    if let root = embeddedRoot(window), leadsToRegion(root) { visit(root, .region) }
    if moving {
      targets[key] = ([:], [])
      return ([:], [])
    }
    targets[key] = (blocking, open)
    return (blocking, open)
  }

  private static func takesPresses(_ view: NSView, in frame: NSRect, _ open: [NSRect]) -> Bool {
    guard let parent = view.superview else { return true }
    for rect in open {
      let area = rect.intersection(frame)
      if area.isEmpty { continue }
      for i in 0..<5 {
        for j in 0..<3 {
          let point = NSPoint(x: area.minX + area.width * (CGFloat(i) + 0.5) / 5, y: area.minY + area.height * (CGFloat(j) + 0.5) / 3)
          let local = parent.layer.flatMap { layer in topLayer(view.window).map { layer.convert(point, from: $0) } } ?? parent.convert(point, from: nil)
          if view.hitTest(local) === view { return true }
        }
      }
    }
    return false
  }

  static func blocks(_ view: NSView) -> Bool {
    guard let window = view.window else { return true }
    return classify(window).blocking[ObjectIdentifier(view)] ?? true
  }

  static func leadsToRegion(_ view: NSView) -> Bool {
    regions.allObjects.contains { $0 === view || $0.isDescendant(of: view) }
  }

  private static let embeddedSelector = NSSelectorFromString("ardiaEmbeddedSubview")

  static func embeddedRoot(_ window: NSWindow?) -> NSView? {
    guard let content = window?.contentView, content.responds(to: embeddedSelector) else { return nil }
    return content.perform(embeddedSelector)?.takeUnretainedValue() as? NSView
  }

  static func hostsRoot(_ view: NSView) -> Bool {
    embeddedRoot(view.window) != nil && view === view.window?.contentView
  }

  static func inRoot(_ view: NSView) -> Bool {
    guard let root = embeddedRoot(view.window) else { return false }
    return view === root || view.isDescendant(of: root)
  }

  #if DEBUG
  static func blockedRects(_ window: NSWindow) -> [[Double]] {
    typealias Region = @convention(c) (AnyObject, Selector, NSRect) -> OpaquePointer?
    typealias Enumerate = @convention(c) (OpaquePointer) -> OpaquePointer?
    typealias Next = @convention(c) (OpaquePointer) -> UnsafePointer<CGRect>?
    let sel = NSSelectorFromString("_regionForOpaqueViewsBlockingDraggableFrame:")
    targets[ObjectIdentifier(window)] = nil
    guard window.responds(to: sel), let frame = window.contentView?.superview,
          let sky = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW),
          let enumerate = dlsym(sky, "CGSRegionEnumerator"), let next = dlsym(sky, "CGSNextRect"),
          let region = unsafeBitCast(window.method(for: sel), to: Region.self)(window, sel, frame.bounds),
          let rects = unsafeBitCast(enumerate, to: Enumerate.self)(region)
    else { return [] }
    var out: [[Double]] = []
    while let r = unsafeBitCast(next, to: Next.self)(rects) {
      out.append([r.pointee.minX, frame.bounds.height - r.pointee.maxY, r.pointee.width, r.pointee.height])
    }
    return out
  }
  #endif

  private typealias OpaqueRect = @convention(c) (AnyObject, Selector) -> NSRect

  private typealias CanMove = @convention(c) (AnyObject, Selector) -> Bool
  private static let canMoveSelector = #selector(getter: NSView.mouseDownCanMoveWindow)

  private static func matches(_ cls: AnyClass, _ selector: Selector, _ encoding: (String) -> Bool) -> Bool {
    guard let method = class_getInstanceMethod(cls, selector), let types = method_getTypeEncoding(method) else { return false }
    return encoding(String(cString: types))
  }

  private static let capable: Bool = {
    let noArguments = { (types: String) in types.hasSuffix("@0:8") }
    guard let host = NSClassFromString("BridgedContentView"), NSClassFromString("RCTView") != nil,
          host.instancesRespond(to: embeddedSelector),
          matches(NSView.self, opaqueRectSelector, { $0.hasPrefix("{CGRect=") && noArguments($0) }),
          matches(host, opaqueRectSelector, { $0.hasPrefix("{CGRect=") && noArguments($0) }),
          matches(NSView.self, refreshSelector, { $0.hasPrefix("v") && noArguments($0) }),
          matches(NSView.self, canMoveSelector, { ($0.hasPrefix("B") || $0.hasPrefix("c")) && noArguments($0) })
    else { return false }
    install(host)
    return true
  }()

  private static func install(_ host: AnyClass) {
    replaceRect(host) { view, original in hostsRoot(view) ? .zero : original() }
    replaceCanMove(host) { view, original in hostsRoot(view) ? true : original() }
    let allOpen = ProcessInfo.processInfo.environment["ARDIA_SERVER_WINDOW_DRAG"] == "all"
    replaceRect(NSView.self) { view, original in
      guard inRoot(view) else { return original() }
      return !allOpen && blocks(view) ? view.bounds : .zero
    }
    for name in ["NSView", "RCTUIView", "RCTView"] {
      guard let cls = NSClassFromString(name) else { continue }
      replaceCanMove(cls) { view, original in
        if inRoot(view) { return allOpen || !blocks(view) ? true : original() }
        return hostsRoot(view) ? true : original()
      }
    }
  }

  private static func replaceRect(_ cls: AnyClass, _ body: @escaping (NSView, () -> NSRect) -> NSRect) {
    guard let method = class_getInstanceMethod(cls, opaqueRectSelector) else { return }
    let original = unsafeBitCast(method_getImplementation(method), to: OpaqueRect.self)
    let block: @convention(block) (NSView) -> NSRect = { view in body(view) { original(view, opaqueRectSelector) } }
    let imp = imp_implementationWithBlock(block)
    if !class_addMethod(cls, opaqueRectSelector, imp, method_getTypeEncoding(method)) { method_setImplementation(method, imp) }
  }

  private static func replaceCanMove(_ cls: AnyClass, _ body: @escaping (NSView, () -> Bool) -> Bool) {
    guard let method = class_getInstanceMethod(cls, canMoveSelector) else { return }
    let original = unsafeBitCast(method_getImplementation(method), to: CanMove.self)
    let block: @convention(block) (NSView) -> Bool = { view in body(view) { original(view, canMoveSelector) } }
    let imp = imp_implementationWithBlock(block)
    if !class_addMethod(cls, canMoveSelector, imp, method_getTypeEncoding(method)) { method_setImplementation(method, imp) }
  }
}

final class MountWatcher: NSObject {
  @objc func uiManagerDidPerformMounting(_ manager: AnyObject) {
    DispatchQueue.main.async { ServerWindowDrag.scheduleRefreshAll() }
  }
}

final class PointerWatcher: NSObject {
  private weak var view: NSView?
  private var area: NSTrackingArea?

  init(_ view: NSView) {
    self.view = view
    super.init()
    let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
    view.addTrackingArea(area)
    self.area = area
  }

  deinit {
    if let area { view?.removeTrackingArea(area) }
  }

  @objc(mouseMoved:) func mouseMoved(with event: NSEvent) {
    guard let window = event.window else { return }
    ServerWindowDrag.pointerMoved(in: window, at: event.locationInWindow)
  }

  @objc(mouseEntered:) func mouseEntered(with event: NSEvent) { mouseMoved(with: event) }
  @objc(mouseExited:) func mouseExited(with event: NSEvent) {}
}

final class WindowDragRegion: ExpoView {
  let onRegionDoubleClick = EventDispatcher()
  let onRegionClick = EventDispatcher()
  var titleBarDoubleClick = true
  var clickable = false
  private static let dragDistance: CGFloat = 3
  private var monitor: Any?
  private var doubleClickDown: PressPlace?

  override var mouseDownCanMoveWindow: Bool {
    get { true }
    set {}
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    ServerWindowDrag.refresh(self)
  }

  override func setFrameOrigin(_ newOrigin: NSPoint) {
    super.setFrameOrigin(newOrigin)
    ServerWindowDrag.refresh(self)
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    ServerWindowDrag.track(self, bridge: appContext?.reactBridge)
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
    doubleClickDown = nil
    guard window != nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp]) { [weak self] event in
      guard let self else { return event }
      if event.type == .leftMouseUp {
        guard let down = self.doubleClickDown, event.window === self.window else { return event }
        self.doubleClickDown = nil
        if event.clickCount == 2 { self.doubleClick(event, down) }
        return nil
      }
      self.doubleClickDown = nil
      guard let place = self.pressPlace(event) else { return event }
      OutsidePressArea.tellAreas(event)
      self.press(event, place, releaseFollows: true)
      return nil
    }
  }

  deinit {
    if let monitor { NSEvent.removeMonitor(monitor) }
  }

  override func mouseDown(with event: NSEvent) {
    if let place = pressPlace(event) { press(event, place, releaseFollows: false) } else { super.mouseDown(with: event) }
  }

  private enum PressPlace { case region, titlebarEdge }

  private func pressPlace(_ event: NSEvent) -> PressPlace? {
    guard let window, event.window === window, !isHiddenOrHasHiddenAncestor, alphaValue > 0,
          !event.modifierFlags.contains(.control),
          let frame = window.contentView?.superview, let hit = frame.hitTest(event.locationInWindow)
    else { return nil }
    if hit === frame { return Self.onTitlebarTopEdge(window, frame, event.locationInWindow) ? .titlebarEdge : nil }
    guard bounds.contains(convert(event.locationInWindow, from: nil)) else { return nil }
    if hit === self || (clickable && hit.isDescendant(of: self)) { return .region }
    let background = hit is NSClipView || (hit.superview as? NSClipView)?.documentView === hit
    guard background, let container = superview, hit.isDescendant(of: container) else { return nil }
    var view = hit.superview
    while let v = view, v !== container {
      if !(v is NSClipView || v is NSScrollView), !v.mouseDownCanMoveWindow { return nil }
      view = v.superview
    }
    return .region
  }

  private static let resizeDirectionSelector = NSSelectorFromString("_resizeDirectionForMouseLocation:")

  private static func onTitlebarTopEdge(_ window: NSWindow, _ frame: NSView, _ point: NSPoint) -> Bool {
    let band = ServerWindowDrag.band(window)
    guard band > 0, frame.bounds.contains(point), point.y > frame.bounds.height - band,
          let method = class_getInstanceMethod(type(of: window), resizeDirectionSelector),
          method_getNumberOfArguments(method) == 3, returnType(method) == "q"
    else { return false }
    typealias Direction = @convention(c) (AnyObject, Selector, NSPoint) -> Int
    let direction = unsafeBitCast(method_getImplementation(method), to: Direction.self)
    let middle = NSPoint(x: frame.bounds.midX, y: point.y)
    return direction(window, resizeDirectionSelector, point) == direction(window, resizeDirectionSelector, middle)
  }

  private func press(_ event: NSEvent, _ place: PressPlace, releaseFollows: Bool) {
    guard let window else { return }
    var key = NSApp.keyWindow
    while let k = key, k !== window { key = k.parent }
    if key == nil, window.canBecomeKey, !event.modifierFlags.contains(.command) { window.makeKeyAndOrderFront(nil) }
    if clickable, place == .region { return clickOrDrag(event, in: window) }
    if event.clickCount == 2 {
      if releaseFollows { doubleClickDown = place } else { doubleClick(event, place) }
      return
    }
    window.performDrag(with: event)
  }

  private func clickOrDrag(_ down: NSEvent, in window: NSWindow) {
    let until: Date = NSEvent.pressedMouseButtons & 1 == 0 ? Date() : .distantFuture
    let start = down.locationInWindow
    while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp], until: until, inMode: .eventTracking, dequeue: true),
          next.type == .leftMouseDragged {
      if hypot(next.locationInWindow.x - start.x, next.locationInWindow.y - start.y) >= Self.dragDistance { return window.performDrag(with: down) }
    }
    onRegionClick([:])
  }

  private func doubleClick(_ event: NSEvent, _ place: PressPlace) {
    guard let window else { return }
    if titleBarDoubleClick || place == .titlebarEdge { Self.doubleClick(window, event.modifierFlags) } else { onRegionDoubleClick([:]) }
  }

  static func doubleClick(_ window: NSWindow, _ modifiers: NSEvent.ModifierFlags) {
    let sel = NSSelectorFromString("_handlePossibleDoubleClickWithModifiers:")
    if let frame = window.contentView?.superview, let method = class_getInstanceMethod(type(of: frame), sel),
       method_getNumberOfArguments(method) == 3, returnType(method) == "v" {
      typealias Handle = @convention(c) (AnyObject, Selector, UInt) -> Void
      unsafeBitCast(method_getImplementation(method), to: Handle.self)(frame, sel, modifiers.rawValue)
      return
    }
    let global = UserDefaults.standard.persistentDomain(forName: UserDefaults.globalDomain) ?? [:]
    let fill = NSSelectorFromString("_zoomFill:")
    switch global["AppleActionOnDoubleClick"] as? String {
    case "Minimize": window.performMiniaturize(nil)
    case "None": break
    case "Fill" where window.responds(to: fill): window.perform(fill, with: nil)
    case nil where (global["AppleMiniaturizeOnDoubleClick"] as? Bool) == true: window.performMiniaturize(nil)
    default: window.performZoom(nil)
    }
  }

  private static func returnType(_ method: Method) -> String {
    let type = method_copyReturnType(method)
    defer { free(type) }
    return String(cString: type)
  }
}

public class OutsidePressAreaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaOutsidePressArea")

    View(OutsidePressArea.self) {
      Events("onOutsidePress")
    }
  }
}

final class OutsidePressArea: ExpoView {
  let onOutsidePress = EventDispatcher()
  fileprivate static let areas = NSHashTable<OutsidePressArea>.weakObjects()
  private static let toldPresses = NSHashTable<NSEvent>(options: [.weakMemory, .objectPointerPersonality])

  static func tellAreas(_ event: NSEvent) {
    guard !toldPresses.contains(event) else { return }
    toldPresses.add(event)
    for area in areas.allObjects { area.pressed(event) }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    _ = installOutsidePressMonitor
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { Self.areas.add(self) } else { Self.areas.remove(self) }
  }

  fileprivate func pressed(_ event: NSEvent) {
    guard let window, event.window === window, !isHiddenOrHasHiddenAncestor else { return }
    if let hit = window.contentView?.superview?.hitTest(event.locationInWindow), hit.isDescendant(of: self) { return }
    onOutsidePress(["timestamp": event.timestamp * 1000])
  }
}

let installOutsidePressMonitor: Void = {
  _ = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { event in
    OutsidePressArea.tellAreas(event)
    return event
  }
}()

public class MagnifyAreaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaMagnifyArea")

    AsyncFunction("devMagnify") { (windowId: String, x: Double, y: Double, steps: [[String: Any]]) -> [String: Any] in
      #if DEBUG
      return MagnifyArea.devMagnify(windowId: windowId, x: x, y: y, steps: steps)
      #else
      return ["error": "DEV builds only"]
      #endif
    }.runOnQueue(.main)

    View(MagnifyArea.self) {
      Prop("enabled") { (view: MagnifyArea, on: Bool) in view.enabled = on }
      Events("onMagnify")
    }
  }
}

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
    guard let window = WindowManager.shared.windows[windowId], let content = window.contentView else { return ["error": "no window \(windowId)"] }
    let location = content.convert(NSPoint(x: x, y: content.isFlipped ? y : content.bounds.height - y), to: nil)
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

final class SymbolView: ExpoView {
  private let imageView = NSImageView()
  var name = "questionmark" { didSet { update() } }
  var pointSize: Double = 14 { didSet { update() } }
  var weight = "regular" { didSet { update() } }
  var tint: NSColor? { didSet { imageView.contentTintColor = tint } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    imageView.imageScaling = .scaleNone
    imageView.autoresizingMask = [.width, .height]
    addSubview(imageView)
    update()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    imageView.frame = bounds
  }

  private func update() {
    let weights: [String: NSFont.Weight] = [
      "light": .light, "regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold,
    ]
    let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: weights[weight] ?? .regular)
    imageView.image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config)
  }
}

extension NSColor {
  convenience init?(hex: String) {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else { return nil }
    let rgba = s.count == 6 ? (v << 8) | 0xFF : v
    self.init(
      srgbRed: CGFloat((rgba >> 24) & 0xFF) / 255, green: CGFloat((rgba >> 16) & 0xFF) / 255,
      blue: CGFloat((rgba >> 8) & 0xFF) / 255, alpha: CGFloat(rgba & 0xFF) / 255)
  }
}

let installTextFieldSelectAll: Void = {
  let block: @convention(block) (NSTextField, Any?) -> Void = { field, sender in
    if let editor = field.currentEditor() { editor.selectAll(sender) } else { field.selectText(sender) }
  }
  class_addMethod(NSTextField.self, #selector(NSText.selectAll(_:)), imp_implementationWithBlock(block), "v@:@")
}()

let installInputSourceKeys: Void = {
  let processKeyBindings = NSSelectorFromString("processInputKeyBindings:")
  let keyDown = #selector(NSResponder.keyDown(with:))
  guard NSTextInputContext.responds(to: processKeyBindings), let method = class_getInstanceMethod(NSTextView.self, keyDown) else { return }
  typealias KeyDown = @convention(c) (NSTextView, Selector, NSEvent) -> Void
  typealias ProcessKeyBindings = @convention(c) (AnyClass, Selector, NSEvent) -> ObjCBool
  let original = unsafeBitCast(method_getImplementation(method), to: KeyDown.self)
  let process = unsafeBitCast(NSTextInputContext.method(for: processKeyBindings), to: ProcessKeyBindings.self)
  let inputSourceKeys: Set<UInt16> = [UInt16(kVK_JIS_Eisu), UInt16(kVK_JIS_Kana)]
  let block: @convention(block) (NSTextView, NSEvent) -> Void = { view, event in
    if inputSourceKeys.contains(event.keyCode) {
      _ = process(NSTextInputContext.self, processKeyBindings, event)
    } else {
      original(view, keyDown, event)
    }
  }
  let imp = imp_implementationWithBlock(block)
  if !class_addMethod(NSTextView.self, keyDown, imp, method_getTypeEncoding(method)) { method_setImplementation(method, imp) }
}()

let installWindowMoveFallback: Void = {
  guard WindowMove.replacesNativeDrag else { return }
  let selector = #selector(NSWindow.performDrag(with:))
  guard let method = class_getInstanceMethod(NSWindow.self, selector) else { return }
  typealias PerformDrag = @convention(c) (NSWindow, Selector, NSEvent) -> Void
  let original = unsafeBitCast(method_getImplementation(method), to: PerformDrag.self)
  let block: @convention(block) (NSWindow, NSEvent) -> Void = { window, event in
    if !WindowMove.follow(window, from: event) { original(window, selector, event) }
  }
  method_setImplementation(method, imp_implementationWithBlock(block))
}()

enum WindowMove {
  static let replacesNativeDrag = ProcessInfo.processInfo.isOperatingSystemAtLeast(OperatingSystemVersion(majorVersion: 27, minorVersion: 0, patchVersion: 0))
  private static var following = false
  private static let staleAfter: TimeInterval = 0.012

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

let installScrollViewInsetFix: Void = {
  guard let cls = NSClassFromString("RCTCustomScrollView"),
        let method = class_getInstanceMethod(cls, #selector(NSView.init(frame:))) else { return }
  typealias Init = @convention(c) (AnyObject, Selector, NSRect) -> AnyObject
  let original = unsafeBitCast(method_getImplementation(method), to: Init.self)
  let block: @convention(block) (AnyObject, NSRect) -> AnyObject = { receiver, frame in
    let view = original(receiver, #selector(NSView.init(frame:)), frame)
    (view as? NSScrollView)?.automaticallyAdjustsContentInsets = false
    return view
  }
  let imp = imp_implementationWithBlock(block)
  if !class_addMethod(cls, #selector(NSView.init(frame:)), imp, method_getTypeEncoding(method)) {
    method_setImplementation(method, imp)
  }
}()

public class ContextMenuAreaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaContextMenuArea")

    View(ContextMenuArea.self) {
      Events("onContextMenu")
      Prop("captureDescendants") { (view: ContextMenuArea, on: Bool) in view.captureDescendants = on }
    }
  }
}

final class ContextMenuArea: ExpoView {
  let onContextMenu = EventDispatcher()
  var captureDescendants = false

  override func hitTest(_ point: NSPoint) -> NSView? {
    let hit = super.hitTest(point)
    guard captureDescendants, hit != nil, let event = NSApp.currentEvent else { return hit }
    let secondary = event.type == .rightMouseDown || (event.type == .leftMouseDown && event.modifierFlags.contains(.control))
    return secondary ? self : hit
  }

  override func rightMouseDown(with event: NSEvent) {
    onContextMenu([:])
  }

  override func mouseDown(with event: NSEvent) {
    if event.modifierFlags.contains(.control) {
      onContextMenu([:])
      return
    }
    super.mouseDown(with: event)
  }

  override func menu(for event: NSEvent) -> NSMenu? { nil }
}

public class VisualEffectModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaVisualEffect")

    View(VisualEffect.self) {
      Prop("material") { (view: VisualEffect, name: String) in view.setMaterial(name) }
      Prop("blendingMode") { (view: VisualEffect, name: String) in
        view.effect.blendingMode = name == "behindWindow" ? .behindWindow : .withinWindow
      }
      Prop("cornerRadius") { (view: VisualEffect, v: Double) in view.cornerRadius = v }
    }
  }
}

final class VisualEffect: ExpoView {
  let effect = NSVisualEffectView()
  var cornerRadius: Double = 0 { didSet { applyCorners() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    effect.state = .active
    effect.blendingMode = .withinWindow
    effect.material = .hudWindow
    effect.wantsLayer = true
    addSubview(effect)
  }

  func setMaterial(_ name: String) {
    let materials: [String: NSVisualEffectView.Material] = [
      "hudWindow": .hudWindow, "popover": .popover, "menu": .menu, "sidebar": .sidebar,
      "headerView": .headerView, "sheet": .sheet, "windowBackground": .windowBackground,
      "underWindowBackground": .underWindowBackground, "contentBackground": .contentBackground,
      "fullScreenUI": .fullScreenUI, "toolTip": .toolTip, "titlebar": .titlebar, "selection": .selection,
    ]
    effect.material = materials[name] ?? .hudWindow
  }

  private func applyCorners() {
    effect.layer?.cornerRadius = cornerRadius
    effect.layer?.cornerCurve = .continuous
    effect.layer?.masksToBounds = cornerRadius > 0
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    effect.frame = bounds
    applyCorners()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

public class GlassEffectModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaGlassEffect")

    Function("isLiquidGlass") { () -> Bool in
      if #available(macOS 26.0, *) { return true }
      return false
    }

    View(GlassEffect.self) {
      Prop("cornerRadius") { (view: GlassEffect, v: Double) in view.cornerRadius = v }
      Prop("tint") { (view: GlassEffect, hex: String?) in view.tint = hex.flatMap(NSColor.init(hex:)) }
      Prop("glassStyle") { (view: GlassEffect, style: String?) in view.clear = style == "clear" }
      Prop("dark") { (view: GlassEffect, dark: Bool?) in view.appearance = dark.map { NSAppearance(named: $0 ? .darkAqua : .aqua) } ?? nil }
    }
  }
}

final class GlassEffect: ExpoView {
  private let effect: NSView
  private let tintLayer = CALayer()
  var cornerRadius: Double = 0 { didSet { apply() } }
  var tint: NSColor? { didSet { apply() } }
  var clear = false { didSet { apply() } }

  required init(appContext: AppContext? = nil) {
    if #available(macOS 26.0, *) {
      effect = NSGlassEffectView()
    } else {
      let material = NSVisualEffectView()
      material.material = .sidebar
      material.blendingMode = .behindWindow
      material.state = .followsWindowActiveState
      material.wantsLayer = true
      tintLayer.actions = ["backgroundColor": NSNull(), "bounds": NSNull(), "position": NSNull()]
      material.layer?.addSublayer(tintLayer)
      effect = material
    }
    super.init(appContext: appContext)
    addSubview(effect)
    apply()
  }

  private func apply() {
    if #available(macOS 26.0, *), let glass = effect as? NSGlassEffectView {
      glass.cornerRadius = cornerRadius
      glass.tintColor = tint
      glass.style = clear ? .clear : .regular
      return
    }
    effect.layer?.cornerRadius = cornerRadius
    effect.layer?.cornerCurve = .continuous
    effect.layer?.masksToBounds = cornerRadius > 0
    tintLayer.frame = effect.bounds
    tintLayer.backgroundColor = tint?.cgColor
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    effect.frame = bounds
    if tintLayer.superlayer != nil { tintLayer.frame = effect.bounds }
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

public class SurfaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaSurface")

    View(Surface.self) {
      Prop("fill") { (view: Surface, hex: String?) in view.surfaceFill = hex.flatMap(NSColor.init(hex:)) }
      Prop("cornerRadius") { (view: Surface, v: Double) in view.surfaceRadius = v }
      Prop("borderColor") { (view: Surface, hex: String?) in view.surfaceBorderColor = hex.flatMap(NSColor.init(hex:)) }
      Prop("borderWidth") { (view: Surface, v: Double) in view.surfaceBorderWidth = v }
      Prop("borderColors") { (view: Surface, hexes: [String]?) in view.surfaceBorderColors = (hexes ?? []).compactMap(NSColor.init(hex:)) }
      Prop("surfaceShadowColor") { (view: Surface, hex: String?) in view.surfaceShadowColor = hex.flatMap(NSColor.init(hex:)) }
      Prop("surfaceShadowOpacity") { (view: Surface, v: Double) in view.surfaceShadowOpacity = v }
      Prop("surfaceShadowRadius") { (view: Surface, v: Double) in view.surfaceShadowRadius = v }
      Prop("surfaceShadowOffset") { (view: Surface, v: [Double]) in view.surfaceShadowOffset = v.count == 2 ? CGSize(width: v[0], height: v[1]) : .zero }
    }
  }
}

final class Surface: ExpoView {
  var surfaceFill: NSColor? { didSet { apply() } }
  var surfaceRadius: Double = 0 { didSet { apply() } }
  var surfaceBorderColor: NSColor? { didSet { apply() } }
  var surfaceBorderWidth: Double = 0 { didSet { apply() } }
  var surfaceBorderColors: [NSColor] = [] { didSet { apply() } }
  var surfaceShadowColor: NSColor? { didSet { apply() } }
  var surfaceShadowOpacity: Double = 0 { didSet { apply() } }
  var surfaceShadowRadius: Double = 0 { didSet { apply() } }
  var surfaceShadowOffset: CGSize = .zero { didSet { apply() } }

  private let plate = CALayer()
  private let shadowLayer = CALayer()
  private let shadowMask = CAShapeLayer()
  private let borderGradient = CAGradientLayer()
  private let borderStroke = CAShapeLayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
  }

  override func layout() {
    super.layout()
    apply()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    apply()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    apply()
  }

  override func updateLayer() {
    super.updateLayer()
    apply()
  }

  private func apply() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if borderGradient.superlayer !== layer {
      layer.insertSublayer(borderGradient, at: 0)
      borderStroke.fillColor = nil
      borderStroke.strokeColor = NSColor.black.cgColor
      borderGradient.mask = borderStroke
    }
    if plate.superlayer !== layer {
      layer.insertSublayer(plate, at: 0)
      layer.insertSublayer(shadowLayer, below: plate)
      shadowMask.fillRule = .evenOdd
      shadowLayer.mask = shadowMask
    }
    layer.masksToBounds = false
    plate.frame = bounds
    plate.cornerRadius = surfaceRadius
    plate.cornerCurve = .continuous
    plate.backgroundColor = surfaceFill?.cgColor
    plate.borderColor = surfaceBorderColor?.cgColor
    plate.borderWidth = surfaceBorderWidth

    if surfaceBorderColors.count >= 2, surfaceBorderWidth > 0 {
      borderGradient.isHidden = false
      borderGradient.frame = bounds
      borderGradient.colors = surfaceBorderColors.map(\.cgColor)
      let flipped = layer.isGeometryFlipped || isFlipped
      borderGradient.startPoint = CGPoint(x: 0.5, y: flipped ? 0 : 1)
      borderGradient.endPoint = CGPoint(x: 0.5, y: flipped ? 1 : 0)
      let inset = surfaceBorderWidth / 2
      borderStroke.frame = bounds
      borderStroke.lineWidth = surfaceBorderWidth
      borderStroke.path = CGPath(
        roundedRect: bounds.insetBy(dx: inset, dy: inset),
        cornerWidth: max(surfaceRadius - inset, 0), cornerHeight: max(surfaceRadius - inset, 0), transform: nil)
      plate.borderWidth = 0
    } else {
      borderGradient.isHidden = true
    }

    let shape = CGPath(roundedRect: bounds, cornerWidth: surfaceRadius, cornerHeight: surfaceRadius, transform: nil)
    shadowLayer.frame = bounds
    if let shadowColor = surfaceShadowColor, surfaceShadowOpacity > 0 {
      shadowLayer.shadowColor = shadowColor.cgColor
      shadowLayer.shadowOpacity = Float(surfaceShadowOpacity)
      shadowLayer.shadowRadius = surfaceShadowRadius
      shadowLayer.shadowOffset = CGSize(width: surfaceShadowOffset.width, height: layer.isGeometryFlipped || isFlipped ? surfaceShadowOffset.height : -surfaceShadowOffset.height)
      shadowLayer.shadowPath = shape
      let outset = surfaceShadowRadius * 3 + abs(surfaceShadowOffset.height) + abs(surfaceShadowOffset.width) + 4
      let mask = CGMutablePath()
      mask.addRect(bounds.insetBy(dx: -outset, dy: -outset))
      mask.addPath(shape)
      shadowMask.frame = bounds
      shadowMask.path = mask
      shadowLayer.isHidden = false
    } else {
      shadowLayer.isHidden = true
    }
    CATransaction.commit()
  }
}

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

final class SavedKeyResponders {
  static let shared = SavedKeyResponders()

  private final class Saved {
    weak var window: NSWindow?
    weak var responder: NSView?
    let selection: NSRange?
    init(window: NSWindow, responder: NSView, selection: NSRange?) {
      self.window = window
      self.responder = responder
      self.selection = selection
    }
  }

  private var saved: [Int: Saved] = [:]
  private var next = 0

  func save(_ window: NSWindow?) -> Int {
    saved = saved.filter { $0.value.window != nil && $0.value.responder != nil }
    guard let window, let responder = Self.owner(of: window.firstResponder) else { return 0 }
    let editor = window.firstResponder as? NSTextView
    next += 1
    saved[next] = Saved(window: window, responder: responder, selection: editor?.isFieldEditor == true ? editor?.selectedRange() : nil)
    return next
  }

  func restore(_ token: Int) -> Bool {
    guard let entry = saved.removeValue(forKey: token), let window = entry.window, let view = entry.responder,
      view.window === window, !view.isHiddenOrHasHiddenAncestor, view.acceptsFirstResponder
    else { return false }
    guard window.makeFirstResponder(view) else { return false }
    if let selection = entry.selection, let editor = (view as? NSTextField)?.currentEditor() as? NSTextView,
      NSMaxRange(selection) <= (editor.string as NSString).length
    {
      editor.setSelectedRange(selection)
    }
    return true
  }

  func discard(_ token: Int) {
    saved.removeValue(forKey: token)
  }

  private static func owner(of responder: NSResponder?) -> NSView? {
    if let editor = responder as? NSTextView, editor.isFieldEditor, let field = editor.delegate as? NSView { return field }
    return responder as? NSView
  }
}

public class PopoverBubbleModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPopoverBubble")

    Function("isAvailable") { () -> Bool in true }

    View(PopoverBubble.self) {
      Prop("material") { (view: PopoverBubble, name: String?) in view.setMaterial(name) }
      Prop("dark") { (view: PopoverBubble, dark: Bool?) in view.appearance = dark.map { NSAppearance(named: $0 ? .darkAqua : .aqua) } ?? nil }
      Prop("cornerRadius") { (view: PopoverBubble, v: Double) in view.cornerRadius = v }
      Prop("arrowEdge") { (view: PopoverBubble, edge: String?) in view.arrowEdge = PopoverBubble.Edge(rawValue: edge ?? "") ?? .none }
      Prop("arrowX") { (view: PopoverBubble, v: Double) in view.arrowX = v }
      Prop("arrowWidth") { (view: PopoverBubble, v: Double) in view.arrowWidth = v }
      Prop("arrowHeight") { (view: PopoverBubble, v: Double) in view.arrowHeight = v }
      Prop("tint") { (view: PopoverBubble, hex: String?) in view.tint = hex.flatMap(NSColor.init(hex:)) }
      Prop("edgeColor") { (view: PopoverBubble, hex: String?) in view.edgeColor = hex.flatMap(NSColor.init(hex:)) }
      Prop("edgeWidth") { (view: PopoverBubble, v: Double) in view.edgeWidth = v }
      Prop("bubbleShadowOpacity") { (view: PopoverBubble, v: Double) in view.bubbleShadowOpacity = v }
      Prop("bubbleShadowRadius") { (view: PopoverBubble, v: Double) in view.bubbleShadowRadius = v }
      Prop("bubbleShadowOffsetY") { (view: PopoverBubble, v: Double) in view.bubbleShadowOffsetY = v }
    }
  }
}

final class PopoverBubbleOverlay: NSView {
  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

final class PopoverBubble: ExpoView {
  enum Edge: String { case top, bottom, none }

  let effect = NSVisualEffectView()
  private let overlay = PopoverBubbleOverlay()
  private let shadowLayer = CALayer()
  private let shadowMask = CAShapeLayer()
  private let tintLayer = CAShapeLayer()
  private let edgeLayer = CAShapeLayer()
  private let edgeMask = CAShapeLayer()
  private var maskKey = ""

  var cornerRadius: Double = 12 { didSet { apply() } }
  var arrowEdge: Edge = .none { didSet { apply() } }
  var arrowX: Double = 0 { didSet { apply() } }
  var arrowWidth: Double = 20 { didSet { apply() } }
  var arrowHeight: Double = 9 { didSet { apply() } }
  var tint: NSColor? { didSet { apply() } }
  var edgeColor: NSColor? { didSet { apply() } }
  var edgeWidth: Double = 0 { didSet { apply() } }
  var bubbleShadowOpacity: Double = 0 { didSet { apply() } }
  var bubbleShadowRadius: Double = 0 { didSet { apply() } }
  var bubbleShadowOffsetY: Double = 0 { didSet { apply() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    effect.state = .active
    effect.blendingMode = .withinWindow
    effect.material = .popover
    addSubview(effect)
    overlay.wantsLayer = true
    overlay.layer?.masksToBounds = false
    shadowMask.fillRule = .evenOdd
    shadowLayer.mask = shadowMask
    shadowLayer.shadowColor = NSColor.black.cgColor
    edgeLayer.fillColor = nil
    edgeLayer.mask = edgeMask
    overlay.layer?.addSublayer(shadowLayer)
    overlay.layer?.addSublayer(tintLayer)
    overlay.layer?.addSublayer(edgeLayer)
    addSubview(overlay)
  }

  func setMaterial(_ name: String?) {
    let materials: [String: NSVisualEffectView.Material] = [
      "popover": .popover, "menu": .menu, "hudWindow": .hudWindow, "sheet": .sheet, "toolTip": .toolTip,
    ]
    effect.material = name.flatMap { materials[$0] } ?? .popover
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    apply()
  }

  override func layout() {
    super.layout()
    apply()
  }

  static func shape(size: CGSize, radius: CGFloat, edge: Edge, arrowX: CGFloat, arrowWidth: CGFloat, arrowHeight: CGFloat) -> CGPath {
    let lift = edge == .none ? 0 : min(arrowHeight, size.height)
    let body = CGRect(x: 0, y: lift, width: size.width, height: size.height - lift)
    let r = max(0, min(radius, body.width / 2, body.height / 2))
    let half = arrowWidth / 2
    guard edge != .none, half > 0, body.width >= 2 * (r + half) else {
      return CGPath(roundedRect: body, cornerWidth: r, cornerHeight: r, transform: nil)
    }
    let x = min(max(arrowX, r + half), body.width - r - half)
    let top = body.minY
    let path = CGMutablePath()
    path.move(to: CGPoint(x: r, y: top))
    path.addArc(tangent1End: CGPoint(x: x - half, y: top), tangent2End: CGPoint(x: x, y: 0), radius: 3)
    path.addArc(tangent1End: CGPoint(x: x, y: 0), tangent2End: CGPoint(x: x + half, y: top), radius: 2.5)
    path.addArc(tangent1End: CGPoint(x: x + half, y: top), tangent2End: CGPoint(x: body.maxX - r, y: top), radius: 3)
    path.addArc(tangent1End: CGPoint(x: body.maxX, y: top), tangent2End: CGPoint(x: body.maxX, y: body.maxY), radius: r)
    path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.maxY), tangent2End: CGPoint(x: body.minX, y: body.maxY), radius: r)
    path.addArc(tangent1End: CGPoint(x: body.minX, y: body.maxY), tangent2End: CGPoint(x: body.minX, y: top), radius: r)
    path.addArc(tangent1End: CGPoint(x: body.minX, y: top), tangent2End: CGPoint(x: r, y: top), radius: r)
    path.closeSubpath()
    if edge == .top { return path }
    var flip = CGAffineTransform(translationX: 0, y: size.height).scaledBy(x: 1, y: -1)
    return path.copy(using: &flip) ?? path
  }

  private func apply() {
    let size = bounds.size
    effect.frame = bounds
    overlay.frame = bounds
    guard size.width > 0, size.height > 0 else { return }
    let path = Self.shape(
      size: size, radius: cornerRadius, edge: arrowEdge, arrowX: arrowX, arrowWidth: arrowWidth, arrowHeight: arrowHeight)

    let key = "\(size.width)x\(size.height) \(cornerRadius) \(arrowEdge.rawValue) \(arrowX) \(arrowWidth) \(arrowHeight)"
    if key != maskKey {
      maskKey = key
      effect.maskImage = NSImage(size: size, flipped: true) { _ in
        guard let context = NSGraphicsContext.current?.cgContext else { return false }
        context.setFillColor(NSColor.black.cgColor)
        context.addPath(path)
        context.fillPath()
        return true
      }
    }

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let local = overlay.bounds
    tintLayer.frame = local
    tintLayer.path = path
    tintLayer.fillColor = tint?.cgColor

    edgeLayer.frame = local
    edgeMask.frame = local
    edgeMask.path = path
    edgeLayer.path = path
    edgeLayer.lineWidth = edgeWidth * 2
    edgeLayer.strokeColor = edgeColor?.cgColor
    edgeLayer.isHidden = edgeColor == nil || edgeWidth <= 0

    shadowLayer.frame = local
    if bubbleShadowOpacity > 0 {
      shadowLayer.isHidden = false
      shadowLayer.shadowOpacity = Float(bubbleShadowOpacity)
      shadowLayer.shadowRadius = bubbleShadowRadius
      let flipped = overlay.layer?.isGeometryFlipped == true || overlay.isFlipped
      shadowLayer.shadowOffset = CGSize(width: 0, height: flipped ? bubbleShadowOffsetY : -bubbleShadowOffsetY)
      shadowLayer.shadowPath = path
      let outset = bubbleShadowRadius * 3 + abs(bubbleShadowOffsetY) + 4
      let mask = CGMutablePath()
      mask.addRect(local.insetBy(dx: -outset, dy: -outset))
      mask.addPath(path)
      shadowMask.frame = local
      shadowMask.path = mask
    } else {
      shadowLayer.isHidden = true
    }
    CATransaction.commit()
  }
}
