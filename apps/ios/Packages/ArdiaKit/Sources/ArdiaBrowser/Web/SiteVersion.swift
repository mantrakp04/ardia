import WebKit

public enum SiteVersion: String, Sendable, CaseIterable {
  case mobile
  case desktop

  @MainActor public static var current = SiteVersion.mobile

  public init(layoutHasSidebar: Bool) {
    self = layoutHasSidebar ? .desktop : .mobile
  }

  public static func resolved(override: SiteVersion?, current: SiteVersion) -> SiteVersion {
    override ?? current
  }

  public var contentMode: WKWebpagePreferences.ContentMode {
    switch self {
    case .mobile: .mobile
    case .desktop: .desktop
    }
  }

  public var customUserAgent: String? {
    switch self {
    case .mobile: nil
    case .desktop: BrowserUserAgent.desktop
    }
  }
}

#if canImport(UIKit)
public extension WebEngine {
  func adopt(_ version: SiteVersion) {
    SiteVersion.current = version
    for page in livePages {
      guard let webView = page.webView else { continue }
      let agent = page.siteVersion.customUserAgent
      if webView.customUserAgent != agent { webView.customUserAgent = agent }
    }
  }
}

public extension WebTab {
  var siteVersion: SiteVersion {
    SiteVersion.resolved(override: siteVersionOverride, current: SiteVersion.current)
  }

  func setSiteVersionOverride(_ override: SiteVersion?) {
    guard siteVersionOverride != override else { return }
    siteVersionOverride = override
    guard let webView else { return }
    webView.customUserAgent = siteVersion.customUserAgent
    reload()
  }
}
#endif
