import SwiftUI

public enum OnboardingSurface: Equatable, Sendable {
  case space
  case system

  public init(isWelcome: Bool, composition: PageComposition) {
    self = isWelcome || composition != .stacked ? .space : .system
  }

  public var followsSpaceInk: Bool { self == .space }

  public func isDark(look: ProfileLook, appDark: Bool) -> Bool {
    switch self {
    case .space: look.backdrop(dark: appDark).isDark
    case .system: appDark
    }
  }

  public func inkScheme(look: ProfileLook, appDark: Bool) -> ColorScheme {
    switch self {
    case .space: look.inkScheme(appDark: appDark)
    case .system: appDark ? .dark : .light
    }
  }
}
