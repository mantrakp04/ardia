import ArdiaBrowser
import CryptoKit
import ExpoModulesCore
import Foundation
import Observation
import SwiftData
import UIKit
import WebKit

typealias EventSink = ([String: Any?]) -> Void

@MainActor
final class PhonePages {
  static let shared = PhonePages()

  let engine: WebEngine
  let defaults: UserDefaults
  var pageSink: EventSink?
  var downloadSink: EventSink?
  var blockingSink: EventSink?

  private let container: ModelContainer
  private var tabIDs: [String: UUID] = [:]
  private var pageIDs: [UUID: String] = [:]
  private var watchers: [String: PageWatcher] = [:]
  private var popups: [String: PendingPopup] = [:]
  private var desktopTabs: Set<UUID> = []
  private var finds: [String: PageFind] = [:]
  private var blockingGeneration = 0
  private var shareGeneration = 0

  private struct PendingPopup {
    var tabID: UUID?
    var url: URL?
    var openerID: String
    var isPrivate: Bool
  }

  private init() {
    defaults = UserDefaults(suiteName: "ardia.phone.pages") ?? .standard
    container = (try? BrowserStore.makeContainer(.inMemory)) ?? (try! BrowserStore.makeContainer(.inMemory))
    let tabs = TabStore(context: container.mainContext, defaults: defaults)
    tabs.autoArchiveInterval = .never
    let blocker = ContentBlocker(
      settings: BlockingSettings(defaults: defaults),
      directory: URL.cachesDirectory.appending(path: "Blocking", directoryHint: .isDirectory)
    )
    engine = WebEngine(tabs: tabs, blocker: blocker, preferences: BrowsingPreferences(defaults: defaults))
    engine.openExternalURL = { url in UIApplication.shared.open(url) }
    engine.openUniversalLink = { url in await UIApplication.shared.open(url, options: [.universalLinksOnly: true]) }
    engine.onVisit = { [weak self] tabID, visit in
      guard let self, let pageID = self.pageIDs[tabID] else { return }
      self.send(pageID, "page.visited", ["url": visit.url, "title": visit.title, "kind": PagePayloads.visitKind(visit.kind)])
    }
    engine.onCloseRequested = { [weak self] tabID in
      guard let self, let pageID = self.pageIDs[tabID] else { return }
      self.send(pageID, "page.closeRequested", [:])
    }
    engine.onPopup = { [weak self] opener, popup in self?.popupOpened(from: opener, popup: popup) }
    engine.onOpenLink = { [weak self] url, opener, _ in self?.linkOpened(url, from: opener) }
    engine.onPrivateBrowsingEnded = { [weak self] in self?.privateBrowsingEnded() }
    engine.downloads.onStart = { [weak self] start, webView in self?.downloadStarted(start, in: webView) }
    engine.downloads.onProgress = { [weak self] list in
      self?.downloadSink?(["name": "downloads.progress", "downloads": list.map(PagePayloads.download)])
    }
    engine.downloads.onOutcome = { [weak self] outcome in self?.downloadFinished(outcome) }
    watchBlocking(generation: 0)
    watchShareRequests(generation: 0)
    Task {
      await blocker.prepare()
      await blocker.refreshIfDue()
    }
  }

  var pageIDList: [String] { Array(tabIDs.keys) }

  func page(_ pageID: String) -> WebTab? {
    tabIDs[pageID].flatMap(engine.existingWebTab)
  }

  func require(_ pageID: String) throws -> WebTab {
    guard let page = page(pageID) else { throw PagePayloads.error("ERR_NO_PAGE", "No page is open with id \(pageID)") }
    return page
  }

  func isDesktopSite(_ page: WebTab) -> Bool { desktopTabs.contains(page.id) }

  func faviconURL(_ page: WebTab) -> String? { engine.tabs.tab(page.id)?.faviconURL }

  func state(_ page: WebTab) -> [String: Any] {
    PagePayloads.state(page, faviconURL: faviconURL(page), isDesktopSite: isDesktopSite(page))
  }

