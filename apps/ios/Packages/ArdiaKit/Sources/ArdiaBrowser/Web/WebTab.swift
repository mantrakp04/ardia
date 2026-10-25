#if canImport(UIKit)
import Foundation
import Observation
import UIKit
import WebKit

public enum PageSecurity: Sendable, Equatable {
  case none
  case secure
  case mixed
  case insecure
}

public enum PageLoadFailure: Sendable, Equatable {
  case crashed
  case network(title: String, message: String)
}

@MainActor
@Observable
public final class WebTab: DiscardablePage, Identifiable {
  public static let zoomLevels: [Double] = [0.5, 0.75, 0.85, 1, 1.15, 1.25, 1.5, 1.75, 2, 2.5, 3]

  public let id: UUID
  public private(set) var webView: WKWebView?
  public private(set) var url: URL?
  public private(set) var title = ""
  public private(set) var progress = 0.0
  public private(set) var isLoading = false
  public private(set) var canGoBack = false
  public private(set) var canGoForward = false
  public private(set) var themeColor: UIColor?
  public private(set) var underPageBackgroundColor: UIColor?
  public private(set) var security: PageSecurity = .none
  public private(set) var scrollDirection: ScrollDirection = .up
  public private(set) var isScrolledToTop = true
  public private(set) var failure: PageLoadFailure?
  public private(set) var pageZoom = 1.0
  public var request: PageRequest?
  public let blockedResources = BlockedResourceCounter()

  public var isLive: Bool { webView != nil }
  public let isPrivate: Bool
  public var host: String? { url.flatMap { BrowserURL.host(of: $0.absoluteString) } }

  @ObservationIgnored weak var engine: WebEngine?
  @ObservationIgnored private var popupConfiguration: WKWebViewConfiguration?
  @ObservationIgnored private var coordinator: WebTabCoordinator?
  @ObservationIgnored private var observations: [NSKeyValueObservation] = []
  @ObservationIgnored private var progressThrottle = ProgressThrottle()
  @ObservationIgnored private var scrollTracker = ScrollDirectionTracker()
  @ObservationIgnored private var pendingNavigationType: WKNavigationType?
  @ObservationIgnored private var restoringState = false
  @ObservationIgnored private var lastVisit: Visit?
  @ObservationIgnored private var lastCommit = Date.distantPast
  @ObservationIgnored private var crashReloads = 0
  @ObservationIgnored private var snapshotTask: Task<Void, Never>?
  @ObservationIgnored private var pendingURL: URL?
  @ObservationIgnored private var swipeSnapshots: [ObjectIdentifier: UIImage] = [:]
  @ObservationIgnored private var swipeSnapshotOrder: [ObjectIdentifier] = []

  init(id: UUID, engine: WebEngine, url: URL?, popupConfiguration: WKWebViewConfiguration? = nil) {
    self.id = id
    self.engine = engine
    self.url = url
    self.popupConfiguration = popupConfiguration
    self.isPrivate = engine.tabs.isPrivate(id)
    if let tab = engine.tabs.tab(id) { title = tab.title }
  }

  public func load(_ url: URL) {
    failure = nil
    guard let webView else {
      pendingURL = url
      self.url = url
      return
    }
    webView.load(URLRequest(url: url))
  }

  public func snapshotForSwipe(_ direction: SwipeNavigationDirection) -> UIImage? {
    guard let list = webView?.backForwardList else { return nil }
    let item = direction == .back ? list.backItem : list.forwardItem
    return item.flatMap { swipeSnapshots[ObjectIdentifier($0)] }
  }

  public var blockersEnabled: Bool {
    !(engine?.blocker.settings.isExempt(host) ?? false)
  }

  @discardableResult
  public func setBlockersEnabled(_ enabled: Bool) -> String? {
    guard let engine, let host else { return nil }
    engine.blocker.settings.setExempt(host, !enabled)
    if let controller = webView?.configuration.userContentController {
      engine.blocker.prepareNavigation(of: controller, toHost: host)
    }
    reload()
    return enabled ? String(localized: "Blockers enabled for \(host)") : String(localized: "Blockers disabled for \(host)")
  }

