import AppKit
import ExpoModulesCore

public class DevModule: Module {
  #if DEBUG
  public func definition() -> ModuleDefinition {
    Name("ArdiaDev")

    AsyncFunction("devCrash") { (kind: String?) in
      DispatchQueue.main.async { CrashReports.crashForTesting(kind) }
    }

    AsyncFunction("devRenderIntroMusic") { (cues: [String: Double], path: String) -> Double? in
      return IntroMusic.render(cues: cues, to: path)
    }

    AsyncFunction("devMenuCommand") { (command: String, arg: String?) in
      MenuTarget.shared.dispatch(command, arg, windowId: WindowManager.shared.keyWindowId)
    }.runOnQueue(.main)

    AsyncFunction("devPostKey") { (windowId: String, key: String, keyCode: Int, modifiers: [String]) -> Bool in
      guard let window = WindowManager.shared.window(windowId) else { return false }
      let mods = ModifierName.flags(named: modifiers)
      if key.hasPrefix("menu:"),
        let event = SyntheticInput.key(.keyDown, in: window, characters: String(key.dropFirst(5)), modifiers: mods, keyCode: keyCode) {
        return NSApp.mainMenu?.performKeyEquivalent(with: event) ?? false
      }
      for type in [NSEvent.EventType.keyDown, .keyUp] {
        guard let event = SyntheticInput.key(type, in: window, characters: key, modifiers: mods, keyCode: keyCode) else { return false }
        NSApp.postEvent(event, atStart: false)
      }
      return true
    }.runOnQueue(.main)

    AsyncFunction("devPostKeys") { (windowId: String, presses: [[String: Any]], promise: Promise) in
      guard let window = WindowManager.shared.window(windowId) else { return promise.resolve([]) }
      var postedAt: [Double] = []
      func post(_ index: Int) {
        guard index < presses.count else { return promise.resolve(postedAt) }
        let press = presses[index]
        let after = press["after"] as? Int ?? 0
        let send = {
          let key = press["key"] as? String ?? ""
          let mods = ModifierName.flags(named: press["modifiers"] as? [String] ?? [])
          let phase = press["phase"] as? String
          let types: [NSEvent.EventType] = phase == "down" ? [.keyDown] : phase == "up" ? [.keyUp] : [.keyDown, .keyUp]
          for type in types {
            if let event = SyntheticInput.key(type, in: window, characters: key, modifiers: mods, keyCode: press["keyCode"] as? Int ?? 0) {
              NSApp.postEvent(event, atStart: false)
            }
          }
          postedAt.append(ProcessInfo.processInfo.systemUptime * 1000)
          post(index + 1)
        }
        if after > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(after), execute: send) } else { send() }
      }
      post(0)
    }.runOnQueue(.main)

    AsyncFunction("devMenuItems") { (title: String, perform: [String]?) -> [[String: Any]] in
      var tiling: NSMenu?
      var flags: [String: Any] = [:]
      if title.hasPrefix("tiling:"), let window = WindowManager.shared.window(String(title.dropFirst(7))) {
        for name in ["_canEnterTileMode", "_implicitlyDisallowTiling", "_cgsWindowSaysSupportsTiling"] {
          let sel = NSSelectorFromString(name)
          guard window.responds(to: sel) else { continue }
          typealias Get = @convention(c) (AnyObject, Selector) -> Bool
          flags[name] = unsafeBitCast(window.method(for: sel), to: Get.self)(window, sel)
        }
        let sel = NSSelectorFromString("_windowTilingMenu")
        if window.responds(to: sel) { tiling = window.perform(sel)?.takeUnretainedValue() as? NSMenu }
      }
      guard var menu = tiling ?? NSApp.mainMenu?.items.first(where: { $0.title == title })?.submenu else { return flags.isEmpty ? [] : [flags] }
      func items(_ menu: NSMenu) -> [[String: Any]] {
        menu.delegate?.menuNeedsUpdate?(menu)
        let populate = NSSelectorFromString("_populateFromSidebandUpdatersOfSign:")
        if menu.responds(to: populate) {
          typealias Populate = @convention(c) (AnyObject, Selector, Int) -> Void
          for sign in [-1, 1] { unsafeBitCast(menu.method(for: populate), to: Populate.self)(menu, populate, sign) }
        }
        menu.update()
        return menu.items.map { item in
          var out: [String: Any] = [
            "title": item.isSeparatorItem ? "-" : item.title, "key": item.keyEquivalent,
            "modifiers": item.keyEquivalentModifierMask.rawValue, "action": item.action.map(NSStringFromSelector) ?? "",
            "enabled": item.isEnabled, "hidden": item.isHidden, "alternate": item.isAlternate,
          ]
          if let sub = item.submenu { out["items"] = items(sub) }
          return out
        }
      }
      let listed = items(menu)
      if let perform, !perform.isEmpty {
        for (i, step) in perform.enumerated() {
          guard let index = menu.items.firstIndex(where: { $0.title == step && (i == perform.count - 1 || $0.submenu != nil) }) else { return [["error": "no \(step)"]] }
          if i == perform.count - 1 { menu.performActionForItem(at: index) } else if let sub = menu.items[index].submenu { menu = sub }
        }
      }
      return flags.isEmpty ? listed : [flags] + listed
    }.runOnQueue(.main)

    AsyncFunction("devDragBlockedRects") { (windowId: String) -> [[Double]] in
      guard let window = WindowManager.shared.window(windowId) else { return [] }
      return ServerWindowDrag.blockedRects(window)
    }.runOnQueue(.main)

    Function("devReceiveURLsWhenDetached") { (urls: [String], timeoutMs: Double) in
      DevModule.urlDelivery = ["state": "waiting"]
      let start = Date()
      func poll() {
        let waited = Date().timeIntervalSince(start) * 1000
        if ShellEvents.isAttached(.openURLs) {
          guard waited < timeoutMs else { return DevModule.urlDelivery = ["state": "neverDetached", "waitedMs": waited] }
          return DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(5), execute: poll)
        }
        OpenURLInbox.receive(urls.compactMap(URL.init(string:)))
        DevModule.urlDelivery = ["state": "received", "waitedMs": waited, "attachedAfter": ShellEvents.isAttached(.openURLs)]
      }
      DispatchQueue.main.async(execute: poll)
    }

    AsyncFunction("devURLDelivery") { () -> [String: Any] in DevModule.urlDelivery }.runOnQueue(.main)

    AsyncFunction("devShortcutRecording") { () -> Bool in ShortcutRecorder.shared.isRecording }.runOnQueue(.main)

    AsyncFunction("devDragPreviewState") { () -> [String: Any] in
      return DragPreview.shared.debugState
    }.runOnQueue(.main)
    AsyncFunction("devWindowMoveProbe") { (id: String, probe: [String: Double], promise: Promise) in
      guard let window = WindowManager.shared.window(id) else { return promise.resolve(["error": "no window \(id)"]) }
      let count = Int(probe["steps"] ?? 60), dx = CGFloat(probe["dx"] ?? 3), dy = CGFloat(probe["dy"] ?? 0)
      let interval = (probe["intervalMs"] ?? 8) / 1000
      if let x = probe["x"], let top = probe["top"] {
        WindowMoveProbe.drag(window, x: CGFloat(x), top: CGFloat(top), count: count, dx: dx, dy: dy, interval: interval) { promise.resolve($0) }
      } else {
        WindowMoveProbe.steps(window, count: count, dx: dx, dy: dy, interval: interval) { promise.resolve($0) }
      }
    }.runOnQueue(.main)

    AsyncFunction("devSnapshotWindow") { (windowId: String, path: String, transparent: Bool?) -> Bool in
      return Self.snapshot(windowId: windowId, path: path, transparent: transparent ?? false)
    }.runOnQueue(.main)

    AsyncFunction("devSetPointer") { (windowId: String, x: Double, y: Double, on: Bool) -> Bool in
      let select = NSSelectorFromString("ardia_setPointerOverride:")
      guard let view = NSClassFromString("RCTView"), (view as AnyObject).responds(to: select) else { return false }
      guard on else {
        _ = (view as AnyObject).perform(select, with: nil)
        return true
      }
      guard let window = WindowManager.shared.window(windowId), let content = window.contentView else { return false }
      let local = SyntheticInput.contentPoint(x: x, top: y, in: content)
      let screen = window.convertPoint(toScreen: content.convert(local, to: nil))
      _ = (view as AnyObject).perform(select, with: NSValue(point: screen))
      return true
    }.runOnQueue(.main)

    AsyncFunction("devLeftEdgePointer") { (windowId: String, x: Double, y: Double, on: Bool) -> Bool in
      guard on else {
        LeftEdgeWatcher.shared.pointerOverride = nil
        LeftEdgeWatcher.shared.checkPointer()
        return true
      }
      guard let window = WindowManager.shared.window(windowId) else { return false }
      LeftEdgeWatcher.shared.pointerOverride = NSPoint(x: window.frame.minX + x, y: window.frame.maxY - y)
      LeftEdgeWatcher.shared.checkPointer()
      return true
    }.runOnQueue(.main)

    AsyncFunction("devLeftEdgeStats") { (reset: Bool) -> [String: Any] in
      let stats = LeftEdgeWatcher.shared.stats
      if reset { LeftEdgeWatcher.shared.resetStats() }
      return stats
    }.runOnQueue(.main)

    AsyncFunction("devHoverStats") { (reset: Bool) -> [String: Any] in
      let select = NSSelectorFromString("ardia_hoverStats:")
      guard let view = NSClassFromString("RCTView"), (view as AnyObject).responds(to: select) else { return [:] }
      return ((view as AnyObject).perform(select, with: NSNumber(value: reset))?.takeUnretainedValue() as? [String: Any]) ?? [:]
    }.runOnQueue(.main)

    AsyncFunction("devSetMouseButtons") { (pressed: Int) -> Bool in
      let select = NSSelectorFromString("ardia_setButtonsOverride:")
      guard let view = NSClassFromString("RCTView"), (view as AnyObject).responds(to: select) else { return false }
      _ = (view as AnyObject).perform(select, with: pressed < 0 ? nil : NSNumber(value: pressed > 0))
      return true
    }.runOnQueue(.main)

    AsyncFunction("devTypeKeys") { (windowId: String, text: String, interval: Double, promise: Promise) in
      let toKeyWindow = windowId == "key"
      guard let window = toKeyWindow ? NSApp.keyWindow : WindowManager.shared.window(windowId), !text.isEmpty else { return promise.resolve([]) }
      let keys = text.map(String.init)
      let now = { Date().timeIntervalSince1970 * 1000 }
      let activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .latencyCritical], reason: "devTypeKeys")
      let timer = DispatchSource.makeTimerSource(flags: .strict, queue: .main)
      var times = [[String: Double]](repeating: [:], count: keys.count)
      var next = 0, drawn = 0
      var t0 = 0.0
      let press = { (i: Int) in
        let handled = now()
        let target = toKeyWindow ? NSApp.keyWindow ?? window : window
        for type in [NSEvent.EventType.keyDown, .keyUp] {
          guard let event = SyntheticInput.key(type, in: target, characters: keys[i]) else { continue }
          if toKeyWindow { NSApp.sendEvent(event) }
          else if type == .keyDown { target.firstResponder?.keyDown(with: event) } else { target.firstResponder?.keyUp(with: event) }
        }
        let observer = CFRunLoopObserverCreateWithHandler(
          nil, CFRunLoopActivity.beforeWaiting.rawValue | CFRunLoopActivity.exit.rawValue, false, 2_000_001
        ) { _, _ in
          times[i] = ["due": t0 + interval * Double(i), "handled": handled, "drawn": now()]
          drawn += 1
          if drawn == keys.count {
            ProcessInfo.processInfo.endActivity(activity)
            promise.resolve(times)
          }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
      }
      timer.setEventHandler {
        if next == 0 { t0 = now() }
        repeat {
          press(next)
          next += 1
        } while next < keys.count && t0 + interval * Double(next) <= now()
        if next == keys.count { timer.cancel() }
      }
      timer.schedule(deadline: .now(), repeating: .microseconds(Int(interval * 1000)), leeway: .nanoseconds(0))
      timer.resume()
    }

    AsyncFunction("devKeyEquivalent") { (windowId: String, press: [String: Any], promise: Promise) in
      KeyEquivalents.press(windowId: windowId, press) { promise.resolve($0) }
    }.runOnQueue(.main)

    AsyncFunction("devMenuBar") { () -> [[String: Any]] in
      return KeyEquivalents.menuBar()
    }.runOnQueue(.main)

    AsyncFunction("devKeyEquivalentTrace") { () -> [String] in
      return KeyEquivalents.trace
    }.runOnQueue(.main)

    AsyncFunction("devFocusHandoffTrace") { () -> [String] in
      return FocusHandoff.shared.trace
    }.runOnQueue(.main)

    AsyncFunction("devClick") { (windowId: String, click: [String: Any], promise: Promise) in
      KeyEquivalents.click(windowId: windowId, click) { promise.resolve($0) }
    }.runOnQueue(.main)

    AsyncFunction("devRunAppleScript") { (source: String, promise: Promise) in
      Self.scriptQueue.async {
        var error: NSDictionary?
        let result = NSAppleScript(source: source)?.executeAndReturnError(&error)
        if let error {
          promise.resolve(["ok": false, "error": error[NSAppleScript.errorMessage] as? String ?? "\(error)", "number": error[NSAppleScript.errorNumber] as Any])
        } else {
          promise.resolve(["ok": true, "result": result.map(Self.plain) as Any])
        }
      }
    }
  }

  private static var urlDelivery: [String: Any] = [:]

  private static let scriptQueue = DispatchQueue(label: "ardia.dev-applescript")

  private static func snapshot(windowId: String, path: String, transparent: Bool = false) -> Bool {
    guard let view = WindowManager.shared.window(windowId)?.contentView, let layer = view.layer else { return false }
    let scale = view.window?.backingScaleFactor ?? 2
    let size = view.bounds.size
    guard let rep = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale), bitsPerSample: 8,
      samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
      let context = NSGraphicsContext(bitmapImageRep: rep) else { return false }
    let cg = context.cgContext
    if !transparent {
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = context
      (view.window?.backgroundColor ?? .windowBackgroundColor).setFill()
      NSRect(origin: .zero, size: CGSize(width: size.width * scale, height: size.height * scale)).fill()
      NSGraphicsContext.restoreGraphicsState()
    }
    cg.scaleBy(x: scale, y: scale)
    if view.isFlipped || layer.isGeometryFlipped {
      cg.translateBy(x: 0, y: size.height)
      cg.scaleBy(x: 1, y: -1)
    }
    layer.render(in: cg)
    guard let png = rep.representation(using: .png, properties: [:]) else { return false }
    return (try? png.write(to: URL(fileURLWithPath: path))) != nil
  }

  private static func plain(_ d: NSAppleEventDescriptor) -> Any {
    switch d.descriptorType {
    case typeAEList:
      return d.numberOfItems == 0 ? [] : (1...d.numberOfItems).compactMap { d.atIndex($0).map(plain) }
    case typeAERecord:
      var out: [String: Any] = [:]
      if d.numberOfItems > 0 {
        for i in 1...d.numberOfItems { if let item = d.atIndex(i) { out[String(format: "%08x", d.keywordForDescriptor(at: i))] = plain(item) } }
      }
      return out
    case typeTrue: return true
    case typeFalse: return false
    case typeBoolean: return d.booleanValue
    case typeSInt32, typeSInt16: return Int(d.int32Value)
    case typeNull: return NSNull()
    case typeObjectSpecifier: return "«specifier»"
    default: return d.stringValue ?? "«\(d.descriptorType)»"
    }
  }
  #else
  public func definition() -> ModuleDefinition {
    Name("ArdiaDev")
  }
  #endif
}
