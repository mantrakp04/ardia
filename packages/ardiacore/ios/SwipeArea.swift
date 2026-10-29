import ExpoModulesCore

final class SwipeArea: ExpoView, ArdiaSwipeTarget {
  let onSwipe = EventDispatcher()
  let onPagerPosition = EventDispatcher()
  let onPagerState = EventDispatcher()
  var canSwipeBack = false
  var canSwipeForward = false
  var tracksUnavailableDirections = false
  var allowsVerticalMotion = false
  @objc var isPager = false
  private(set) var pager: Pager?
  private var pagerWidth: CGFloat = 0

  @objc var hasNativePager: Bool { pager != nil }

  var pageWidth: Double { Double(pagerWidth > 0 ? pagerWidth : bounds.width) }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { ArdiaSwipe.addTarget(self) } else { ArdiaSwipe.removeTarget(self) }
  }

  deinit {
    if let pager { DispatchQueue.main.async { pager.prune() } }
  }

  func swipeEvent(_ event: [String: Any]) {
    onSwipe(event)
  }

  @objc(pagerInput:distance:direction:timestamp:)
  func pagerInput(_ phase: String, distance: CGFloat, direction: Int32, timestamp: TimeInterval) {
    pager?.input(from: self, phase: phase, distance: Double(distance), direction: Int(direction), timestamp: timestamp)
  }

  func configurePager(_ config: PagerConfig?) {
    guard let config else {
      let old = pager
      pager = nil
      old?.detach(self)
      return
    }
    if pager?.key != config.key {
      pager?.detach(self)
      pager = Pager.named(config.key)
      pager!.attach(self)
    }
    pagerWidth = CGFloat(config.width)
    pager!.configure(selected: config.selected, count: config.count, ack: config.ack, order: config.order)
  }
}