  func applyNightShade(_ mode: NightShadeMode) {
    webView?.evaluateJavaScript("window.__ardiaNightShade && window.__ardiaNightShade(\"\(mode.rawValue)\")", in: nil, in: ReadableContent.world)
  }

  func applySwipeNavigation(_ mode: SwipeNavigationMode) {
    webView?.allowsBackForwardNavigationGestures = mode == .screenEdges
  }

  private func rememberSwipeSnapshot() {
    guard let webView, webView.window != nil, let item = webView.backForwardList.currentItem else { return }
    let key = ObjectIdentifier(item)
    let configuration = WKSnapshotConfiguration()
    configuration.afterScreenUpdates = false
    webView.takeSnapshot(with: configuration) { [weak self] image, _ in
      MainActor.assumeIsolated {
        guard let self, let image else { return }
        self.swipeSnapshots[key] = image
        self.swipeSnapshotOrder.removeAll { $0 == key }
        self.swipeSnapshotOrder.append(key)
        while self.swipeSnapshotOrder.count > 8 { self.swipeSnapshots[self.swipeSnapshotOrder.removeFirst()] = nil }
      }
    }
  }

  public func goBack() {
    failure = nil
    webView?.goBack()
  }

  public func goForward() {
    failure = nil
    webView?.goForward()
  }

  public func reload() {
    failure = nil
    crashReloads = 0
    guard let webView else { return }
    if webView.url == nil, let url { webView.load(URLRequest(url: url)) } else { webView.reload() }
  }

  public func stopLoading() {
    webView?.stopLoading()
  }

  public func presentFindInPage() {
    webView?.findInteraction?.presentFindNavigator(showingReplace: false)
  }

  public func setPageZoom(_ zoom: Double) {
    let clamped = min(max(zoom, Self.zoomLevels.first!), Self.zoomLevels.last!)
    pageZoom = clamped
    webView?.pageZoom = clamped
    if let host { engine?.preferences.update(host) { $0.pageZoom = clamped == 1 ? nil : clamped } }
  }

  public func zoomIn() {
    if let next = Self.zoomLevels.first(where: { $0 > pageZoom + 0.001 }) { setPageZoom(next) }
  }

  public func zoomOut() {
    if let next = Self.zoomLevels.last(where: { $0 < pageZoom - 0.001 }) { setPageZoom(next) }
  }

  public func readableContent() async throws -> ReadableContent {
    guard let webView else { throw ReadableContentError.pageNotLoaded }
    let raw = try await webView.callAsyncJavaScript(ReadableContent.script, arguments: [:], in: nil, contentWorld: ReadableContent.world)
    guard let json = raw as? String, let data = json.data(using: .utf8) else { throw ReadableContentError.notReadable }
    return try JSONDecoder().decode(ReadableContent.self, from: data)
  }

  public func captureSnapshot() async {
    guard let webView, webView.window != nil, !webView.bounds.isEmpty, let engine, url != nil else { return }
    let configuration = WKSnapshotConfiguration()
    configuration.snapshotWidth = NSNumber(value: Double(min(webView.bounds.width, TabSnapshotStore.pointWidth)))
    configuration.afterScreenUpdates = false
    guard let image = try? await webView.takeSnapshot(configuration: configuration), let cgImage = image.cgImage else { return }
    let tabID = id
    if isPrivate {
      engine.tabs.update(tabID, snapshotFileName: engine.snapshots.keepInMemory(cgImage, for: tabID))
      return
    }
    if let name = await engine.snapshots.save(cgImage, scale: image.scale, for: tabID) {
      engine.tabs.update(tabID, snapshotFileName: name)
    }
  }

