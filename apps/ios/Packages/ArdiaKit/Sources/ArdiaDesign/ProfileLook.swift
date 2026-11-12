import ArdiaSync
import SwiftUI

struct LookRGB: Equatable, Hashable, Sendable {
  var red: Double
  var green: Double
  var blue: Double

  init(red: Double, green: Double, blue: Double) {
    self.red = red
    self.green = green
    self.blue = blue
  }

  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }

  init?(hexString: String) {
    var text = hexString.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.hasPrefix("#") { text.removeFirst() }
    guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
    self.init(hex: value)
  }

  init(hue: Double, saturation: Double, lightness: Double) {
    guard saturation > 0 else {
      self.init(red: lightness, green: lightness, blue: lightness)
      return
    }
    let upper = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
    let lower = 2 * lightness - upper
    func channel(_ offset: Double) -> Double {
      var turn = hue + offset
      if turn < 0 { turn += 1 }
      if turn > 1 { turn -= 1 }
      if turn < 1 / 6 { return lower + (upper - lower) * 6 * turn }
      if turn < 1 / 2 { return upper }
      if turn < 2 / 3 { return lower + (upper - lower) * (2 / 3 - turn) * 6 }
      return lower
    }
    self.init(red: channel(1 / 3), green: channel(0), blue: channel(-1 / 3))
  }

  var hsl: (hue: Double, saturation: Double, lightness: Double) {
    let high = max(red, green, blue)
    let low = min(red, green, blue)
    let lightness = (high + low) / 2
    let spread = high - low
    guard spread > 0 else { return (0, 0, lightness) }
    let saturation = lightness > 0.5 ? spread / (2 - high - low) : spread / (high + low)
    let sector: Double
    if high == red {
      sector = (green - blue) / spread + (green < blue ? 6 : 0)
    } else if high == green {
      sector = (blue - red) / spread + 2
    } else {
      sector = (red - green) / spread + 4
    }
    return (sector / 6, saturation, lightness)
  }

  var hex: UInt32 {
    func byte(_ value: Double) -> UInt32 { UInt32((min(1, max(0, value)) * 255).rounded()) }
    return byte(red) << 16 | byte(green) << 8 | byte(blue)
  }

  var hexString: String {
    let digits = String(hex, radix: 16, uppercase: true)
    return "#" + String(repeating: "0", count: 6 - digits.count) + digits
  }

  var color: Color { Color(hex: hex) }

  var snapped: LookRGB { LookRGB(hex: hex) }

  func mixed(with other: LookRGB, by amount: Double) -> LookRGB {
    LookRGB(
      red: red + (other.red - red) * amount,
      green: green + (other.green - green) * amount,
      blue: blue + (other.blue - blue) * amount
    )
  }

  func lightened(by delta: Double) -> LookRGB {
    let (hue, saturation, lightness) = hsl
    return LookRGB(hue: hue, saturation: saturation, lightness: min(1, max(0, lightness + delta)))
  }

  func toned(hueShift: Double = 0, saturation: Double, lightness: Double) -> LookRGB {
    let own = hsl
    var hue = own.hue + hueShift
    if hue < 0 { hue += 1 }
    if hue > 1 { hue -= 1 }
    return LookRGB(hue: hue, saturation: own.saturation == 0 ? 0 : saturation, lightness: lightness)
  }

  var luminance: Double {
    func linear(_ value: Double) -> Double {
      value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  }

  func contrast(with other: LookRGB) -> Double {
    let lighter = max(luminance, other.luminance)
    let darker = min(luminance, other.luminance)
    return (lighter + 0.05) / (darker + 0.05)
  }

  var greyed: LookRGB {
    let lightness = hsl.lightness
    return LookRGB(red: lightness, green: lightness, blue: lightness)
  }
}

public struct ProfileLook: Equatable, Hashable, Sendable {
  public enum Preset: String, CaseIterable, Sendable {
    case plum, blue, purple, pink, red, orange, yellow, green, neutral

