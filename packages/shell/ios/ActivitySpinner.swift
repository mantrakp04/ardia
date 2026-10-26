import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class ActivitySpinner: ExpoView {
  private let track = CAShapeLayer()
  private let ring = CAShapeLayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    for shape in [track, ring] {
      shape.fillColor = nil
      shape.lineWidth = 1.5
    }
    ring.lineCap = .round
    ring.strokeStart = 0
    ring.strokeEnd = 0.72
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    relayout()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    relayout()
    spin()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    recolor()
  }

  private func relayout() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for shape in [track, ring] where shape.superlayer !== layer { layer.addSublayer(shape) }
    let path = CGPath(ellipseIn: bounds.insetBy(dx: 1.25, dy: 1.25), transform: nil)
    for shape in [track, ring] {
      shape.frame = bounds
      shape.path = path
    }
    CATransaction.commit()
    recolor()
  }

  private func recolor() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      track.strokeColor = NSColor.secondaryLabelColor.withAlphaComponent(0.18).cgColor
      ring.strokeColor = NSColor.secondaryLabelColor.cgColor
    }
  }

  private func spin() {
    guard window != nil, ring.animation(forKey: "activityRotation") == nil else { return }
    let turn = CABasicAnimation(keyPath: "transform.rotation.z")
    turn.fromValue = 0
    turn.toValue = isFlipped ? 2 * Double.pi : -2 * Double.pi
    turn.duration = 1.88
    turn.repeatCount = .infinity
    turn.timingFunction = CAMediaTimingFunction(name: .linear)
    turn.isRemovedOnCompletion = false
    ring.add(turn, forKey: "activityRotation")
  }
}
