import AppKit
import ExpoModulesCore

final class EdgeFade: ExpoView {
  private let content = EdgeFadeContent()
  private let fade = CAGradientLayer()

  var trailing: Double = 0 { didSet { relayout() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    content.wantsLayer = true
    addSubview(content)
    fade.colors = [NSColor.black.cgColor, NSColor.black.cgColor, NSColor.clear.cgColor]
    fade.startPoint = CGPoint(x: 0, y: 0.5)
    fade.endPoint = CGPoint(x: 1, y: 0.5)
  }

  override func didUpdateReactSubviews() {
    let wanted: [NSView] = reactSubviews() ?? []
    if content.subviews != wanted { content.subviews = wanted }
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    relayout()
  }

  private func relayout() {
    content.frame = bounds
    guard trailing > 0, bounds.width > 0 else {
      content.layer?.mask = nil
      return
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    fade.frame = content.bounds
    fade.locations = [0, NSNumber(value: max(0, 1 - trailing / bounds.width)), 1]
    content.layer?.mask = fade
    CATransaction.commit()
  }
}

private final class EdgeFadeContent: NSView {
  override var isFlipped: Bool { true }
}
