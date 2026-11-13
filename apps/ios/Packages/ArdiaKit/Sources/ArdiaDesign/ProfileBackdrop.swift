import ArdiaSync
import SwiftUI

public struct ProfileBackdrop: View {
  private let look: ProfileLook?
  private let themed: Bool
  private let softened: Bool

  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.profileLook) private var ambientLook

  public init(look: ProfileLook? = nil, themed: Bool = true, softened: Bool = false) {
    self.look = look
    self.themed = themed
    self.softened = softened
  }

  public var body: some View {
    let backdrop = (look ?? ambientLook).backdrop(dark: colorScheme == .dark, themed: themed)
    fill(backdrop)
      .overlay {
        if softened {
          Color.adaptive(light: .white.opacity(0.72), dark: .black.opacity(0.55))
        }
      }
      .accessibilityHidden(true)
  }

  @ViewBuilder
  private func fill(_ backdrop: LookBackdrop) -> some View {
    switch backdrop.fill {
    case .tint(let stops):
      LinearGradient(colors: stops.map(\.color), startPoint: .top, endPoint: .bottom)
        .overlay { FilmGrain(opacity: backdrop.isDark ? 0.03 : 0.06) }
    case .theme(let look, let dark):
      ThemeBackdrop(look: look, dark: dark)
    }
  }
}

struct ThemeBackdrop: View {
  static let gradientSamples = 16

  let look: SyncedTheme.Look
  let dark: Bool

  var body: some View {
    Canvas { context, size in
      let rect = CGRect(origin: .zero, size: size)
      context.fill(Path(rect), with: .color(look.under(dark: dark).color))
      context.opacity = look.layerAlpha
      context.drawLayer { layer in
        layer.opacity = 1
        let width = max(size.width, 1)
        let height = max(size.height, 1)
        let base = ThemeAxis.ends(look.angle, width: width, height: height, reach: SyncedTheme.Look.reach, half: ThemeAxis.baseHalf)
        layer.fill(Path(rect), with: .linearGradient(baseGradient, startPoint: base.start, endPoint: base.end))
        guard let overlay = overlayGradient else { return }
        let ends = ThemeAxis.ends(look.angle + 45, width: width, height: height, reach: 1, half: ThemeAxis.overlayHalf)
        layer.fill(Path(rect), with: .linearGradient(overlay, startPoint: ends.start, endPoint: ends.end))
      }
    }
    .overlay {
      if look.grainAlpha > 0 {
        Image(decorative: TextureTile.image(look.texture), scale: 2)
          .resizable(resizingMode: .tile)
          .opacity(look.grainAlpha)
          .allowsHitTesting(false)
      }
    }
  }

  private var baseGradient: Gradient {
    let first = look.stops[0]
    let second = look.stops.count > 1 ? look.stops[1] : first
    let steps = look.stops.count > 1 ? Self.gradientSamples : 1
    return Gradient(stops: (0...steps).map { index in
      let share = Double(index) / Double(steps)
      let rgb = Oklab.mix(first.rgb, second.rgb, share)
      let alpha = first.alpha + (second.alpha - first.alpha) * share
      return Gradient.Stop(color: Color(.sRGB, red: rgb.red, green: rgb.green, blue: rgb.blue, opacity: alpha), location: share)
    })
  }

  private var overlayGradient: Gradient? {
    guard look.stops.count > 2 else { return nil }
    let top = look.stops[2]
    return Gradient(colors: [0, top.alpha].map { Color(.sRGB, red: top.red, green: top.green, blue: top.blue, opacity: $0) })
  }
}

enum TextureTile {
  static let side = 128

  private static let darkening: [SyncedTheme.Texture: (gain: Float, floor: Float)] = [
    .grain: (0.211, 0), .sand: (0.937, 0.132), .denim: (0.226, 0.068), .tweed: (0.23, 0.261),
  ]

  private static let images: [SyncedTheme.Texture: CGImage] = Dictionary(uniqueKeysWithValues: SyncedTheme.Texture.allCases.map { ($0, makeImage($0)) })

  static func image(_ texture: SyncedTheme.Texture) -> CGImage { images[texture]! }

  static func bytes(_ texture: SyncedTheme.Texture) -> [UInt8] {
    let match = darkening[texture]!
    var bytes = [UInt8](repeating: 0, count: side * side * 4)
    for (index, alpha) in alphas(texture).enumerated() {
      bytes[index * 4 + 3] = UInt8(min(255, max(0, match.floor + match.gain * alpha) * 255))
    }
    return bytes
  }