  public func makeLive() {
    guard webView == nil, let engine else { return }
    let isPopup = popupConfiguration != nil
    let configuration = popupConfiguration ?? Self.makeConfiguration(dataStore: isPrivate ? engine.privateDataStore() : .default())
    popupConfiguration = nil
    let webView = WKWebView(frame: .zero, configuration: configuration)
    let coordinator = WebTabCoordinator(tab: self)
    self.coordinator = coordinator
    webView.navigationDelegate = coordinator
    webView.uiDelegate = coordinator
    webView.scrollView.delegate = coordinator
    webView.allowsBackForwardNavigationGestures = engine.preferences.swipeNavigation == .screenEdges
    webView.allowsLinkPreview = true
    webView.isFindInteractionEnabled = true
    webView.scrollView.contentInsetAdjustmentBehavior = .automatic
    webView.isInspectable = engine.isInspectable
    engine.blocker.install(on: configuration.userContentController, counter: blockedResources)
    engine.installPageScripts(on: configuration.userContentController)
    self.webView = webView
    observe(webView)
    let stored = engine.tabs.tab(id)
    if let zoom = engine.preferences.settings(for: host).pageZoom {
      pageZoom = zoom
      webView.pageZoom = zoom
    }
    if isPopup {
      return
    } else if let pendingURL {
      self.pendingURL = nil
      webView.load(URLRequest(url: pendingURL))
    } else if let state = stored?.interactionState {
      restoringState = true
      webView.interactionState = state
    } else if let url, url.scheme != BrowserURL.browseScheme {
      webView.load(URLRequest(url: url))
    }
  }

  public func discard() {
    guard let webView else { return }
    saveState()
    snapshotTask?.cancel()
    snapshotTask = nil
    swipeSnapshots = [:]
    observations.forEach { $0.invalidate() }
    observations = []
    webView.stopLoading()
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    webView.scrollView.delegate = nil
    webView.removeFromSuperview()
    request?.dismiss()
    request = nil
    coordinator = nil
    self.webView = nil
    isLoading = false
    progress = 0
  }

  func saveState() {
    guard let webView, let engine else { return }
    engine.tabs.saveInteractionState(webView.interactionState as? Data, for: id)
  }

  static func makeConfiguration(dataStore: WKWebsiteDataStore) -> WKWebViewConfiguration {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = dataStore
    configuration.userContentController = WKUserContentController()
    configuration.applicationNameForUserAgent = BrowserUserAgent.applicationName
    configuration.defaultWebpagePreferences.preferredContentMode = .mobile
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.allowsInlineMediaPlayback = true
    configuration.allowsPictureInPictureMediaPlayback = true
    configuration.allowsAirPlayForMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = .audio
    configuration.upgradeKnownHostsToHTTPS = true
    configuration.preferences.isFraudulentWebsiteWarningEnabled = true
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    configuration.dataDetectorTypes = [.phoneNumber, .address, .calendarEvent, .trackingNumber, .flightNumber]
    return configuration
  }

  private func observe(_ webView: WKWebView) {
    func watch<Value>(_ keyPath: KeyPath<WKWebView, Value>, _ update: @escaping @MainActor (WebTab, WKWebView) -> Void) {
      observations.append(webView.observe(keyPath, options: [.initial, .new]) { [weak self] view, _ in
        MainActor.assumeIsolated {
          guard let self else { return }
          update(self, view)
        }
      })
    }
    watch(\.url) { tab, view in tab.urlChanged(view.url) }
    watch(\.title) { tab, view in tab.titleChanged(view.title ?? "") }
    watch(\.estimatedProgress) { tab, view in
      if let value = tab.progressThrottle.offer(view.estimatedProgress, at: .now) { tab.progress = value }
    }
    watch(\.isLoading) { tab, view in
      if tab.isLoading != view.isLoading { tab.isLoading = view.isLoading }
      if !view.isLoading { tab.progressThrottle.reset(); tab.progress = 0 }
    }
    watch(\.canGoBack) { tab, view in if tab.canGoBack != view.canGoBack { tab.canGoBack = view.canGoBack } }
    watch(\.canGoForward) { tab, view in if tab.canGoForward != view.canGoForward { tab.canGoForward = view.canGoForward } }
    watch(\.themeColor) { tab, view in tab.colorsChanged(theme: view.themeColor, underPage: view.underPageBackgroundColor) }
    watch(\.underPageBackgroundColor) { tab, view in tab.colorsChanged(theme: view.themeColor, underPage: view.underPageBackgroundColor) }
    watch(\.hasOnlySecureContent) { tab, view in tab.securityChanged(view) }
  }

