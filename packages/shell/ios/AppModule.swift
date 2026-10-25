import AppKit
import MachO
import ExpoModulesCore

public class AppModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaApp")
    Constant("apiVersion") { () -> Int in 16 }
    Events("onNotificationResponse", "onScriptCommand")

    OnCreate {
      DispatchQueue.main.async {
        NotificationHub.shared.install()
        AppIcons.restore()
        AppUpdater.shared.start()
      }
    }

    OnStartObserving("onNotificationResponse") {
      DispatchQueue.main.async { [weak self] in
        NotificationHub.shared.onResponse = { id, action, info in
          self?.sendEvent("onNotificationResponse", [
            "id": id, "action": action, "tabId": info["tabId"] as Any, "windowId": info["windowId"] as Any, "data": info["data"] as Any,
          ])
        }
        NotificationHub.shared.flushPending()
      }
    }

    OnStartObserving("onScriptCommand") {
      DispatchQueue.main.async { [weak self] in
        ShellScripting.send = { body in self?.sendEvent("onScriptCommand", body) }
      }
    }

    AsyncFunction("updaterState") { () -> [String: Any] in AppUpdater.shared.state }.runOnQueue(.main)
    AsyncFunction("checkForUpdates") { AppUpdater.shared.checkForUpdates(nil) }.runOnQueue(.main)
    AsyncFunction("setAutomaticUpdateChecks") { (on: Bool) in AppUpdater.shared.setAutomaticChecks(on) }.runOnQueue(.main)
    AsyncFunction("setAutomaticUpdateDownloads") { (on: Bool) in AppUpdater.shared.setAutomaticDownloads(on) }.runOnQueue(.main)
    AsyncFunction("setUpdateChannel") { (channel: String) in AppUpdater.shared.setChannel(channel) }.runOnQueue(.main)

    AsyncFunction("setWindowActivity") { (windowId: String, url: String?, title: String?) in
      Handoff.setActivity(windowId: windowId, url: url, title: title)
    }.runOnQueue(.main)

    AsyncFunction("share") { (url: String, title: String?, windowId: String?, anchor: [Double]?, promise: Promise) in
      SharePicker.show(url: url, title: title, windowId: windowId, anchor: anchor) { promise.resolve(nil) }
    }.runOnQueue(.main)

    AsyncFunction("shareVia") { (service: String, url: String, title: String?, windowId: String?) in
      SharePicker.perform(service: service, url: url, title: title, windowId: windowId)
    }.runOnQueue(.main)

    AsyncFunction("isInDock") { () -> Bool in DockTile.isInDock }.runOnQueue(.main)
    AsyncFunction("addToDock") { () -> Bool in DockTile.add() }.runOnQueue(.main)

    AsyncFunction("appIcons") { (size: Double) -> [[String: Any]] in
      AppIcons.variants.map { ["id": $0.id, "name": $0.name, "preview": AppIcons.preview($0.id, size: size) as Any] }
    }.runOnQueue(.main)
    AsyncFunction("appIcon") { () -> String in AppIcons.current }.runOnQueue(.main)
    AsyncFunction("setAppIcon") { (id: String) in AppIcons.set(id, announce: ACIsolatedDataDirectory() == nil) }.runOnQueue(.main)

    AsyncFunction("notificationPermission") { (promise: Promise) in
      NotificationHub.shared.permission { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("requestNotificationPermission") { (promise: Promise) in
      NotificationHub.shared.requestPermission { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("postNotification") { (options: [String: Any], promise: Promise) in
      NotificationHub.shared.post(options) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("removeNotifications") { (ids: [String]) in NotificationHub.shared.remove(ids) }.runOnQueue(.main)
    AsyncFunction("openNotificationSettings") {
      let id = Bundle.main.bundleIdentifier ?? ""
      if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)") {
        NSWorkspace.shared.open(url)
      }
    }.runOnQueue(.main)

    AsyncFunction("setScriptState") { (state: [String: Any]) in ShellScripting.setState(state) }.runOnQueue(.main)
    AsyncFunction("replyToScript") { (id: String, result: [String: Any]?, error: String?) in
      ShellScripting.reply(id, result: result, error: error)
    }.runOnQueue(.main)

    Function("systemInfo") { () -> [String: Any] in
      let info = Bundle.main.infoDictionary ?? [:]
      let env = ProcessInfo.processInfo.environment
      let os = ProcessInfo.processInfo.operatingSystemVersion
      var model = [CChar](repeating: 0, count: 256)
      var size = model.count
      sysctlbyname("hw.model", &model, &size, nil, 0)
      #if DEBUG
      let configuration = "Debug"
      #else
      let configuration = "Release"
      #endif
      return [
        "appName": info["CFBundleName"] as? String ?? "Ardia",
        "appVersion": info["CFBundleShortVersionString"] as? String ?? "",
        "appBuild": info["CFBundleVersion"] as? String ?? "",
        "bundleId": Bundle.main.bundleIdentifier ?? "",
        "configuration": configuration,
        "osVersion": "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
        "osBuild": Self.osBuild,
        "arch": Self.arch,
        "model": String(cString: model),
        "memoryGB": Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824,
        "locale": Locale.current.identifier,
        "updates": AppUpdater.shared.isAvailable,
        "feedbackURL": Self.infoString("ACFeedbackURL") as Any,
        "feedbackEmail": Self.infoString("ACFeedbackEmail") as Any,
        "videoTourURL": Self.infoString("ACVideoTourURL") as Any,
        "releaseNotesURL": Self.infoString("ACReleaseNotesURL") as Any,
        "isolatedInstance": env["ARDIA_BACKGROUND"] == "1" || env["ARDIA_DATA_DIR"] != nil,
        "forceReleaseNotes": env["ARDIA_RELEASE_NOTES"] == "1",
        "processStart": Self.processStart as Any,
        "bootTime": Self.bootTime as Any,
        "inApplicationsFolder": Self.inApplicationsFolder,
      ]
    }

    AsyncFunction("crashReports") { (since: Double) -> [[String: Any]] in CrashReports.since(since) }

    AsyncFunction("devCrash") { (kind: String?) in
      #if DEBUG
      DispatchQueue.main.async { CrashReports.crashForTesting(kind) }
      #endif
    }

    AsyncFunction("openExternalURL") { (url: String) -> Bool in
      guard let target = URL(string: url), target.scheme != nil else { return false }
      return NSWorkspace.shared.open(target)
    }.runOnQueue(.main)

    AsyncFunction("playIntroMusic") { (cues: [String: Double], muted: Bool) in IntroMusic.shared.play(cues: cues, muted: muted) }.runOnQueue(.main)
    AsyncFunction("setIntroMusicMuted") { (muted: Bool) in IntroMusic.shared.setMuted(muted) }.runOnQueue(.main)
    AsyncFunction("stopIntroMusic") { (fade: Double) in IntroMusic.shared.stop(fade: fade) }.runOnQueue(.main)
    AsyncFunction("devRenderIntroMusic") { (cues: [String: Double], path: String) -> Double? in
      #if DEBUG
      return IntroMusic.render(cues: cues, to: path)
      #else
      return nil
      #endif
    }

    Function("launchEnvironment") { (name: String) -> String? in
      #if DEBUG
      return ProcessInfo.processInfo.environment[name]
      #else
      return nil
      #endif
    }

    Function("killSwitchEnvironment") { (name: String) -> String? in
      AppModule.killSwitchNames.contains(name) ? ProcessInfo.processInfo.environment[name] : nil
    }

    AsyncFunction("devMenuCommand") { (command: String, arg: String?) in
      #if DEBUG
      MenuTarget.shared.handler?(command, arg, WindowManager.shared.keyWindowId)
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devPostKey") { (windowId: String, key: String, keyCode: Int, modifiers: [String]) -> Bool in
      #if DEBUG
      guard let window = WindowManager.shared.windows[windowId] else { return false }
      let names: [String: NSEvent.ModifierFlags] = [
        "command": .command, "shift": .shift, "option": .option, "control": .control, "function": .function,
      ]
      let mods = NSEvent.ModifierFlags(modifiers.compactMap { names[$0] })
      if key.hasPrefix("menu:"), let event = NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: mods, timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber, context: nil, characters: String(key.dropFirst(5)),
        charactersIgnoringModifiers: String(key.dropFirst(5)), isARepeat: false, keyCode: UInt16(keyCode)) {
        return NSApp.mainMenu?.performKeyEquivalent(with: event) ?? false
      }
      for type in [NSEvent.EventType.keyDown, .keyUp] {
        guard let event = NSEvent.keyEvent(
          with: type, location: .zero, modifierFlags: mods, timestamp: ProcessInfo.processInfo.systemUptime,
          windowNumber: window.windowNumber, context: nil, characters: key, charactersIgnoringModifiers: key,
          isARepeat: false, keyCode: UInt16(keyCode)) else { return false }
        NSApp.postEvent(event, atStart: false)
      }
      return true
      #else
      return false
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devPostKeys") { (windowId: String, presses: [[String: Any]], promise: Promise) in
      #if DEBUG
      guard let window = WindowManager.shared.windows[windowId] else { return promise.resolve([]) }
      let names: [String: NSEvent.ModifierFlags] = [
        "command": .command, "shift": .shift, "option": .option, "control": .control, "function": .function,
      ]
      var postedAt: [Double] = []
      func post(_ index: Int) {
        guard index < presses.count else { return promise.resolve(postedAt) }
        let press = presses[index]
        let after = press["after"] as? Int ?? 0
        let send = {
          let key = press["key"] as? String ?? ""
          let mods = NSEvent.ModifierFlags((press["modifiers"] as? [String] ?? []).compactMap { names[$0] })
          let phase = press["phase"] as? String
          let types: [NSEvent.EventType] = phase == "down" ? [.keyDown] : phase == "up" ? [.keyUp] : [.keyDown, .keyUp]
          for type in types {
            if let event = NSEvent.keyEvent(
              with: type, location: .zero, modifierFlags: mods, timestamp: ProcessInfo.processInfo.systemUptime,
              windowNumber: window.windowNumber, context: nil, characters: key, charactersIgnoringModifiers: key,
              isARepeat: false, keyCode: UInt16(press["keyCode"] as? Int ?? 0)) {
              NSApp.postEvent(event, atStart: false)
            }
          }
          postedAt.append(ProcessInfo.processInfo.systemUptime * 1000)
          post(index + 1)
        }
        if after > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(after), execute: send) } else { send() }
      }
      post(0)
      #else
      promise.resolve([])
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devMenuItems") { (title: String, perform: [String]?) -> [[String: Any]] in
      #if DEBUG
      var tiling: NSMenu?
      var flags: [String: Any] = [:]
      if title.hasPrefix("tiling:"), let window = WindowManager.shared.windows[String(title.dropFirst(7))] {
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
      #else
      return []
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devDragBlockedRects") { (windowId: String) -> [[Double]] in
      #if DEBUG
      guard let window = WindowManager.shared.windows[windowId] else { return [] }
      return ServerWindowDrag.blockedRects(window)
      #else
      return []
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devSnapshotWindow") { (windowId: String, path: String, transparent: Bool?) -> Bool in
      #if DEBUG
      return Self.snapshot(windowId: windowId, path: path, transparent: transparent ?? false)
      #else
      return false
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devSetPointer") { (windowId: String, x: Double, y: Double, on: Bool) -> Bool in
      #if DEBUG
      let select = NSSelectorFromString("ardia_setPointerOverride:")
      guard let view = NSClassFromString("RCTView"), (view as AnyObject).responds(to: select) else { return false }
      guard on else {
        _ = (view as AnyObject).perform(select, with: nil)
        return true
      }
      guard let window = WindowManager.shared.windows[windowId], let content = window.contentView else { return false }
      let local = NSPoint(x: x, y: content.isFlipped ? y : content.bounds.height - y)
      let screen = window.convertPoint(toScreen: content.convert(local, to: nil))
      _ = (view as AnyObject).perform(select, with: NSValue(point: screen))
      return true
      #else
      return false
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devLeftEdgePointer") { (windowId: String, x: Double, y: Double, on: Bool) -> Bool in
      #if DEBUG
      guard on else {
        LeftEdgeWatcher.shared.pointerOverride = nil
        LeftEdgeWatcher.shared.checkPointer()
        return true
      }
      guard let window = WindowManager.shared.windows[windowId] else { return false }
      LeftEdgeWatcher.shared.pointerOverride = NSPoint(x: window.frame.minX + x, y: window.frame.maxY - y)
      LeftEdgeWatcher.shared.checkPointer()
      return true
      #else
      return false
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devLeftEdgeStats") { (reset: Bool) -> [String: Any] in
      #if DEBUG
      let stats = LeftEdgeWatcher.shared.stats
      if reset { LeftEdgeWatcher.shared.resetStats() }
      return stats
      #else
      return [:]
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devHoverStats") { (reset: Bool) -> [String: Any] in
      #if DEBUG
      let select = NSSelectorFromString("ardia_hoverStats:")
      guard let view = NSClassFromString("RCTView"), (view as AnyObject).responds(to: select) else { return [:] }
      return ((view as AnyObject).perform(select, with: NSNumber(value: reset))?.takeUnretainedValue() as? [String: Any]) ?? [:]
      #else
      return [:]
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devSetMouseButtons") { (pressed: Int) -> Bool in
      #if DEBUG
      let select = NSSelectorFromString("ardia_setButtonsOverride:")
      guard let view = NSClassFromString("RCTView"), (view as AnyObject).responds(to: select) else { return false }
      _ = (view as AnyObject).perform(select, with: pressed < 0 ? nil : NSNumber(value: pressed > 0))
      return true
      #else
      return false
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devTypeKeys") { (windowId: String, text: String, interval: Double, promise: Promise) in
      #if DEBUG
      let toKeyWindow = windowId == "key"
      guard let window = toKeyWindow ? NSApp.keyWindow : WindowManager.shared.windows[windowId], !text.isEmpty else { return promise.resolve([]) }
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
          guard let event = NSEvent.keyEvent(
            with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: target.windowNumber, context: nil, characters: keys[i], charactersIgnoringModifiers: keys[i],
            isARepeat: false, keyCode: 0) else { continue }
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
      #else
      promise.resolve([])
      #endif
    }

    AsyncFunction("devKeyEquivalent") { (windowId: String, press: [String: Any], promise: Promise) in
      #if DEBUG
      KeyEquivalents.press(windowId: windowId, press) { promise.resolve($0) }
      #else
      promise.resolve(["error": "DEV builds only"])
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devKeyEquivalentTrace") { () -> [String] in
      #if DEBUG
      return KeyEquivalents.trace
      #else
      return []
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devFocusHandoffTrace") { () -> [String] in
      #if DEBUG
      return FocusHandoff.shared.trace
      #else
      return []
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devClick") { (windowId: String, click: [String: Any], promise: Promise) in
      #if DEBUG
      KeyEquivalents.click(windowId: windowId, click) { promise.resolve($0) }
      #else
      promise.resolve(["error": "DEV builds only"])
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devRunAppleScript") { (source: String, promise: Promise) in
      #if DEBUG
      Self.scriptQueue.async {
        var error: NSDictionary?
        let result = NSAppleScript(source: source)?.executeAndReturnError(&error)
        if let error {
          promise.resolve(["ok": false, "error": error[NSAppleScript.errorMessage] as? String ?? "\(error)", "number": error[NSAppleScript.errorNumber] as Any])
        } else {
          promise.resolve(["ok": true, "result": result.map(Self.plain) as Any])
        }
      }
      #else
      promise.resolve(["ok": false, "error": "DEV builds only"])
      #endif
    }
  }

  private static func infoString(_ key: String) -> String? {
    let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return value?.isEmpty == false ? value : nil
  }

  private static let killSwitchNames: Set<String> = [
    "ARDIA_SWITCHES", "ARDIA_EXTENSION_ACTION_POLL", "ARDIA_SLOW_TIMERS",
    "ARDIA_MEMORY_TRIM", "ARDIA_MEMORY_TRIM_HEAP", "ARDIA_MEMORY_TRIM_ENGINE",
    "ARDIA_EARLY_NAVIGATE",
  ]
  private static let scriptQueue = DispatchQueue(label: "ardia.dev-applescript")

  static func snapshot(windowId: String, path: String, transparent: Bool = false) -> Bool {
    guard let view = WindowManager.shared.windows[windowId]?.contentView, let layer = view.layer else { return false }
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

  private static var osBuild: String {
    var size = 0
    sysctlbyname("kern.osversion", nil, &size, nil, 0)
    var build = [CChar](repeating: 0, count: max(size, 1))
    sysctlbyname("kern.osversion", &build, &size, nil, 0)
    return String(cString: build)
  }

  private static var arch: String {
    #if arch(arm64)
    "arm64"
    #else
    "x86_64"
    #endif
  }

  private static var inApplicationsFolder: Bool {
    let path = Bundle.main.bundleURL.resolvingSymlinksInPath().path
    let home = FileManager.default.homeDirectoryForCurrentUser.resolvingSymlinksInPath().path
    return path.hasPrefix("/Applications/") || path.hasPrefix(home + "/Applications/")
  }
}

