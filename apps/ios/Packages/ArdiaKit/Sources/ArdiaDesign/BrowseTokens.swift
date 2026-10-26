import SwiftUI

#if canImport(UIKit)
  import UIKit
#elseif canImport(AppKit)
  import AppKit
#endif

public extension Color {
  static func adaptive(light: Color, dark: Color) -> Color {
    #if canImport(UIKit)
      Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
    #elseif canImport(AppKit)
      Color(NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(dark) : NSColor(light) })
    #else
      light
    #endif
  }

  init(p3Hex hex: UInt32, opacity: Double = 1) {
    self.init(
      .displayP3,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: opacity
    )
  }
}

public enum BrowsePalette {
  public static let foregroundPrimary = Color.adaptive(light: Color(hex: 0x0E0F10, opacity: 0.9), dark: .white.opacity(0.8))
  public static let foregroundSecondary = Color.adaptive(light: .black.opacity(0.5), dark: .white.opacity(0.5))
  public static let foregroundTertiary = Color.adaptive(light: .black.opacity(0.3), dark: .white.opacity(0.3))
  public static let popover = Color.adaptive(light: Color(hex: 0xFAFBFF), dark: Color(hex: 0x151C30))
  public static let loadingBorder = Color.adaptive(light: Color(hex: 0x0C50FF), dark: Color(hex: 0x2AB6F6))
  public static let findError = Color(hex: 0xC93333)
  public static let highlightedPill = Palette.indigo
  public static let pillFill = Color.adaptive(light: Color(hex: 0x6E5A63, opacity: 0.1), dark: .white.opacity(0.12))
  public static let pillLabel = Color.adaptive(light: Color(hex: 0x0E0F10, opacity: 0.85), dark: .white.opacity(0.85))
  public static let sheet = Color.adaptive(light: Color(hex: 0xFCFCFE, opacity: 0.86), dark: Color(hex: 0x1E1D24, opacity: 0.72))
  public static let sheetOpaque = Color.adaptive(light: Color(hex: 0xFCFCFE), dark: Color(hex: 0x1E1D24))
  public static let fieldFill = Color.adaptive(light: .black.opacity(0.06), dark: .white.opacity(0.12))
  public static let fieldStroke = Color.adaptive(light: .black.opacity(0.06), dark: .white.opacity(0.08))
  public static let searchAccent = Color.adaptive(light: Color(p3Hex: 0x3139FB), dark: Color(p3Hex: 0x6F86FF))
  public static let launchGradientLight: [Color] = [Color(hex: 0x3F48F2), Color(hex: 0x6A5CE8), Color(hex: 0xA672DA), Color(hex: 0xFF8AAB)]
  public static let launchGradientDark: [Color] = [Color(hex: 0x16182E), Color(hex: 0x1B1A30), Color(hex: 0x2A1C2B), Color(hex: 0x3B1E25)]
  public static let incognitoGradient: [Color] = [Color(hex: 0x111120), Color(hex: 0x15141E), Color(hex: 0x1D161F), Color(hex: 0x2A191E)]
  public static let rowIcon = Color.adaptive(light: .black.opacity(0.42), dark: .white.opacity(0.5))
  public static let incognitoSheet = Color(hex: 0x151517)
  public static let incognitoField = Color.white.opacity(0.12)
  public static let incognitoCaption = Color.white.opacity(0.55)
  public static let pageBackdrop = Color.adaptive(light: Color(p3Hex: 0xF3F6F6), dark: Color(p3Hex: 0x242424))
  public static let toolbarTile = Color.adaptive(light: .black.opacity(0.05), dark: .white.opacity(0.08))
  public static let toolbarCapsule = Color.adaptive(light: .black.opacity(0.06), dark: .white.opacity(0.1))
  public static let summaryGradient: [Color] = [Color(hex: 0x3925AE), Color(hex: 0x8B73D5), Color(hex: 0xC573B5), Color(hex: 0xF4748F)]
}