  @discardableResult
  func open(_ pageID: String, url: String?, title: String?, isPrivate: Bool, savedState: String?) throws -> WebTab {
    if let existing = page(pageID) { return existing }
    if let tabID = tabIDs[pageID], let page = engine.webTab(for: tabID) {
      watch(pageID, page)
      return page
    }
    let saved = try savedState.map { encoded in
      guard let data = Data(base64Encoded: encoded) else { throw PagePayloads.badArgs("savedState is not base64") }
      return data
    }
    let target = url.flatMap(URL.init(string:)) ?? URL(string: "about:blank")!
    let tab = engine.tabs.open(.url(target, origin: url == nil ? .link : .typed), placement: .end, selecting: false, isPrivate: isPrivate)
    if let title, !title.isEmpty { engine.tabs.update(tab.id, title: title) }
    if let saved { engine.tabs.saveInteractionState(saved, for: tab.id) }
    tabIDs[pageID] = tab.id
    pageIDs[tab.id] = pageID
    guard let page = engine.webTab(for: tab.id) else {
      forget(pageID)
      throw PagePayloads.error("ERR_NO_PAGE", "The page \(pageID) could not be opened")
    }
    watch(pageID, page)
    return page
  }

  func activate(_ pageID: String) -> WebTab? {
    guard let tabID = tabIDs[pageID] else { return nil }
    engine.tabs.select(tabID)
    return engine.webTab(for: tabID)
  }

  func close(_ pageID: String) {
    guard let tabID = tabIDs[pageID] else { return }
    popups = popups.filter { $0.value.openerID != pageID }
    forget(pageID)
    engine.tabs.close(tabID)
  }

  private func forget(_ pageID: String) {
    watchers.removeValue(forKey: pageID)?.stop()
    finds[pageID] = nil
    if let tabID = tabIDs.removeValue(forKey: pageID) {
      pageIDs[tabID] = nil
      desktopTabs.remove(tabID)
    }
  }

  func endPrivateSession() {
    let privateIDs = tabIDs.filter { engine.tabs.isPrivate($0.value) }.map(\.key)
    privateIDs.forEach(forget)
    popups = popups.filter { !$0.value.isPrivate }
    engine.tabs.closeAllPrivate()
  }

  private func privateBrowsingEnded() {
    popups = popups.filter { !$0.value.isPrivate }
    PageSnapshots.endPrivateBrowsing()
    pageSink?(["name": "pages.privateSessionEnded"])
  }

  func saveState(_ pageID: String) -> String? {
    guard let tabID = tabIDs[pageID] else { return nil }
    let live = engine.existingWebTab(tabID)?.webView?.interactionState as? Data
    return (live ?? engine.tabs.tab(tabID)?.interactionState)?.base64EncodedString()
  }

  func setDesktopSite(_ pageID: String, _ enabled: Bool) throws {
    let page = try require(pageID)
    if enabled { desktopTabs.insert(page.id) } else { desktopTabs.remove(page.id) }
    applyUserAgent(page)
    page.reload()
    watchers[pageID]?.resend()
  }

  func applyUserAgent(_ page: WebTab) {
    let agent = desktopTabs.contains(page.id) ? BrowserUserAgent.desktop : nil
    if page.webView?.customUserAgent != agent { page.webView?.customUserAgent = agent }
  }

  func find(_ pageID: String) throws -> PageFind {
    let page = try require(pageID)
    if let find = finds[pageID], find.page === page { return find }
    let find = PageFind(page: page) { [weak self] result in self?.send(pageID, "page.find", ["result": result]) }
    finds[pageID] = find
    return find
  }

  func endFind(_ pageID: String) async {
    guard let find = finds.removeValue(forKey: pageID) else {
      send(pageID, "page.find", ["result": nil])
      return
    }
    await find.end()
  }

  func snapshot(_ pageID: String, maxWidth: Int?, quality: Int?) async throws -> [String: Any]? {
    let page = try require(pageID)
    guard let webView = page.webView, !webView.bounds.isEmpty else { return nil }
    let configuration = WKSnapshotConfiguration()
    configuration.afterScreenUpdates = false
    configuration.snapshotWidth = NSNumber(value: Double(min(CGFloat(maxWidth ?? 600), webView.bounds.width)))
    guard let image = try? await webView.takeSnapshot(configuration: configuration) else { return nil }
    return await PageSnapshots.write(pageID, image: image, isPrivate: page.isPrivate, quality: quality ?? 82)
  }

  func answer(_ pageID: String, requestID: String, answer: PageRequest.Answer?) -> Bool {
    guard let page = page(pageID), let request = page.request, request.id.uuidString == requestID, !request.isAnswered, let answer else { return false }
    request.answer(answer)
    if page.request === request { page.request = nil }
    return true
  }

