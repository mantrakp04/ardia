import ArdiaDesign
import CoreGraphics
import Testing

struct SidebarMetricsTests {
  @Test func `the touch scale is the Mac's value times 1.25, halves to even`() {
    #expect(SidebarMetrics.touch(34) == 42)
    #expect(SidebarMetrics.touch(3) == 4)
    #expect(SidebarMetrics.touch(6) == 8)
    #expect(SidebarMetrics.touch(10) == 12)
    #expect(SidebarMetrics.touch(16) == 20)
    #expect(SidebarMetrics.touch(50) == 62)
  }

  @Test func `the metrics match the spec's touch table`() {
    #expect(SidebarMetrics.defaultWidth == 260)
    #expect(SidebarMetrics.widthRange == 220...400)
    #expect(SidebarMetrics.sideInset == 10)
    #expect(SidebarMetrics.cardInset == 10)
    #expect(SidebarMetrics.headerHeight == 56)
    #expect(SidebarMetrics.footerHeight == 52)
    #expect(SidebarMetrics.Tile.height == 52)
    #expect(SidebarMetrics.Tile.gap == 8)
    #expect(SidebarMetrics.Tile.radius == 12)
    #expect(SidebarMetrics.Tile.minWidth == 62)
    #expect(SidebarMetrics.Tile.maxColumns == 4)
    #expect(SidebarMetrics.Row.height == 42)
    #expect(SidebarMetrics.Row.gap == 4)
    #expect(SidebarMetrics.Row.radius == 12)
    #expect(SidebarMetrics.Row.icon == 20)
    #expect(SidebarMetrics.Row.title.baseSize == 15)
    #expect(SidebarMetrics.sectionLabel.baseSize == 13)
    #expect(SidebarMetrics.sectionLabel.weight == .semibold)
  }

  @Test func `row metrics are the Mac's through the touch scale`() {
    #expect(SidebarMetrics.Row.height == SidebarMetrics.touch(34))
    #expect(SidebarMetrics.Row.gap == SidebarMetrics.touch(3))
    #expect(SidebarMetrics.Row.icon == SidebarMetrics.touch(16))
    #expect(SidebarMetrics.Row.radius == SidebarMetrics.touch(Tokens.Radius.chrome))
    #expect(SidebarMetrics.Tile.radius == SidebarMetrics.touch(Tokens.Radius.chrome))
    #expect(SidebarMetrics.Tile.gap == SidebarMetrics.touch(6))
    #expect(SidebarMetrics.Tile.minWidth == SidebarMetrics.touch(50))
  }

  @Test func `the sidebar width stays in its range`() {
    #expect(SidebarMetrics.clampedWidth(100) == 220)
    #expect(SidebarMetrics.clampedWidth(300) == 300)
    #expect(SidebarMetrics.clampedWidth(900) == 400)
  }

  @Test func `pinned tiles fill a balanced grid of at most four columns`() {
    #expect(SidebarMetrics.pinGrid(count: 8, innerWidth: 400, balanced: true) == .init(columns: 4, tileWidth: 94))
    #expect(SidebarMetrics.pinGrid(count: 8, innerWidth: 240, balanced: true) == .init(columns: 3, tileWidth: 74.5))
    #expect(SidebarMetrics.pinGrid(count: 5, innerWidth: 400, balanced: true) == .init(columns: 3, tileWidth: 128))
  }

  @Test func `an unbalanced grid shows every tile that fits on one row`() {
    #expect(SidebarMetrics.pinGrid(count: 2, innerWidth: 240, balanced: false) == .init(columns: 2, tileWidth: 116))
    #expect(SidebarMetrics.pinGrid(count: 9, innerWidth: 400, balanced: false).columns == 5)
  }

  @Test func `a narrow or empty grid still has one column`() {
    #expect(SidebarMetrics.pinGrid(count: 0, innerWidth: 240, balanced: true).columns == 1)
    #expect(SidebarMetrics.pinGrid(count: 3, innerWidth: 40, balanced: true).columns == 1)
  }
}