    var swatch: UInt32 {
      switch self {
      case .plum: 0xC07A98
      case .blue: 0x4691C3
      case .purple: 0x7873AF
      case .pink: 0xD37B8B
      case .red: 0xC1575C
      case .orange: 0xD87249
      case .yellow: 0xE3AC38
      case .green: 0x3EB489
      case .neutral: 0x8E8E93
      }
    }

    var tint: UInt32? { self == .plum ? 0xB25B6B : nil }
    var action: UInt32? { self == .plum ? 0xDD899B : nil }
  }

  enum WindowTint {
    static let alpha = 0.36
    static let neutralAlpha = 0.12
    static let lightness = 0.25
    static let hueSaturation = 0.36
    static let hueLightness = 0.527
    static let lightShare = 0.75
    static let darkShare = 0.5
    static let inactiveLight = LookRGB(red: 235 / 255, green: 231 / 255, blue: 230 / 255)
    static let inactiveDark = LookRGB(red: 40.7 / 255, green: 33.1 / 255, blue: 31.8 / 255)
    static let incognito: UInt32 = 0x3A3A3C
  }

  let swatch: LookRGB
  let tint: LookRGB
  let action: LookRGB
  let isNeutral: Bool
  let theme: [LookRGB]
  let darkTheme: [LookRGB]?
  let isAlwaysDark: Bool

  public static let plum = ProfileLook(preset: .plum)

  public static let incognito = ProfileLook(
    swatch: LookRGB(hex: WindowTint.incognito),
    tint: LookRGB(hex: WindowTint.incognito),
    action: LookRGB(hex: WindowTint.incognito),
    isNeutral: true,
    theme: [],
    darkTheme: nil,
    isAlwaysDark: true
  )

  init(swatch: LookRGB, tint: LookRGB, action: LookRGB, isNeutral: Bool, theme: [LookRGB], darkTheme: [LookRGB]?, isAlwaysDark: Bool = false) {
    self.swatch = swatch
    self.tint = tint
    self.action = action
    self.isNeutral = isNeutral
    self.theme = theme
    self.darkTheme = darkTheme
    self.isAlwaysDark = isAlwaysDark
  }

  public init(preset: Preset) {
    let swatch = LookRGB(hex: preset.swatch)
    let isNeutral = preset == .neutral
    self.init(
      swatch: swatch,
      tint: preset.tint.map(LookRGB.init(hex:)) ?? Self.tint(forHueOf: swatch, grey: isNeutral),
      action: preset.action.map(LookRGB.init(hex:)) ?? swatch.lightened(by: 0.12),
      isNeutral: isNeutral,
      theme: [],
      darkTheme: nil
    )
  }

  public init(colorName: String?, themeColors: [String] = [], darkThemeColors: [String]? = nil) {
    let theme = themeColors.compactMap(LookRGB.init(hexString:))
    let darkTheme = darkThemeColors.map { $0.compactMap(LookRGB.init(hexString:)) }.flatMap { $0.isEmpty ? nil : $0 }
    guard let first = theme.first ?? colorName.flatMap(LookRGB.init(hexString:)) else {
      self.init(preset: colorName.flatMap { Preset(rawValue: $0.lowercased()) } ?? .plum)
      return
    }
    let middle = theme.dropFirst().reduce(first) { $0.mixed(with: $1, by: 0.5) }
    let isNeutral = middle.hsl.saturation < 0.12
    self.init(
      swatch: middle,
      tint: Self.tint(forHueOf: middle, grey: isNeutral),
      action: middle.lightened(by: 0.12),
      isNeutral: isNeutral,
      theme: theme,
      darkTheme: darkTheme
    )
  }

  public init(profile: SyncedProfile?) {
    self.init(colorName: profile?.color, themeColors: profile?.theme?.colors ?? [], darkThemeColors: profile?.theme?.darkColors)
  }

  static func tint(forHueOf swatch: LookRGB, grey: Bool) -> LookRGB {
    LookRGB(hue: swatch.hsl.hue, saturation: grey ? 0 : WindowTint.hueSaturation, lightness: WindowTint.hueLightness).snapped
  }