  func openPopup(_ pageID: String, popupID: String) throws -> Bool {
    guard let popup = popups.removeValue(forKey: popupID) else { return false }
    if let tabID = popup.tabID {
      guard engine.tabs.tab(tabID) != nil, let page = engine.webTab(for: tabID) else { return false }
      tabIDs[pageID] = tabID
      pageIDs[tabID] = pageID
      watch(pageID, page)
      return true
    }
    try open(pageID, url: popup.url?.absoluteString, title: nil, isPrivate: popup.isPrivate, savedState: nil)
    return true
  }

  func dismissPopup(_ popupID: String) -> Bool {
    guard let popup = popups.removeValue(forKey: popupID) else { return false }
    if let tabID = popup.tabID { engine.tabs.close(tabID) }
    return true
  }

  private func popupOpened(from opener: WebTab, popup: WebTab) {
    guard let openerID = pageIDs[opener.id] else { return }
    let popupID = UUID().uuidString
    popups[popupID] = PendingPopup(tabID: popup.id, url: popup.url, openerID: openerID, isPrivate: popup.isPrivate)
    send(openerID, "page.popup", ["popupId": popupID, "url": popup.url?.absoluteString, "isUserGesture": true, "isPrivate": popup.isPrivate])
  }

  private func linkOpened(_ url: URL, from opener: UUID) {
    guard let openerID = pageIDs[opener] else { return }
    let popupID = UUID().uuidString
    let isPrivate = engine.tabs.isPrivate(opener)
    popups[popupID] = PendingPopup(tabID: nil, url: url, openerID: openerID, isPrivate: isPrivate)
    send(openerID, "page.popup", ["popupId": popupID, "url": url.absoluteString, "isUserGesture": true, "isPrivate": isPrivate])
  }

  private func downloadStarted(_ start: DownloadStart, in webView: WKWebView?) {
    guard let webView, let entry = tabIDs.first(where: { engine.existingWebTab($0.value)?.webView === webView }) else { return }
    send(entry.key, "page.download", [
      "downloadId": start.id.uuidString,
      "url": start.url?.absoluteString ?? "",
      "fileName": start.fileName,
      "mimeType": start.mimeType,
      "contentLength": start.contentLength.map(Double.init),
      "isPrivate": engine.tabs.isPrivate(entry.value),
    ])
  }

  private func downloadFinished(_ outcome: DownloadOutcome) {
    switch outcome {
    case .finished(let url):
      downloadSink?(["name": "downloads.finished", "fileName": url.lastPathComponent, "uri": url.absoluteString, "failure": nil])
    case .failed(let fileName):
      downloadSink?(["name": "downloads.finished", "fileName": fileName, "uri": nil, "failure": "network"])
    }
  }

  private func watch(_ pageID: String, _ page: WebTab) {
    if let watcher = watchers[pageID], watcher.page === page { return }
    watchers[pageID]?.stop()
    watchers[pageID] = PageWatcher(page: page, pages: self) { [weak self] name, fields in self?.send(pageID, name, fields) }
  }

  func send(_ pageID: String, _ name: String, _ fields: [String: Any?]) {
    var event = fields
    event["name"] = name
    event["pageId"] = pageID
    pageSink?(event)
  }

  func blockingState() -> [String: Any?] {
    let blocker = engine.blocker
    let settings = blocker.settings
    let lists = blocker.filterLists
    let status: String
    var failure: String?
    switch blocker.state {
    case .preparing: status = "preparing"
    case .ready: status = "ready"
    case .failed(let message):
      status = "failed"
      failure = message
    }
    return [
      "isEnabled": settings.isOn,
      "blocksAds": settings.blocksAds,
      "blocksTrackers": settings.blocksTrackers,
      "hidesCookieBanners": settings.hidesCookieBanners,
      "exemptHosts": settings.exemptHosts.sorted(),
      "status": status,
      "failure": failure,
      "isUpdating": lists.isUpdating,
      "isOffline": lists.isOffline,
      "lastUpdated": lists.lastUpdated.map { $0.timeIntervalSince1970 * 1000 },
      "enabledRuleCount": lists.enabledRuleCount,
      "buildError": lists.buildError,
      "myFilters": lists.myFilters,
      "myFiltersRuleCount": lists.myFiltersResult.ruleCount,
      "myFiltersSkippedCount": lists.myFiltersResult.skippedCount,
      "lists": lists.lists.map(Self.filterList),
    ]
  }

