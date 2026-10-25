import SwiftUI

public enum TabsPalette {
  public static let backdropLight: [UInt32] = [0xE4E2F7, 0xEFEEFC, 0xF8EDF5, 0xFDE6E9, 0xE6E5F8, 0xEAE9F9]
  public static let backdropDark: [UInt32] = [0x1C1A2B, 0x29263D, 0x3F333C, 0x442B2D, 0x24223A, 0x2B2840]
  public static let blobLavender = Color(hex: 0xC9C3F4)
  public static let blobBlush = Color(hex: 0xFBCFDC)
  public static let blobPeriwinkle = Color(hex: 0xC8D6FB)
  public static let blobLavenderDark = Color(hex: 0x3A3170)
  public static let blobBlushDark = Color(hex: 0x5A2F44)
  public static let blobPeriwinkleDark = Color(hex: 0x27365F)
  public static let cardShadow = Color(hex: 0x1B1640, opacity: 0.18)
  public static let cardShadowBase = Color.adaptive(light: .white, dark: Color(hex: 0x1B1C1C))
  public static let cardEdge = Color.adaptive(light: .black.opacity(0.08), dark: .white.opacity(0.12))
  public static let headerText = Color.adaptive(light: Color(hex: 0x0E0F10, opacity: 0.72), dark: .white.opacity(0.78))
  public static let incognitoCard = Color(hex: 0x1C1D22)
  public static let incognitoCardRaised = Color(hex: 0x2A2B31)
  public static let archiveTile = Color(hex: 0xB059EE)
  public static let receivedBadge = Palette.indigo
  public static let poof = Color(hex: 0xF4F1FF)
  public static let browsePage = Color.adaptive(light: Color(p3Hex: 0xF1F0F5), dark: Color(p3Hex: 0x1F2128))
  public static let placeholderTints: [UInt32] = [0xE8E6FB, 0xFBE7EE, 0xE3F0FB, 0xE6F5EA, 0xFDF0DD, 0xEFE6F8]
  public static let placeholderTintsDark: [UInt32] = [0x262447, 0x3F2532, 0x1E3046, 0x1F3527, 0x3D3020, 0x30243F]
}

public enum TabsLayout {
  public static let cardRadius: CGFloat = 13
  public static let displayCornerRadius: CGFloat = 55
  public static let faviconSize: CGFloat = 16
  public static let faviconRadius: CGFloat = 3
  public static let headerSpacing: CGFloat = 6
  public static let headerGap: CGFloat = 8
  public static let barCircle: CGFloat = 35
  public static let barPlus = CGSize(width: 78, height: 40)
  public static let barSideInset: CGFloat = 16
  public static let tileSize: CGFloat = 64
  public static let tileRadius: CGFloat = 16
  public static let archiveCardRadius: CGFloat = 16
  public static let archiveCardTile: CGFloat = 28
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
