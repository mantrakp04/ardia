import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class PopoverBubble: ExpoView {
  enum Edge: String { case top, bottom, none }

  let effect = NSVisualEffectView()
  private let overlay = PopoverBubbleOverlay()
  private let shadowLayer = CALayer()
  private let shadowMask = CAShapeLayer()
  private let tintLayer = CAShapeLayer()
  private let edgeLayer = CAShapeLayer()
  private let edgeMask = CAShapeLayer()
  private var maskKey = ""

  var cornerRadius: Double = 12 { didSet { apply() } }
  var arrowEdge: Edge = .none { didSet { apply() } }
  var arrowX: Double = 0 { didSet { apply() } }
  var arrowWidth: Double = 20 { didSet { apply() } }
  var arrowHeight: Double = 9 { didSet { apply() } }
  var tint: NSColor? { didSet { apply() } }
  var edgeColor: NSColor? { didSet { apply() } }
  var edgeWidth: Double = 0 { didSet { apply() } }
  var bubbleShadowOpacity: Double = 0 { didSet { apply() } }
  var bubbleShadowRadius: Double = 0 { didSet { apply() } }
  var bubbleShadowOffsetY: Double = 0 { didSet { apply() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    effect.state = .active
    effect.blendingMode = .withinWindow
    effect.material = .popover
    addSubview(effect)
    overlay.wantsLayer = true
    overlay.layer?.masksToBounds = false
    shadowMask.fillRule = .evenOdd
    shadowLayer.mask = shadowMask
    shadowLayer.shadowColor = NSColor.black.cgColor
    edgeLayer.fillColor = nil
    edgeLayer.mask = edgeMask
    overlay.layer?.addSublayer(shadowLayer)
    overlay.layer?.addSublayer(tintLayer)
    overlay.layer?.addSublayer(edgeLayer)
    addSubview(overlay)
  }

  func setMaterial(_ name: String?) {
    let materials: [String: NSVisualEffectView.Material] = [
      "popover": .popover, "menu": .menu, "hudWindow": .hudWindow, "sheet": .sheet, "toolTip": .toolTip,
    ]
    effect.material = name.flatMap { materials[$0] } ?? .popover
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    apply()
  }

  override func layout() {
    super.layout()
    apply()
  }

  static func shape(size: CGSize, radius: CGFloat, edge: Edge, arrowX: CGFloat, arrowWidth: CGFloat, arrowHeight: CGFloat) -> CGPath {
    let lift = edge == .none ? 0 : min(arrowHeight, size.height)
    let body = CGRect(x: 0, y: lift, width: size.width, height: size.height - lift)
    let r = max(0, min(radius, body.width / 2, body.height / 2))
    let half = arrowWidth / 2
    guard edge != .none, half > 0, body.width >= 2 * (r + half) else {
      return CGPath(roundedRect: body, cornerWidth: r, cornerHeight: r, transform: nil)
    }
    let x = min(max(arrowX, r + half), body.width - r - half)
    let top = body.minY
    let path = CGMutablePath()
    path.move(to: CGPoint(x: r, y: top))
    path.addArc(tangent1End: CGPoint(x: x - half, y: top), tangent2End: CGPoint(x: x, y: 0), radius: 3)
    path.addArc(tangent1End: CGPoint(x: x, y: 0), tangent2End: CGPoint(x: x + half, y: top), radius: 2.5)
    path.addArc(tangent1End: CGPoint(x: x + half, y: top), tangent2End: CGPoint(x: body.maxX - r, y: top), radius: 3)
    path.addArc(tangent1End: CGPoint(x: body.maxX, y: top), tangent2End: CGPoint(x: body.maxX, y: body.maxY), radius: r)
    path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.maxY), tangent2End: CGPoint(x: body.minX, y: body.maxY), radius: r)
    path.addArc(tangent1End: CGPoint(x: body.minX, y: body.maxY), tangent2End: CGPoint(x: body.minX, y: top), radius: r)
    path.addArc(tangent1End: CGPoint(x: body.minX, y: top), tangent2End: CGPoint(x: r, y: top), radius: r)
    path.closeSubpath()
    if edge == .top { return path }
    var flip = CGAffineTransform(translationX: 0, y: size.height).scaledBy(x: 1, y: -1)
    return path.copy(using: &flip) ?? path
  }

  private func apply() {
    let size = bounds.size
    effect.frame = bounds
    overlay.frame = bounds
    guard size.width > 0, size.height > 0 else { return }
    let path = Self.shape(
      size: size, radius: cornerRadius, edge: arrowEdge, arrowX: arrowX, arrowWidth: arrowWidth, arrowHeight: arrowHeight)

    let key = "\(size.width)x\(size.height) \(cornerRadius) \(arrowEdge.rawValue) \(arrowX) \(arrowWidth) \(arrowHeight)"
    if key != maskKey {
      maskKey = key
      effect.maskImage = NSImage(size: size, flipped: true) { _ in
        guard let context = NSGraphicsContext.current?.cgContext else { return false }
        context.setFillColor(NSColor.black.cgColor)
        context.addPath(path)
        context.fillPath()
        return true
      }
    }

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let local = overlay.bounds
    tintLayer.frame = local
    tintLayer.path = path
    tintLayer.fillColor = tint?.cgColor

    edgeLayer.frame = local
    edgeMask.frame = local
    edgeMask.path = path
    edgeLayer.path = path
    edgeLayer.lineWidth = edgeWidth * 2
    edgeLayer.strokeColor = edgeColor?.cgColor
    edgeLayer.isHidden = edgeColor == nil || edgeWidth <= 0

    shadowLayer.frame = local
    if bubbleShadowOpacity > 0 {
      shadowLayer.isHidden = false
      shadowLayer.shadowOpacity = Float(bubbleShadowOpacity)
      shadowLayer.shadowRadius = bubbleShadowRadius
      let flipped = overlay.layer?.isGeometryFlipped == true || overlay.isFlipped
      shadowLayer.shadowOffset = CGSize(width: 0, height: flipped ? bubbleShadowOffsetY : -bubbleShadowOffsetY)
      shadowLayer.shadowPath = path
      let outset = bubbleShadowRadius * 3 + abs(bubbleShadowOffsetY) + 4
      let mask = CGMutablePath()
      mask.addRect(local.insetBy(dx: -outset, dy: -outset))
      mask.addPath(path)
      shadowMask.frame = local
      shadowMask.path = mask
    } else {
      shadowLayer.isHidden = true
    }
    CATransaction.commit()
  }
}
