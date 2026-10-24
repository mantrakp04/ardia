import AppKit

final class TrafficLights {
  static let shared = TrafficLights()

  private var lightsAlphas: [String: CGFloat] = [:]
  private(set) var menusTracking = 0
  private var menuObservers: [NSObjectProtocol] = []
  private var zoomMenus: [String: NSHashTable<NSMenu>] = [:]

  func setTrafficLightsAlpha(of window: NSWindow, alpha: CGFloat, animation: ((Double) -> CAAnimation?)? = nil) {
    guard let id = WindowManager.shared.id(of: window) else { return }
    let was = lightsAlphas[id] ?? 1
    lightsAlphas[id] = alpha < 1 ? alpha : nil
    watchMenus()
    Self.fadeTrafficLights(in: window, to: alpha, animation: animation)
    if alpha == 0, was > 0 { lightsDidHide(id: id, window: window) }
  }

  private func lightsDidHide(id: String, window: NSWindow) {
    #if DEBUG
    LightsDiagnostics.log("lights hidden", window: window, menusTracking: menusTracking)
    #endif
    zoomMenus.removeValue(forKey: id)?.allObjects.forEach { $0.cancelTracking() }
  }

  func setTrafficLightsAlpha(id: String, alpha: CGFloat, duration: Double) {
    let was = lightsAlphas[id] ?? 1
    lightsAlphas[id] = alpha < 1 ? alpha : nil
    watchMenus()
    guard let window = WindowManager.shared.windows[id] else { return }
    Self.fadeTrafficLights(in: window, to: alpha, animation: duration > 0 ? { from in Self.lightsFade(from: from, to: alpha, duration: duration) } : nil)
    if alpha == 0, was > 0 { lightsDidHide(id: id, window: window) }
  }

  func reapplyLightsAlpha(_ window: NSWindow?) {
    guard let window, let id = WindowManager.shared.id(of: window), let alpha = lightsAlphas[id] else { return }
    Self.fadeTrafficLights(in: window, to: alpha, animation: nil)
  }

  func forgetLights(id: String, window: NSWindow) {
    lightsAlphas[id] = nil
    zoomMenus[id] = nil
    Self.lightsFadeGenerations[ObjectIdentifier(window)] = nil
  }

  private func hidesLights(_ window: NSWindow, _ button: NSWindow.ButtonType) -> Bool {
    guard let id = WindowManager.shared.id(of: window), lightsAlphas[id] == 0, !window.styleMask.contains(.fullScreen), Self.fullScreenLights(window) == nil else { return false }
    return window.standardWindowButton(button).map { $0.isHidden && $0.isEnabled } == true
  }

  private func watchMenus() {
    guard menuObservers.isEmpty else { return }
    let center = NotificationCenter.default
    menuObservers = [
      center.addObserver(forName: NSMenu.didBeginTrackingNotification, object: nil, queue: .main) { [weak self] note in
        guard let self else { return }
        self.menusTracking += 1
        guard let menu = note.object as? NSMenu, let id = self.zoomButtonUnderPointer() else { return }
        self.zoomMenus[id, default: .weakObjects()].add(menu)
      },
      center.addObserver(forName: NSMenu.didEndTrackingNotification, object: nil, queue: .main) { [weak self] _ in
        guard let self else { return }
        self.menusTracking = max(0, self.menusTracking - 1)
      },
    ]
  }

  private func zoomButtonUnderPointer() -> String? {
    let mouse = NSEvent.mouseLocation
    return WindowManager.shared.windows.first { _, window in
      guard let zoom = Self.lightButton(window, .zoomButton), !zoom.isHidden else { return false }
      return window.convertToScreen(zoom.convert(zoom.bounds, to: nil)).insetBy(dx: -3, dy: -3).contains(mouse)
    }?.key
  }

  static func hiddenButton(_ window: Any?, _ button: NSWindow.ButtonType) -> NSWindow? {
    guard let window = window as? NSWindow, shared.hidesLights(window, button) else { return nil }
    return window
  }

  static func performMiniaturize(_ window: NSWindow, sender: Any?) {
    if hiddenButton(window, .miniaturizeButton) != nil { window.miniaturize(sender) } else { window.performMiniaturize(sender) }
  }

  static func performZoom(_ window: NSWindow, sender: Any?) {
    if hiddenButton(window, .zoomButton) != nil { window.zoom(sender) } else { window.performZoom(sender) }
  }

  static func performClose(_ window: NSWindow?, sender: Any?) {
    guard let window else { return }
    guard hiddenButton(window, .closeButton) != nil else { return window.performClose(sender) }
    if window.delegate?.windowShouldClose?(window) != false { window.close() }
  }

