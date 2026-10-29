import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

public class ShellModule: Module {
  static func documentURL(_ name: String) throws -> URL {
    let dir: URL
    if let custom = LaunchConfig.shared.dataDirectory {
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
    Events(
      ShellEvents.Channel.command.rawValue, ShellEvents.Channel.openURLs.rawValue, ShellEvents.Channel.window.rawValue,
      ShellEvents.Channel.app.rawValue)

    OnCreate {
      _ = installTextFieldSelectAll
      _ = installInputSourceKeys
      _ = installScrollViewInsetFix
      _ = installOutsidePressMonitor
      _ = installWindowMoveFallback
      ShellEvents.attach(.command, to: self)
      ShellEvents.attach(.window, to: self)
      DispatchQueue.main.async { [weak self] in
        FocusHandoff.shared.install()
        if let queue = self?.appContext?.reactBridge?.uiManager.methodQueue {
          FocusHandoff.shared.afterPendingUI = { block in queue.async { DispatchQueue.main.async(execute: block) } }
        }
        NSApp.mainMenu = MainMenu.build()
        self?.appearanceObservation = NSApp.observe(\.effectiveAppearance) { _, _ in
          ShellEvents.send(.app, ["type": "appearance", "dark": ShellModule.isDark])
        }
        self?.observeForSidebar()
        ArdiaHost.quitCancelledHandler = { ShellEvents.send(.app, ["type": "quitCancelled"]) }
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
      ShellEvents.detach(self) { owned in
        guard owned.contains(.window) else { return }
        WindowManager.shared.runtimeGone()
        SidebarEdgeWatcher.shared.reset()
      }
    }

    OnStartObserving(ShellEvents.Channel.app.rawValue) { ShellEvents.attach(.app, to: self) }

    OnStartObserving(ShellEvents.Channel.openURLs.rawValue) { ShellEvents.attach(.openURLs, to: self) }

    AsyncFunction("openWindow") { (id: String, options: OpenWindowOptions) in
      WindowManager.shared.open(id: id, options, focus: options.focus)
    }.runOnQueue(.main)

    AsyncFunction("closeWindow") { (id: String) in WindowManager.shared.close(id: id) }.runOnQueue(.main)
    AsyncFunction("animateWindowClose") { (id: String, after: String?, promise: Promise) in
      WindowManager.shared.animateClose(id: id, after: after) { promise.resolve(nil) }
    }.runOnQueue(.main)
    AsyncFunction("setTrafficLightsCenter") { (id: String, center: CGPoint?) in
      WindowManager.shared.setTrafficLightsCenter(id: id, center: center)
    }.runOnQueue(.main)
    AsyncFunction("watchSidebarEdge") { (id: String, on: Bool, hold: Double, side: String) in
      SidebarEdgeWatcher.shared.watch(id: id, on: on, hold: CGFloat(hold), right: side == "right")
    }.runOnQueue(.main)
    AsyncFunction("focusWindow") { (id: String) in WindowManager.shared.focus(id: id) }.runOnQueue(.main)
    AsyncFunction("restoreFullScreen") { (ids: [String], focus: String?) in
      WindowManager.shared.restoreFullScreen(ids: ids, focus: focus)
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewBegin") { (windowId: String, chip: CGRect, grab: CGPoint) in
      DragPreview.shared.begin(windowId: windowId, chip: chip, grab: grab)
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewPage") { (base64: String, frame: CGRect) in
      guard let data = Data(base64Encoded: base64) else { return }
      DragPreview.shared.setPage(data, frame: frame)
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewUpdate") { (shape: String, point: CGPoint) in
      DragPreview.shared.update(shape: shape, at: point)
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
    AsyncFunction("devWindowMoveProbe") { (id: String, probe: [String: Double], promise: Promise) in
      #if DEBUG
      guard let window = WindowManager.shared.windows[id] else { return promise.resolve(["error": "no window \(id)"]) }
      let count = Int(probe["steps"] ?? 60), dx = CGFloat(probe["dx"] ?? 3), dy = CGFloat(probe["dy"] ?? 0)
      let interval = (probe["intervalMs"] ?? 8) / 1000
      if let x = probe["x"], let top = probe["top"] {
        WindowMoveProbe.drag(window, x: CGFloat(x), top: CGFloat(top), count: count, dx: dx, dy: dy, interval: interval) { promise.resolve($0) }
      } else {
        WindowMoveProbe.steps(window, count: count, dx: dx, dy: dy, interval: interval) { promise.resolve($0) }
      }
      #else
      promise.resolve(["error": "DEV builds only"])
      #endif
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewEnd") { (windowId: String?, frame: CGRect?) in
      DragPreview.shared.end(windowId: windowId, fallback: frame)
    }.runOnQueue(.main)
    AsyncFunction("setWindowTitle") { (id: String, title: String) in
      WindowManager.shared.setTitle(id: id, title: title)
    }.runOnQueue(.main)
    AsyncFunction("windowIds") { () -> [String] in Array(WindowManager.shared.windows.keys) }.runOnQueue(.main)

    AsyncFunction("setAppearance") { (mode: String) in
      NSApp.appearance = mode == "light" ? NSAppearance(named: .aqua) : mode == "dark" ? NSAppearance(named: .darkAqua) : nil
    }.runOnQueue(.main)

    AsyncFunction("isDarkAppearance") { () -> Bool in ShellModule.isDark }.runOnQueue(.main)

    AsyncFunction("setMenuState") { (state: MenuStateUpdate) in
      MenuState.current = MenuState(state)
      MainMenu.refresh()
    }.runOnQueue(.main)
    AsyncFunction("setMenuBookmarks") { (bookmarks: MenuBookmarks) in
      MenuState.setBookmarks(bookmarks)
      MainMenu.refresh()
    }.runOnQueue(.main)

    AsyncFunction("replyToTerminate") { (ok: Bool) in WindowManager.shared.replyToTerminate(ok) }.runOnQueue(.main)

    AsyncFunction("confirm") { (options: ConfirmOptions, promise: Promise) in
      if let file = MenuChoice.testFile(flag: "appDialog", name: "dialog.json"),
         let answer = MenuChoice.testAnswer(dumping: options.toDictionary().merging(["kind": "confirm"]) { $1 }, to: file) {
        let words = Set(answer.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) })
        promise.resolve(["confirmed": words.contains("confirm"), "suppressed": words.contains("suppress")])
        return
      }
      let alert = ShellModule.alert(title: options.title, message: options.message)
      alert.addButton(withTitle: options.confirmTitle)
      alert.addButton(withTitle: options.cancelTitle)
      if options.destructive { alert.buttons.first?.hasDestructiveAction = true }
      if let suppression = options.suppression {
        alert.showsSuppressionButton = true
        alert.suppressionButton?.title = suppression
      }
      ShellModule.present(alert, windowId: options.windowId) { response in
        promise.resolve([
          "confirmed": response == .alertFirstButtonReturn,
          "suppressed": alert.suppressionButton?.state == .on,
        ])
      }
    }.runOnQueue(.main)

    AsyncFunction("prompt") { (options: PromptOptions, promise: Promise) in
      if let file = MenuChoice.testFile(flag: "appDialog", name: "dialog.json"),
         let answer = MenuChoice.testAnswer(dumping: options.toDictionary().merging(["kind": "prompt"]) { $1 }, to: file) {
        promise.resolve(answer.isEmpty ? nil : answer)
        return
      }
      let alert = ShellModule.alert(title: options.title, message: options.message)
      alert.addButton(withTitle: options.confirmTitle)
      alert.addButton(withTitle: "Cancel")
      let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
      field.stringValue = options.value
      field.placeholderString = options.placeholder
      alert.accessoryView = field
      alert.window.initialFirstResponder = field
      ShellModule.present(alert, windowId: options.windowId) { response in
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
      let emit: ([String: Any]) -> Void = { ShellEvents.send(.app, $0) }
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
      let emit: ([String: Any]) -> Void = { ShellEvents.send(.app, $0) }
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

    AsyncFunction("readText") { () -> String in NSPasteboard.general.string(forType: .string) ?? "" }.runOnQueue(.main)

    AsyncFunction("showMenu") { (items: [MenuItem], promise: Promise) in
      if let file = MenuChoice.testFile(flag: "appMenu", name: "menu.json") {
        promise.resolve(MenuChoice.testPick(items, dumpingTo: file, appContext: self.appContext))
        return
      }
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
    let emit: (String) -> Void = { ShellEvents.send(.app, ["type": $0]) }
    let quiet = { NSApp.modalWindow == nil && !NSApp.windows.contains { $0.attachedSheet != nil || $0.isSheet && $0.isVisible } }
    let workspace = NotificationCenter.default
    sidebarObservers.append((workspace, workspace.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { _ in
      if quiet() { emit("resignActive") }
    }))
    let distributed = DistributedNotificationCenter.default()
    sidebarObservers.append((distributed, distributed.addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in
      emit("lockedOrAsleep")
      if quiet() { emit("screenLocked") }
    }))
    let session = NSWorkspace.shared.notificationCenter
    for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
      sidebarObservers.append((session, session.addObserver(forName: name, object: nil, queue: .main) { _ in emit("lockedOrAsleep") }))
    }
    flagsMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { event in
      if SwitcherHold.released(by: event.modifierFlags) { emit("switcherReleased") }
      return event
    }
  }

  static var isDark: Bool {
    NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
  }

  static func alert(title: String, message: String) -> NSAlert {
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = message
    return alert
  }

  static func present(_ alert: NSAlert, windowId: String?, completion: @escaping (NSApplication.ModalResponse) -> Void) {
    if let window = windowId.flatMap({ WindowManager.shared.windows[$0] }), window.isVisible {
      alert.beginSheetModal(for: window, completionHandler: completion)
    } else {
      completion(alert.runModal())
    }
  }

  static func contextMenu(_ items: [MenuItem], target: MenuChoice) -> NSMenu {
    let menu = NSMenu()
    menu.autoenablesItems = false
    for item in items {
      if item.separator {
        menu.addItem(.separator())
        continue
      }
      let entry = NSMenuItem(title: item.title, action: nil, keyEquivalent: item.key)
      if !item.modifiers.isEmpty { entry.keyEquivalentModifierMask = ModifierName.flags(item.modifiers) }
      if let children = item.children {
        entry.submenu = contextMenu(children, target: target)
      } else if item.share {
        let id = item.id
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        SharePicker.menuItems(target: target, action: #selector(MenuChoice.choose(_:)), choice: { "\(id):via:\($0)" })
          .forEach(submenu.addItem)
        entry.submenu = submenu
      } else {
        entry.action = #selector(MenuChoice.choose(_:))
        entry.target = target
        entry.representedObject = item.id
      }
      entry.isAlternate = item.alternate
      entry.isEnabled = item.enabled
      entry.state = item.checked ? .on : .off
      if let symbol = item.symbol {
        entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        if #available(macOS 27.0, *) { entry.preferredImageVisibility = .visible }
      } else if let hex = item.swatch, let light = RGBA(hex: hex)?.srgb {
        let dark = item.swatchDark.flatMap { RGBA(hex: $0)?.srgb } ?? light
        entry.image = light.alphaComponent == 0
          ? emptySwatch() : swatch(NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light })
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

  static func emptySwatch() -> NSImage {
    NSImage(size: NSSize(width: 12, height: 12), flipped: false) { rect in
      NSColor.tertiaryLabelColor.setStroke()
      NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).stroke()
      return true
    }
  }
}
