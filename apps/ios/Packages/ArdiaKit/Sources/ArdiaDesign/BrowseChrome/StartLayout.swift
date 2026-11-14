import SwiftUI

public struct StartLayout: Sendable, Equatable {
  public static let margin = Tokens.Space.xxl
  public static let maxContentWidth = SidebarMetrics.Tile.minWidth * CGFloat(SidebarMetrics.Tile.maxColumns) * 2
  public static let sectionGap = Tokens.Space.xxxl

  public let contentWidth: CGFloat
  public let isSideBySide: Bool
  public let headerWidth: CGFloat
  public let gridWidth: CGFloat

  public init(container: CGSize, safeArea: EdgeInsets) {
    let usableWidth = max(0, container.width - max(Self.margin, safeArea.leading) - max(Self.margin, safeArea.trailing))
    let usableHeight = max(0, container.height - safeArea.top - safeArea.bottom)
    isSideBySide = usableWidth > usableHeight * 1.4 && usableHeight < Self.stackedMinimumHeight
    contentWidth = min(usableWidth, isSideBySide ? Self.maxContentWidth * 1.5 : Self.maxContentWidth)
    if isSideBySide {
      headerWidth = (contentWidth - Self.sectionGap) * 0.4
      gridWidth = contentWidth - Self.sectionGap - headerWidth
    } else {
      headerWidth = contentWidth
      gridWidth = contentWidth
    }
  }

  static let stackedMinimumHeight: CGFloat = 480
}
