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

struct CommandBarHeightTests {
  private let shortWindow: CGFloat = 500
  private let keyboard: CGFloat = 262

  @Test func `the panel stops above the keyboard and the window's bottom margin`() {
    for overlap: CGFloat in [0, keyboard] {
      let limit = SidebarChrome.commandBarPanelLimit(windowHeight: shortWindow, keyboardOverlap: overlap)
      #expect(SidebarChrome.commandBarTop(windowHeight: shortWindow) + limit + overlap + SidebarChrome.CommandBar.bottomMargin == shortWindow)
    }
  }

  @Test func `the field and its padding always fit, and the suggestions get what is left`() {
    for overlap: CGFloat in [0, keyboard] {
      let panel = SidebarChrome.commandBarPanelLimit(windowHeight: shortWindow, keyboardOverlap: overlap)
      let rows = SidebarChrome.commandBarRowsLimit(windowHeight: shortWindow, keyboardOverlap: overlap)
      #expect(panel >= SidebarChrome.CommandBar.fixedHeight)
      #expect(rows == panel - SidebarChrome.CommandBar.fixedHeight)
    }
  }

  @Test func `in a 500 point window eight suggestions do not fit, so they scroll`() {
    let rows = SidebarChrome.commandBarRowsLimit(windowHeight: shortWindow, keyboardOverlap: 0)
    let eight = CGFloat(SidebarChrome.CommandBar.rowLimit) * BrowseLayout.suggestionPitch
    #expect(rows < eight)
    #expect(rows >= BrowseLayout.suggestionPitch)
  }

  @Test func `at the largest text size one suggestion still shows without a keyboard, and the list scrolls with one`() {
    let largestRow = BrowseLayout.suggestionPitch * SidebarChrome.CommandBar.largestTextScale
    #expect(SidebarChrome.commandBarRowsLimit(windowHeight: shortWindow, keyboardOverlap: 0) >= largestRow)
    #expect(SidebarChrome.commandBarRowsLimit(windowHeight: shortWindow, keyboardOverlap: keyboard) < largestRow)
  }

  @Test func `a keyboard taller than the window never makes the limits negative`() {
    #expect(SidebarChrome.commandBarPanelLimit(windowHeight: shortWindow, keyboardOverlap: 2_000) == SidebarChrome.CommandBar.fixedHeight)
    #expect(SidebarChrome.commandBarRowsLimit(windowHeight: shortWindow, keyboardOverlap: 2_000) == 0)
  }
}