  private static func filterList(_ list: FilterListInfo) -> [String: Any?] {
    var state = "ready"
    var failure: String?
    switch list.state {
    case .ready: state = "ready"
    case .downloading: state = "downloading"
    case .compiling: state = "compiling"
    case .offline: state = "offline"
    case .failed(let message):
      state = "failed"
      failure = message
    }
    return [
      "id": list.id,
      "title": list.title,
      "group": list.group.title,
      "category": list.category.rawValue,
      "sourceUrl": list.sourceURL?.absoluteString,
      "supportUrl": list.supportURL?.absoluteString,
      "languages": list.languages,
      "isEnabled": list.isEnabled,
      "isDefault": list.isDefault,
      "isCustom": list.isCustom,
      "ruleCount": list.ruleCount,
      "skippedCount": list.skippedCount,
      "updatedAt": list.updatedAt.map { $0.timeIntervalSince1970 * 1000 },
      "state": state,
      "failure": failure,
    ]
  }

  private func watchBlocking(generation: Int) {
    let state = withObservationTracking {
      blockingState()
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self, self.blockingGeneration == generation else { return }
        self.blockingGeneration += 1
        self.watchBlocking(generation: self.blockingGeneration)
      }
    }
    if generation > 0 { blockingSink?(["name": "blocking.state", "state": state]) }
  }

  private func watchShareRequests(generation: Int) {
    let request = withObservationTracking {
      engine.shareRequest
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self, self.shareGeneration == generation else { return }
        self.shareGeneration += 1
        self.watchShareRequests(generation: self.shareGeneration)
      }
    }
    guard let request else { return }
    engine.shareRequest = nil
    Self.present(UIActivityViewController(activityItems: [request], applicationActivities: nil))
  }

  static func present(_ controller: UIViewController) {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    guard var top = scenes.flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController else { return }
    while let presented = top.presentedViewController { top = presented }
    top.present(controller, animated: true)
  }
}

@MainActor
final class PageWatcher {
  let page: WebTab
  private weak var pages: PhonePages?
  private let send: (String, [String: Any?]) -> Void
  private var generation = 0
  private var sentState: NSDictionary?
  private var sentRequest: UUID?
  private var observedWebView: ObjectIdentifier?
  private var fullscreen: NSKeyValueObservation?
  private var isFullscreen = false

  init(page: WebTab, pages: PhonePages, send: @escaping (String, [String: Any?]) -> Void) {
    self.page = page
    self.pages = pages
    self.send = send
    observe(generation: 0)
  }

  func stop() {
    generation += 1
    fullscreen = nil
  }

  func resend() {
    sentState = nil
    emit()
  }

  private func observe(generation: Int) {
    withObservationTracking {
      emit()
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self, self.generation == generation else { return }
        self.generation += 1
        self.observe(generation: self.generation)
      }
    }
  }

  private func emit() {
    guard let pages else { return }
    let webView = page.webView
    let identity = webView.map(ObjectIdentifier.init)
    if identity != observedWebView {
      observedWebView = identity
      if let webView {
        pages.applyUserAgent(page)
        webView.isInspectable = pages.engine.isInspectable
        fullscreen = webView.observe(\.fullscreenState, options: [.new]) { [weak self] view, _ in
          MainActor.assumeIsolated { self?.fullscreenChanged(view.fullscreenState) }
        }
      } else {
        fullscreen = nil
      }
    }
    let state = pages.state(page)
    let comparable = state as NSDictionary
    if comparable != sentState {
      sentState = comparable
      send("page.state", ["state": state])
    }
    let request = page.request.flatMap { $0.isAnswered ? nil : $0 }
    if request?.id != sentRequest {
      sentRequest = request?.id
      send("page.request", ["request": request.map(PagePayloads.request)])
    }
  }

  private func fullscreenChanged(_ state: WKWebView.FullscreenState) {
    let now = state == .enteringFullscreen || state == .inFullscreen
    guard now != isFullscreen else { return }
    isFullscreen = now
    send("page.fullscreen", ["isFullscreen": now])
  }
}

