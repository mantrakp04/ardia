import ArdiaDesign
import CoreGraphics
import Testing

struct TabsDeckGeometryTests {
  let geometry = TabsDeckGeometry(container: CGSize(width: 393, height: 852), safeTop: 59, safeBottom: 34)

  @Test func `resting deck matches Arc's measured slots`() {
    #expect(abs(geometry.cardSize.width - 217) < 0.5)
    #expect(abs(geometry.leading(at: 0) - 80) < 0.5)
    #expect(abs(geometry.leading(at: 1) - 298) < 0.5)
    #expect(abs(geometry.leading(at: -1) - 10) < 0.5)
    #expect(abs(geometry.barCenterY - 812) < 0.5)
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
    #expect(geometry.visibleWidth(at: 0, isLast: false) >= geometry.cardSize.width - 0.5)
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
}
