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
}

public enum BrowsePalette {
  public static let foregroundPrimary = Tokens.Role.textTab.color
  public static let foregroundSecondary = Tokens.Role.textSecondary.color
  public static let foregroundTertiary = Tokens.Role.textTertiary.color
  public static let popover = Palette.panel
  public static let loadingBorder = Palette.accent
  public static let findError = Color(hex: 0xC93333)
  public static let fieldFill = Color.adaptive(light: .black.opacity(0.06), dark: .white.opacity(0.12))
  public static let fieldStroke = Color.adaptive(light: .black.opacity(0.06), dark: .white.opacity(0.08))
  public static let searchAccent = Palette.formAccent
  public static let rowIcon = Color.adaptive(light: .black.opacity(0.42), dark: .white.opacity(0.5))
  public static let incognitoSheet = Color(hex: 0x151517)
  public static let incognitoField = Color.white.opacity(0.12)
  public static let incognitoCaption = Color.white.opacity(0.55)
  public static let toolbarTile = Color.adaptive(light: .black.opacity(0.05), dark: .white.opacity(0.08))
}

public enum BrowseLayout {
  public static let sheetTopRadius: CGFloat = 40
  public static let sheetTintShare: Double = 0.8
  public static let searchFieldHeight: CGFloat = 47.5
  public static let searchFieldInset: CGFloat = 15
  public static let suggestionPitch: CGFloat = 58.5
  public static let suggestionIcon: CGFloat = 15
  public static let sheetAboveKeyboard: CGFloat = 274
  public static let trayFieldTop: CGFloat = 15
  public static let trayDim: Double = 0.28
  public static let logoSize: CGFloat = 132
  public static let tabStackRadius: CGFloat = 5
  public static let tabStackTile = CGSize(width: 20, height: 26)
  public static let hitTarget: CGFloat = 44
  public static let barHeight: CGFloat = 75
  public static let barCollapseTravel: CGFloat = 30
  public static let progressHeight: CGFloat = 2.5
  public static let toolbarTile: CGFloat = 78
}

public enum BarMetrics {
  public static let pieceHeight = GlassMetrics.hitTarget + Tokens.Space.xs
  public static let pieceGap = Tokens.Space.m
  public static let sideInset = Tokens.Space.l
  public static let maxWidth: CGFloat = 560
  public static let homeIndicatorShare = Tokens.Space.l
  public static let cornerMargin = Tokens.Space.xs
  public static let pageGap = Tokens.Space.m
  public static let compactHeight = GlassMetrics.pillHeight
  public static let compactShape = GlassControlShape.pill
  public static let compactMaxWidth: CGFloat = 220
  public static let addressGlyph = Tokens.Space.xl
  public static let compactGlyph = Tokens.Space.l
  public static let railBadgeOffset = Tokens.Space.s
  public static let addressGap = Tokens.Space.s
  public static let railPieces: CGFloat = 4
  public static let toastClearance = pieceHeight + Tokens.Space.l
  public static let tabStackWidth = Tokens.Space.huge
}

public enum TrayMetrics {
  public static let sideInset = Tokens.Space.m
  public static let keyboardGap = Tokens.Space.m
  public static let contentInset = Tokens.Space.m
  public static let fieldLeading = Tokens.Space.l
  public static let fieldTrailing = Tokens.Space.ml
  public static let fieldGap = Tokens.Space.m
  public static let accessorySize = CGSize(width: Tokens.Space.huge, height: GlassMetrics.hitTarget - Tokens.Space.xs)
}

public enum PageMenuLayout {
  public static let inset = Tokens.Space.xl
  public static let groupRadius = Tokens.Radius.hero
  public static let rowHeight = GlassMetrics.hitTarget + Tokens.Space.s
  public static let tileHeight = GlassMetrics.hitTarget
  public static let rowPadding = Tokens.Space.xl
  public static let rowGap = Tokens.Space.l
  public static let tileGap = Tokens.Space.m
  public static let zoomButton = CGSize(width: GlassMetrics.hitTarget - Tokens.Space.xs, height: GlassMetrics.hitTarget - Tokens.Space.ml)
  public static let zoomValueWidth = Tokens.Space.huge + Tokens.Space.xl
  public static let minimumHeight = Tokens.Space.huge * 6
  public static let popoverWidth = SidebarMetrics.touch(256)
}

public extension Motion {
  static let searchRise = Animation.spring(response: 0.39, dampingFraction: 1)
  static let surfaceSwap = Animation.easeOut(duration: 0.3)
  static let surfaceFade = Animation.easeOut(duration: 0.2)
  static let trayDim = Animation.easeInOut(duration: 0.3)
  static let trayDismiss = Animation.spring(response: 0.32, dampingFraction: 1)
  static let traySettle = Animation.spring(response: 0.34, dampingFraction: 0.86)
  static let resultsIn = Animation.easeOut(duration: 0.14)
  static let pager = Animation.spring(response: 0.3, dampingFraction: 0.9)
  static let press = Animation.spring(response: 0.2, dampingFraction: 0.7)
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
