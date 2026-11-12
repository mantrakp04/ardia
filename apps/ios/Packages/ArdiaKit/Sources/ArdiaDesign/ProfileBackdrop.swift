import SwiftUI

public struct ProfileBackdrop: View {
  private let look: ProfileLook?
  private let themed: Bool
  private let softened: Bool

  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.profileLook) private var ambientLook

  public init(look: ProfileLook? = nil, themed: Bool = false, softened: Bool = false) {
    self.look = look
    self.themed = themed
    self.softened = softened
  }

  public var body: some View {
    let look = look ?? ambientLook
    let dark = colorScheme == .dark
    let showsTheme = look.showsTheme(dark: dark, themed: themed)
    LinearGradient(
      colors: look.backdropColors(dark: dark, themed: themed),
      startPoint: showsTheme ? .topLeading : .top,
      endPoint: showsTheme ? .bottomTrailing : .bottom
    )
    .overlay {
      if softened {
        Color.adaptive(light: .white.opacity(0.72), dark: .black.opacity(0.55))
      }
    }
    .overlay { FilmGrain(opacity: dark ? 0.03 : 0.06) }
    .accessibilityHidden(true)
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
    guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
    self.init(hex: value)
  }
}

#Preview("Backdrop") {
  ProfileBackdrop().ignoresSafeArea()
}

#Preview("Softened") {
  ProfileBackdrop(softened: true).ignoresSafeArea()
}