  func pointerOverTrafficLights(_ window: NSWindow) -> Bool {
    let mouse = window.mouseLocationOutsideOfEventStream
    return Self.trafficLightButtons(window).contains { !$0.isHidden && $0.convert($0.bounds, to: nil).insetBy(dx: -3, dy: -3).contains(mouse) }
  }

  #if DEBUG
  static func devReleaseLightsHover(_ window: NSWindow) {
    let zoom = lightButton(window, .zoomButton)
    releaseLightsHover(in: window, buttons: trafficLightButtons(window), at: zoom.map { $0.convert(NSPoint(x: $0.bounds.midX, y: $0.bounds.midY), to: nil) })
  }
  #endif

  private static func releaseLightsHover(in window: NSWindow, buttons: [NSButton], at point: NSPoint? = nil) {
    let mouse = point ?? window.mouseLocationOutsideOfEventStream
    guard buttons.contains(where: { !$0.isHidden && $0.convert($0.bounds, to: nil).insetBy(dx: -3, dy: -3).contains(mouse) }) else { return }
    let exited = #selector(NSResponder.mouseExited(with:))
    var sent: [String] = []
    var seen = Set<ObjectIdentifier>()
    let groups: [NSView] = fullScreenLights(window) == nil ? [] : Array(Set(buttons.compactMap(\.superview)))
    for view in buttons + groups {
      for area in view.trackingAreas where area.options.contains(.mouseEnteredAndExited) {
        guard view.convert(view is NSButton || !area.options.contains(.inVisibleRect) ? area.rect : view.visibleRect, to: nil).contains(mouse), seen.insert(ObjectIdentifier(area)).inserted, let owner = area.owner as AnyObject?,
          owner.responds(to: exited),
          let event = NSEvent.enterExitEvent(
            with: .mouseExited, location: mouse, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
            context: nil, eventNumber: 0, trackingNumber: Int(bitPattern: Unmanaged.passUnretained(area).toOpaque()), userData: nil)
        else { continue }
        _ = owner.perform(exited, with: event)
        sent.append(NSStringFromClass(type(of: owner)))
      }
    }
    #if DEBUG
    LightsDiagnostics.count("lights.hoverRelease")
    if LightsDiagnostics.enabled {
      let zoom = lightButton(window, .zoomButton).map { window.convertToScreen($0.convert($0.bounds, to: nil)) } ?? .zero
      LightsDiagnostics.log("released lights hover: mouseExited to \(sent.isEmpty ? "nothing" : sent.joined(separator: ", "))", window: window, menusTracking: TrafficLights.shared.menusTracking)
      LightsDiagnostics.log("on-screen windows near the zoom button: " + LightsDiagnostics.screenWindows(near: zoom).joined(separator: "; "), window: window, menusTracking: TrafficLights.shared.menusTracking)
    }
    #endif
  }

  private static let fullScreenLightsClass: AnyClass? = NSClassFromString("ACFullScreenLights")
  private static let fullScreenActions: [NSWindow.ButtonType: Selector] = [
    .closeButton: #selector(NSWindow.performClose(_:)), .miniaturizeButton: #selector(NSWindow.performMiniaturize(_:)),
    .zoomButton: #selector(NSWindow.toggleFullScreen(_:)),
  ]

  private static func fullScreenLights(_ window: NSWindow) -> [NSButton]? {
    guard let lightsClass = fullScreenLightsClass, let group = window.contentView?.superview?.subviews.last(where: { $0.isKind(of: lightsClass) }) else { return nil }
    return group.subviews.compactMap { $0 as? NSButton }
  }

  static func lightButton(_ window: NSWindow, _ type: NSWindow.ButtonType) -> NSButton? {
    guard let fullScreen = fullScreenLights(window) else { return window.standardWindowButton(type) }
    return fullScreen.first { $0.action == fullScreenActions[type] }
  }

  static func trafficLightButtons(_ window: NSWindow) -> [NSButton] {
    fullScreenLights(window) ?? [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].compactMap { window.standardWindowButton($0) }
  }

  private static let lightsFadeKey = "ardiaLightsFade"
  private static var lightsFadeGenerations: [ObjectIdentifier: Int] = [:]

  private static func lightsOpacity(_ button: NSButton) -> CGFloat {
    button.layer.map { CGFloat($0.opacity) } ?? button.alphaValue
  }

