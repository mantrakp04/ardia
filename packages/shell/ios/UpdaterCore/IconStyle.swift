import Foundation

enum IconStyle {
  static let defaultsKey = "AppleIconAppearanceTheme"

  static func restylesIcons(theme: String?) -> Bool {
    guard let theme else { return false }
    return theme.hasPrefix("Tinted") || theme.hasPrefix("Clear")
  }

  static func shown(saved: String, theme: String?) -> String {
    restylesIcons(theme: theme) ? "default" : saved
  }

  static var systemTheme: String? { UserDefaults.standard.string(forKey: defaultsKey) }

  static var systemRestylesIcons: Bool { restylesIcons(theme: systemTheme) }
}
