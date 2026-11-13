import SwiftUI

public struct DeckChromeLayout: Equatable, Sendable {
  public let header: CGRect
  public let banner: CGRect?
  public let cardsTop: CGFloat

  public init(container: CGSize, safeArea: EdgeInsets, occlusions: [CGRect], showsBanner: Bool, reserved: SideInsets = SideInsets(leading: 0, trailing: 0)) {
    let headerTop = safeArea.top + TabsLayout.deckChromeTop
    header = Self.row(container: container, safeArea: safeArea, occlusions: occlusions, reserved: reserved, top: headerTop, height: TabsLayout.deckHeaderHeight, maxWidth: .infinity)
    banner = showsBanner
      ? Self.row(container: container, safeArea: safeArea, occlusions: occlusions, reserved: reserved, top: header.maxY + TabsLayout.deckChromeGap, height: TabsLayout.bannerHeight, maxWidth: BarMetrics.maxWidth)
      : nil
    let chromeBottom = banner?.maxY ?? header.maxY
    let natural = chromeBottom + TabsLayout.deckChromeToCards
    let titleBottom = natural + TabsDeckGeometry.headerHeight
    let above = occlusions.filter { $0.minY < titleBottom && $0.maxY > safeArea.top }
    cardsTop = above.reduce(natural) { max($0, $1.maxY + TabsLayout.deckChromeToCards) }
  }

  static func row(container: CGSize, safeArea: EdgeInsets, occlusions: [CGRect], reserved: SideInsets, top: CGFloat, height: CGFloat, maxWidth: CGFloat) -> CGRect {
    let sides = SideClearance.insets(containerWidth: container.width, safeArea: safeArea, occlusions: occlusions, band: top...(top + height), base: BarMetrics.sideInset)
    let leading = max(sides.leading, reserved.leading)
    let trailing = max(sides.trailing, reserved.trailing)
    let available = max(0, container.width - leading - trailing)
    let width = min(available, maxWidth)
    return CGRect(x: leading + (available - width) / 2, y: top, width: width, height: height)
  }
}