extension AppModule {
  fileprivate static let bootTime: Double? = {
    var boot = timeval()
    var size = MemoryLayout<timeval>.stride
    var mib: [Int32] = [CTL_KERN, KERN_BOOTTIME]
    guard sysctl(&mib, 2, &boot, &size, nil, 0) == 0 else { return nil }
    return Double(boot.tv_sec) * 1000 + Double(boot.tv_usec) / 1000
  }()

  fileprivate static let processStart: Double? = {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return nil }
    let start = info.kp_proc.p_starttime
    return Double(start.tv_sec) * 1000 + Double(start.tv_usec) / 1000
  }()
}

fileprivate enum CrashReports {
  static func since(_ since: Double) -> [[String: Any]] {
    guard let executable = Bundle.main.executableURL else { return [] }
    let exe = executable.resolvingSymlinksInPath().path
    let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/DiagnosticReports")
    let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
    var reports: [[String: Any]] = []
    for url in files where url.pathExtension == "ips" && url.lastPathComponent.hasPrefix("\(executable.lastPathComponent)-") {
      guard let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate,
        modified.timeIntervalSince1970 * 1000 > since,
        let report = parse(url, executable: exe, time: modified) else { continue }
      reports.append(report)
    }
    return Array(reports.sorted { ($0["time"] as? Double ?? 0) < ($1["time"] as? Double ?? 0) }.suffix(5))
  }

  private static func isThisExecutable(procPath: String, sliceUUID: String?, executable: String) -> Bool {
    if let sliceUUID, let ours = executableUUID, sliceUUID.lowercased() != ours { return false }
    if procPath == executable { return true }
    let pattern = procPath.replacingOccurrences(of: "?", with: "\\?").replacingOccurrences(of: "/Users/USER/", with: "/Users/*/")
    return NSPredicate(format: "SELF LIKE %@", pattern).evaluate(with: executable)
  }

  private static let executableUUID: String? = {
    guard let header = _dyld_get_image_header(0) else { return nil }
    var command = UnsafeRawPointer(header).advanced(by: MemoryLayout<mach_header_64>.size)
    for _ in 0..<header.pointee.ncmds {
      let load = command.assumingMemoryBound(to: load_command.self).pointee
      if load.cmd == UInt32(LC_UUID) {
        return UUID(uuid: command.assumingMemoryBound(to: uuid_command.self).pointee.uuid).uuidString.lowercased()
      }
      command = command.advanced(by: Int(load.cmdsize))
    }
    return nil
  }()

  private static func parse(_ url: URL, executable: String, time: Date) -> [String: Any]? {
    guard let data = try? Data(contentsOf: url), let newline = data.firstIndex(of: 0x0A),
      let header = (try? JSONSerialization.jsonObject(with: data[..<newline])) as? [String: Any],
      let body = (try? JSONSerialization.jsonObject(with: data[data.index(after: newline)...])) as? [String: Any],
      let procPath = body["procPath"] as? String,
      isThisExecutable(procPath: procPath, sliceUUID: header["slice_uuid"] as? String, executable: executable)
    else { return nil }
    let exception = body["exception"] as? [String: Any] ?? [:]
    let images = (body["usedImages"] as? [[String: Any]] ?? []).map { image -> String in
      if let name = image["name"] as? String, !name.isEmpty { return name }
      return (image["path"] as? String).map { URL(fileURLWithPath: $0).lastPathComponent } ?? "???"
    }
    let threads = body["threads"] as? [[String: Any]] ?? []
    let faulting = body["faultingThread"] as? Int ?? threads.firstIndex { $0["triggered"] as? Bool == true } ?? 0
    let frames = threads.indices.contains(faulting) ? threads[faulting]["frames"] as? [[String: Any]] ?? [] : []
    func simplified(_ frames: [[String: Any]]) -> [[String: Any]] {
      frames.prefix(64).map { frame -> [String: Any] in
        let index = frame["imageIndex"] as? Int ?? -1
        var out: [String: Any] = ["image": images.indices.contains(index) ? images[index] : "???"]
        if let symbol = frame["symbol"] as? String { out["symbol"] = symbol }
        if let offset = frame["imageOffset"] as? Int { out["offset"] = offset }
        return out
      }
    }
    var report: [String: Any] = ["time": time.timeIntervalSince1970 * 1000, "frames": simplified(frames)]
    if let thrown = body["lastExceptionBacktrace"] as? [[String: Any]], !thrown.isEmpty {
      report["exceptionFrames"] = simplified(thrown)
    }
    if let name = exceptionName(body) { report["exceptionName"] = name }
    for (key, value) in [
      ("incidentId", header["incident_id"]), ("appVersion", header["app_version"]), ("build", header["build_version"]),
      ("exceptionType", exception["type"]), ("signal", exception["signal"]),
    ] {
      if let value = value as? String { report[key] = value }
    }
    return report
  }

  private static func exceptionName(_ body: [String: Any]) -> String? {
    let valid = try! NSRegularExpression(pattern: "^[A-Z][A-Za-z0-9_]{2,63}$")
    func checked(_ full: String) -> String? {
      let name = String(full.prefix { $0 != ":" })
      return valid.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) == nil ? nil : name
    }
    if let reason = body["exceptionReason"] as? [String: Any], let name = reason["name"] as? String {
      return checked(name)
    }
    let uncaught = try! NSRegularExpression(pattern: "uncaught exception '([^']{1,64})'")
    for case let lines as [String] in (body["asi"] as? [String: Any] ?? [:]).values {
      for line in lines {
        guard let match = uncaught.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
          let range = Range(match.range(at: 1), in: line) else { continue }
        return checked(String(line[range]))
      }
    }
    return nil
  }

  #if DEBUG
  @inline(never) static func crashForTesting(_ kind: String?) {
    if kind == "exception" {
      _ = NSArray().object(at: 3)
    }
    let pointer = UnsafeMutablePointer<Int>(bitPattern: 0x10)!
    pointer.pointee = 1
  }
  #endif
}

