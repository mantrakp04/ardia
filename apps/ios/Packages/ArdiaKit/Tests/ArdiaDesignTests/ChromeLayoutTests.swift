import ArdiaDesign
import CoreGraphics
import Testing

struct ChromeLayoutTests {
  @Test func `phones keep the bar in both orientations`() {
    #expect(ChromeLayout(windowSize: CGSize(width: 402, height: 874)) == .bar)
    #expect(ChromeLayout(windowSize: CGSize(width: 874, height: 402)) == .bar)
    #expect(ChromeLayout(windowSize: CGSize(width: 956, height: 440)) == .bar)
  }

  @Test func `the Duo closed is the bar and open is the overlay sidebar`() {
    #expect(ChromeLayout(windowSize: CGSize(width: 466, height: 678)) == .bar)
    #expect(ChromeLayout(windowSize: CGSize(width: 678, height: 466)) == .bar)
    #expect(ChromeLayout(windowSize: CGSize(width: 669, height: 951)) == .sidebarOverlay)
    #expect(ChromeLayout(windowSize: CGSize(width: 951, height: 669)) == .sidebarDocked)
  }

  @Test func `iPads dock the sidebar unless the window is narrow`() {
    #expect(ChromeLayout(windowSize: CGSize(width: 744, height: 1133)) == .sidebarOverlay)
    #expect(ChromeLayout(windowSize: CGSize(width: 1032, height: 1376)) == .sidebarDocked)
    #expect(ChromeLayout(windowSize: CGSize(width: 1376, height: 1032)) == .sidebarDocked)
    #expect(ChromeLayout(windowSize: CGSize(width: 500, height: 1032)) == .bar)
  }

  @Test func `the thresholds sit at 640 and 820 points of width`() {
    #expect(ChromeLayout(windowSize: CGSize(width: 639.5, height: 900)) == .bar)
    #expect(ChromeLayout(windowSize: CGSize(width: 640, height: 900)) == .sidebarOverlay)
    #expect(ChromeLayout(windowSize: CGSize(width: 819.5, height: 900)) == .sidebarOverlay)
    #expect(ChromeLayout(windowSize: CGSize(width: 820, height: 900)) == .sidebarDocked)
  }

  @Test func `a short window keeps the bar however wide it is`() {
    #expect(ChromeLayout(windowSize: CGSize(width: 1200, height: ChromeLayout.sidebarMinHeight - 1)) == .bar)
    #expect(ChromeLayout(windowSize: CGSize(width: 1200, height: ChromeLayout.sidebarMinHeight)) == .sidebarDocked)
  }

  @Test func `an unmeasured window is the bar`() {
    #expect(ChromeLayout(windowSize: .zero) == .bar)
    #expect(!ChromeLayout.bar.hasSidebar)
    #expect(ChromeLayout.sidebarOverlay.hasSidebar && ChromeLayout.sidebarDocked.hasSidebar)
  }

  @Test func `the demo canvas argument reads width by height`() {
    #expect(CanvasArgument.size("669x951") == CGSize(width: 669, height: 951))
    #expect(CanvasArgument.size("466X678") == CGSize(width: 466, height: 678))
    #expect(CanvasArgument.size("669x") == nil)
    #expect(CanvasArgument.size("0x100") == nil)
    #expect(CanvasArgument.size("-4x100") == nil)
    #expect(CanvasArgument.size("wide") == nil)
  }

  @Test func `the hinge argument names the three states`() {
    #expect(HingeState(rawValue: "closed") == .closed)
    #expect(HingeState(rawValue: "partial") == .partial)
    #expect(HingeState(rawValue: "open") == .open)
    #expect(HingeState(rawValue: "flat") == nil)
  }

  @Test func `only the bar layout has a bottom bar`() {
    #expect(ChromeLayout.bar.hasBottomBar)
    #expect(!ChromeLayout.sidebarOverlay.hasBottomBar)
    #expect(!ChromeLayout.sidebarDocked.hasBottomBar)
    for layout in ChromeLayout.allCases {
      #expect(layout.hasBottomBar == !layout.hasSidebar)
    }
  }
}
