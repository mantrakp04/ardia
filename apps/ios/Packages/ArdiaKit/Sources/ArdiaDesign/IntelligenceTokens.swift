import SwiftUI

public enum IntelligencePalette {
  public static let pageBackground = Color.adaptive(light: Color(hex: 0xF1F0F5), dark: Color(hex: 0x1F2128))
  public static let card = Color.adaptive(light: .white, dark: Color(hex: 0x2A2D36))
  public static let emojiTile = Color.adaptive(light: Color(hex: 0xE2E1E6), dark: .white.opacity(0.1))
  public static let skeleton = Color.adaptive(light: .black.opacity(0.07), dark: .white.opacity(0.09))
  public static let cardSkeleton = Color.adaptive(light: .black.opacity(0.06), dark: .white.opacity(0.08))
  public static let ink = Color.adaptive(light: Color(p3Hex: 0x3139FB), dark: Color(p3Hex: 0x5585FF))
  public static let followUpFill = Color.adaptive(light: Color(hex: 0xE1E1FB), dark: Color(hex: 0x2C2F3A))
  public static let quoteBackground = Color.adaptive(light: Color(hex: 0xF8F8FA), dark: Color(hex: 0x0A0A14))
  public static let askField = Color.adaptive(light: .white.opacity(0.72), dark: .white.opacity(0.1))
  public static let symbolCircle = Color.adaptive(light: Color(p3Hex: 0x3139FB), dark: Color(p3Hex: 0x5585FF))

  public static let loadingInk = Color.adaptive(light: Color(p3Hex: 0x5B3FDB), dark: Color(p3Hex: 0x7A5CF0))
  public static let loadingBase: [Color] = [
    Color.adaptive(light: Color(hex: 0xF7F4F8), dark: Color(hex: 0x2A2729)),
    Color.adaptive(light: Color(hex: 0xF0EEF5), dark: Color(hex: 0x212329)),
  ]
  public static let risingLight: [Color] = [
    Color(hex: 0xF0EEF5), Color(hex: 0xF0EEF5), Color(hex: 0xF0EEF5),
    Color(hex: 0xC7A6F2), Color(hex: 0xE7A3D6), Color(hex: 0xF39BC2),
    Color(hex: 0xD4B3F5), Color(hex: 0xF2B0D6), Color(hex: 0xF8A6C8),
  ]
  public static let risingDark: [Color] = [
    Color(hex: 0x212329), Color(hex: 0x212329), Color(hex: 0x212329),
    Color(hex: 0x8E58C4), Color(hex: 0xA14597), Color(hex: 0xA21C74),
    Color(hex: 0xB370CB), Color(hex: 0xD05998), Color(hex: 0xCC2A80),
  ]
  public static let modeSelection: [Color] = [Color(hex: 0x4A2FB8), Color(hex: 0x9B3FA8), Color(hex: 0xE0558F)]
}

public enum IntelligenceMotion {
  public static let reveal = Animation.spring(duration: 0.4, bounce: 0)
  public static let backdrop = Animation.easeInOut(duration: 0.4)
  public static let stream = Animation.easeOut(duration: 0.18)
  public static let cardFill = Animation.spring(response: 0.25, dampingFraction: 0.7, blendDuration: 0.1)
  public static let summaryReveal = Animation.easeOut(duration: 0.4)
  public static let ease = Animation.timingCurve(0.25, 0.1, 0.25, 1, duration: 0.4)
  public static let rise = Animation.timingCurve(0.25, 0.1, 0.25, 1, duration: 1.0)
  public static let modeSwitch = Animation.spring(duration: 0.3, bounce: 0.15)
  public static let modePress = Animation.spring(response: 0.15, dampingFraction: 0.85, blendDuration: 0.25)

  public static func domainDelay(_ index: Int) -> Double {
    0.2 + min(Double(index) * 0.05, 0.3)
  }
}

public struct RisingGradient: View {
  public var isAnimating: Bool

  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase
  @State private var risen = false

  public init(isAnimating: Bool = true) {
    self.isAnimating = isAnimating
  }

  public var body: some View {
    GeometryReader { proxy in
      let height = proxy.size.height * 0.44
      ZStack(alignment: .bottom) {
        LinearGradient(colors: IntelligencePalette.loadingBase, startPoint: .top, endPoint: .bottom)
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !drifts)) { context in
          MeshGradient(
            width: 3,
            height: 3,
            points: Self.points(at: drifts ? context.date.timeIntervalSinceReferenceDate : 0),
            colors: colorScheme == .dark ? IntelligencePalette.risingDark : IntelligencePalette.risingLight
          )
        }
        .frame(height: height)
        .offset(y: risen || reduceMotion ? 0 : height * 0.35)
        .opacity(risen ? 1 : 0)
      }
    }
    .overlay { FilmGrain(opacity: 0.1) }
    .ignoresSafeArea()
    .accessibilityHidden(true)
    .onAppear {
      withAnimation(reduceMotion ? .easeOut(duration: 0.3) : IntelligenceMotion.rise) { risen = true }
    }
  }

  private var drifts: Bool {
    isAnimating && !reduceMotion && scenePhase == .active
  }

  static func points(at time: TimeInterval) -> [SIMD2<Float>] {
    let slow = Float(time * 2 * .pi / 9)
    let slower = Float(time * 2 * .pi / 13)
    return [
      [0, 0], [0.5, 0], [1, 0],
      [0, 0.42 + 0.06 * sin(slower)], [0.5 + 0.12 * sin(slow), 0.46 + 0.06 * cos(slow)], [1, 0.4 + 0.06 * cos(slower)],
      [0, 1], [0.5 + 0.08 * cos(slower), 1], [1, 1],
    ]
  }
}
