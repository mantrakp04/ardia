import SwiftUI

public enum IntelligencePalette {
  public static let pageBackground = Color.adaptive(light: Color(hex: 0xF1F0F5), dark: Color(hex: 0x1F2128))
  public static let card = Color.adaptive(light: .white, dark: Color(hex: 0x2A2D36))
  public static let emojiTile = Color.adaptive(light: Color(hex: 0xE2E1E6), dark: .white.opacity(0.1))
  public static let skeleton = Color.adaptive(light: .black.opacity(0.07), dark: .white.opacity(0.09))
  public static let cardSkeleton = Color.adaptive(light: .black.opacity(0.06), dark: .white.opacity(0.08))
  public static let ink = Color.adaptive(light: Color(p3Hex: 0x3139FB), dark: Color(p3Hex: 0x6F86FF))
  public static let followUpFill = Color.adaptive(light: Color(hex: 0xE1E1FB), dark: Color(hex: 0x272727))
  public static let loadingTitle = Color.adaptive(light: Color(hex: 0x1E1A63), dark: .white)
  public static let loadingStatus = Color.adaptive(light: Color(hex: 0x1E1A63, opacity: 0.62), dark: .white.opacity(0.72))
  public static let askField = Color.adaptive(light: .white.opacity(0.72), dark: .white.opacity(0.1))
  public static let symbolCircle = Color.adaptive(light: Color(p3Hex: 0x3139FB), dark: Color(p3Hex: 0x5585FF))

  public static let loadingLight: [Color] = [
    Color(hex: 0xD9CCF2), Color(hex: 0xC9B8EC), Color(hex: 0xE3C6E0),
    Color(hex: 0xBFB2EA), Color(hex: 0xD7BCE4), Color(hex: 0xEDC3D3),
    Color(hex: 0xCFC8F0), Color(hex: 0xE0C9E6), Color(hex: 0xEFCBD8),
  ]
  public static let loadingDark: [Color] = [
    Color(hex: 0x1B1748), Color(hex: 0x2A1F66), Color(hex: 0x3B2160),
    Color(hex: 0x241C5C), Color(hex: 0x37226A), Color(hex: 0x4E2459),
    Color(hex: 0x1F1A50), Color(hex: 0x33204F), Color(hex: 0x47203F),
  ]
}

public enum IntelligenceMotion {
  public static let reveal = Animation.spring(duration: 0.4, bounce: 0)
  public static let backdrop = Animation.easeInOut(duration: 0.4)
  public static let stream = Animation.easeOut(duration: 0.18)
  public static let cardFill = Animation.spring(response: 0.25, dampingFraction: 0.7, blendDuration: 0.1)
  public static let summaryReveal = Animation.easeOut(duration: 0.4)
}

public struct DriftingMesh: View {
  public var isAnimating: Bool

  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  public init(isAnimating: Bool = true) {
    self.isAnimating = isAnimating
  }

  public var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !isAnimating || reduceMotion)) { context in
      let phase = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate
      MeshGradient(
        width: 3,
        height: 3,
        points: Self.points(at: phase),
        colors: colorScheme == .dark ? IntelligencePalette.loadingDark : IntelligencePalette.loadingLight
      )
    }
    .overlay { FilmGrain(opacity: 0.12) }
    .ignoresSafeArea()
    .accessibilityHidden(true)
  }

  static func points(at time: TimeInterval) -> [SIMD2<Float>] {
    let slow = Float(time * 2 * .pi / 9)
    let slower = Float(time * 2 * .pi / 13)
    return [
      [0, 0], [0.5 + 0.08 * sin(slow), 0], [1, 0],
      [0, 0.5 + 0.1 * cos(slower)], [0.5 + 0.14 * sin(slower), 0.48 + 0.12 * cos(slow)], [1, 0.5 + 0.1 * sin(slow)],
      [0, 1], [0.5 + 0.1 * cos(slow), 1], [1, 1],
    ]
  }
}
