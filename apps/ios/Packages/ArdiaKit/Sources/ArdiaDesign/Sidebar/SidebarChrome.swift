import SwiftUI

public enum SidebarChrome {
  public enum RowParts {
    public static let contentLeading = SidebarMetrics.touch(9)
    public static let trailing = SidebarMetrics.touch(6)
    public static let titleGap = SidebarMetrics.touch(5)
    public static let closeSlot = SidebarMetrics.touch(22)
    public static let titleFade = SidebarMetrics.touch(24)
    public static let selectedBorder = Tokens.Hairline.ring
    public static let newTabLabel = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.55), light: TokenColor(hex: 0x000000, opacity: 0.5))
    public static let newTabGlyph = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.25), light: TokenColor(hex: 0x000000, opacity: 0.26))
    public static let glowOffset: CGFloat = 0.5
    public static let softGlowShare: Double = 0.45
    public static let sectionTop = Tokens.Space.m
    public static let sectionBottom = Tokens.Space.xs
  }

  public enum Edge {
    public static let handleWidth = SidebarMetrics.touch(4)
    public static let handleHitWidth = SidebarMetrics.sideInset
    public static let dragThreshold: CGFloat = 1
  }

  public enum Card {
    public static let controlInset = Tokens.Space.ml
    public static let controlGap = Tokens.Space.m
    public static let hostCapsuleMaxWidth = SidebarMetrics.defaultWidth + SidebarMetrics.touch(48)
    public static let controlBand = controlInset * 2 + GlassMetrics.hitTarget
    public static let pageMenuWidth = SidebarMetrics.touch(336)
    public static let minimumRadius = SidebarMetrics.Row.radius
    public static let pageMenuMaxHeight = SidebarMetrics.touch(560)
    public static let logoAspect: CGFloat = 0.82
  }

  public static func cardRadius(windowCorners: RectangleCornerRadii) -> CGFloat {
    max(windowCorners.largest - SidebarMetrics.cardInset, Card.minimumRadius)
  }

  public enum Overlay {
    public static let slideShadow = Tokens.Shadow.sheet
  }

  public enum CommandBar {
    public static let maxWidth: CGFloat = 600
    public static let topShareOfWindow: CGFloat = 1 / 6
    public static let sideMargin = Tokens.Space.xxl
    public static let rowLimit = 8
    public static let fieldHeight = SidebarMetrics.touch(41)
    public static let inset = Tokens.Space.m
    public static let enterScale: CGFloat = 0.96
  }

  public static func commandBarTop(windowHeight: CGFloat) -> CGFloat {
    (windowHeight * CommandBar.topShareOfWindow).rounded()
  }

  public static func commandBarWidth(windowWidth: CGFloat) -> CGFloat {
    max(0, min(CommandBar.maxWidth, windowWidth - CommandBar.sideMargin * 2))
  }
}