  public var preset: Preset? {
    Preset.allCases.first { ProfileLook(preset: $0) == self }
  }

  public var swatchColor: Color { swatch.color }

  public var surface: Color { surface(at: 0) }

  public var surfaceLow: Color { surface(at: 1) }

  private func surface(at index: Int) -> Color {
    Color.adaptive(light: backdropStops(dark: false, themed: false)[index].color, dark: backdropStops(dark: true, themed: false)[index].color)
  }

  func themeStops(dark: Bool) -> [LookRGB] {
    dark ? (darkTheme ?? theme) : theme
  }

  func windowTintStops(dark: Bool) -> [LookRGB] {
    let alpha = (isNeutral ? WindowTint.neutralAlpha : WindowTint.alpha) * (dark ? WindowTint.darkShare : WindowTint.lightShare)
    let under = dark
      ? WindowTint.inactiveDark.mixed(with: LookRGB(hex: 0x000000), by: 0.4)
      : LookRGB(hex: 0xFFFFFF).mixed(with: WindowTint.inactiveLight, by: 0.2)
    return [tint, tint.lightened(by: WindowTint.lightness)].map { under.mixed(with: $0, by: alpha).snapped }
  }

  public func showsTheme(dark: Bool, themed: Bool) -> Bool {
    themed && themeStops(dark: dark).count >= 2
  }

  func backdropStops(dark: Bool, themed: Bool) -> [LookRGB] {
    showsTheme(dark: dark, themed: themed) ? themeStops(dark: dark) : windowTintStops(dark: dark || isAlwaysDark)
  }

  public func inkIsLight(dark: Bool, themed: Bool) -> Bool {
    let stops = backdropStops(dark: dark, themed: themed)
    let onWhite = stops.map { $0.contrast(with: LookRGB(hex: 0xFFFFFF)) }.min() ?? 1
    let onBlack = stops.map { $0.contrast(with: LookRGB(hex: 0x000000)) }.min() ?? 1
    return onWhite >= onBlack
  }

  func deckBaseStops(dark: Bool) -> [LookRGB] {
    let window = windowTintStops(dark: dark)
    let shares = [0, 0.5, 1, 0.9, 0.35, 0.65]
    let base = shares.map { window[0].mixed(with: window[1], by: $0) }
    let stops = themeStops(dark: dark)
    guard stops.count >= 2 else { return base }
    let share = dark ? 0.18 : 0.1
    return base.enumerated().map { index, stop in stop.mixed(with: stops[index % stops.count], by: share) }
  }

  func deckBlobStops(dark: Bool) -> [LookRGB] {
    let swatch = isNeutral ? swatch.greyed : swatch
    let blobs = dark
      ? [
        swatch.toned(saturation: 0.38, lightness: 0.32),
        swatch.toned(hueShift: 0.05, saturation: 0.32, lightness: 0.27),
        swatch.toned(hueShift: -0.06, saturation: 0.42, lightness: 0.26),
      ]
      : [
        swatch.toned(saturation: 0.66, lightness: 0.86),
        swatch.toned(hueShift: 0.05, saturation: 0.84, lightness: 0.9),
        swatch.toned(hueShift: -0.06, saturation: 0.7, lightness: 0.88),
      ]
    let stops = themeStops(dark: dark)
    guard !stops.isEmpty else { return blobs }
    return blobs.enumerated().map { index, blob in blob.mixed(with: stops[index % stops.count], by: 0.2) }
  }

  public func windowTint(dark: Bool) -> [Color] { windowTintStops(dark: dark).map(\.color) }
  public func backdropColors(dark: Bool, themed: Bool) -> [Color] { backdropStops(dark: dark, themed: themed).map(\.color) }
  public func deckBase(dark: Bool) -> [Color] { deckBaseStops(dark: dark).map(\.color) }
  public func deckBlobs(dark: Bool) -> [Color] { deckBlobStops(dark: dark).map(\.color) }
}

public extension EnvironmentValues {
  @Entry var profileLook = ProfileLook.plum
}
