import Foundation

struct WindowDragPacing {
  static let linkStall: TimeInterval = 0.05

  private var pending: CGPoint?
  private var lastFrame: TimeInterval

  init(now: TimeInterval) {
    lastFrame = now
  }

  mutating func moved(to pointer: CGPoint, now: TimeInterval) -> CGPoint? {
    pending = pointer
    return now - lastFrame > Self.linkStall ? take() : nil
  }

  mutating func frame(now: TimeInterval) -> CGPoint? {
    lastFrame = now
    return take()
  }

  mutating func finish(at pointer: CGPoint?) -> CGPoint? {
    if let pointer { pending = pointer }
    return take()
  }

  private mutating func take() -> CGPoint? {
    defer { pending = nil }
    return pending
  }
}
