import ArdiaDesign
import CoreGraphics
import Testing

struct TabsDeckGeometryTests {
  let geometry = TabsDeckGeometry(container: CGSize(width: 393, height: 852), safeTop: 59, safeBottom: 34)

  @Test func `resting deck matches Arc's measured slots`() {
    let proMax = TabsDeckGeometry(container: CGSize(width: 440, height: 956), safeTop: 62, safeBottom: 34)
    #expect(abs(proMax.cardSize.width - 306) < 0.5)
    #expect(abs(proMax.leading(at: 0) - 66) < 0.5)
    #expect(abs(proMax.leading(at: 1) - 284) < 0.5)
    #expect(abs(geometry.leading(at: -1) - 6) < 0.5)
    #expect(abs(geometry.barCenterY - (852 - 22 - BarMetrics.pieceHeight / 2)) < 0.5)
  }

  @Test func `the next card overlaps the focused one`() {
    #expect(geometry.leading(at: 1) < geometry.leading(at: 0) + geometry.cardSize.width)
  }

  @Test func `cards move without a jump as they cross the focus slot`() {
    let step = 0.001
    let leftSlope = (geometry.leading(at: 0) - geometry.leading(at: -step)) / step
    let rightSlope = (geometry.leading(at: step) - geometry.leading(at: 0)) / step
    #expect(abs(leftSlope - rightSlope) / rightSlope < 0.01)
  }

  @Test func `tucked cards stay on screen and keep their order`() {
    let positions = stride(from: -8.0, through: 0, by: 0.5).map { geometry.leading(at: $0) }
    #expect(positions.allSatisfy { $0 >= 0 })
    #expect(zip(positions, positions.dropFirst()).allSatisfy { $0 < $1 })
  }

  @Test func `a mostly covered card shows only its favicon`() {
    #expect(geometry.visibleWidth(at: -1, isLast: false) < TabsDeckGeometry.headerFaviconOnlyWidth)
    #expect(abs(geometry.visibleWidth(at: 0, isLast: false) - geometry.spacing) < 0.5)
    #expect(geometry.visibleWidth(at: 0, isLast: true) == geometry.cardSize.width)
  }

  @Test func `a flick carries the deck past the nearest card`() {
    #expect(geometry.settleTarget(from: 5, velocity: 0, count: 10) == 5)
    #expect(geometry.settleTarget(from: 5.2, velocity: -2000, count: 10) == 7)
    #expect(geometry.settleTarget(from: 0.2, velocity: 3000, count: 10) == 0)
    #expect(geometry.settleTarget(from: 9.4, velocity: -4000, count: 10) == 9)
  }

  @Test func `closing a card keeps the focused tab in the middle`() {
    #expect(TabsDeckGeometry.scrollAfterRemoving(index: 2, scroll: 5, remaining: 9) == 4)
    #expect(TabsDeckGeometry.scrollAfterRemoving(index: 5, scroll: 5, remaining: 9) == 5)
    #expect(TabsDeckGeometry.scrollAfterRemoving(index: 9, scroll: 9, remaining: 9) == 8)
    #expect(TabsDeckGeometry.scrollAfterRemoving(index: 0, scroll: 0, remaining: 0) == 0)
  }

  @Test func `a card closes on a flick or a long drag, never on a drag down`() {
    let height = geometry.cardSize.height
    #expect(TabsDeckGeometry.shouldClose(translation: -40, velocity: -900, cardHeight: height))
    #expect(TabsDeckGeometry.shouldClose(translation: -height / 2, velocity: 0, cardHeight: height))
    #expect(!TabsDeckGeometry.shouldClose(translation: -60, velocity: -100, cardHeight: height))
    #expect(!TabsDeckGeometry.shouldClose(translation: 120, velocity: 900, cardHeight: height))
  }

  @Test func `only cards near the focus are built`() {
    #expect(TabsDeckGeometry.renderedRange(around: 30, count: 60) == 24..<36)
    #expect(TabsDeckGeometry.renderedRange(around: 0, count: 3) == 0..<3)
    #expect(TabsDeckGeometry.renderedRange(around: 0, count: 0).isEmpty)
  }

  @Test func `landscape cards fit between the header and the bar`() {
    let landscape = TabsDeckGeometry(container: CGSize(width: 852, height: 393), safeTop: 0, safeBottom: 21)
    let top = landscape.cardCenterY - landscape.cardSize.height / 2
    let bottom = landscape.cardCenterY + landscape.cardSize.height / 2
    #expect(top >= TabsDeckGeometry.headerHeight)
    #expect(bottom < landscape.barCenterY - 20)
  }