public enum BrowseLayout {
  public static let sheetTopRadius: CGFloat = 40
  public static let toolbarSheetRadius: CGFloat = 38
  public static let searchFieldHeight: CGFloat = 47.5
  public static let searchFieldInset: CGFloat = 15
  public static let searchRowSpacing: CGFloat = 10
  public static let suggestionPitch: CGFloat = 58.5
  public static let suggestionIcon: CGFloat = 15
  public static let pillSize = CGSize(width: 94, height: 27)
  public static let highlightedPillSize = CGSize(width: 94, height: 27)
  public static let pillRadius: CGFloat = 10
  public static let sheetAboveKeyboard: CGFloat = 274
  public static let trayFieldTop: CGFloat = 15
  public static let trayDim: Double = 0.28
  public static let logoSize: CGFloat = 132
  public static let plusCapsule = CGSize(width: 78, height: 40)
  public static let chevronCircle: CGFloat = 35
  public static let tabStackThumb: CGFloat = 30
  public static let tabStackRadius: CGFloat = 5
  public static let tabStackTile = CGSize(width: 20, height: 26)
  public static let barCenterFromBottom: CGFloat = 44
  public static let barSideInset: CGFloat = 20
  public static let hitTarget: CGFloat = 44
  public static let barHeight: CGFloat = 75
  public static let barCollapseTravel: CGFloat = 30
  public static let barControlScale: CGFloat = 0.93
  public static let progressHeight: CGFloat = 2.5
  public static let refreshIndicator: CGFloat = 36
  public static let toolbarCapsuleHeight: CGFloat = 44
  public static let toolbarTile: CGFloat = 78
  public static let toolbarTileRadius: CGFloat = 18
  public static let toolbarRowHeight: CGFloat = 48
  public static let toolbarRowRadius: CGFloat = 14
  public static let summaryCardWidth: CGFloat = 182
  public static let summaryCardTop: CGFloat = 96
  public static let pinchFollowFloor: CGFloat = 0.93
  public static let pinchCommitScale: CGFloat = 0.82
}

public extension Motion {
  static let searchRise = Animation.spring(response: 0.39, dampingFraction: 1)
  static let sheetToTop = Animation.spring(response: 0.3, dampingFraction: 1)
  static let trayDismiss = Animation.spring(response: 0.32, dampingFraction: 1)
  static let traySettle = Animation.spring(response: 0.34, dampingFraction: 0.86)
  static let resultsIn = Animation.easeOut(duration: 0.14)
  static let resultsOut = Animation.easeOut(duration: 0.22)
  static let pager = Animation.spring(response: 0.3, dampingFraction: 0.9)
  static let foldSettle = Animation.spring(response: 0.45, dampingFraction: 1)
  static let summaryDismiss = Animation.easeOut(duration: 0.4)
  static let press = Animation.spring(response: 0.2, dampingFraction: 0.7)
  static let barPressIn = Animation.spring(duration: 0.08, bounce: 0)
  static let barPressOut = Animation.spring(duration: 0.16, bounce: 0.1)
  static let barCollapse = Animation.spring(duration: 0.4, bounce: 0)
  static let progressReveal = Animation.easeOut(duration: 0.2)
  static let progressAdvance = Animation.easeOut(duration: 0.45)
  static let progressFill = Animation.easeOut(duration: 0.2)
  static let progressFade = Animation.easeOut(duration: 0.25)
  static let progressRevealDelay: Duration = .milliseconds(150)
  static let placeholderDelay: Duration = .milliseconds(300)
  static let placeholderIn = Animation.easeOut(duration: 0.22)
  static let pagerSettle = Spring(duration: 0.38, bounce: 0)
  static let pagerFade = Animation.easeOut(duration: 0.2)
  static let barTone = Animation.easeOut(duration: 0.25)
  static let logoSpinDecay: Double = 2.2
}
