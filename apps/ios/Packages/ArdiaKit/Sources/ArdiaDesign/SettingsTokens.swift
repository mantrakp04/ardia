import SwiftUI

public enum SettingsTile {
  public static let side: CGFloat = 29
  public static let accountSide: CGFloat = 56
  public static let accountSideLarge: CGFloat = 44
  public static let heroSide: CGFloat = 64
  public static let scannerGlyph: CGFloat = 48
}

public enum SettingsLayout {
  public static let readableWidth: CGFloat = 640
  public static let shortcutHeight: CGFloat = 48
  public static let heroScrollThreshold: CGFloat = 150
  public static let primaryButtonHeight: CGFloat = 50
  public static let stepRowHeight: CGFloat = 52
  public static let stepDividerInset: CGFloat = 56

  public static let minimumSideMargin: CGFloat = Tokens.Space.xl

  public static func columnMargin(forWidth width: CGFloat) -> CGFloat {
    max(0, (width - readableWidth) / 2)
  }

  public static func contentMargin(forWidth width: CGFloat, safeInset: CGFloat = 0) -> CGFloat {
    max(columnMargin(forWidth: width), max(safeInset, 0) + minimumSideMargin)
  }
}

public enum SettingsTint {
  public static let neutral = Color(hex: 0x86888D)
  public static let red = Color(hex: 0xFF5A5F)
  public static let orange = Color(hex: 0xFF901A)
  public static let yellow = Color(hex: 0xFFC829)
  public static let blue = Color(hex: 0x458AFF)
  public static let deepBlue = Color(hex: 0x007AFF)
  public static let purple = Color(hex: 0xB059EE)
  public static let green = Color(hex: 0x3EA82E)

  public static let sync = blue
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
  public static let defaultBrowser = deepBlue
  public static let clearData = red
  public static let export = Color(hex: 0x0153FF)
  public static let onboarding = orange
}

public enum MenuLayout {
  public static let sheetRadius: CGFloat = 38
  public static let inset: CGFloat = 16
  public static let innerRadius: CGFloat = sheetRadius - inset
  public static let capsuleHeight: CGFloat = innerRadius * 2
  public static let tileHeight: CGFloat = 68
  public static let rowHeight: CGFloat = 50
}