  @Test func `portrait phones and the closed Duo get the strip, landscape and wide windows the grid`() {
    #expect(DeckStyle.style(for: CGSize(width: 402, height: 874)) == .strip)
    #expect(DeckStyle.style(for: CGSize(width: 466, height: 678)) == .strip)
    #expect(DeckStyle.style(for: CGSize(width: 874, height: 402)) == .grid)
    #expect(DeckStyle.style(for: CGSize(width: 678, height: 466)) == .grid)
    #expect(DeckStyle.style(for: CGSize(width: 669, height: 951)) == .grid)
    #expect(DeckStyle.style(for: CGSize(width: 599, height: 951)) == .strip)
  }

  @Test func `grid cards stay between the min and max width and fill the row`() {
    for (width, height) in [(874.0, 402.0), (678.0, 466.0), (669.0, 951.0), (1032.0, 1376.0), (600.0, 900.0)] {
      let grid = DeckGridMetrics(width: width, height: height)
      #expect(grid.columns >= 2)
      #expect(grid.cardSize.width >= DeckGridMetrics.minCardWidth - 0.5, "\(width)")
      #expect(grid.cardSize.width <= DeckGridMetrics.maxCardWidth + 0.5, "\(width)")
      let used = grid.cardSize.width * CGFloat(grid.columns) + DeckGridMetrics.gap * CGFloat(grid.columns - 1)
      #expect(abs(used + grid.sideInset * 2 - width) < 2, "\(width)")
    }
  }

  @Test func `a landscape phone row fits between the header and the bar`() {
    let grid = DeckGridMetrics(width: 874, height: 250)
    #expect(grid.columns == 4)
    #expect(grid.cardSize.height + DeckGridMetrics.headerHeight <= 250)
    #expect(grid.cardSize.height < grid.cardSize.width * DeckGridMetrics.portraitAspect)
    let tall = DeckGridMetrics(width: 669, height: 800)
    #expect(abs(tall.cardSize.height - (tall.cardSize.width * DeckGridMetrics.portraitAspect).rounded(.down)) < 1)
  }

  @Test func `the expanding card starts from the window's real corner`() {
    let pro = TabsDeckGeometry(container: CGSize(width: 402, height: 874), safeTop: 62, safeBottom: 34, windowCorner: 62)
    #expect(pro.windowCorner == 62)
    let headed = TabsDeckGeometry(container: CGSize(width: 402, height: 874), safeTop: 62, safeBottom: 34, topInset: 52)
    let plain = TabsDeckGeometry(container: CGSize(width: 402, height: 874), safeTop: 62, safeBottom: 34)
    #expect(headed.cardCenterY > plain.cardCenterY)
    #expect(headed.cardCenterY + headed.cardSize.height / 2 < headed.barCenterY - 20)
  }

  @Test func `card titles start a full gap below the deck's header and banner`() {
    let chrome = TabsLayout.deckChromeTop + TabsLayout.deckHeaderHeight + TabsLayout.deckChromeGap + TabsLayout.bannerHeight
    let geometry = TabsDeckGeometry(container: CGSize(width: 402, height: 874), safeTop: 62, safeBottom: 34, topInset: chrome + TabsLayout.deckChromeToCards)
    #expect(geometry.cardTitleTop - (62 + chrome) >= TabsLayout.deckChromeToCards - 0.5)
    let plain = TabsDeckGeometry(container: CGSize(width: 393, height: 852), safeTop: 59, safeBottom: 34)
    #expect(plain.cardTitleTop >= 59 + TabsDeckGeometry.topReserve - TabsLayout.headerGap - 0.5)
  }

  @Test func `four pinned tiles split two and two in the sidebar and stay one row on the phone`() {
    let sidebar = SidebarMetrics.pinGrid(count: 4, innerWidth: SidebarMetrics.defaultWidth - SidebarMetrics.sideInset * 2, balanced: true)
    #expect(sidebar.columns == 2)
    let phone = SidebarMetrics.pinGrid(count: 4, innerWidth: 360, balanced: true)
    #expect(phone.columns == 4)
    #expect(SidebarMetrics.pinGrid(count: 5, innerWidth: 360, balanced: true).columns == 3)
  }
}