  private func urlChanged(_ newURL: URL?) {
    guard let newURL, newURL != url else { return }
    let previous = url
    url = newURL
    if let webView { securityChanged(webView) }
    engine?.tabs.update(id, url: newURL.absoluteString)
    let sameDocument = !(webView?.isLoading ?? false) && previous != nil
    if sameDocument, let previous, Self.withoutFragment(previous) != Self.withoutFragment(newURL) {
      lastVisit = engine?.tabs.recordVisit(url: newURL.absoluteString, title: title, transition: .link, fromTab: id)
    }
  }

  private func titleChanged(_ newTitle: String) {
    guard !newTitle.isEmpty, newTitle != title else { return }
    title = newTitle
    engine?.tabs.update(id, title: newTitle)
    if let lastVisit, lastVisit.url == url?.absoluteString { engine?.tabs.amend(lastVisit, title: newTitle) }
  }

  private func colorsChanged(theme: UIColor?, underPage: UIColor?) {
    if themeColor != theme { themeColor = theme }
    if underPageBackgroundColor != underPage { underPageBackgroundColor = underPage }
    if let hex = (theme ?? underPage)?.hexString { engine?.tabs.update(id, themeColorHex: hex) }
  }

  private func securityChanged(_ webView: WKWebView) {
    let next: PageSecurity
    switch webView.url?.scheme?.lowercased() {
    case "https": next = webView.hasOnlySecureContent ? .secure : .mixed
    case "http": next = .insecure
    default: next = .none
    }
    if security != next { security = next }
  }

  fileprivate func decidePolicy(for action: WKNavigationAction, preferences: WKWebpagePreferences) -> WKNavigationActionPolicy {
    guard let target = action.request.url else { return .cancel }
    let isMainFrame = action.targetFrame?.isMainFrame ?? true
    if action.shouldPerformDownload { return .download }
    switch ExternalLinks.route(target, isMainFrame: isMainFrame) {
    case .blocked:
      return .cancel
    case .external(let app):
      if action.navigationType == .other && !isMainFrame { return .cancel }
      askToOpenExternal(target, app: app)
      return .cancel
    case .web:
      break
    }
    if isMainFrame, action.targetFrame != nil {
      pendingNavigationType = action.navigationType
      if action.navigationType != .reload { rememberSwipeSnapshot() }
      let targetHost = BrowserURL.host(of: target.absoluteString)
      if let controller = webView?.configuration.userContentController {
        engine?.blocker.prepareNavigation(of: controller, toHost: targetHost)
      }
      let zoom = engine?.preferences.settings(for: targetHost).pageZoom ?? 1
      if zoom != pageZoom {
        pageZoom = zoom
        webView?.pageZoom = zoom
      }
    }
    return .allow
  }

  fileprivate func decidePolicy(for response: WKNavigationResponse) -> WKNavigationResponsePolicy {
    if !response.canShowMIMEType { return .download }
    if response.isForMainFrame, let http = response.response as? HTTPURLResponse,
       let disposition = http.value(forHTTPHeaderField: "Content-Disposition")?.lowercased(), disposition.hasPrefix("attachment") {
      return .download
    }
    return .allow
  }

  fileprivate func didStartNavigation() {
    failure = nil
  }

  fileprivate func didCommit() {
    blockedResources.reset()
    scrollTracker.reset()
    if scrollDirection != .up { scrollDirection = .up }
    let type = pendingNavigationType
    pendingNavigationType = nil
    let now = Date.now
    defer { lastCommit = now }
    if restoringState {
      restoringState = false
      return
    }
    guard let engine, let committed = webView?.url?.absoluteString else { return }
    if type == .reload { return }
    if type == .other, now.timeIntervalSince(lastCommit) < 1.5, let lastVisit {
      engine.tabs.amend(lastVisit, url: committed)
      return
    }
    let transition: VisitTransition = switch type {
    case .linkActivated: .link
    case .formSubmitted, .formResubmitted: .formSubmit
    case .backForward: .backForward
    case nil: .restored
    default: engine.tabs.tab(id)?.origin == .typed && lastVisit == nil ? .typed : .link
    }
    lastVisit = engine.tabs.recordVisit(url: committed, title: webView?.title ?? "", transition: transition, fromTab: id)
  }

