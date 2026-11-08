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
    return stalled(now) ? take() : nil
  }

  mutating func frame(now: TimeInterval) -> CGPoint? {
    lastFrame = now
    return take()
  }

  mutating func idle(now: TimeInterval) -> CGPoint? {
    stalled(now) ? take() : nil
  }

  func untilStall(now: TimeInterval) -> TimeInterval? {
    pending == nil ? nil : max(0, lastFrame + Self.linkStall - now)
  }

  mutating func finish(at pointer: CGPoint?) -> CGPoint? {
    if let pointer { pending = pointer }
    return take()
  }

  private func stalled(_ now: TimeInterval) -> Bool {
    now - lastFrame >= Self.linkStall
  }

  private mutating func take() -> CGPoint? {
    defer { pending = nil }
    return pending
  }
}
