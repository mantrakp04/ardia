import SwiftUI

public struct LaunchGradient: View {
  public var colors: [Color]
  public var softened: Bool

  public init(colors: [Color] = Palette.launchGradient, softened: Bool = false) {
    self.colors = colors.isEmpty ? Palette.launchGradient : colors
    self.softened = softened
  }

  public var body: some View {
    let palette = Self.meshColors(from: colors)
    MeshGradient(
      width: 3,
      height: 3,
      points: [
        [0, 0], [0.55, 0], [1, 0],
        [0, 0.5], [0.62, 0.42], [1, 0.55],
        [0, 1], [0.5, 1], [1, 1],
      ],
      colors: palette
    )
    .overlay {
      if softened {
        Color.adaptive(light: .white.opacity(0.72), dark: .black.opacity(0.55))
      }
    }
    .overlay { FilmGrain() }
    .accessibilityHidden(true)
  }

  static func meshColors(from colors: [Color]) -> [Color] {
    let deep = colors[0]
    let violet = colors[min(1, colors.count - 1)]
    let plum = colors[min(2, colors.count - 1)]
    let pink = colors[colors.count - 1]
    return [
      deep, violet, plum,
      violet, plum, pink,
      plum, pink, pink,
    ]
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
    guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
    self.init(hex: value)
  }
}

#Preview("Launch Gradient") {
  LaunchGradient().ignoresSafeArea()
}

#Preview("Softened") {
  LaunchGradient(softened: true).ignoresSafeArea()
}
