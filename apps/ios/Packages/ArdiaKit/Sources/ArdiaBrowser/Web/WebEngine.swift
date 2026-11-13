#if canImport(UIKit)
import Foundation
import Observation
import UIKit
import WebKit

@MainActor
@Observable
public final class WebEngine {
  public static let liveLimit = 6

  public let tabs: TabStore
  public let blocker: ContentBlocker
  public let downloads: DownloadManager
  public let snapshots: TabSnapshotStore
  public var shareRequest: URL?
  public var isInspectable = false
  @ObservationIgnored public var openExternalURL: (@MainActor (URL) -> Void)?

  @ObservationIgnored private var sessionGrants: [String: Set<SitePermission>] = [:]
  @ObservationIgnored private var privateGrants: [String: Set<SitePermission>] = [:]
  @ObservationIgnored private var permissionUse = SitePermissionUse()
  @ObservationIgnored private(set) var privateSession = 0
  @ObservationIgnored private let roster = LivePageRoster<WebTab>(limit: WebEngine.liveLimit)
  @ObservationIgnored private var notificationTasks: [Task<Void, Never>] = []

  @ObservationIgnored public var openUniversalLink: (@MainActor (URL) async -> Bool)?
  @ObservationIgnored public var omnibox: Omnibox?
  @ObservationIgnored private let pageScriptControllers = NSHashTable<WKUserContentController>.weakObjects()
  @ObservationIgnored private var sharedPrivateDataStore: WKWebsiteDataStore?
  @ObservationIgnored private var backgroundDownloader: WKWebView?

  public let preferences: BrowsingPreferences

  public init(tabs: TabStore, blocker: ContentBlocker, preferences: BrowsingPreferences, downloads: DownloadManager? = nil, snapshots: TabSnapshotStore = TabSnapshotStore()) {
    self.tabs = tabs
    self.blocker = blocker
    self.preferences = preferences
    self.downloads = downloads ?? DownloadManager.forStore(tabs.context)
    self.snapshots = snapshots
    self.downloads.startDownload = { [weak self] url in self?.startDownload(url) }
    preferences.onNightShadeChange = { [weak self] in self?.broadcastNightShade() }
    preferences.onSwipeNavigationChange = { [weak self] in self?.applySwipeNavigationPreference() }
    tabs.onTabsArchived = { [weak self] ids in
      for id in ids { self?.roster.remove(id) }
    }
    tabs.onPrivateTabsClosed = { [weak self] ids, noneLeft in
      guard let self else { return }
      for id in ids { roster.remove(id) }
      snapshots.remove(ids.map { "memory-\($0.uuidString)" })
      if noneLeft { endPrivateBrowsing() }
    }
    tabs.onTabsRemoved = { [weak self] removed in
      guard let self else { return }
      for tab in removed { roster.remove(tab.id) }
      snapshots.removeTabs(removed.map(\.id))
    }
    observeSystem()
  }

  public func webTab(for id: UUID) -> WebTab? {
    guard let tab = tabs.tab(id), !tab.isArchived else { return nil }
    let page = roster.page(id) ?? {
      let page = WebTab(id: id, engine: self, url: URL(string: tab.url))
      roster.register(page, for: id)
      return page
    }()
    roster.activate(id)
    return page
  }

  public func existingWebTab(_ id: UUID) -> WebTab? {
    roster.page(id)
  }

  var livePages: [WebTab] {
    roster.liveIDs.compactMap { roster.page($0) }
  }

  public func openLink(_ url: URL, from tabID: UUID, inBackground: Bool) {
    let tab = tabs.open(.url(url, origin: .link), placement: .after(tabID), selecting: !inBackground)
    if !inBackground { _ = webTab(for: tab.id) }
  }

  public func download(_ url: URL, from tabID: UUID) {
    guard let webView = roster.page(tabID)?.webView else { return }
    webView.startDownload(using: URLRequest(url: url)) { [weak self] download in
      self?.downloads.track(download)
    }
  }

  public func startDownload(_ url: URL) {
    let page = roster.liveIDs.lazy.compactMap { self.roster.page($0) }.first { !$0.isPrivate && $0.webView != nil }
    let webView = page?.webView ?? downloaderWebView()
    webView.startDownload(using: URLRequest(url: url)) { [weak self] download in
      self?.downloads.track(download)
    }
  }

  private func downloaderWebView() -> WKWebView {
    if let backgroundDownloader { return backgroundDownloader }
    let webView = WKWebView(frame: .zero, configuration: WebTab.makeConfiguration(dataStore: .default()))
    backgroundDownloader = webView
    return webView
  }

  public func copyLink(_ url: URL) {
    Task {
      let clean = await omnibox?.cleanURL(url) ?? url
      UIPasteboard.general.url = clean
    }
  }

  public func share(_ url: URL) {
    Task {
      shareRequest = await omnibox?.cleanURL(url) ?? url
    }
  }

  private func applySwipeNavigationPreference() {
    for id in roster.liveIDs { roster.page(id)?.applySwipeNavigation(preferences.swipeNavigation) }
  }

  func privateDataStore() -> WKWebsiteDataStore {
    if let sharedPrivateDataStore { return sharedPrivateDataStore }
    let store = WKWebsiteDataStore.nonPersistent()
    sharedPrivateDataStore = store
    return store
  }

