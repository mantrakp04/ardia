import ArdiaDesign
import Foundation
import SwiftUI
import Testing

@MainActor
struct SidebarStateTests {
  private func fresh() -> (SidebarState, UserDefaults) {
    let name = "sidebar-state-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return (SidebarState(defaults: defaults), defaults)
  }

  @Test func `a round trip through docked: hide, peek, pin, hide again, remembered each time`() {
    let (sidebar, defaults) = fresh()
    #expect(sidebar.placement(layout: .sidebarDocked, hinge: nil) == .docked)
    sidebar.toggle(layout: .sidebarDocked, hinge: nil)
    #expect(sidebar.placement(layout: .sidebarDocked, hinge: nil) == .hidden)
    #expect(SidebarPreferences(defaults: defaults).hidesDocked)
    sidebar.peek(.pointer, layout: .sidebarDocked, hinge: nil)
    #expect(sidebar.placement(layout: .sidebarDocked, hinge: nil) == .peek)
    #expect(SidebarPreferences(defaults: defaults).hidesDocked)
    sidebar.toggle(layout: .sidebarDocked, hinge: nil)
    #expect(sidebar.placement(layout: .sidebarDocked, hinge: nil) == .docked)
    #expect(!SidebarPreferences(defaults: defaults).hidesDocked)
    sidebar.toggle(layout: .sidebarDocked, hinge: nil)
    #expect(sidebar.placement(layout: .sidebarDocked, hinge: nil) == .hidden)
    #expect(SidebarState(defaults: defaults).placement(layout: .sidebarDocked, hinge: nil) == .hidden)
  }

  @Test func `a late report from a window that went to the bar cannot strand a sidebar window`() {
    let (sidebar, _) = fresh()
    sidebar.adapt(to: .bar)
    #expect(sidebar.placement(layout: .sidebarDocked, hinge: nil) == .docked)
    sidebar.toggle(layout: .sidebarDocked, hinge: nil)
    #expect(sidebar.placement(layout: .sidebarDocked, hinge: nil) == .hidden)
    sidebar.peek(.pointer, layout: .sidebarDocked, hinge: nil)
    #expect(sidebar.placement(layout: .sidebarDocked, hinge: nil) == .peek)
  }

  @Test func `the toggle and its label follow what is on screen`() {
    let (sidebar, _) = fresh()
    #expect(sidebar.toggleAction(layout: .sidebarDocked, hinge: nil) == .hide)
    #expect(sidebar.toggleAction(layout: .sidebarOverlay, hinge: nil) == .show)
    #expect(sidebar.toggleAction(layout: .bar, hinge: nil) == nil)
    #expect(sidebar.toggleAction(layout: .sidebarOverlay, hinge: .partial) == nil)
    sidebar.toggle(layout: .sidebarOverlay, hinge: nil)
    #expect(sidebar.toggleAction(layout: .sidebarOverlay, hinge: nil) == .hide)
  }

  @Test func `a touch peek reads Hide and closes, a pointer peek reads Keep Open and pins`() {
    let (sidebar, defaults) = fresh()
    sidebar.toggle(layout: .sidebarDocked, hinge: nil)
    sidebar.peek(.touch, layout: .sidebarDocked, hinge: nil)
    #expect(sidebar.toggleAction(layout: .sidebarDocked, hinge: nil) == .hide)
    sidebar.toggle(layout: .sidebarDocked, hinge: nil)
    #expect(sidebar.placement(layout: .sidebarDocked, hinge: nil) == .hidden)
    #expect(SidebarPreferences(defaults: defaults).hidesDocked)
    sidebar.peek(.pointer, layout: .sidebarDocked, hinge: nil)
    #expect(sidebar.toggleAction(layout: .sidebarDocked, hinge: nil) == .pin)
  }

