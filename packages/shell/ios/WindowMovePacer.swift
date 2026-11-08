import AppKit
import QuartzCore

final class WindowMovePacer: NSObject {
  private var pacing = WindowDragPacing(now: CACurrentMediaTime())
  private let place: (NSPoint) -> Void
  private var link: CADisplayLink?

  init(window: NSWindow, place: @escaping (NSPoint) -> Void) {
    self.place = place
    super.init()
    let fps = Float(max(60, NSScreen.screens.map(\.maximumFramesPerSecond).max() ?? 60))
    let link = window.displayLink(target: self, selector: #selector(frame(_:)))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: fps, preferred: fps)
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  func moved(to pointer: NSPoint) {
    if let due = pacing.moved(to: pointer, now: CACurrentMediaTime()) { place(due) }
  }

  var untilStall: TimeInterval? {
    pacing.untilStall(now: CACurrentMediaTime())
  }

  func idle() {
    if let due = pacing.idle(now: CACurrentMediaTime()) { place(due) }
  }

  func finish(at pointer: NSPoint?) {
    link?.invalidate()
    link = nil
    if let due = pacing.finish(at: pointer) { place(due) }
  }

  @objc private func frame(_ link: CADisplayLink) {
    WindowMove.traceFrame()
    if let due = pacing.frame(now: CACurrentMediaTime()) { place(due) }
  }
}