#if DEBUG
enum KeyEquivalents {
  private static let modifierNames: [String: NSEvent.ModifierFlags] = [
    "command": .command, "shift": .shift, "option": .option, "control": .control, "function": .function,
  ]
  private static var fired: [[String: Any]] = []
  private static var matched: [[String: Any]] = []
  private static var watching = false
  private static var pressing = 0, dryPressing = 0
  private static var handler: ((String, String?, String?) -> Void)?
  private static var menuKeyIMP: IMP?
  private(set) static var trace: [String] = []

  private static func note(_ line: String) {
    trace.append(String(format: "%.1f ", CACurrentMediaTime() * 1000) + line)
    if trace.count > 40 { trace.removeFirst(trace.count - 40) }
  }

  static func press(windowId: String, _ press: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
    guard let window = WindowManager.shared.windows[windowId] else { return done(["error": "no window \(windowId)"]) }
    note("press \(press["key"] ?? "") \(press["modifiers"] ?? "") focus=\(press["focus"] ?? "-")")
    watch()
    let key = press["key"] as? String ?? ""
    let mods = NSEvent.ModifierFlags((press["modifiers"] as? [String] ?? []).compactMap { modifierNames[$0] })
    switch press["focus"] as? String {
    case "window": window.makeFirstResponder(nil)
    case "page": if let page = pageViews(in: window).first { window.makeFirstResponder(page) }
    case "devtools": if let devTools = pageViews(in: window).first(where: isDevTools) { window.makeFirstResponder(devTools) }
    case let focus? where focus.hasPrefix("label:"):
      var control = window.contentView.flatMap { labeledView(String(focus.dropFirst(6)), in: $0) }
      while let view = control, !view.acceptsFirstResponder { control = view.superview }
      guard let control, window.makeFirstResponder(control) else { return done(["error": "can't focus \(focus)"]) }
    default: break
    }
    if let settle = press["settle"] as? Int, settle > 0 {
      var next = press
      next["settle"] = 0
      next["focus"] = nil
      return DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(settle)) {
        Self.press(windowId: windowId, next, done)
      }
    }
    guard let event = NSEvent.keyEvent(
      with: .keyDown, location: .zero, modifierFlags: mods, timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil, characters: press["characters"] as? String ?? key,
      charactersIgnoringModifiers: key, isARepeat: false, keyCode: UInt16(press["keyCode"] as? Int ?? 0))
    else { return done(["error": "no event for \(key)"]) }
    let restoreKeyWindow = press["asKey"] as? Bool == true ? standInKeyWindow(window) : nil
    let dry = press["dry"] as? Bool == true
    let throughAppKit = press["send"] as? Bool == true && !dry
    if !throughAppKit { begin(dry: dry) }
    fired = []
    matched = []
    NSApp.postEvent(event, atStart: true)
    let current = NSApp.nextEvent(matching: .keyDown, until: .distantPast, inMode: .default, dequeue: true) ?? event
    var result: [String: Any] = ["firstResponder": window.firstResponder.map { String(describing: type(of: $0)) } ?? "nil"]
    if press["send"] as? Bool == true {
      NSApp.sendEvent(current)
      let keyEvent = { (type: NSEvent.EventType, repeated: Bool) in
        NSEvent.keyEvent(
          with: type, location: .zero, modifierFlags: mods, timestamp: ProcessInfo.processInfo.systemUptime,
          windowNumber: window.windowNumber, context: nil, characters: press["characters"] as? String ?? key,
          charactersIgnoringModifiers: key, isARepeat: repeated, keyCode: UInt16(press["keyCode"] as? Int ?? 0))
      }
      let repeats = press["repeats"] as? Int ?? 0
      let every = press["repeatEvery"] as? Int ?? 50
      if repeats > 0 {
        for index in 1...repeats {
          DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(index * every)) {
            keyEvent(.keyDown, true).map { NSApp.sendEvent($0) }
            if index == repeats { keyEvent(.keyUp, false).map { NSApp.sendEvent($0) } }
          }
        }
      } else {
        keyEvent(.keyUp, false).map { NSApp.sendEvent($0) }
      }
      result["handledBy"] = "sent"
    } else if !window.isKeyWindow, let page = window.firstResponder, String(describing: type(of: page)) == "RenderWidgetHostViewCocoa" {
      let selector = NSSelectorFromString("keyEvent:wasKeyEquivalent:")
      typealias KeyEvent = @convention(c) (AnyObject, Selector, NSEvent, ObjCBool) -> Void
      unsafeBitCast(page.method(for: selector), to: KeyEvent.self)(page, selector, current, true)
      result["handledBy"] = "page"
    } else if window.performKeyEquivalent(with: current) {
      result["handledBy"] = "window"
    } else if dry, let (item, _) = menuItem(for: current), !(item is CommandItem) {
      result["handledBy"] = "menu"
      fired = [describe(item).merging(["dry": true]) { a, _ in a }]
    } else if NSApp.mainMenu?.performKeyEquivalent(with: current) == true {
      result["handledBy"] = "menu"
    } else {
      result["handledBy"] = "none"
    }
    note("dispatched \(result["handledBy"] ?? "")")
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(press["wait"] as? Int ?? 250)) {
      result["firstResponderAfter"] = window.firstResponder.map { String(describing: type(of: $0)) } ?? "nil"
      restoreKeyWindow?()
      if !throughAppKit { end(dry: dry) }
      result["fired"] = fired
      result["matched"] = matched
      note("resolved")
      done(result)
    }
  }

  static func click(windowId: String, _ click: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
    guard let window = WindowManager.shared.windows[windowId], let content = window.contentView else {
      return done(["error": "no window \(windowId)"])
    }
    var origin = NSPoint.zero
    if let label = click["label"] as? String {
      guard let target = labeledView(label, in: content) else { return done(["error": "no view labeled \(label)"]) }
      let frame = target.convert(target.bounds, to: content)
      origin = NSPoint(x: frame.midX, y: content.isFlipped ? frame.midY : content.bounds.height - frame.midY)
    } else if click["in"] as? String == "page" {
      guard let page = pageViews(in: window).first else { return done(["error": "no page in \(windowId)"]) }
      let frame = page.convert(page.bounds, to: content)
      origin = NSPoint(x: frame.minX, y: content.isFlipped ? frame.minY : content.bounds.height - frame.maxY)
    }
    let x = origin.x + (click["x"] as? Double ?? 0), y = origin.y + (click["y"] as? Double ?? 0)
    let point = content.convert(NSPoint(x: x, y: content.isFlipped ? y : content.bounds.height - y), to: nil)
    let responderName = { window.firstResponder.map { String(describing: type(of: $0)) } ?? "nil" }
    let hit = content.superview.flatMap { $0.hitTest(point) }
    var result: [String: Any] = ["firstResponder": responderName(), "hit": hit.map { String(describing: type(of: $0)) } ?? "nil"]
    let restoreKeyWindow = click["asKey"] as? Bool == false ? nil : standInKeyWindow(window)
    for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
      guard let event = NSEvent.mouseEvent(
        with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)
      else { return done(["error": "no mouse event"]) }
      if type == .leftMouseUp { result["at"] = event.timestamp * 1000 }
      if click["queued"] as? Bool == true { NSApp.postEvent(event, atStart: false) } else { NSApp.sendEvent(event) }
    }
    result["firstResponderOnClick"] = responderName()
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(click["wait"] as? Int ?? 250)) {
      result["firstResponderAfter"] = responderName()
      restoreKeyWindow?()
      done(result)
    }
  }

  private static func begin(dry: Bool) {
    if pressing == 0, let method = class_getInstanceMethod(NSMenu.self, #selector(NSMenu.performKeyEquivalent(with:))) {
      let original = method_getImplementation(method)
      menuKeyIMP = original
      typealias PerformKey = @convention(c) (NSMenu, Selector, NSEvent) -> Bool
      let block: @convention(block) (NSMenu, NSEvent) -> Bool = { menu, event in
        guard menu === NSApp.mainMenu else {
          return unsafeBitCast(original, to: PerformKey.self)(menu, #selector(NSMenu.performKeyEquivalent(with:)), event)
        }
        guard let (item, parent) = menuItem(for: event) else { return false }
        parent.update()
        matched.append(describe(item).merging(["enabled": item.isEnabled]) { a, _ in a })
        guard item.isEnabled else { return false }
        parent.performActionForItem(at: parent.index(of: item))
        return true
      }
      method_setImplementation(method, imp_implementationWithBlock(block))
    }
    pressing += 1
    if dry {
      if dryPressing == 0 { handler = MenuTarget.shared.handler }
      dryPressing += 1
      MenuTarget.shared.handler = { _, _, _ in }
    }
  }

  private static func end(dry: Bool) {
    if dry {
      dryPressing -= 1
      if dryPressing == 0 { MenuTarget.shared.handler = handler }
    }
    pressing -= 1
    if pressing == 0, let imp = menuKeyIMP, let method = class_getInstanceMethod(NSMenu.self, #selector(NSMenu.performKeyEquivalent(with:))) {
      method_setImplementation(method, imp)
    }
  }

  private static func menuItem(for event: NSEvent, in menu: NSMenu? = NSApp.mainMenu) -> (NSMenuItem, NSMenu)? {
    guard let menu else { return nil }
    let relevant: NSEvent.ModifierFlags = [.command, .shift, .option, .control, .function]
    var key = event.charactersIgnoringModifiers ?? ""
    if key == "\u{7f}" { key = "\u{8}" }
    if key == "\u{19}" { key = "\t" }
    let functionKey = key.unicodeScalars.first.map { (0xF700...0xF8FF).contains($0.value) } ?? false
    var mods = event.modifierFlags.intersection(relevant)
    if functionKey { mods.remove(.function) }
    for item in menu.items {
      if let submenu = item.submenu, submenu !== NSApp.servicesMenu, let found = menuItem(for: event, in: submenu) { return found }
      guard !item.keyEquivalent.isEmpty, !item.isHidden || item.allowsKeyEquivalentWhenHidden,
            item.keyEquivalent.lowercased() == key.lowercased() else { continue }
      let itemMods = item.keyEquivalentModifierMask.intersection(relevant)
        .union(item.keyEquivalent != item.keyEquivalent.lowercased() ? .shift : [])
      let printable = key.unicodeScalars.first.map { $0.value >= 0x20 && $0.value != 0x7f } ?? false
      let shiftedSymbol = printable && key.lowercased() == key.uppercased() && !functionKey
      if itemMods == mods || (shiftedSymbol && itemMods.union(.shift) == mods) { return (item, menu) }
    }
    return nil
  }

  private static func watch() {
    guard !watching else { return }
    watching = true
    NotificationCenter.default.addObserver(forName: NSMenu.willSendActionNotification, object: nil, queue: nil) { note in
      guard let item = note.userInfo?["MenuItem"] as? NSMenuItem else { return }
      fired.append(describe(item))
    }
  }

  private static func describe(_ item: NSMenuItem) -> [String: Any] {
    var entry: [String: Any] = ["title": item.title, "action": item.action.map(NSStringFromSelector) ?? ""]
    if let command = item as? CommandItem {
      entry["command"] = command.command
      if let arg = command.arg { entry["arg"] = arg }
    }
    return entry
  }

  private static func standInKeyWindow(_ window: NSWindow) -> () -> Void {
    let previous = NSApp.keyWindow
    window.makeKey()
    return { [weak window, weak previous] in
      if let window, NSApp.keyWindow === window, previous !== window { previous?.makeKey() }
    }
  }

  private static func labeledView(_ label: String, in root: NSView) -> NSView? {
    guard !root.isHidden, root.alphaValue > 0 else { return nil }
    for child in root.subviews.reversed() {
      if let found = labeledView(label, in: child) { return found }
    }
    return root.accessibilityLabel() == label && !root.visibleRect.isEmpty ? root : nil
  }

  private static func pageViews(in window: NSWindow) -> [NSView] {
    var views: [NSView] = []
    func walk(_ view: NSView) {
      guard !view.isHidden, view.alphaValue > 0 else { return }
      if String(describing: type(of: view)) == "RenderWidgetHostViewCocoa", !view.visibleRect.isEmpty { views.append(view) }
      view.subviews.forEach(walk)
    }
    window.contentView.map(walk)
    let area = { (v: NSView) in v.visibleRect.width * v.visibleRect.height }
    let devTools = views.filter(isDevTools)
    return views.filter { !isDevTools($0) }.sorted { area($0) > area($1) } + devTools.sorted { area($0) > area($1) }
  }

  private static func isDevTools(_ view: NSView) -> Bool {
    var tab: NSView? = view.superview
    while let current = tab, String(describing: type(of: current)) != "ArdiaCoreWebView" { tab = current.superview }
    guard let tab, let devTools = tab.value(forKey: "devtoolsView") as? NSView else { return false }
    return view.isDescendant(of: devTools)
  }
}
#endif
