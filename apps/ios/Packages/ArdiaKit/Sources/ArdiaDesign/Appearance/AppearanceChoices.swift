import Foundation

public enum InterfaceStyleChoice: String, CaseIterable, Sendable {
  case matchMac
  case glass
  case classic
}

public enum ColorSchemeChoice: String, CaseIterable, Sendable {
  case matchMac
  case system
  case light
  case dark
}

public struct AppearanceChoices: Equatable, Sendable {
  public var interfaceStyle: InterfaceStyleChoice
  public var colorScheme: ColorSchemeChoice

  public init(interfaceStyle: InterfaceStyleChoice = .matchMac, colorScheme: ColorSchemeChoice = .matchMac) {
    self.interfaceStyle = interfaceStyle
    self.colorScheme = colorScheme
  }

  public func shown(syncIsOn: Bool) -> AppearanceChoices {
    guard !syncIsOn else { return self }
    return AppearanceChoices(
      interfaceStyle: interfaceStyle == .matchMac ? .glass : interfaceStyle,
      colorScheme: colorScheme == .matchMac ? .system : colorScheme
    )
  }
}
