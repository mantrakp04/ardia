import SwiftUI

public enum TabsPalette {
  public static let cardShadow = Color.black.opacity(0.18)
  public static let cardShadowBase = Color.adaptive(light: .white, dark: Color(hex: 0x1B1C1C))
  public static let cardEdge = Color.adaptive(light: .black.opacity(0.08), dark: .white.opacity(0.12))
  public static let headerText = Color.adaptive(light: Color(hex: 0x0E0F10, opacity: 0.88), dark: .white.opacity(0.92))
  public static let incognitoCard = Color(hex: 0x1C1D22)
  public static let incognitoCardRaised = Color(hex: 0x2A2B31)
  public static let archiveTile = Color(hex: 0xB059EE)
  public static let receivedBadge = Palette.primaryAction
  public static let pageDot = Color.primary.opacity(0.32)
  public static let spaceBadge = Color.adaptive(light: .white, dark: Color(hex: 0x1C1C1E))
  public static let spaceBadgeInk = Color.adaptive(light: .black, dark: .white)
  public static let poof = Color(hex: 0xF7F5FF)
  public static let placeholderTints: [UInt32] = [0xE8E6FB, 0xFBE7EE, 0xE3F0FB, 0xE6F5EA, 0xFDF0DD, 0xEFE6F8]
  public static let placeholderTintsDark: [UInt32] = [0x262447, 0x3F2532, 0x1E3046, 0x1F3527, 0x3D3020, 0x30243F]
}

public enum TabsLayout {
  public static let cardRadius: CGFloat = 13
  public static let displayCornerRadius: CGFloat = 55
  public static let faviconSize: CGFloat = 16
  public static let faviconRadius: CGFloat = 4
  public static let headerSpacing: CGFloat = 6
  public static let headerGap: CGFloat = 8
  public static let barCircle: CGFloat = 48
  public static let barPlus = CGSize(width: 77, height: 48)
  public static let barSideInset: CGFloat = 12
  public static let barGap: CGFloat = 8
  public static let headerCircle: CGFloat = 44
  public static let headerCenter: CGFloat = 26
  public static let headerSide: CGFloat = 12
  public static let archiveCardHeight: CGFloat = 43
  public static let archiveCardCenter: CGFloat = 78.5
  public static let tileHeight: CGFloat = 52
  public static let tileRadius: CGFloat = 14
  public static let tileGap: CGFloat = 8
  public static let tileSide: CGFloat = 20
  public static let tileIcon: CGFloat = 20
  public static let tilesPerRow = 4
  public static let spaceBadge: CGFloat = 20
  public static let pageDot: CGFloat = 7
  public static let pageDotSpacing: CGFloat = 21
  public static let pageDotsAboveBar: CGFloat = 60
  public static let startSwitcherRatio: CGFloat = 0.44
  public static let startTilesGap: CGFloat = 45

  public static var headerBottom: CGFloat { headerCenter + headerCircle / 2 }
  public static var archiveCardBottom: CGFloat { archiveCardCenter + archiveCardHeight / 2 }
}

public enum TabsMotion {
  public static let openScale = Animation.spring(response: 0.19, dampingFraction: 1)
  public static let openPosition = Animation.spring(response: 0.3, dampingFraction: 1)
  public static let expand = Animation.spring(response: 0.3, dampingFraction: 1)
  public static let gapClose = Motion.tabStack
  public static let release = Animation.spring(response: 0.3, dampingFraction: 0.9)
  public static let fade = Animation.easeOut(duration: 0.2)
  public static let poofDuration: Double = 0.42
  public static let flyAway: Double = 0.2
  public static let backdropSlowLoop: Double = 10
  public static let backdropFastLoop: Double = 7

  public static func settle(distance: Double, velocity: Double) -> Animation {
    let initial = abs(distance) > 0.001 ? velocity / distance : 0
    return .interpolatingSpring(duration: 0.4, bounce: 0, initialVelocity: max(min(initial, 30), -30))
  }
}
