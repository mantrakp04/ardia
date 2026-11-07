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

final class IconStyleTracker {
  private var restyled: Bool
  private let onChange: () -> Void

  init(theme: String?, onChange: @escaping () -> Void) {
    restyled = IconStyle.restylesIcons(theme: theme)
    self.onChange = onChange
  }

  func themeChanged(to theme: String?) {
    let now = IconStyle.restylesIcons(theme: theme)
    guard now != restyled else { return }
    restyled = now
    onChange()
  }
}