  fileprivate func didFinish() {
    crashReloads = 0
    fetchFavicon()
    scheduleSnapshot()
  }

  fileprivate func didFail(_ error: Error, provisional: Bool) {
    let error = error as NSError
    if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return }
    if error.domain == WKError.errorDomain && error.code == 102 { return }
    if error.domain == "WebKitErrorDomain" && (error.code == 102 || error.code == 204) { return }
    guard provisional else { return }
    failure = .network(title: String(localized: "This Webpage Couldn’t Load"), message: Self.message(for: error))
  }

  fileprivate func processTerminated() {
    if crashReloads == 0 {
      crashReloads += 1
      webView?.reload()
    } else {
      failure = .crashed
    }
  }

  fileprivate func handle(_ request: PageRequest) {
    self.request?.dismiss()
    self.request = request
  }

  fileprivate func handleScroll(_ scrollView: UIScrollView) {
    let offset = scrollView.contentOffset.y + scrollView.adjustedContentInset.top
    let atTop = offset <= 1
    if atTop != isScrolledToTop { isScrolledToTop = atTop }
    guard scrollView.isTracking || scrollView.isDecelerating else { return }
    if let next = scrollTracker.offer(offset: offset, contentHeight: scrollView.contentSize.height, viewportHeight: scrollView.bounds.height - scrollView.adjustedContentInset.top - scrollView.adjustedContentInset.bottom) {
      scrollDirection = next
    }
  }

  fileprivate func scrolledToTop() {
    scrollTracker.reset()
    if scrollDirection != .up { scrollDirection = .up }
  }

  private func askToOpenExternal(_ target: URL, app: ExternalApp) {
    handle(PageRequest(kind: .openExternal(target, app: app), host: host ?? "") { [weak self] answer in
      guard case .accepted = answer else { return }
      self?.engine?.openExternalURL?(target)
    })
  }

  private func scheduleSnapshot() {
    snapshotTask?.cancel()
    guard engine?.tabs.selectedTabID == id else { return }
    snapshotTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(1))
      guard !Task.isCancelled else { return }
      await self?.captureSnapshot()
    }
  }

  private func fetchFavicon() {
    guard let webView, let pageURL = webView.url, pageURL.scheme?.hasPrefix("http") == true else { return }
    let script = """
    const links = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="shortcut icon"]')];
    const scored = links.filter(l => l.href).map(l => {
      const rel = (l.getAttribute('rel') || '').toLowerCase();
      const size = parseInt((l.getAttribute('sizes') || '').split('x')[0], 10) || (rel.includes('apple') ? 180 : 16);
      const svg = (l.getAttribute('type') || '').includes('svg') || l.href.endsWith('.svg');
      return { href: l.href, score: svg ? 0 : Math.abs(96 - size) };
    }).sort((a, b) => a.score - b.score);
    return scored.length ? scored[0].href : null;
    """
    let tabID = id
    Task { [weak self] in
      let found = try? await webView.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: ReadableContent.world)
      guard let self, let engine = self.engine else { return }
      let fallback = URL(string: "/favicon.ico", relativeTo: pageURL)?.absoluteString
      if let icon = (found as? String) ?? fallback { engine.tabs.update(tabID, faviconURL: icon) }
    }
  }

  static func withoutFragment(_ url: URL) -> String {
    let string = url.absoluteString
    return string.firstIndex(of: "#").map { String(string[..<$0]) } ?? string
  }

  static func message(for error: NSError) -> String {
    guard error.domain == NSURLErrorDomain else { return String(localized: "Something went wrong while loading this page. Try again.") }
    switch error.code {
    case NSURLErrorNotConnectedToInternet, NSURLErrorDataNotAllowed:
      return String(localized: "Your iPhone isn’t connected to the internet.")
    case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed:
      return String(localized: "The server can’t be found. Check the address and try again.")
    case NSURLErrorTimedOut:
      return String(localized: "The server took too long to respond. Try again later.")
    case NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost:
      return String(localized: "The server stopped responding. Try again later.")
    case NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateNotYetValid,
         NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorSecureConnectionFailed, NSURLErrorClientCertificateRejected:
      return String(localized: "This connection isn’t private, so the page wasn’t opened.")
    case NSURLErrorAppTransportSecurityRequiresSecureConnection:
      return String(localized: "This page needs a secure connection, and the site doesn’t offer one.")
    default:
      return String(localized: "Something went wrong while loading this page. Try again.")
    }
  }
}

