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

  @ObservationIgnored var grantedCapture: Set<String> = []
  @ObservationIgnored private let roster = LivePageRoster<WebTab>(limit: WebEngine.liveLimit)
  @ObservationIgnored private var notificationTasks: [Task<Void, Never>] = []

  @ObservationIgnored public var openUniversalLink: (@MainActor (URL) async -> Bool)?
  @ObservationIgnored public var omnibox: Omnibox?
  @ObservationIgnored private let pageScriptControllers = NSHashTable<WKUserContentController>.weakObjects()
  @ObservationIgnored private var sharedPrivateDataStore: WKWebsiteDataStore?

  public let preferences: BrowsingPreferences

  public init(tabs: TabStore, blocker: ContentBlocker, preferences: BrowsingPreferences, downloads: DownloadManager = DownloadManager(), snapshots: TabSnapshotStore = TabSnapshotStore()) {
    self.tabs = tabs
    self.blocker = blocker
    self.preferences = preferences
    self.downloads = downloads
    self.snapshots = snapshots
    preferences.onNightShadeChange = { [weak self] in self?.broadcastNightShade() }
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
      snapshots.remove(removed.compactMap(\.snapshotFileName))
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

  public var liveTabIDs: [UUID] { roster.liveIDs }

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

  public func applySwipeNavigationPreference() {
    for id in roster.liveIDs { roster.page(id)?.applySwipeNavigation(preferences.swipeNavigation) }
  }

  func privateDataStore() -> WKWebsiteDataStore {
    if let sharedPrivateDataStore { return sharedPrivateDataStore }
    let store = WKWebsiteDataStore.nonPersistent()
    sharedPrivateDataStore = store
    return store
  }

  private func endPrivateBrowsing() {
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
      page.applyNightShade(preferences.nightShade(for: page.host))
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
    notificationTasks.append(Task { [weak self] in
      for await _ in center.notifications(named: UIApplication.didEnterBackgroundNotification).map({ _ in () }) {
        self?.saveAll()
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
    return (engine.preferences.nightShade(for: message.webView?.url?.host()).rawValue, nil)
  }
}
#endif
