import SwiftUI

public enum Palette {
  public static let indigo = Color(.displayP3, red: 0x31 / 255, green: 0x39 / 255, blue: 0xFB / 255)
  public static let gradientDeep = Color(hex: 0x090092)
  public static let gradientViolet = Color(hex: 0x3413AF)
  public static let gradientPlum = Color(hex: 0x6E38B1)
  public static let gradientPink = Color(hex: 0xFF5686)

  public static let launchGradient: [Color] = [gradientDeep, gradientViolet, gradientPlum, gradientPink]
}

public enum Spacing {
  public static let hairline: CGFloat = 4
  public static let tight: CGFloat = 8
  public static let small: CGFloat = 12
  public static let page: CGFloat = 16
  public static let medium: CGFloat = 20
  public static let large: CGFloat = 24
  public static let section: CGFloat = 32
}

public enum Radius {
  public static let field: CGFloat = 16
  public static let card: CGFloat = 20
  public static let sheet: CGFloat = 32
}

public enum Motion {
  public static let snappy = Animation.spring(response: 0.3, dampingFraction: 0.86)
  public static let smooth = Animation.spring(response: 0.42, dampingFraction: 0.9)
  public static let bouncy = Animation.spring(response: 0.38, dampingFraction: 0.72)
  public static let tabStack = Animation.spring(duration: 0.4, bounce: 0.2)
  public static let tabExpand = Animation.spring(duration: 0.4, bounce: 0.1)
  public static let searchFocus = Animation.spring(duration: 0.35, bounce: 0.05)
  public static let searchResults = Animation.easeOut(duration: 0.22)
  public static let modeToggle = Animation.spring(duration: 0.3, bounce: 0.15)
  public static let swipeSettle = Animation.spring(duration: 0.2, bounce: 0)
  public static let summarySheet = Animation.easeOut(duration: 0.16)
  public static let cornerMorph = Animation.spring(response: 0.3, dampingFraction: 1)
}

public enum Layout {
  public static let urlBarHeight: CGFloat = 52
  public static let urlBarPill: CGFloat = 38
  public static let toolbarButton: CGFloat = 48
  public static let searchRow: CGFloat = 56
  public static let compactSearchRow: CGFloat = 44
  public static let searchFieldRadius: CGFloat = 22
  public static let expandedCardScale: CGFloat = 0.9
  public static let summarizePinchScale: CGFloat = 0.3
  public static let swipeParallax: CGFloat = -0.33
  public static let swipeCommit: CGFloat = 75
  public static let swipeFlickCommit: CGFloat = 50
}

public extension Color {
  init(hex: UInt32, opacity: Double = 1) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: opacity
    )
  }
}
