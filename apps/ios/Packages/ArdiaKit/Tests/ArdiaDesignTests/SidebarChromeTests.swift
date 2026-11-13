import ArdiaDesign
import CoreGraphics
import SwiftUI
import Testing

struct SidebarChromeTests {
  @Test func `the command bar is at most 600 points wide and keeps a margin on narrow windows`() {
    #expect(SidebarChrome.commandBarWidth(windowWidth: 1_366) == 600)
    #expect(SidebarChrome.commandBarWidth(windowWidth: 669) == 600)
    #expect(SidebarChrome.commandBarWidth(windowWidth: 600) == 600 - SidebarChrome.CommandBar.sideMargin * 2)
    #expect(SidebarChrome.commandBarWidth(windowWidth: 10) == 0)
  }

  @Test func `the command bar sits in the upper third of the window`() {
    for height: CGFloat in [678, 951, 1_024, 1_376] {
      let top = SidebarChrome.commandBarTop(windowHeight: height)
      #expect(top > 0)
      #expect(top + SidebarChrome.CommandBar.fieldHeight < height / 3)
    }
  }

  @Test func `the page card's corners are concentric with the window, never sharper than a row`() {
    #expect(SidebarChrome.cardRadius(windowCorners: RectangleCornerRadii(uniform: 55)) == 45)
    #expect(SidebarChrome.cardRadius(windowCorners: RectangleCornerRadii(uniform: 30)) == 20)
    #expect(SidebarChrome.cardRadius(windowCorners: RectangleCornerRadii(uniform: 0)) == SidebarMetrics.Row.radius)
  }

  @Test func `the page starts below the floating controls' band`() {
    #expect(SidebarChrome.Card.controlBand == SidebarChrome.Card.controlInset * 2 + GlassMetrics.hitTarget)
    #expect(SidebarChrome.Card.controlBand == 64)
  }

  @Test func `the page menu popover is wider than the phone's content column`() {
    #expect(SidebarChrome.Card.pageMenuWidth >= 402)
    #expect(SidebarChrome.Card.pageMenuWidth > PageMenuLayout.popoverWidth)
  }

  @Test func `row parts are the Mac's through the touch scale`() {
    #expect(SidebarChrome.RowParts.contentLeading == SidebarMetrics.touch(9))
    #expect(SidebarChrome.RowParts.closeSlot == 28)
    #expect(SidebarChrome.RowParts.titleFade == 30)
  }
}
