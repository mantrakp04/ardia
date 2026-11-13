import ArdiaSync
import SwiftUI

public struct ResolvedAppearance: Equatable, Sendable {
  public var interfaceStyle: InterfaceStyle
  public var glassTintAmount: Double
  public var colorScheme: ColorScheme?

  public init(interfaceStyle: InterfaceStyle, glassTintAmount: Double, colorScheme: ColorScheme?) {
    self.interfaceStyle = interfaceStyle
    self.glassTintAmount = glassTintAmount
    self.colorScheme = colorScheme
  }

  public static let standard = ResolvedAppearance(interfaceStyle: .glass, glassTintAmount: GlassTint.defaultAmount, colorScheme: nil)
  public static let macDefaults = ResolvedAppearance(interfaceStyle: .glass, glassTintAmount: 0, colorScheme: nil)
}

public enum AppearanceResolver {
  public static let macDefaultGlassTintAmount = 0.8

  public static func resolve(_ choices: AppearanceChoices, mac: SyncedLookSettings?, syncIsOn: Bool) -> ResolvedAppearance {
    let macSettings = syncIsOn ? mac : nil
    return ResolvedAppearance(
      interfaceStyle: interfaceStyle(choices.interfaceStyle, mac: macSettings),
      glassTintAmount: glassTintAmount(mac: macSettings, syncIsOn: syncIsOn),
      colorScheme: colorScheme(choices.colorScheme, mac: macSettings)
    )
  }

  private static func interfaceStyle(_ choice: InterfaceStyleChoice, mac: SyncedLookSettings?) -> InterfaceStyle {
    switch choice {
    case .glass: .glass
    case .classic: .classic
    case .matchMac: mac?.interfaceStyle == .classic ? .classic : .glass
    }
  }

  private static func glassTintAmount(mac: SyncedLookSettings?, syncIsOn: Bool) -> Double {
    guard syncIsOn else { return GlassTint.defaultAmount }
    guard mac?.glassTintWithTheme == true else { return 0 }
    guard let amount = mac?.glassTintAmount, !amount.isNaN else { return macDefaultGlassTintAmount }
    return min(max(amount, 0), 1)
  }

  private static func colorScheme(_ choice: ColorSchemeChoice, mac: SyncedLookSettings?) -> ColorScheme? {
    switch choice {
    case .system: nil
    case .light: .light
    case .dark: .dark
    case .matchMac:
      switch mac?.appearance {
      case .light: .light
      case .dark: .dark
      case .auto, nil: nil
      }
    }
  }
}
