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
          forName: .ardiaQuitCancelled, object: nil, queue: .main
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
        pointer: (options["pointer"] as? [Double]).flatMap { $0.count == 2 ? NSPoint(x: $0[0], y: $0[1]) : nil },
        animated: options["animated"] as? Bool ?? false)
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
    AsyncFunction("restoreFullScreen") { (ids: [String], focus: String?) in
      WindowManager.shared.restoreFullScreen(ids: ids, focus: focus)
    }.runOnQueue(.main)
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
