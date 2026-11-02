import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

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
