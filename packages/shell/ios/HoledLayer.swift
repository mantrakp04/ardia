import QuartzCore

final class HoledLayer: CALayer {
  let hole = CAShapeLayer()

  override init() {
    super.init()
    hole.fillRule = .evenOdd
    hole.actions = ["path": NSNull(), "bounds": NSNull(), "position": NSNull()]
    super.mask = hole
  }

  override init(layer: Any) {
    super.init(layer: layer)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var mask: CALayer? {
    get { super.mask }
    set { super.mask = hole }
  }
}
