import SwiftUI

public struct TokenColor: Equatable, Hashable, Sendable {
  public let red: Double
  public let green: Double
  public let blue: Double
  public let opacity: Double

  public init(red: Double, green: Double, blue: Double, opacity: Double = 1) {
    self.red = red
    self.green = green
    self.blue = blue
    self.opacity = opacity
  }

  public init(hex: UInt32, opacity: Double = 1) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: opacity
    )
  }

  public var color: Color { Color(.sRGB, red: red, green: green, blue: blue, opacity: opacity) }

  public func withOpacity(_ opacity: Double) -> TokenColor {
    TokenColor(red: red, green: green, blue: blue, opacity: opacity)
  }

  public func composited(over base: TokenColor) -> TokenColor {
    let shown = opacity + base.opacity * (1 - opacity)
    guard shown > 0 else { return TokenColor(red: 0, green: 0, blue: 0, opacity: 0) }
    func channel(_ top: Double, _ under: Double) -> Double {
      (top * opacity + under * base.opacity * (1 - opacity)) / shown
    }
    return TokenColor(red: channel(red, base.red), green: channel(green, base.green), blue: channel(blue, base.blue), opacity: shown)
  }

  public func mixed(toward other: TokenColor, by share: Double) -> TokenColor {
    TokenColor(
      red: red + (other.red - red) * share,
      green: green + (other.green - green) * share,
      blue: blue + (other.blue - blue) * share,
      opacity: opacity
    )
  }
}

public struct SchemeColor: ShapeStyle, Equatable, Hashable, Sendable {
  public let dark: TokenColor
  public let light: TokenColor

  public init(dark: TokenColor, light: TokenColor) {
    self.dark = dark
    self.light = light
  }

  public func resolved(dark isDark: Bool) -> TokenColor { isDark ? dark : light }

  public func composited(over base: SchemeColor) -> SchemeColor {
    SchemeColor(dark: dark.composited(over: base.dark), light: light.composited(over: base.light))
  }

  public var color: Color { Color.adaptive(light: light.color, dark: dark.color) }

  public func resolve(in environment: EnvironmentValues) -> Color {
    resolved(dark: environment.colorScheme == .dark).color
  }
}

public struct SchemeValue: Equatable, Hashable, Sendable {
  public let dark: Double
  public let light: Double

  public init(dark: Double, light: Double) {
    self.dark = dark
    self.light = light
  }

  public func resolved(dark isDark: Bool) -> Double { isDark ? dark : light }
}

public struct SpringToken: Equatable, Hashable, Sendable {
  public let response: Double
  public let dampingFraction: Double

  public init(response: Double, dampingFraction: Double) {
    self.response = response
    self.dampingFraction = dampingFraction
  }

  public var animation: Animation { .spring(response: response, dampingFraction: dampingFraction) }

  public var spring: Spring { Spring(response: response, dampingRatio: dampingFraction) }
}

public struct ShadowToken: Equatable, Hashable, Sendable {
  public let color: TokenColor
  public let radius: CGFloat
  public let x: CGFloat
  public let y: CGFloat
  public let opacity: SchemeValue

  public init(color: TokenColor, radius: CGFloat, x: CGFloat, y: CGFloat, opacity: SchemeValue) {
    self.color = color
    self.radius = radius
    self.x = x
    self.y = y
    self.opacity = opacity
  }

  public func color(dark: Bool) -> Color { color.withOpacity(opacity.resolved(dark: dark)).color }
}

public struct TypeToken: Equatable, Hashable, Sendable {
  public let size: CGFloat
  public let tracking: CGFloat
  public let isMonospaced: Bool

  public init(size: CGFloat, tracking: CGFloat, isMonospaced: Bool) {
    self.size = size
    self.tracking = tracking
    self.isMonospaced = isMonospaced
  }
}

public extension View {
  func shadow(_ token: ShadowToken) -> some View {
    modifier(TokenShadow(token: token))
  }
}

private struct TokenShadow: ViewModifier {
  let token: ShadowToken
  @Environment(\.colorScheme) private var colorScheme

  func body(content: Content) -> some View {
    content.shadow(color: token.color(dark: colorScheme == .dark), radius: token.radius, x: token.x, y: token.y)
  }
}
