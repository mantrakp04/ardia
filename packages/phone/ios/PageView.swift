import ArdiaBrowser
import ExpoModulesCore
import Observation
import UIKit
import WebKit

final class PageView: ExpoView {
  let onPageEvent = EventDispatcher()

  var pageID: String?
  var initialURL: String?
  var toneInsets: (top: CGFloat, bottom: CGFloat) = (0, 0)
  private(set) var page: WebTab?

  private weak var hostedWebView: WKWebView?
  private var sampled: PageTone?
  private var sentTone: PageTone?
  private var sentState: NavigationState?
  private var wasLoading = false
  private var observing = 0
  private var toneTask: Task<Void, Never>?
  private var scrollObservation: NSKeyValueObservation?
  private var lastScroll: TimeInterval = 0

  private struct NavigationState: Equatable {
    var url: String?
    var title: String
    var progress: Double
    var isLoading: Bool
    var canGoBack: Bool
    var canGoForward: Bool
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
  }

  func bind() {
    guard let pageID else { return }
    if let page, PhonePages.shared.engine.existingWebTab(page.id) === page, hostedWebView === page.webView, page.webView != nil {
      return
    }
    unbind()
    guard let opened = PhonePages.shared.open(pageID, initialURL: initialURL) else { return }
    page = opened
    wasLoading = opened.isLoading
    host(opened.webView)
    observing += 1
    observe(opened, generation: observing)
  }

  func unbind() {
    observing += 1
    toneTask?.cancel()
    toneTask = nil
    scrollObservation = nil
    if let hostedWebView, hostedWebView.superview === self { hostedWebView.removeFromSuperview() }
    hostedWebView = nil
    page = nil
    sampled = nil
    sentTone = nil
    sentState = nil
  }

  private func host(_ webView: WKWebView?) {
    guard let webView else { return }
    webView.removeFromSuperview()
    webView.frame = bounds
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    webView.allowsBackForwardNavigationGestures = true
    addSubview(webView)
    hostedWebView = webView
    scrollObservation = webView.scrollView.observe(\.contentOffset, options: []) { [weak self] _, _ in
      MainActor.assumeIsolated { self?.scrollMoved() }
    }
    scheduleToneSample(after: .milliseconds(120))
  }

  private func observe(_ page: WebTab, generation: Int) {
    withObservationTracking {
      send(page)
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self, self.observing == generation, let current = self.page, current === page else { return }
        self.observe(page, generation: generation)
      }
    }
  }

  private func send(_ page: WebTab) {
    let state = NavigationState(
      url: page.url?.absoluteString,
      title: page.title,
      progress: page.progress,
      isLoading: page.isLoading,
      canGoBack: page.canGoBack,
      canGoForward: page.canGoForward
    )
    if state != sentState {
      sentState = state
      var payload: [String: Any] = [
        "name": "state",
        "title": state.title,
        "progress": state.progress,
        "isLoading": state.isLoading,
        "canGoBack": state.canGoBack,
        "canGoForward": state.canGoForward,
      ]
      if let url = state.url { payload["url"] = url }
      onPageEvent(payload)
    }
    if wasLoading, !state.isLoading { scheduleToneSample(after: .milliseconds(250)) }
    wasLoading = state.isLoading
    sendTone(theme: page.themeColor, underPage: page.underPageBackgroundColor)
  }

  private func sendTone(theme: UIColor?, underPage: UIColor?) {
    let tone = PageTone.resolve(theme: theme, underPage: underPage, sampled: sampled, stored: nil)
    guard tone != sentTone, tone.top != nil || tone.bottom != nil else { return }
    sentTone = tone
    var payload: [String: Any] = ["name": "tone"]
    if let top = tone.top { payload["top"] = top.hex }
    if let bottom = tone.bottom { payload["bottom"] = bottom.hex }
    onPageEvent(payload)
  }

  private func scrollMoved() {
    lastScroll = CACurrentMediaTime()
    guard toneTask == nil else { return }
    toneTask = Task { @MainActor [weak self] in
      while let self, !Task.isCancelled {
        let quiet = CACurrentMediaTime() - self.lastScroll
        if quiet >= 0.16 { break }
        try? await Task.sleep(for: .seconds(max(0.16 - quiet, 0.02)))
      }
      guard let self, !Task.isCancelled else { return }
      self.toneTask = nil
      await self.sampleTone()
    }
  }

  private func scheduleToneSample(after delay: Duration) {
    toneTask?.cancel()
    toneTask = Task { @MainActor [weak self] in
      try? await Task.sleep(for: delay)
      guard let self, !Task.isCancelled else { return }
      self.toneTask = nil
      await self.sampleTone()
    }
  }

  private func sampleTone() async {
    guard let page, let webView = hostedWebView, webView.window != nil, !webView.isHidden, webView.url != nil,
          !page.isLoading, webView.bounds.height > toneInsets.top + toneInsets.bottom + ToneSampler.bandHeight * 4 else { return }
    let id = page.id
    guard let tone = await ToneSampler.sample(webView, topInset: toneInsets.top, bottomInset: toneInsets.bottom),
          self.page?.id == id else { return }
    sampled = tone
    sendTone(theme: page.themeColor, underPage: page.underPageBackgroundColor)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { scheduleToneSample(after: .milliseconds(120)) }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    hostedWebView?.frame = bounds
  }

  func goBack() -> Bool {
    guard let page, page.canGoBack else { return false }
    page.goBack()
    return true
  }

  func goForward() -> Bool {
    guard let page, page.canGoForward else { return false }
    page.goForward()
    return true
  }

  func load(_ address: String) {
    guard let url = URL(string: address) else { return }
    page?.load(url)
  }
}
