import ArdiaBrowser
import ArdiaDesign
import CoreGraphics
import Testing

struct SiteVersionLayoutTests {
  static let barWindows: [CGSize] = [
    CGSize(width: 466, height: 678),
    CGSize(width: 375, height: 1_024),
    CGSize(width: 507, height: 1_366),
    CGSize(width: 639, height: 951),
    CGSize(width: 1_366, height: 480),
  ]

  @Test(arguments: barWindows)
  func `every bar window asks for mobile sites, whatever device it runs on`(window: CGSize) {
    let layout = ChromeLayout(windowSize: window)
    #expect(layout == .bar)
    let version = SiteVersion(layout: layout)
    #expect(version == .mobile)
    #expect(version.contentMode == .mobile)
    #expect(version.contentMode != .recommended)
    #expect(version.customUserAgent == nil)
  }

  @Test func `sidebar windows ask for desktop sites`() {
    #expect(SiteVersion(layout: ChromeLayout(windowSize: CGSize(width: 669, height: 951))) == .desktop)
    #expect(SiteVersion(layout: ChromeLayout(windowSize: CGSize(width: 1_032, height: 1_376))) == .desktop)
  }
}