  private static func lightsFade(from: Double, to alpha: CGFloat, duration: Double) -> CAAnimation? {
    guard abs(Double(alpha) - from) > 0.001 else { return nil }
    let animation = CABasicAnimation(keyPath: "opacity")
    animation.fromValue = from
    animation.toValue = Double(alpha)
    animation.duration = duration
    animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    return animation
  }

  private static func fadeTrafficLights(in window: NSWindow, to alpha: CGFloat, animation make: ((Double) -> CAAnimation?)?) {
    let buttons = trafficLightButtons(window)
    guard let first = buttons.first else { return }
    let settled = buttons.allSatisfy { lightsOpacity($0) == alpha && $0.isHidden == (alpha == 0) && $0.layer?.animation(forKey: lightsFadeKey) == nil }
    if settled { return }
    let key = ObjectIdentifier(window)
    let generation = (lightsFadeGenerations[key] ?? 0) + 1
    lightsFadeGenerations[key] = generation
    let from = first.isHidden ? 0 : Double(first.layer?.presentation()?.opacity ?? Float(lightsOpacity(first)))
    let animation = make?(from)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if alpha == 0 { releaseLightsHover(in: window, buttons: buttons) }
    if alpha == 0, animation != nil {
      CATransaction.setCompletionBlock { [weak window] in
        guard let window, lightsFadeGenerations[ObjectIdentifier(window)] == generation else { return }
        let buttons = trafficLightButtons(window)
        releaseLightsHover(in: window, buttons: buttons)
        buttons.forEach { $0.isHidden = true }
      }
    }
    #if DEBUG
    LightsDiagnostics.count(animation == nil ? "lights.set" : "lights.fade")
    if buttons.contains(where: { $0.isHidden != (alpha == 0) }) { LightsDiagnostics.count("lights.hiddenToggle") }
    #endif
    for button in buttons {
      if alpha > 0 { button.isHidden = false }
      if let layer = button.layer { layer.opacity = Float(alpha) } else { button.alphaValue = alpha }
      button.layer?.removeAnimation(forKey: lightsFadeKey)
      if let animation { button.layer?.add(animation, forKey: lightsFadeKey) }
    }
    if alpha == 0, animation == nil { buttons.forEach { $0.isHidden = true } }
    CATransaction.commit()
  }
}

#if DEBUG
enum LightsDiagnostics {
  private static let handle: FileHandle? = {
    guard let path = ProcessInfo.processInfo.environment["ARDIA_TRAFFIC_LIGHTS_LOG"], !path.isEmpty else { return nil }
    if !FileManager.default.fileExists(atPath: path) { FileManager.default.createFile(atPath: path, contents: nil) }
    let handle = FileHandle(forWritingAtPath: path)
    _ = try? handle?.seekToEnd()
    return handle
  }()

  static var enabled: Bool { handle != nil }
  static var counts: [String: Int] = [:]

  static var events: [[Any]] = []

  static func count(_ what: String) {
    counts[what, default: 0] += 1
    events.append([Date().timeIntervalSince1970 * 1000, what])
    if events.count > 2000 { events.removeFirst(events.count - 2000) }
  }

  static func windowList() -> [String] {
    NSApp.windows.map { w in
      let f = w.frame
      return "\(NSStringFromClass(type(of: w))) level=\(w.level.rawValue) visible=\(w.isVisible) frame=(\(Int(f.minX)),\(Int(f.minY)),\(Int(f.width)),\(Int(f.height))) parent=\(w.parent.map { NSStringFromClass(type(of: $0)) } ?? "-")"
    }
  }

  static func screenWindows(near rect: NSRect) -> [String] {
    guard let top = NSScreen.screens.first?.frame.maxY else { return [] }
    let near = CGRect(x: rect.minX, y: top - rect.maxY, width: rect.width, height: rect.height).insetBy(dx: -200, dy: -200)
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
    return list.compactMap { info in
      guard let bounds = info[kCGWindowBounds as String] as? NSDictionary, let frame = CGRect(dictionaryRepresentation: bounds), frame.intersects(near) else { return nil }
      return "\(info[kCGWindowOwnerName as String] ?? "?") layer=\(info[kCGWindowLayer as String] ?? "?") bounds=\(Int(frame.minX)),\(Int(frame.minY)),\(Int(frame.width)),\(Int(frame.height))"
    }
  }

  static func log(_ what: String, window: NSWindow, menusTracking: Int) {
    guard let handle else { return }
    let lines = ["\(ProcessInfo.processInfo.systemUptime) window=\(window.windowNumber) \(what) menusTracking=\(menusTracking)"] + windowList().map { "  " + $0 }
    handle.write((lines.joined(separator: "\n") + "\n").data(using: .utf8) ?? Data())
  }
}
#endif