  func allows(_ permissions: Set<SitePermission>, origin: WKSecurityOrigin, page: WebTab) -> Bool {
    guard isGranted(permissions, origin: origin, isPrivate: page.isPrivate) else { return false }
    noteUse(permissions, origin: origin, page: page)
    return true
  }

  func isGranted(_ permissions: Set<SitePermission>, origin: WKSecurityOrigin, isPrivate: Bool) -> Bool {
    switch SitePermissionMemory(scheme: origin.protocol, isPrivate: isPrivate) {
    case .saved: preferences.isGranted(permissions, host: Self.siteKey(origin))
    case .session: permissions.isSubset(of: sessionGrants[Self.originKey(origin)] ?? [])
    case .privateSession: permissions.isSubset(of: privateGrants[Self.originKey(origin)] ?? [])
    }
  }

  func grant(_ permissions: Set<SitePermission>, origin: WKSecurityOrigin, page: WebTab, session: Int) {
    let key = Self.originKey(origin)
    switch SitePermissionMemory(scheme: origin.protocol, isPrivate: page.isPrivate) {
    case .saved:
      preferences.grant(permissions, host: Self.siteKey(origin))
      noteUse(permissions, origin: origin, page: page)
    case .session:
      sessionGrants[key, default: []].formUnion(permissions)
    case .privateSession:
      guard session == privateSession else { return }
      privateGrants[key, default: []].formUnion(permissions)
    }
  }

  public func revoke(_ permissions: Set<SitePermission>, host: String) {
    preferences.revoke(permissions, host: host)
    let site = BlockingSettings.normalize(host)
    let users = permissionUse.tabs(using: permissions, site: site)
    for id in roster.liveIDs {
      guard let page = roster.page(id), !page.isPrivate, let webView = page.webView else { continue }
      let topLevel = page.url.map { SitePermissionSite.key(host: $0.host() ?? "", port: $0.port ?? 0) }
      guard users.contains(id) || topLevel == site else { continue }
      if permissions.contains(.camera) { webView.setCameraCaptureState(.none) }
      if permissions.contains(.microphone) { webView.setMicrophoneCaptureState(.none) }
      permissionUse = permissionUse.forgetting(tab: id)
      page.reload()
    }
  }

  func pageCommitted(_ id: UUID) {
    permissionUse = permissionUse.forgetting(tab: id)
  }

  private func noteUse(_ permissions: Set<SitePermission>, origin: WKSecurityOrigin, page: WebTab) {
    guard SitePermissionMemory(scheme: origin.protocol, isPrivate: page.isPrivate) == .saved else { return }
    permissionUse = permissionUse.recording(permissions, site: Self.siteKey(origin), tab: page.id)
  }

  private static func siteKey(_ origin: WKSecurityOrigin) -> String {
    SitePermissionSite.key(host: origin.host, port: origin.port)
  }

  private static func originKey(_ origin: WKSecurityOrigin) -> String {
    "\(origin.protocol)://\(origin.host):\(origin.port)"
  }

  private func endPrivateBrowsing() {
    privateGrants.removeAll()
    downloads.endPrivateBrowsing()
    privateSession += 1
    preferences.endPrivateBrowsing()
    blocker.settings.endPrivateBrowsing()
    guard let store = sharedPrivateDataStore else { return }
    sharedPrivateDataStore = nil
    Task { await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) }
  }

  func installPageScripts(on controller: WKUserContentController) {
    guard !pageScriptControllers.contains(controller) else { return }
    pageScriptControllers.add(controller)
    controller.addScriptMessageHandler(PageMessageProxy(engine: self), contentWorld: ReadableContent.world, name: PageScripts.handlerName)
    controller.addUserScript(WKUserScript(source: PageScripts.nightShade, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: ReadableContent.world))
  }

  private func broadcastNightShade() {
    for id in roster.liveIDs {
      guard let page = roster.page(id) else { continue }
      page.applyNightShade(preferences.nightShade(for: page.host, isPrivate: page.isPrivate))
    }
  }

  public func discardBackgroundTabs() {
    roster.discardAll(except: tabs.selectedTabID)
  }

  public func saveAll() {
    for id in roster.liveIDs { roster.page(id)?.saveState() }
  }

  func openPopup(from opener: WebTab, url: URL, configuration: WKWebViewConfiguration) -> WKWebView? {
    let tab = tabs.open(.url(url, origin: .link), placement: .after(opener.id), selecting: true)
    let page = WebTab(id: tab.id, engine: self, url: url, popupConfiguration: configuration)
    page.siteVersionOverride = opener.siteVersionOverride
    roster.register(page, for: tab.id)
    roster.activate(tab.id)
    return page.webView
  }

  private func observeSystem() {
    let center = NotificationCenter.default
    notificationTasks.append(Task { [weak self] in
      for await _ in center.notifications(named: UIApplication.didReceiveMemoryWarningNotification).map({ _ in () }) {
        self?.discardBackgroundTabs()
      }
    })
  }

  isolated deinit {
    notificationTasks.forEach { $0.cancel() }
  }
}

@MainActor
final class PageMessageProxy: NSObject, WKScriptMessageHandlerWithReply {
  weak var engine: WebEngine?

  init(engine: WebEngine) {
    self.engine = engine
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
    guard let engine, let body = message.body as? [String: Any], body["type"] as? String == "nightShade" else { return (nil, nil) }
    return (engine.preferences.nightShade(for: message.webView?.url?.host(), isPrivate: message.isFromPrivatePage).rawValue, nil)
  }
}
#endif
