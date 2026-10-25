import SwiftUI

public extension Palette {
  static let toast = Color(.displayP3, red: 0x2A / 255, green: 0x31 / 255, blue: 0xF5 / 255)
  static let toastShadow = Color(.displayP3, red: 0x0E / 255, green: 0x16 / 255, blue: 0xE9 / 255)
}

public enum SettingsTile {
  public static let side: CGFloat = 29
}

public enum SettingsTint {
  public static let neutral = Color(hex: 0x86888D)
  public static let red = Color(hex: 0xFF5A5F)
  public static let orange = Color(hex: 0xFF901A)
  public static let yellow = Color(hex: 0xFFC829)
  public static let blue = Color(hex: 0x458AFF)
  public static let deepBlue = Color(hex: 0x0C50FF)
  public static let purple = Color(hex: 0xB059EE)
  public static let green = Color(hex: 0x3EA82E)

  public static let sync = Palette.indigo
  public static let ads = red
  public static let trackers = yellow
  public static let cookies = orange
  public static let search = deepBlue
  public static let archive = purple
  public static let keyboard = yellow
  public static let swipe = blue
  public static let nightShade = Color(hex: 0x5856D6)
  public static let appLinks = green
  public static let bottomBar = Color(hex: 0x30B0C7)
  public static let intelligence = Color(hex: 0xC04FD8)
  public static let pinch = Color(hex: 0xFF6B9A)
  public static let defaultBrowser = Palette.indigo
  public static let clearData = red
  public static let export = Color(hex: 0x0153FF)
  public static let onboarding = orange
}