  private static func alphas(_ texture: SyncedTheme.Texture) -> [Float] {
    let n = side
    var alpha = [Float](repeating: 0, count: n * n)
    var state: UInt32 = 0x9E37_79B9
    func random() -> Float {
      state ^= state << 13
      state ^= state >> 17
      state ^= state << 5
      return Float(state % 10_000) / 10_000
    }
    func add(_ x: Int, _ y: Int, _ value: Float) {
      let index = ((y % n + n) % n) * n + (x % n + n) % n
      alpha[index] = min(1, alpha[index] + value)
    }
    switch texture {
    case .sand:
      for index in 0..<(n * n) { alpha[index] = random() * 0.25 }
      for _ in 0..<(n * n / 18) {
        let x = Int(random() * Float(n)), y = Int(random() * Float(n)), value = 0.5 + random() * 0.5
        add(x, y, value)
        add(x + 1, y, value * 0.6)
        add(x, y + 1, value * 0.6)
        add(x + 1, y + 1, value * 0.4)
      }
    case .denim:
      for y in 0..<n {
        for x in 0..<n {
          let twill: Float = (x + y) % 4 < 2 ? 0.75 : 0.15
          alpha[y * n + x] = min(1, twill * (0.6 + random() * 0.4) + (y % 2 == 0 ? 0.08 : 0))
        }
      }
    case .tweed:
      for index in 0..<(n * n) { alpha[index] = random() * 0.15 }
      for _ in 0..<(n * n / 40) {
        let x = Int(random() * Float(n)), y = Int(random() * Float(n)), value = 0.4 + random() * 0.6
        let horizontal = random() < 0.5
        for step in 0..<(3 + Int(random() * 4)) { horizontal ? add(x + step, y, value) : add(x, y + step, value) }
      }
    case .grain:
      for index in 0..<(n * n) {
        let u = random()
        alpha[index] = u * u
      }
    }
    return alpha
  }

  private static func makeImage(_ texture: SyncedTheme.Texture) -> CGImage {
    let provider = CGDataProvider(data: Data(bytes(texture)) as CFData)!
    return CGImage(
      width: side,
      height: side,
      bitsPerComponent: 8,
      bitsPerPixel: 32,
      bytesPerRow: side * 4,
      space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
      provider: provider,
      decode: nil,
      shouldInterpolate: false,
      intent: .defaultIntent
    )!
  }
}

public extension View {
  func lookBackdrop() -> some View {
    scrollContentBackground(.hidden)
      .background { ProfileBackdrop().ignoresSafeArea() }
  }
}

public struct FilmGrain: View {
  public var opacity: Double

  public init(opacity: Double = 0.16) {
    self.opacity = opacity
  }

  public var body: some View {
    Image(decorative: GrainTexture.image, scale: 2)
      .resizable(resizingMode: .tile)
      .blendMode(.overlay)
      .opacity(opacity)
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

enum GrainTexture {
  static let side = 128

  static let image: CGImage = {
    var state: UInt32 = 0x9E37_79B9
    var bytes = [UInt8](repeating: 0, count: side * side * 4)
    for index in 0..<(side * side) {
      state ^= state << 13
      state ^= state >> 17
      state ^= state << 5
      let value = UInt8(truncatingIfNeeded: 64 + Int(state % 128))
      bytes[index * 4] = value
      bytes[index * 4 + 1] = value
      bytes[index * 4 + 2] = value
      bytes[index * 4 + 3] = 255
    }
    let provider = CGDataProvider(data: Data(bytes) as CFData)!
    return CGImage(
      width: side,
      height: side,
      bitsPerComponent: 8,
      bitsPerPixel: 32,
      bytesPerRow: side * 4,
      space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
      provider: provider,
      decode: nil,
      shouldInterpolate: false,
      intent: .defaultIntent
    )!
  }()
}

public extension Color {
  init?(hexString: String) {
    var text = hexString.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.hasPrefix("#") { text.removeFirst() }
    guard text.count == 6 || text.count == 8, let value = UInt32(text, radix: 16) else { return nil }
    guard text.count == 8 else {
      self.init(hex: value)
      return
    }
    self.init(.sRGB, red: Double(value >> 24 & 0xFF) / 255, green: Double(value >> 16 & 0xFF) / 255, blue: Double(value >> 8 & 0xFF) / 255, opacity: Double(value & 0xFF) / 255)
  }
}

#Preview("Backdrop") {
  ProfileBackdrop().ignoresSafeArea()
}

#Preview("Softened") {
  ProfileBackdrop(softened: true).ignoresSafeArea()
}