  @Test func `a cancelled pull or resize cannot leave the sidebar half in`() {
    let (sidebar, _) = fresh()
    sidebar.peekDrag = 0.4
    sidebar.dragWidth = 300
    sidebar.adapt(to: .sidebarOverlay)
    #expect(sidebar.peekDrag == nil)
    #expect(sidebar.dragWidth == nil)
    sidebar.peekDrag = 0.7
    sidebar.cancelGestures()
    #expect(sidebar.peekDrag == nil)
  }

  @Test func `a layout change closes peeks and a docked layout drops the overlay`() {
    let (sidebar, _) = fresh()
    sidebar.toggle(layout: .sidebarOverlay, hinge: nil)
    sidebar.adapt(to: .sidebarDocked)
    #expect(sidebar.placement(layout: .sidebarDocked, hinge: nil) == .docked)
    sidebar.toggle(layout: .sidebarDocked, hinge: nil)
    sidebar.peek(.pointer, layout: .sidebarDocked, hinge: nil)
    sidebar.adapt(to: .sidebarOverlay)
    #expect(sidebar.placement(layout: .sidebarOverlay, hinge: nil) == .hidden)
  }

  @Test func `a pointer peek leaves after the Mac's delay unless held`() async throws {
    let (sidebar, _) = fresh()
    sidebar.toggle(layout: .sidebarDocked, hinge: nil)
    sidebar.peek(.pointer, layout: .sidebarDocked, hinge: nil)
    sidebar.releasePointerPeek()
    sidebar.holdPeek()
    try await Task.sleep(for: SidebarPeek.leaveDelay * 3)
    #expect(sidebar.placement(layout: .sidebarDocked, hinge: nil) == .peek)
    sidebar.releasePointerPeek()
    try await Task.sleep(for: SidebarPeek.leaveDelay * 3)
    #expect(sidebar.placement(layout: .sidebarDocked, hinge: nil) == .hidden)
  }

  @Test func `the empty card opens search once, until a page has shown`() {
    let (sidebar, _) = fresh()
    #expect(sidebar.shouldAutoOpenSearch)
    sidebar.noteAutoOpenedSearch()
    #expect(!sidebar.shouldAutoOpenSearch)
    sidebar.notePageShown()
    #expect(sidebar.shouldAutoOpenSearch)
  }

  @Test func `the width is clamped, remembered and reset`() {
    let (sidebar, defaults) = fresh()
    sidebar.commitWidth(9_000)
    #expect(sidebar.width == SidebarMetrics.widthRange.upperBound)
    #expect(SidebarState(defaults: defaults).width == SidebarMetrics.widthRange.upperBound)
    sidebar.resetWidth()
    #expect(sidebar.width == SidebarMetrics.defaultWidth)
  }
}

struct SidebarResizeRuleTests {
  @Test func `a resize starts from the width on screen, not the saved one`() {
    #expect(SidebarWidth.adjusted(400, by: 10, windowWidth: 700) == 290)
    #expect(SidebarWidth.adjusted(260, by: -42, windowWidth: 1_366) == 220)
    #expect(SidebarWidth.adjusted(260, by: 500, windowWidth: 1_366) == SidebarMetrics.widthRange.upperBound)
  }

  @Test func `only a mostly sideways drag resizes`() {
    #expect(SidebarWidth.isResizeDrag(CGSize(width: 12, height: 3)))
    #expect(SidebarWidth.isResizeDrag(CGSize(width: -12, height: 3)))
    #expect(!SidebarWidth.isResizeDrag(CGSize(width: 3, height: 12)))
    #expect(!SidebarWidth.isResizeDrag(CGSize(width: 5, height: 5)))
  }

  @Test func `the handle's hit strip stays in the gutter, off the page and off the rows' close buttons`() {
    #expect(SidebarChrome.Edge.handleHitWidth <= SidebarMetrics.sideInset)
    #expect(SidebarChrome.Edge.handleWidth <= SidebarChrome.Edge.handleHitWidth)
  }
}