@MainActor
final class WebTabCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, UIScrollViewDelegate {
  weak var tab: WebTab?

  init(tab: WebTab) {
    self.tab = tab
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences) async -> (WKNavigationActionPolicy, WKWebpagePreferences) {
    guard let tab else { return (.cancel, preferences) }
    if let engine = tab.engine, let target = navigationAction.request.url, navigationAction.navigationType == .linkActivated,
       navigationAction.targetFrame?.isMainFrame ?? true, let targetHost = BrowserURL.host(of: target.absoluteString), targetHost != tab.host,
       engine.preferences.appLinks(for: targetHost) == .app, let open = engine.openUniversalLink, await open(target) {
      return (.cancel, preferences)
    }
    return (tab.decidePolicy(for: navigationAction, preferences: preferences), preferences)
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
    tab?.decidePolicy(for: navigationResponse) ?? .cancel
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    tab?.didStartNavigation()
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    tab?.didCommit()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    tab?.didFinish()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
    tab?.didFail(error, provisional: true)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
    tab?.didFail(error, provisional: false)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    tab?.processTerminated()
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    tab?.engine?.downloads.track(download)
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    tab?.engine?.downloads.track(download)
  }

  func webView(_ webView: WKWebView, respondTo challenge: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
    let method = challenge.protectionSpace.authenticationMethod
    guard let tab, [NSURLAuthenticationMethodHTTPBasic, NSURLAuthenticationMethodHTTPDigest, NSURLAuthenticationMethodNTLM].contains(method) else {
      return (.performDefaultHandling, nil)
    }
    let space = challenge.protectionSpace
    let answer: PageRequest.Answer = await withCheckedContinuation { continuation in
      tab.handle(PageRequest(kind: .httpAuthentication(realm: space.realm, isProxy: space.isProxy(), failedBefore: challenge.previousFailureCount > 0), host: space.host) { answer in
        continuation.resume(returning: answer)
      })
    }
    guard case .credential(let user, let password) = answer else { return (.cancelAuthenticationChallenge, nil) }
    return (.useCredential, URLCredential(user: user, password: password, persistence: .forSession))
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    guard let tab, let engine = tab.engine, let url = navigationAction.request.url else { return nil }
    if case .external(let app) = ExternalLinks.route(url) {
      tab.handle(PageRequest(kind: .openExternal(url, app: app), host: tab.host ?? "") { [weak engine] answer in
        if case .accepted = answer { engine?.openExternalURL?(url) }
      })
      return nil
    }
    return engine.openPopup(from: tab, url: url, configuration: configuration)
  }

