import SwiftUI

public struct DeckSceneLayout: Equatable, Sendable {
  public static let railSearchMaxWidth: CGFloat = 320

  public let size: CGSize
  public let style: DeckStyle
  public let bar: BottomBarGeometry
  public let chrome: DeckChromeLayout
  public let content: CGRect
  public let strip: TabsDeckGeometry
  public let grid: DeckGridMetrics
  public let gridViewport: CGRect
  public let gridTopInset: CGFloat
  public let gridBottomInset: CGFloat
  public let railSearch: CGRect?

  public var isRail: Bool { bar.axis != .horizontal }

  public init(container: CGSize, safeArea: EdgeInsets, corners: RectangleCornerRadii, occlusions: [CGRect], verticalEdge: HorizontalEdge?, showsBanner: Bool) {
    size = container
    style = DeckStyle.style(for: container)
    let bar = BottomBarGeometry(container: container, safeArea: safeArea, corners: corners, occlusions: occlusions, verticalEdge: verticalEdge)
    self.bar = bar
    let isRail = bar.axis != .horizontal
    let reserved = SideInsets(leading: bar.pageLeadingInset, trailing: bar.pageTrailingInset)
    let roomForBanner = container.height >= TabsLayout.bannerMinWindowHeight
    chrome = DeckChromeLayout(container: container, safeArea: safeArea, occlusions: occlusions, showsBanner: showsBanner && roomForBanner, reserved: reserved)
    let width = max(container.width - reserved.leading - reserved.trailing, 1)
    content = CGRect(x: reserved.leading, y: 0, width: width, height: container.height)
    let safeSide = isRail ? 0 : max(safeArea.leading, safeArea.trailing)
    let bottomGap = max(safeArea.bottom, BarMetrics.sideInset)
    let stripBar = isRail
      ? CGRect(x: 0, y: container.height - bottomGap, width: width, height: 0)
      : bar.barFrame.offsetBy(dx: -reserved.leading, dy: 0)
    let tabButton = isRail ? CGPoint(x: bar.barFrame.midX - reserved.leading, y: bar.barFrame.minY + BarMetrics.pieceHeight / 2) : nil
    strip = TabsDeckGeometry(
      container: CGSize(width: width, height: container.height),
      safeTop: safeArea.top,
      safeBottom: safeArea.bottom,
      safeSide: safeSide,
      topInset: chrome.cardsTop - safeArea.top,
      windowCorner: corners.largest,
      barFrame: stripBar,
      tabButton: tabButton
    )
    let chromeBottom = chrome.banner?.maxY ?? chrome.header.maxY
    gridViewport = CGRect(x: content.minX, y: chromeBottom, width: width, height: max(container.height - chromeBottom, 1))
    gridTopInset = chrome.cardsTop - chromeBottom
    gridBottomInset = container.height - stripBar.minY + TabsDeckGeometry.barClearance
    grid = DeckGridMetrics(width: width, height: stripBar.minY - chrome.cardsTop - TabsDeckGeometry.barClearance, safeSide: safeSide)
    railSearch = isRail ? Self.railSearch(bar: bar.barFrame, content: content, edge: bar.axis) : nil
  }

  static func railSearch(bar: CGRect, content: CGRect, edge: BottomBarGeometry.Axis) -> CGRect {
    let available = max(content.width - BarMetrics.sideInset * 2, BarMetrics.pieceHeight)
    let width = min(railSearchMaxWidth, available)
    let y = bar.minY + BarMetrics.pieceHeight + BarMetrics.pieceGap
    let x: CGFloat
    if case .vertical(.leading) = edge {
      x = content.minX + BarMetrics.sideInset
    } else {
      x = content.maxX - BarMetrics.sideInset - width
    }
    return CGRect(x: x, y: y, width: width, height: BarMetrics.pieceHeight)
  }
}