@MainActor
final class PageFind {
  let page: WebTab
  private let report: ([String: Any]?) -> Void
  private var query = ""
  private var total = 0
  private var index = 0

  init(page: WebTab, report: @escaping ([String: Any]?) -> Void) {
    self.page = page
    self.report = report
  }

  func start(_ text: String) async {
    query = text
    index = 0
    total = 0
    guard let webView = page.webView, !text.isEmpty else {
      send()
      return
    }
    _ = try? await webView.callAsyncJavaScript("window.getSelection().removeAllRanges()", arguments: [:], in: nil, contentWorld: .defaultClient)
    let counted = try? await webView.callAsyncJavaScript(Self.countScript, arguments: ["query": text], in: nil, contentWorld: .defaultClient)
    let found = await search(webView, backwards: false)
    total = found ? max((counted as? NSNumber)?.intValue ?? 1, 1) : 0
    send()
  }

  func step(backwards: Bool) async {
    guard let webView = page.webView, !query.isEmpty, total > 0 else {
      send()
      return
    }
    guard await search(webView, backwards: backwards) else { return send() }
    index = backwards ? (index - 1 + total) % total : (index + 1) % total
    send()
  }

  func end() async {
    if let webView = page.webView {
      _ = try? await webView.callAsyncJavaScript("window.getSelection().removeAllRanges()", arguments: [:], in: nil, contentWorld: .defaultClient)
    }
    report(nil)
  }

  private func search(_ webView: WKWebView, backwards: Bool) async -> Bool {
    let configuration = WKFindConfiguration()
    configuration.backwards = backwards
    configuration.caseSensitive = false
    configuration.wraps = true
    return await withCheckedContinuation { continuation in
      webView.find(query, configuration: configuration) { result in continuation.resume(returning: result.matchFound) }
    }
  }

  private func send() {
    report(["query": query, "activeIndex": total == 0 ? 0 : index, "total": total, "isDone": true])
  }

  private static let countScript = """
  const needle = query.toLocaleLowerCase();
  const text = (document.body ? document.body.innerText : "").toLocaleLowerCase();
  let count = 0;
  for (let at = text.indexOf(needle); needle && at !== -1; at = text.indexOf(needle, at + needle.length)) count++;
  return count;
  """
}

enum PageSnapshots {
  static var saved: URL { URL.applicationSupportDirectory.appending(path: "PageSnapshots", directoryHint: .isDirectory) }
  static var privateFolder: URL { URL.cachesDirectory.appending(path: "PrivatePageSnapshots", directoryHint: .isDirectory) }

  static func write(_ pageID: String, image: UIImage, isPrivate: Bool, quality: Int) async -> [String: Any]? {
    let folder = isPrivate ? privateFolder : saved
    let stem = fileStem(pageID)
    let width = Int((image.size.width * image.scale).rounded())
    let height = Int((image.size.height * image.scale).rounded())
    guard let data = image.jpegData(compressionQuality: CGFloat(min(max(quality, 1), 100)) / 100) else { return nil }
    let stamp = Int(Date.now.timeIntervalSince1970 * 1000)
    return await Task.detached(priority: .utility) { () -> [String: Any]? in
      let manager = FileManager.default
      guard (try? manager.createDirectory(at: folder, withIntermediateDirectories: true)) != nil else { return nil }
      let target = folder.appending(path: "\(stem)-\(stamp).jpg")
      guard (try? data.write(to: target, options: .atomic)) != nil else { return nil }
      for old in older(in: folder, stem: stem) where old != target { try? manager.removeItem(at: old) }
      return ["path": target.path(percentEncoded: false), "uri": target.absoluteString, "width": width, "height": height]
    }.value
  }

  static func delete(_ pageID: String) {
    let stem = fileStem(pageID)
    for folder in [saved, privateFolder] {
      for file in older(in: folder, stem: stem) { try? FileManager.default.removeItem(at: file) }
    }
  }

  static func endPrivateBrowsing() {
    try? FileManager.default.removeItem(at: privateFolder)
  }

  private static func older(in folder: URL, stem: String) -> [URL] {
    let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
    return files.filter { $0.lastPathComponent.hasPrefix("\(stem)-") && $0.pathExtension == "jpg" }
  }

  static func fileStem(_ pageID: String) -> String {
    if pageID.count <= 64, pageID.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") }) { return pageID }
    return SHA256.hash(data: Data(pageID.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
  }
}