  func webViewDidClose(_ webView: WKWebView) {
    guard let tab else { return }
    tab.engine?.tabs.close(tab.id)
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
    guard let tab else { return }
    await withCheckedContinuation { continuation in
      tab.handle(PageRequest(kind: .alert(message: message), host: frame.securityOrigin.host) { _ in continuation.resume() })
    }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
    guard let tab else { return false }
    let answer: PageRequest.Answer = await withCheckedContinuation { continuation in
      tab.handle(PageRequest(kind: .confirm(message: message), host: frame.securityOrigin.host) { continuation.resume(returning: $0) })
    }
    if case .accepted = answer { return true }
    return false
  }

  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo) async -> String? {
    guard let tab else { return nil }
    let answer: PageRequest.Answer = await withCheckedContinuation { continuation in
      tab.handle(PageRequest(kind: .prompt(message: prompt, defaultText: defaultText ?? ""), host: frame.securityOrigin.host) { continuation.resume(returning: $0) })
    }
    if case .text(let text) = answer { return text }
    return nil
  }

  func webView(_ webView: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin, initiatedBy frame: WKFrameInfo, type: WKMediaCaptureType) async -> WKPermissionDecision {
    guard let tab, let engine = tab.engine else { return .deny }
    let key = "\(origin.protocol)://\(origin.host):\(origin.port)#\(type.rawValue)"
    if engine.grantedCapture.contains(key) { return .grant }
    let kind: MediaCaptureKind = switch type {
    case .camera: .camera
    case .microphone: .microphone
    default: .cameraAndMicrophone
    }
    let answer: PageRequest.Answer = await withCheckedContinuation { continuation in
      tab.handle(PageRequest(kind: .mediaCapture(kind), host: origin.host) { continuation.resume(returning: $0) })
    }
    guard case .accepted = answer else { return .deny }
    engine.grantedCapture.insert(key)
    return .grant
  }

  func webView(_ webView: WKWebView, requestGeolocationPermissionFor origin: WKSecurityOrigin, initiatedBy frame: WKFrameInfo) async -> WKPermissionDecision {
    guard let tab, let engine = tab.engine else { return .deny }
    let key = "\(origin.protocol)://\(origin.host):\(origin.port)#location"
    if engine.grantedCapture.contains(key) { return .grant }
    let answer: PageRequest.Answer = await withCheckedContinuation { continuation in
      tab.handle(PageRequest(kind: .location, host: origin.host) { continuation.resume(returning: $0) })
    }
    guard case .accepted = answer else { return .deny }
    engine.grantedCapture.insert(key)
    return .grant
  }

  func webView(_ webView: WKWebView, contextMenuConfigurationFor elementInfo: WKContextMenuElementInfo) async -> UIContextMenuConfiguration? {
    guard let tab, let engine = tab.engine, let link = elementInfo.linkURL, ExternalLinks.route(link) == .web else { return nil }
    let tabID = tab.id
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak engine] suggested in
      let open = UIMenu(options: .displayInline, children: [
        UIAction(title: String(localized: "Open in New Tab"), image: UIImage(systemName: "plus.square.on.square")) { _ in
          engine?.openLink(link, from: tabID, inBackground: false)
        },
        UIAction(title: String(localized: "Open in Background"), image: UIImage(systemName: "square.on.square")) { _ in
          engine?.openLink(link, from: tabID, inBackground: true)
        },
      ])
      let share = UIMenu(options: .displayInline, children: [
        UIAction(title: String(localized: "Copy Link"), image: UIImage(systemName: "link")) { _ in
          engine?.copyLink(link)
        },
        UIAction(title: String(localized: "Share…"), image: UIImage(systemName: "square.and.arrow.up")) { _ in
          engine?.share(link)
        },
        UIAction(title: String(localized: "Download Linked File"), image: UIImage(systemName: "arrow.down.circle")) { _ in
          engine?.download(link, from: tabID)
        },
      ])
      let duplicates = ["open", "copy link", "share", "reading list", "hide link preview", "show link preview"]
      let extra = suggested.filter { element in
        let title = element.title.lowercased()
        return !duplicates.contains { title.hasPrefix($0) || title.contains("reading list") }
      }
      return UIMenu(children: [open, share] + (extra.isEmpty ? [] : [UIMenu(options: .displayInline, children: extra)]))
    }
  }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    tab?.handleScroll(scrollView)
  }

  func scrollViewDidScrollToTop(_ scrollView: UIScrollView) {
    tab?.scrolledToTop()
  }
}

extension UIColor {
  var hexString: String? {
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    guard getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return nil }
    let clamp = { (value: CGFloat) in Int((min(max(value, 0), 1) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", clamp(red), clamp(green), clamp(blue))
  }
}
#endif
