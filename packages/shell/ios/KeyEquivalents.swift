import AppKit
import ArdiaCore
import MachO
import ExpoModulesCore

#if DEBUG
enum KeyEquivalents {
  private static var fired: [[String: Any]] = []
  private static var matched: [[String: Any]] = []
  private static var watching = false
  private static var pressing = 0, dryPressing = 0
  private static var menuKeyIMP: IMP?
  private(set) static var trace: [String] = []

  private static func note(_ line: String) {
    trace.append(String(format: "%.1f ", CACurrentMediaTime() * 1000) + line)
    if trace.count > 40 { trace.removeFirst(trace.count - 40) }
  }

  static func press(windowId: String, _ press: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
    guard let window = WindowManager.shared.window(windowId) else { return done(["error": "no window \(windowId)"]) }
    note("press \(press["key"] ?? "") \(press["modifiers"] ?? "") focus=\(press["focus"] ?? "-")")
    watch()
    let key = press["key"] as? String ?? ""
    let mods = ModifierName.flags(named: press["modifiers"] as? [String] ?? [])
    let characters = press["characters"] as? String ?? key, keyCode = press["keyCode"] as? Int ?? 0
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
    guard let event = SyntheticInput.key(.keyDown, in: window, characters: characters, ignoringModifiers: key, modifiers: mods, keyCode: keyCode)
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
        SyntheticInput.key(type, in: window, characters: characters, ignoringModifiers: key, modifiers: mods, keyCode: keyCode, isARepeat: repeated)
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
    guard let window = WindowManager.shared.window(windowId), let content = window.contentView else {
      return done(["error": "no window \(windowId)"])
    }
    var origin = NSPoint.zero
    if let label = click["label"] as? String {
      guard let target = labeledView(label, in: content) else { return done(["error": "no view labeled \(label)"]) }
      let frame = target.convert(target.bounds, to: content)
      origin = SyntheticInput.contentPoint(x: frame.midX, top: frame.midY, in: content)
    } else if click["in"] as? String == "page" {
      guard let page = pageViews(in: window).first else { return done(["error": "no page in \(windowId)"]) }
      let frame = page.convert(page.bounds, to: content)
      origin = NSPoint(x: frame.minX, y: content.isFlipped ? frame.minY : content.bounds.height - frame.maxY)
    }
    let x = origin.x + (click["x"] as? Double ?? 0), y = origin.y + (click["y"] as? Double ?? 0)
    let point = content.convert(SyntheticInput.contentPoint(x: x, top: y, in: content), to: nil)
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

  static func menuBar(_ menu: NSMenu? = NSApp.mainMenu) -> [[String: Any]] {
    guard let menu else { return [] }
    menu.update()
    return menu.items.map { item in
      if item.isSeparatorItem { return ["separator": true, "hidden": item.isHidden] }
      var entry = describe(item)
      entry["key"] = item.keyEquivalent
      entry["modifiers"] = item.keyEquivalent.isEmpty ? [] : ModifierName.names(item.keyEquivalentModifierMask)
      entry["hidden"] = item.isHidden
      entry["alternate"] = item.isAlternate
      entry["keyWhenHidden"] = item.allowsKeyEquivalentWhenHidden
      entry["state"] = item.state.rawValue
      entry["enabled"] = item.isEnabled
      entry["identifier"] = item.identifier?.rawValue ?? ""
      if let submenu = item.submenu, submenu !== NSApp.servicesMenu { entry["submenu"] = menuBar(submenu) }
      return entry
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
      dryPressing += 1
      MenuTarget.shared.swallowsCommands = true
    }
  }

  private static func end(dry: Bool) {
    if dry {
      dryPressing -= 1
      if dryPressing == 0 { MenuTarget.shared.swallowsCommands = false }
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
    while let current = tab, !(current is ArdiaWebView) { tab = current.superview }
    guard let devTools = (tab as? ArdiaWebView)?.devtoolsView else { return false }
    return view.isDescendant(of: devTools)
  }
}
#endif
