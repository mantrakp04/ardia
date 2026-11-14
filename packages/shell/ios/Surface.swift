import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class Surface: ExpoView {
  var surfaceFill: NSColor? { didSet { apply() } }
  var surfaceFillColors: [NSColor] = [] { didSet { apply() } }
  var surfaceFillStops: [Double] = [] { didSet { apply() } }
  var surfaceFade: [Double] = [] { didSet { apply() } }
  var surfaceFadeStops: [Double] = [] { didSet { apply() } }
  var surfaceRadius: Double = 0 { didSet { apply() } }
  var surfaceBorderColor: NSColor? { didSet { apply() } }
  var surfaceBorderWidth: Double = 0 { didSet { apply() } }
  var surfaceBorderColors: [NSColor] = [] { didSet { apply() } }
  var surfaceShadowColor: NSColor? { didSet { apply() } }
  var surfaceShadowOpacity: Double = 0 { didSet { apply() } }
  var surfaceShadowRadius: Double = 0 { didSet { apply() } }
  var surfaceShadowOffset: CGSize = .zero { didSet { apply() } }

  private let plate = CALayer()
  private let fillGradient = CAGradientLayer()
  private let fadeMask = CAGradientLayer()
  private let shadowLayer = CALayer()
  private let shadowMask = CAShapeLayer()
  private let borderGradient = CAGradientLayer()
  private let borderStroke = CAShapeLayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
  }

  override func layout() {
    super.layout()
    apply()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    apply()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    apply()
  }

  override func updateLayer() {
    super.updateLayer()
    apply()
  }

  private func apply() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if borderGradient.superlayer !== layer {
      layer.insertSublayer(borderGradient, at: 0)
      borderStroke.fillColor = nil
      borderStroke.strokeColor = NSColor.black.cgColor
      borderGradient.mask = borderStroke
    }
    if plate.superlayer !== layer {
      layer.insertSublayer(plate, at: 0)
      layer.insertSublayer(shadowLayer, below: plate)
      shadowMask.fillRule = .evenOdd
      shadowLayer.mask = shadowMask
    }
    layer.masksToBounds = false
    plate.frame = bounds
    plate.cornerRadius = surfaceRadius
    plate.cornerCurve = .continuous
    plate.backgroundColor = surfaceFill?.cgColor
    plate.borderColor = surfaceBorderColor?.cgColor
    plate.borderWidth = surfaceBorderWidth
    applyGradientFill(flipped: layer.isGeometryFlipped || isFlipped)

    if surfaceBorderColors.count >= 2, surfaceBorderWidth > 0 {
      borderGradient.isHidden = false
      borderGradient.frame = bounds
      borderGradient.colors = surfaceBorderColors.map(\.cgColor)
      let flipped = layer.isGeometryFlipped || isFlipped
      borderGradient.startPoint = CGPoint(x: 0.5, y: flipped ? 0 : 1)
      borderGradient.endPoint = CGPoint(x: 0.5, y: flipped ? 1 : 0)
      let inset = surfaceBorderWidth / 2
      borderStroke.frame = bounds
      borderStroke.lineWidth = surfaceBorderWidth
      borderStroke.path = CGPath(
        roundedRect: bounds.insetBy(dx: inset, dy: inset),
        cornerWidth: max(surfaceRadius - inset, 0), cornerHeight: max(surfaceRadius - inset, 0), transform: nil)
      plate.borderWidth = 0
    } else {
      borderGradient.isHidden = true
    }

    let shape = CGPath(roundedRect: bounds, cornerWidth: surfaceRadius, cornerHeight: surfaceRadius, transform: nil)
    shadowLayer.frame = bounds
    if let shadowColor = surfaceShadowColor, surfaceShadowOpacity > 0 {
      shadowLayer.shadowColor = shadowColor.cgColor
      shadowLayer.shadowOpacity = Float(surfaceShadowOpacity)
      shadowLayer.shadowRadius = surfaceShadowRadius
      shadowLayer.shadowOffset = CGSize(width: surfaceShadowOffset.width, height: layer.isGeometryFlipped || isFlipped ? surfaceShadowOffset.height : -surfaceShadowOffset.height)
      shadowLayer.shadowPath = shape
      let outset = surfaceShadowRadius * 3 + abs(surfaceShadowOffset.height) + abs(surfaceShadowOffset.width) + 4
      let mask = CGMutablePath()
      mask.addRect(bounds.insetBy(dx: -outset, dy: -outset))
      mask.addPath(shape)
      shadowMask.frame = bounds
      shadowMask.path = mask
      shadowLayer.isHidden = false
    } else {
      shadowLayer.isHidden = true
    }
    CATransaction.commit()
  }

  private func applyGradientFill(flipped: Bool) {
    if surfaceFillColors.count >= 2 {
      if fillGradient.superlayer !== plate { plate.addSublayer(fillGradient) }
      fillGradient.isHidden = false
      fillGradient.frame = plate.bounds
      fillGradient.colors = surfaceFillColors.map(\.cgColor)
      fillGradient.locations = surfaceFillStops.count == surfaceFillColors.count ? surfaceFillStops.map { NSNumber(value: $0) } : nil
      fillGradient.startPoint = CGPoint(x: 0.5, y: flipped ? 0 : 1)
      fillGradient.endPoint = CGPoint(x: 0.5, y: flipped ? 1 : 0)
      plate.masksToBounds = true
    } else {
      fillGradient.isHidden = true
      plate.masksToBounds = false
    }
    if surfaceFade.count >= 2 {
      fadeMask.frame = plate.bounds
      fadeMask.colors = surfaceFade.map { NSColor.black.withAlphaComponent($0).cgColor }
      fadeMask.locations = surfaceFadeStops.count == surfaceFade.count ? surfaceFadeStops.map { NSNumber(value: $0) } : nil
      fadeMask.startPoint = CGPoint(x: 0, y: 0.5)
      fadeMask.endPoint = CGPoint(x: 1, y: 0.5)
      plate.mask = fadeMask
    } else {
      plate.mask = nil
    }
  }
}
