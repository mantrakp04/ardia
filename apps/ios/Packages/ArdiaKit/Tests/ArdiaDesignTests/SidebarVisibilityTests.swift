import ArdiaDesign
import Testing

struct SidebarVisibilityTests {
  @Test func `the bar layout has no sidebar at all`() {
    #expect(SidebarVisibility().placement(layout: .bar, hinge: nil) == .none)
    #expect(SidebarVisibility(hidesDocked: true, isOverlayOpen: true).placement(layout: .bar, hinge: .open) == .none)
  }

  @Test func `the docked layout shows the sidebar at rest and the overlay layout hides it`() {
    #expect(SidebarVisibility.restsHidden(in: .sidebarDocked) == false)
    #expect(SidebarVisibility.restsHidden(in: .sidebarOverlay) == true)
    #expect(SidebarVisibility().placement(layout: .sidebarDocked, hinge: nil) == .docked)
    #expect(SidebarVisibility().placement(layout: .sidebarOverlay, hinge: nil) == .hidden)
    #expect(SidebarVisibility().placement(layout: .sidebarOverlay, hinge: .open) == .hidden)
  }

  @Test func `the toggle hides and shows the docked sidebar`() {
    let hidden = SidebarVisibility().toggled(in: .sidebarDocked)
    #expect(hidden.placement(layout: .sidebarDocked, hinge: nil) == .hidden)
    #expect(hidden.toggled(in: .sidebarDocked).placement(layout: .sidebarDocked, hinge: nil) == .docked)
  }

  @Test func `the toggle slides the overlay sidebar over the page and back`() {
    let open = SidebarVisibility().toggled(in: .sidebarOverlay)
    #expect(open.placement(layout: .sidebarOverlay, hinge: nil) == .overlay)
    #expect(open.toggled(in: .sidebarOverlay).placement(layout: .sidebarOverlay, hinge: nil) == .hidden)
  }

  @Test func `tapping the page or opening a tab closes the overlay and leaves the docked choice alone`() {
    let open = SidebarVisibility(hidesDocked: true, isOverlayOpen: true)
    let closed = open.dismissingOverlay()
    #expect(closed.isOverlayOpen == false)
    #expect(closed.hidesDocked == true)
    #expect(closed.placement(layout: .sidebarOverlay, hinge: nil) == .hidden)
  }

  @Test func `the overlay toggle never changes what the docked layout remembers`() {
    let start = SidebarVisibility(hidesDocked: false)
    let afterOverlay = start.toggled(in: .sidebarOverlay).toggled(in: .sidebarOverlay).toggled(in: .sidebarOverlay)
    #expect(afterOverlay.hidesDocked == false)
    #expect(afterOverlay.placement(layout: .sidebarDocked, hinge: nil) == .docked)
  }

  @Test func `growing into the docked layout drops an open overlay`() {
    let open = SidebarVisibility().toggled(in: .sidebarOverlay)
    let docked = open.adapting(to: .sidebarDocked)
    #expect(docked.isOverlayOpen == false)
    #expect(docked.placement(layout: .sidebarDocked, hinge: nil) == .docked)
  }

  @Test func `half open puts the page above the fold and the tab list below, whatever was shown`() {
    #expect(SidebarVisibility().placement(layout: .sidebarOverlay, hinge: .partial) == .foldSplit)
    #expect(SidebarVisibility(hidesDocked: true).placement(layout: .sidebarDocked, hinge: .partial) == .foldSplit)
    #expect(SidebarVisibility(isOverlayOpen: true).placement(layout: .sidebarOverlay, hinge: .partial) == .foldSplit)
    #expect(SidebarVisibility().placement(layout: .sidebarOverlay, hinge: .closed) == .hidden)
  }

  @Test func `the toggle does nothing while folded half open or in the bar layout`() {
    let start = SidebarVisibility()
    #expect(start.toggled(in: .bar) == start)
    #expect(SidebarVisibility.canToggle(layout: .bar, hinge: nil) == false)
    #expect(SidebarVisibility.canToggle(layout: .sidebarOverlay, hinge: .partial) == false)
    #expect(SidebarVisibility.canToggle(layout: .sidebarDocked, hinge: nil) == true)
    #expect(SidebarVisibility.canToggle(layout: .sidebarOverlay, hinge: .open) == true)
  }

  @Test func `a sidebar asked to show is shown in both sidebar layouts, and survives growing or shrinking between them`() {
    let shown = SidebarVisibility(shownEverywhere: true)
    #expect(shown.placement(layout: .sidebarDocked, hinge: nil) == .docked)
    #expect(shown.placement(layout: .sidebarOverlay, hinge: nil) == .overlay)
    #expect(shown.adapting(to: .sidebarOverlay).placement(layout: .sidebarOverlay, hinge: nil) == .overlay)
    let hidden = SidebarVisibility(shownEverywhere: false)
    #expect(hidden.placement(layout: .sidebarDocked, hinge: nil) == .hidden)
    #expect(hidden.placement(layout: .sidebarOverlay, hinge: nil) == .hidden)
  }

  @Test func `only the hidden placement shows the host capsule and only the overlay dims the page`() {
    #expect(SidebarPlacement.hidden.showsHostCapsule)
    #expect(!SidebarPlacement.docked.showsHostCapsule)
    #expect(!SidebarPlacement.overlay.showsHostCapsule)
    #expect(!SidebarPlacement.foldSplit.showsHostCapsule)
    #expect(SidebarPlacement.overlay.dimsPage)
    #expect(!SidebarPlacement.docked.dimsPage)
    #expect(SidebarPlacement.docked.sidebarBesidePage)
    #expect(!SidebarPlacement.overlay.sidebarBesidePage)
  }
}
