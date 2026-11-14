@testable import ArdiaDesign
import CoreGraphics
import Testing

struct SidebarGlassTests {
  @Test func `the space band is the Mac's band through the touch scale`() {
    #expect(SpaceSwitcherMetrics.bandHeight == SidebarMetrics.touch(28))
    #expect(SpaceSwitcherMetrics.bandHeight == 35)
    #expect(SpaceSwitcherMetrics.dotCell == SidebarMetrics.touch(12))
    #expect(SpaceSwitcherMetrics.iconCell == SidebarMetrics.touch(26))
  }

  @Test func `each end pads the end mark so it sits centred in the round end`() {
    for cell in [SpaceSwitcherMetrics.dotCell, SpaceSwitcherMetrics.iconCell] {
      let end = SpaceSwitcherMetrics.endPadding(beside: cell)
      #expect(end + cell / 2 == SpaceSwitcherMetrics.bandHeight / 2)
    }
    #expect(SpaceSwitcherMetrics.endPadding(beside: SpaceSwitcherMetrics.dotCell) == 10)
    #expect(SpaceSwitcherMetrics.endPadding(beside: SpaceSwitcherMetrics.iconCell) == 1.5)
  }

  @Test func `a cell wider than the band gets no negative padding`() {
    #expect(SpaceSwitcherMetrics.endPadding(beside: SpaceSwitcherMetrics.bandHeight + 9) == 0)
  }

  @Test func `the cell follows the mark`() {
    #expect(SpaceSwitcherMetrics.cell(showsIcon: false) == SpaceSwitcherMetrics.dotCell)
    #expect(SpaceSwitcherMetrics.cell(showsIcon: true) == SpaceSwitcherMetrics.iconCell)
  }

  @Test func `the New Tab glass is a full row at the row radius, not a capsule`() {
    #expect(GlassControlShape.row.outline == .rounded(SidebarMetrics.Row.radius))
    #expect(GlassControlShape.row.minimumSize.height == SidebarMetrics.Row.height)
    #expect(GlassControlShape.row.minimumSize.height < GlassControlShape.tile.minimumSize.height)
  }
}
