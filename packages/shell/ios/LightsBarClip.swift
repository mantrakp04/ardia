import ExpoModulesCore

final class LightsBarClip: ExpoView {
  var holeLeft: CGFloat = 0 { didSet { reshape() } }
  var holeRadius: CGFloat = 0 { didSet { reshape() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
  }

  override func makeBackingLayer() -> CALayer { HoledLayer() }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    reshape()
  }

  override func layout() {
    super.layout()
    reshape()
  }

  private func reshape() {
    guard let layer = layer as? HoledLayer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.hole.frame = layer.bounds
    let w = layer.bounds.width, h = layer.bounds.height
    let r = min(holeRadius, h, max(0, (w - holeLeft) / 2))
    let down = layer.contentsAreFlipped()
    let y = { (v: CGFloat) in down ? v : h - v }
    let path = CGMutablePath()
    path.addRect(layer.bounds)
    if r > 0 {
      path.move(to: CGPoint(x: holeLeft, y: y(h)))
      path.addArc(tangent1End: CGPoint(x: holeLeft, y: y(h - r)), tangent2End: CGPoint(x: holeLeft + r, y: y(h - r)), radius: r)
      path.addLine(to: CGPoint(x: w - r, y: y(h - r)))
      path.addArc(tangent1End: CGPoint(x: w, y: y(h - r)), tangent2End: CGPoint(x: w, y: y(h)), radius: r)
      path.closeSubpath()
    }
    layer.hole.path = path
    CATransaction.commit()
  }
}
