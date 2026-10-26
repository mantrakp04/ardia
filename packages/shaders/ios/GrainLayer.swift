import AppKit

final class GrainLayer: CALayer {
  static let side = 128
  static let arcDarkening: [String: (gain: Float, floor: Float)] = [
    "grain": (0.211, 0), "sand": (0.937, 0.132), "denim": (0.226, 0.068), "tweed": (0.23, 0.261),
  ]
  private static var patterns: [String: CGColor] = [:]

  var texture = "grain" { didSet { if texture != oldValue { backgroundColor = Self.pattern(texture) } } }

  override init() {
    super.init()
    actions = ["bounds": NSNull(), "position": NSNull(), "opacity": NSNull(), "backgroundColor": NSNull()]
    backgroundColor = Self.pattern(texture)
  }

  override init(layer: Any) { super.init(layer: layer) }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  static func pattern(_ texture: String) -> CGColor? {
    if let cached = patterns[texture] { return cached }
    guard let tile = tile(texture) else { return nil }
    let image = NSImage(cgImage: tile, size: NSSize(width: side / 2, height: side / 2))
    let color = NSColor(patternImage: image).cgColor
    patterns[texture] = color
    return color
  }

  static func tile(_ texture: String) -> CGImage? {
    let n = side
    var alpha = [Float](repeating: 0, count: n * n)
    var state: UInt32 = 0x9E3779B9
    func random() -> Float {
      state ^= state << 13
      state ^= state >> 17
      state ^= state << 5
      return Float(state % 10_000) / 10_000
    }
    func add(_ x: Int, _ y: Int, _ v: Float) {
      let i = ((y % n + n) % n) * n + (x % n + n) % n
      alpha[i] = min(1, alpha[i] + v)
    }
    switch texture {
    case "sand":
      for i in 0..<(n * n) { alpha[i] = random() * 0.25 }
      for _ in 0..<(n * n / 18) {
        let x = Int(random() * Float(n)), y = Int(random() * Float(n)), v = 0.5 + random() * 0.5
        add(x, y, v)
        add(x + 1, y, v * 0.6)
        add(x, y + 1, v * 0.6)
        add(x + 1, y + 1, v * 0.4)
      }
    case "denim":
      for y in 0..<n {
        for x in 0..<n {
          let twill: Float = (x + y) % 4 < 2 ? 0.75 : 0.15
          alpha[y * n + x] = min(1, twill * (0.6 + random() * 0.4) + (y % 2 == 0 ? 0.08 : 0))
        }
      }
    case "tweed":
      for i in 0..<(n * n) { alpha[i] = random() * 0.15 }
      for _ in 0..<(n * n / 40) {
        let x = Int(random() * Float(n)), y = Int(random() * Float(n)), v = 0.4 + random() * 0.6
        let horizontal = random() < 0.5
        for k in 0..<(3 + Int(random() * 4)) { horizontal ? add(x + k, y, v) : add(x, y + k, v) }
      }
    default:
      for i in 0..<(n * n) {
        let u = random()
        alpha[i] = u * u
      }
    }
    let match = arcDarkening[texture] ?? arcDarkening["grain"]!
    var bytes = [UInt8](repeating: 0, count: n * n * 4)
    for i in 0..<(n * n) { bytes[i * 4 + 3] = UInt8(min(255, max(0, match.floor + match.gain * alpha[i]) * 255)) }
    guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
    return CGImage(width: n, height: n, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: n * 4,
                   space: CGColorSpace(name: CGColorSpace.sRGB)!,
                   bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                   provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
  }
}
