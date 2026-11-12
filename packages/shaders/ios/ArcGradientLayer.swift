import AppKit

final class ArcGradientLayer: CALayer {
  static let samples = 16
  static let reach: CGFloat = 0.75
  static let defaultAngle: CGFloat = 135
  private static let space = CGColorSpace(name: CGColorSpace.extendedSRGB)!
  private static let still: [String: CAAction] = [
    "bounds": NSNull(), "position": NSNull(), "colors": NSNull(), "locations": NSNull(), "startPoint": NSNull(),
    "endPoint": NSNull(), "opacity": NSNull(), "hidden": NSNull(),
  ]

  private let base = CAGradientLayer()
  private let overlay = CAGradientLayer()
  var flipped = false { didSet { setNeedsLayout() } }
  var angle = ArcGradientLayer.defaultAngle { didSet { if angle != oldValue { setNeedsLayout() } } }

  override init() {
    super.init()
    actions = Self.still
    for layer in [base, overlay] {
      layer.actions = Self.still
      addSublayer(layer)
    }
    overlay.isHidden = true
  }

  override init(layer: Any) { super.init(layer: layer) }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  func setColors(_ colors: [SIMD4<Float>]) {
    guard let first = colors.first else {
      base.colors = nil
      overlay.isHidden = true
      return
    }
    let second = colors.count > 1 ? colors[1] : first
    let a = Self.oklab(first), b = Self.oklab(second)
    let steps = colors.count > 1 ? Self.samples : 1
    base.colors = (0...steps).map { i -> CGColor in
      let t = Float(i) / Float(steps)
      return Self.cgColor(Self.srgb(a + (b - a) * t))
    }
    base.locations = (0...steps).map { NSNumber(value: Double($0) / Double(steps)) }
    if colors.count > 2 {
      let top = SIMD4(colors[2].x, colors[2].y, colors[2].z, 0)
      overlay.colors = [Self.cgColor(top), Self.cgColor(colors[2])]
      overlay.isHidden = false
    } else {
      overlay.isHidden = true
    }
  }

  override func layoutSublayers() {
    super.layoutSublayers()
    base.frame = bounds
    overlay.frame = bounds
    let w = max(bounds.width, 1), h = max(bounds.height, 1)
    let unit = { (u: CGFloat, v: CGFloat) in CGPoint(x: u, y: self.flipped ? v : 1 - v) }
    func place(_ layer: CAGradientLayer, degrees: CGFloat, reach: CGFloat, half: (CGFloat, CGFloat) -> CGFloat) {
      let r = degrees * .pi / 180, dx = sin(r), dy = -cos(r)
      let length = half(dx, dy)
      let ax = w * dx, ay = h * dy
      let scale = 2 * length * reach / (ax * ax + ay * ay)
      let u = 0.5 - length * dx / w, v = 0.5 - length * dy / h
      layer.startPoint = unit(u, v)
      layer.endPoint = unit(u + ax * scale, v + ay * scale)
    }
    place(base, degrees: angle, reach: Self.reach) { dx, dy in hypot(w * dx, h * dy) * hypot(w, h) / (2 * max(w, h)) }
    place(overlay, degrees: angle + 45, reach: 1) { dx, dy in (w * abs(dx) + h * abs(dy)) / 2 }
  }

  private static func cgColor(_ c: SIMD4<Float>) -> CGColor {
    CGColor(colorSpace: space, components: [CGFloat(c.x), CGFloat(c.y), CGFloat(c.z), CGFloat(min(max(c.w, 0), 1))])
      ?? CGColor(gray: 0.5, alpha: 1)
  }

  static func oklab(_ c: SIMD4<Float>) -> SIMD4<Float> {
    func lin(_ x: Float) -> Float { abs(x) <= 0.04045 ? x / 12.92 : (x < 0 ? -1 : 1) * pow((abs(x) + 0.055) / 1.055, 2.4) }
    let r = lin(c.x), g = lin(c.y), b = lin(c.z)
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return SIMD4(
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
      c.w)
  }

  static func srgb(_ lab: SIMD4<Float>) -> SIMD4<Float> {
    var l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z
    var m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z
    var s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z
    l = l * l * l
    m = m * m * m
    s = s * s * s
    let lin = SIMD3<Float>(
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    func encode(_ x: Float) -> Float { abs(x) <= 0.0031308 ? x * 12.92 : (x < 0 ? -1 : 1) * (1.055 * pow(abs(x), 1 / 2.4) - 0.055) }
    return SIMD4(encode(lin.x), encode(lin.y), encode(lin.z), lab.w)
  }
}
