import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

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
