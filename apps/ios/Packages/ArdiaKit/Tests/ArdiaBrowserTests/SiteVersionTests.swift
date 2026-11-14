import ArdiaBrowser
import Testing
import WebKit

struct SiteVersionTests {
  @Test func `sidebar layouts ask for desktop sites and the bar layout keeps mobile ones`() {
    #expect(SiteVersion(layoutHasSidebar: true) == .desktop)
    #expect(SiteVersion(layoutHasSidebar: false) == .mobile)
  }

  @Test func `mobile pages keep WebKit's own agent, named with the Mobile token, and mobile content`() {
    #expect(SiteVersion.mobile.customUserAgent == nil)
    #expect(BrowserUserAgent.applicationName.contains("Mobile/"))
    #expect(SiteVersion.mobile.contentMode == .mobile)
  }

  @Test func `desktop pages send a Mac Safari agent with no Mobile token and desktop content`() throws {
    let agent = try #require(SiteVersion.desktop.customUserAgent)
    #expect(agent.contains("Macintosh"))
    #expect(agent.contains("Safari/"))
    #expect(!agent.contains("Mobile"))
    #expect(SiteVersion.desktop.contentMode == .desktop)
  }

  @Test func `a page's own Desktop Site choice wins over the layout's version`() {
    #expect(SiteVersion.resolved(override: nil, current: .mobile) == .mobile)
    #expect(SiteVersion.resolved(override: nil, current: .desktop) == .desktop)
    #expect(SiteVersion.resolved(override: .desktop, current: .mobile) == .desktop)
    #expect(SiteVersion.resolved(override: .mobile, current: .desktop) == .mobile)
  }

  @Test func `a page's agent and content mode always come from the same version`() {
    for override in [nil, SiteVersion.mobile, SiteVersion.desktop] {
      for current in SiteVersion.allCases {
        let version = SiteVersion.resolved(override: override, current: current)
        #expect((version.customUserAgent != nil) == (version.contentMode == .desktop))
      }
    }
  }
}
