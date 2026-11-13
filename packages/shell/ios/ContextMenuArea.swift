import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class ContextMenuArea: ExpoView {
  let onContextMenu = EventDispatcher()
  var captureDescendants = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    _ = PressRelease.watchingPresses
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let hit = super.hitTest(point)
    guard captureDescendants, hit != nil, let event = NSApp.currentEvent else { return hit }
    let secondary = event.type == .rightMouseDown || (event.type == .leftMouseDown && event.modifierFlags.contains(.control))
    return secondary ? self : hit
  }

  override func rightMouseDown(with event: NSEvent) {
    openMenu(for: event)
  }

  override func mouseDown(with event: NSEvent) {
    if event.modifierFlags.contains(.control) {
      openMenu(for: event)
      return
    }
    super.mouseDown(with: event)
  }

  private func openMenu(for press: NSEvent) {
    PressRelease.releasePressForMenu(press, in: self)
    onContextMenu([:])
  }

  override func menu(for event: NSEvent) -> NSMenu? { nil }
}

enum PressRelease {
  private static let handlerOfView = NSSelectorFromString("touchHandlerForView:")
  private static let releaseForMenu = NSSelectorFromString("ardia_releaseTouchForMenuWithEvent:")
  private static let cancelledWithoutRelease = "ardia_touchesCancelledWithoutRelease"
  private static let repeatWithin: TimeInterval = 3
  private static let repeatDistance: CGFloat = 12
  private static let classesKept = 4

  private struct Press {
    let at: TimeInterval
    let place: NSPoint
    let window: Int
    let landedOn: String
  }

  private static var presses: (earlier: Press?, latest: Press?) = (nil, nil)

  static let watchingPresses: Void = {
    _ = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { event in
      var classes: [String] = []
      var view = event.window?.contentView?.superview?.hitTest(event.locationInWindow)
      while let v = view, classes.count < classesKept {
        classes.append(String(describing: type(of: v)))
        view = v.superview
      }
      presses = (presses.latest, Press(at: event.timestamp, place: event.locationInWindow, window: event.windowNumber, landedOn: classes.joined(separator: "<")))
      return event
    }
  }()

  static var pressRepeated: [String: Any]? {
    guard let earlier = presses.earlier, let latest = presses.latest, earlier.window == latest.window,
          latest.at - earlier.at < repeatWithin, hypot(latest.place.x - earlier.place.x, latest.place.y - earlier.place.y) < repeatDistance
    else { return nil }
    return ["landedOn": earlier.landedOn, "ms": Int((latest.at - earlier.at) * 1000)]
  }

  static var pressesWithoutRelease: Int {
    guard let handlers = NSClassFromString("RCTTouchHandler") as AnyObject?, handlers.responds(to: NSSelectorFromString(cancelledWithoutRelease))
    else { return 0 }
    return (handlers.value(forKey: cancelledWithoutRelease) as? NSNumber)?.intValue ?? 0
  }

  static func releasePressForMenu(_ press: NSEvent, in view: NSView) {
    guard let handlers = NSClassFromString("RCTTouchHandler") as AnyObject?, handlers.responds(to: handlerOfView),
          let handler = handlers.perform(handlerOfView, with: view)?.takeUnretainedValue(), handler.responds(to: releaseForMenu)
    else { return }
    _ = handler.perform(releaseForMenu, with: press)
  }
}
