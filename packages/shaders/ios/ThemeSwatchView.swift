import ExpoModulesCore
import MetalKit

final class ThemeSwatchView: ExpoView {
  private let themeLayer = ArcGradientLayer()
  private let grain = GrainLayer()
  private let pad = CALayer()
  private var padLightness: Double = -1

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    pad.actions = ["bounds": NSNull(), "position": NSNull(), "contents": NSNull(), "hidden": NSNull()]
    for sub in [themeLayer, pad, grain] as [CALayer] { layer?.addSublayer(sub) }
    pad.contentsGravity = .resize
    pad.isHidden = true
    grain.opacity = 0
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func setColors(_ flat: [Double]) {
    themeLayer.setColors(ThemeGradient.parse(flat))
  }

  func setGrain(_ value: Double) {
    grain.opacity = Float(min(max(value, 0), 1))
  }

  func setTexture(_ value: String) {
    grain.texture = value
  }

  func setAngle(_ degrees: Double) {
    themeLayer.angle = CGFloat(degrees)
  }

  func setPadLightness(_ value: Double) {
    guard value != padLightness else { return }
    padLightness = value
    pad.contents = value < 0 ? nil : Self.padImage(lightness: value)
    pad.isHidden = value < 0
  }

  override func layout() {
    super.layout()
    for sub in [themeLayer, pad, grain] as [CALayer] { sub.frame = bounds }
    themeLayer.flipped = isFlipped
  }

  static func hsl(_ h: Double, _ s: Double, _ l: Double) -> (Double, Double, Double) {
    if s == 0 { return (l, l, l) }
    let q = l < 0.5 ? l * (1 + s) : l + s - l * s
    let p = 2 * l - q
    func channel(_ t0: Double) -> Double {
      var t = t0
      if t < 0 { t += 1 }
      if t > 1 { t -= 1 }
      if t < 1.0 / 6 { return p + (q - p) * 6 * t }
      if t < 0.5 { return q }
      if t < 2.0 / 3 { return p + (q - p) * (2.0 / 3 - t) * 6 }
      return p
    }
    return (channel(h + 1.0 / 3), channel(h), channel(h - 1.0 / 3))
  }

  static func padImage(lightness: Double, side: Int = 192) -> CGImage? {
    var bytes = [UInt8](repeating: 255, count: side * side * 4)
    for y in 0..<side {
      for x in 0..<side {
        let dx = (Double(x) + 0.5) / Double(side) - 0.5
        let dy = (Double(y) + 0.5) / Double(side) - 0.5
        var hue = atan2(dy, dx) / (2 * .pi)
        if hue < 0 { hue += 1 }
        let sat = min(1, (dx * dx + dy * dy).squareRoot() / 0.5)
        let (r, g, b) = hsl(hue, sat, lightness)
        let i = (y * side + x) * 4
        bytes[i] = UInt8(max(0, min(255, (r * 255).rounded())))
        bytes[i + 1] = UInt8(max(0, min(255, (g * 255).rounded())))
        bytes[i + 2] = UInt8(max(0, min(255, (b * 255).rounded())))
      }
    }
    guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
    return CGImage(width: side, height: side, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: side * 4,
                   space: CGColorSpace(name: CGColorSpace.sRGB)!,
                   bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                   provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
  }
}
