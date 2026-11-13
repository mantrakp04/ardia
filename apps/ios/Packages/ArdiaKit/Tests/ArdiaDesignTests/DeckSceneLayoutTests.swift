import ArdiaDesign
import SwiftUI
import Testing

struct DeckSceneLayoutTests {
  let duo = CGSize(width: 466, height: 678)
  let duoCorners = RectangleCornerRadii(topLeading: 8, bottomLeading: 59, bottomTrailing: 59, topTrailing: 8)
  let phone = CGSize(width: 402, height: 874)
  let phoneSafe = EdgeInsets(top: 62, leading: 0, bottom: 34, trailing: 0)

  @Test func `with a bottom bar the deck uses the whole width and the browsing bar's frame`() {
    let layout = DeckSceneLayout(container: phone, safeArea: phoneSafe, corners: RectangleCornerRadii(uniform: 62), occlusions: [], verticalEdge: nil, showsBanner: false)
    #expect(!layout.isRail)
    #expect(layout.content == CGRect(origin: .zero, size: phone))
    #expect(layout.strip.barFrame == layout.bar.barFrame)
    #expect(layout.railSearch == nil)
    #expect(layout.strip.cardCenterY + layout.strip.cardSize.height / 2 < layout.bar.barFrame.minY)
  }

  @Test(arguments: [HorizontalEdge.trailing, .leading])
  func `with a rail the deck, header and search sit beside it at the bar's frame`(edge: HorizontalEdge) {
    let layout = DeckSceneLayout(container: duo, safeArea: EdgeInsets(), corners: duoCorners, occlusions: [], verticalEdge: edge, showsBanner: true)
    let rail = layout.bar.barFrame
    #expect(layout.isRail)
    #expect(rail.width == BarMetrics.pieceHeight)
    let search = try! #require(layout.railSearch)
    if edge == .trailing {
      #expect(layout.content.maxX <= rail.minX)
      #expect(layout.chrome.header.maxX <= rail.minX)
      #expect(search.maxX <= rail.minX)
    } else {
      #expect(layout.content.minX >= rail.maxX)
      #expect(layout.chrome.header.minX >= rail.maxX)
      #expect(search.minX >= rail.maxX)
    }
    #expect(search.minY == rail.minY + BarMetrics.pieceHeight + BarMetrics.pieceGap)
    #expect(layout.strip.cardSize.width <= layout.content.width)
    #expect(layout.strip.cardCenterY + layout.strip.cardSize.height / 2 <= duo.height - BarMetrics.sideInset)
    #expect(abs(layout.strip.tabButtonCenter.y - (rail.minY + BarMetrics.pieceHeight / 2)) < 0.5)
  }

  @Test func `a short window drops the banner and the grid starts below the header`() {
    let short = DeckSceneLayout(container: CGSize(width: 874, height: 402), safeArea: EdgeInsets(), corners: RectangleCornerRadii(uniform: 0), occlusions: [], verticalEdge: nil, showsBanner: true)
    #expect(short.style == .grid)
    #expect(short.chrome.banner == nil)
    #expect(short.gridViewport.minY == short.chrome.header.maxY)
    #expect(short.gridViewport.minY + short.gridTopInset == short.chrome.cardsTop)
    #expect(short.gridTopInset >= TabsLayout.deckChromeToCards)
    #expect(short.grid.cardSize.height + DeckGridMetrics.headerHeight <= short.bar.barFrame.minY - short.chrome.cardsTop)
    let tall = DeckSceneLayout(container: CGSize(width: 669, height: 951), safeArea: EdgeInsets(), corners: RectangleCornerRadii(uniform: 0), occlusions: [], verticalEdge: nil, showsBanner: true)
    let banner = try! #require(tall.chrome.banner)
    #expect(tall.gridViewport.minY == banner.maxY)
  }

  @Test func `with a rail the grid stays beside it`() {
    let layout = DeckSceneLayout(container: CGSize(width: 678, height: 466), safeArea: EdgeInsets(), corners: duoCorners, occlusions: [], verticalEdge: .trailing, showsBanner: false)
    #expect(layout.style == .grid)
    #expect(layout.gridViewport.maxX <= layout.bar.barFrame.minX)
    let used = layout.grid.cardSize.width * CGFloat(layout.grid.columns) + DeckGridMetrics.gap * CGFloat(layout.grid.columns - 1)
    #expect(layout.grid.sideInset * 2 + used <= layout.gridViewport.width + 0.5)
  }
}
