import AppKit
import CoreImage
import ExpoModulesCore

final class DockSelection: ExpoView {
  var source: IconSource? { didSet { if source != oldValue { apply() } } }
  var kind = "" { didSet { apply() } }
  var fill: NSColor? { didSet { apply() } }
  var stroke: NSColor? { didSet { apply() } }
  var cornerRadius: Double = 10 { didSet { apply() } }
  var strokeWidth: Double = 3 { didSet { apply() } }
  var dark = true { didSet { apply() } }
  var iconSize: Double = 16 { didSet { apply() } }
  var glass = false { didSet { if glass != oldValue { apply() } } }
  var colorRing = false { didSet { if colorRing != oldValue { apply() } } }

  private let tile = CALayer()
  private let background = CALayer()
  private let tint = CALayer()
  private let ring = CALayer()
  private let ringImage = CALayer()
  private let ringMask = CALayer()
  private let icon = CALayer()
  private let lift = CALayer()
  private let liftMask = CAShapeLayer()
  private let hue = CALayer()
  private let hueImage = CALayer()
  private let sheen = CAGradientLayer()
  private let rim = CAGradientLayer()
  private let rimMask = CALayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    layerUsesCoreImageFilters = true
    tile.masksToBounds = true
    tile.addSublayer(background)
    tile.addSublayer(tint)
    tint.opacity = 0.22
    for layer in [tint, ringImage] {
      layer.contentsGravity = .resizeAspectFill
      layer.masksToBounds = true
    }
    ring.addSublayer(ringImage)
    ringMask.borderColor = NSColor.white.cgColor
    liftMask.fillRule = .evenOdd
    lift.mask = liftMask
    lift.shadowColor = NSColor.black.cgColor
    lift.shadowRadius = 3
    hue.masksToBounds = true
    hue.addSublayer(hueImage)
    hueImage.contentsGravity = .resizeAspectFill
    sheen.masksToBounds = true
    rimMask.borderColor = NSColor.white.cgColor
    rim.mask = rimMask
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

  override func updateLayer() {
    super.updateLayer()
    apply()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    apply()
  }

  private func apply() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    if tile.superlayer !== layer {
      layer.insertSublayer(tile, at: 0)
      layer.insertSublayer(ring, above: tile)
      layer.insertSublayer(icon, above: ring)
      layer.insertSublayer(lift, below: tile)
      layer.insertSublayer(hue, above: icon)
      layer.insertSublayer(sheen, above: hue)
      layer.insertSublayer(rim, above: sheen)
    }
    for dia in [tile, icon] { dia.isHidden = glass }
    ring.isHidden = glass && !colorRing
    for glassLayer in [hue, sheen] { glassLayer.isHidden = !glass }
    lift.isHidden = !glass || colorRing
    rim.isHidden = !glass || colorRing
    let radius = min(cornerRadius, bounds.width / 2)
    let scale = window?.backingScaleFactor ?? 2
    let width = (strokeWidth * scale).rounded() / scale
    let big = bounds.insetBy(dx: -bounds.width * 0.75, dy: -bounds.height * 0.75)
    let blurred = kind == "blur" ? source.flatMap(BlurredIcon.of) : nil
    if glass {
      applyGlass(radius: radius, rimWidth: width, big: big)
      if colorRing { applyRing(radius: radius, width: width, big: big, blurred: blurred) }
      return
    }
    tile.frame = bounds
    tile.cornerRadius = radius
    tile.cornerCurve = .continuous
    background.frame = bounds
    tint.frame = big
    icon.frame = CGRect(x: (bounds.width - iconSize) / 2, y: (bounds.height - iconSize) / 2, width: iconSize, height: iconSize)
    icon.contents = kind == "template" ? source.flatMap(TemplateIcon.of) : nil
    applyRing(radius: radius, width: width, big: big, blurred: blurred)

    if let blurred {
      background.backgroundColor = NSColor.white.withAlphaComponent(dark ? 0.2 : 1).cgColor
      tint.contents = blurred.plain
      tint.isHidden = false
    } else {
      background.backgroundColor = fill?.cgColor
      tint.contents = nil
      tint.isHidden = true
    }
  }

  private func applyRing(radius: CGFloat, width: CGFloat, big: CGRect, blurred: BlurredIcon?) {
    for shape in [ring, ringMask] {
      shape.frame = bounds
      shape.cornerRadius = radius
      shape.cornerCurve = .continuous
    }
    ringImage.frame = big
    ringMask.borderWidth = width
    if let blurred {
      let bright = glass && colorRing
      ring.mask = ringMask
      ring.backgroundColor = bright ? nil : (dark ? NSColor.black : NSColor.white).cgColor
      ring.borderWidth = 0
      ring.compositingFilter = nil
      ringImage.contents = dark && !bright ? blurred.darkRing : blurred.plain
      ringImage.opacity = dark && !bright ? 0.75 : 1
      ringImage.isHidden = false
    } else {
      ring.mask = nil
      ring.backgroundColor = nil
      ring.borderWidth = width
      ring.borderColor = (stroke ?? .white).cgColor
      ring.compositingFilter = stroke == nil ? CIFilter(name: "CISoftLightBlendMode") : nil
      ringImage.contents = nil
      ringImage.isHidden = true
    }
  }

  private func applyGlass(radius: CGFloat, rimWidth: CGFloat, big: CGRect) {
    let flipped = layer?.isGeometryFlipped == true || isFlipped
    let top = CGPoint(x: 0.5, y: flipped ? 0 : 1)
    let bottom = CGPoint(x: 0.5, y: flipped ? 1 : 0)
    for shape in [hue, sheen, rim, rimMask] {
      shape.frame = bounds
      shape.cornerRadius = radius
      shape.cornerCurve = .continuous
    }

    let shape = CGPath(roundedRect: bounds, cornerWidth: radius, cornerHeight: radius, transform: nil)
    lift.frame = bounds
    lift.shadowPath = shape
    lift.shadowOpacity = dark ? 0.5 : 0.2
    lift.shadowOffset = CGSize(width: 0, height: flipped ? 1 : -1)
    let outside = CGMutablePath()
    outside.addRect(bounds.insetBy(dx: -12, dy: -12))
    outside.addPath(shape)
    liftMask.frame = bounds
    liftMask.path = outside

    let glow = kind == "blur" ? source.flatMap { source in BlurredIcon.of(source).flatMap { GlassGlow.of(source, blurred: $0.plain) } } : nil
    let color = kind == "template" ? fill.flatMap(GlassGlow.of) : nil
    hueImage.frame = big.offsetBy(dx: -bounds.minX, dy: -bounds.minY)
    hueImage.contents = glow
    hue.backgroundColor = color
    hue.isHidden = glow == nil && color == nil
    hue.opacity = dark ? 0.35 : 0.3

    sheen.colors = [NSColor.white.withAlphaComponent(dark ? 0.12 : 0.4).cgColor, NSColor.white.withAlphaComponent(0).cgColor]
    sheen.locations = [0, 0.6]
    sheen.startPoint = top
    sheen.endPoint = bottom

    rimMask.borderWidth = rimWidth
    rim.colors = [
      NSColor.white.withAlphaComponent(dark ? 0.5 : 1).cgColor,
      NSColor.white.withAlphaComponent(dark ? 0.14 : 0.55).cgColor,
    ]
    rim.startPoint = top
    rim.endPoint = bottom
  }
}
