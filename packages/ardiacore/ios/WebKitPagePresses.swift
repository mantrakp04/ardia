import AppKit

struct WebKitPagePresses {
  enum Verdict: Equatable {
    case pass
    case drop
    case refuse
  }

  private var held = Set<Int>()

  static func lands(_ event: NSEvent, on view: NSView) -> Bool {
    guard let window = view.window, event.window === window, let frame = window.contentView?.superview else { return true }
    guard let hit = frame.hitTest(event.locationInWindow) else { return false }
    return hit === view || hit.isDescendant(of: view)
  }

  mutating func verdict(for event: NSEvent, on view: NSView) -> Verdict {
    let button = event.buttonNumber
    switch event.type {
    case .leftMouseDown, .rightMouseDown, .otherMouseDown:
      guard Self.lands(event, on: view) else {
        held.remove(button)
        return .refuse
      }
      held.insert(button)
      return .pass
    case .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
      return held.contains(button) ? .pass : .drop
    case .leftMouseUp, .rightMouseUp, .otherMouseUp:
      return held.remove(button) != nil ? .pass : .drop
    default:
      return .pass
    }
  }
}
