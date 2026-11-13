import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UIKit
import WebKit

struct WebPageView: UIViewRepresentable {
  let page: WebTab?
  var tab: BrowserTab?
  var cover: UIImage?
  var swipeMode: SwipeNavigationMode
  var bottomInset: CGFloat
  var topInset: CGFloat = 0
  var onTone: (UUID, PageTone) -> Void = { _, _ in }

  func makeUIView(context: Context) -> PageContainerView {
    let view = PageContainerView()
    view.backdrop = context.environment.profileLook.surface
    return view
  }

  func updateUIView(_ view: PageContainerView, context: Context) {
    view.backdrop = context.environment.profileLook.surface
    view.swipeMode = swipeMode
    view.onTone = onTone
    view.bottomInset = bottomInset
    view.topInset = topInset
    guard let page else {
      view.show(nil, cover: nil, isLoading: false, progress: 0)
      return
    }
    view.placeholderTab = tab
    view.show(page, cover: cover, isLoading: page.isLoading, progress: page.progress, isLive: page.webView != nil)
    if !page.isLoading { view.endRefreshing() }
  }

  static func dismantleUIView(_ view: PageContainerView, coordinator: ()) {
    view.detach()
  }
}

final class PageContainerView: UIView, UIGestureRecognizerDelegate {
  enum Reveal {
    case none
    case afterReattach
    case whenPainted(sawLoading: Bool)
  }

  var swipeMode: SwipeNavigationMode = .anywhere
  var onTone: ((UUID, PageTone) -> Void)?
  var bottomInset: CGFloat = 0 {
    didSet { if bottomInset != oldValue { applyInsets() } }
  }

  var topInset: CGFloat = 0 {
    didSet { if topInset != oldValue { applyInsets() } }
  }

  var placeholderTab: BrowserTab?
  var backdrop: Color = ProfileLook.plum.surface {
    didSet { backgroundColor = UIColor(backdrop) }
  }
  private var placeholderHost: UIHostingController<PageLoadingPlaceholder>?
  weak var page: WebTab?
  weak var webView: WKWebView?
  let refreshControl = UIRefreshControl()
  let resizeCover = PageResizeCover()
  private var laidOutSize: CGSize = .zero
  private let coverView = UIImageView()
  private var reveal: Reveal = .none
  private var revealDeadline: Task<Void, Never>?
  private var layoutObservation: NSKeyValueObservation?
  var scrollObservation: NSKeyValueObservation?
  var toneTask: Task<Void, Never>?
  var lastScroll: TimeInterval = 0
  private var wasLoading = false
  lazy var swipePan = UIPanGestureRecognizer(target: self, action: #selector(handleSwipe(_:)))
  var swipe: SwipeState?
  var swipeAnimator: UIViewPropertyAnimator?
  lazy var refreshFeedback = UIImpactFeedbackGenerator(style: .light, view: self)
  lazy var swipeFeedback = UIImpactFeedbackGenerator(style: .medium, view: self)

  struct SwipeState {
    var direction: SwipeNavigationDirection
    var target: UIView
    var shade: UIView
    var isPastCommit = false
  }

  static let commitDistance = Layout.swipeCommit
  static let flickDistance = Layout.swipeFlickCommit
  static let commitHysteresis: CGFloat = 12
  static let parallax = -Layout.swipeParallax
  static let reattachDeadline: Duration = .seconds(1.5)
  static let paintDeadline: Duration = .seconds(4)

  override init(frame: CGRect) {
    super.init(frame: frame)
    clipsToBounds = true
    swipePan.delegate = self
    swipePan.maximumNumberOfTouches = 1
    addGestureRecognizer(swipePan)
    refreshControl.addTarget(self, action: #selector(refreshPulled), for: .valueChanged)
    refreshControl.tintColor = UIColor(BrowsePalette.loadingBorder)
    coverView.contentMode = .scaleAspectFill
    coverView.clipsToBounds = true
    coverView.isUserInteractionEnabled = false
    coverView.isHidden = true
    coverView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(coverView)
  }

  required init?(coder: NSCoder) { nil }

  private var hostedWebViews: [WKWebView] {
    subviews.compactMap { $0 as? WKWebView }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let size = bounds.size
    let previous = laidOutSize
    laidOutSize = size
    guard let webView, webView.superview === self, !webView.isHidden else { return }
    if resizeCover.covers(webView) || (canCoverResize && PageResize.coversChange(from: previous, to: size)) {
      resizeCover.follow(in: self, webView: webView, size: size)
    } else if webView.frame != bounds {
      webView.frame = bounds
    }
  }

  private var canCoverResize: Bool {
    window != nil && swipe == nil && coverView.isHidden && (placeholderHost?.view.alpha ?? 0) == 0
      && (webView?.scrollView.contentSize.height ?? 0) > 0
  }

  func show(_ next: WebTab?, cover: UIImage?, isLoading: Bool, progress: Double, isLive: Bool = true) {
    guard let next else {
      cancelSwipe()
      resizeCover.finish()
      page = nil
      webView = nil
      scrollObservation = nil
      hostedWebViews.forEach { $0.isHidden = true }
      hideCover(animated: false)
      hidePlaceholder(animated: false)
      return
    }
    guard isLive else {
      showWaiting(for: next, cover: cover)
      return
    }
    if page !== next || webView == nil || webView !== next.webView || next.webView?.superview !== self {
      switchTo(next, cover: cover)
    }
    if wasLoading, !isLoading { scheduleToneSample(after: .milliseconds(250)) }
    wasLoading = isLoading
    if case .whenPainted = reveal, coverView.isHidden, let cover {
      coverView.image = cover
      coverView.alpha = 1
      coverView.isHidden = false
      coverView.frame = bounds
      bringSubviewToFront(coverView)
    }
    updateReveal(isLoading: isLoading, progress: progress)
  }

  private func showWaiting(for next: WebTab, cover: UIImage?) {
    guard page !== next || webView != nil else { return }
    cancelSwipe()
    resizeCover.finish()
    page = next
    webView = nil
    scrollObservation = nil
    hostedWebViews.forEach { $0.isHidden = true }
    revealDeadline?.cancel()
    if let cover {
      coverView.layer.removeAllAnimations()
      coverView.image = cover
      coverView.alpha = 1
      coverView.isHidden = false
      coverView.frame = bounds
      bringSubviewToFront(coverView)
    } else {
      showPlaceholder()
    }
  }

  private func switchTo(_ next: WebTab, cover: UIImage?) {
    cancelSwipe()
    resizeCover.finish()
    page = next
    guard let webView = next.webView else { return }
    let wasPresented = webView.superview === self && webView.window != nil && !webView.isHidden
    if webView.superview !== self {
      webView.removeFromSuperview()
      insertSubview(webView, belowSubview: coverView)
    }
    webView.autoresizingMask = []
    webView.frame = bounds
    for other in hostedWebViews where other !== webView {
      other.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      other.frame = bounds
      other.isHidden = true
      if other.scrollView.refreshControl === refreshControl { other.scrollView.refreshControl = nil }
    }
    webView.isHidden = false
    insertSubview(webView, belowSubview: coverView)
    self.webView = webView
    webView.scrollView.refreshControl = refreshControl
    wasLoading = next.isLoading
    observeScroll(of: webView)
    applyInsets()
    revealDeadline?.cancel()
    hideCover(animated: false)
    if let cover {
      coverView.layer.removeAllAnimations()
      coverView.image = cover
      coverView.alpha = 1
      coverView.isHidden = false
      coverView.frame = bounds
      bringSubviewToFront(coverView)
    } else {
      showPlaceholder()
    }
    let settled = !next.isLoading && webView.url != nil
    if settled, wasPresented, webView.scrollView.contentSize.height > 0 {
      hideCover(animated: false)
      scheduleToneSample(after: .milliseconds(120))
      return
    }
    if settled {
      reveal = .afterReattach
      waitForPresentation(of: webView)
    } else {
      reveal = .whenPainted(sawLoading: next.isLoading)
      watchFirstLayout(of: webView)
    }
    revealDeadline = Task { @MainActor [weak self] in
      try? await Task.sleep(for: settled ? Self.reattachDeadline : Self.paintDeadline)
      guard !Task.isCancelled else { return }
      self?.hideCover(animated: true)
    }
  }

  private func revealAfterPresentation() {
    guard let webView else { return }
    let configuration = WKSnapshotConfiguration()
    configuration.afterScreenUpdates = true
    configuration.snapshotWidth = 8
    Task { @MainActor [weak self, weak webView] in
      try? await Task.sleep(for: .milliseconds(150))
      guard let self, let webView, self.webView === webView, case .whenPainted = self.reveal else { return }
      webView.takeSnapshot(with: configuration) { [weak self, weak webView] _, _ in
        MainActor.assumeIsolated {
          guard let self, self.webView === webView, case .whenPainted = self.reveal else { return }
          self.hideCover(animated: true)
        }
      }
    }
  }

  private func waitForPresentation(of webView: WKWebView) {
    let configuration = WKSnapshotConfiguration()
    configuration.afterScreenUpdates = true
    configuration.snapshotWidth = 8
    webView.takeSnapshot(with: configuration) { [weak self, weak webView] _, _ in
      MainActor.assumeIsolated {
        guard let self, case .afterReattach = self.reveal, self.webView === webView else { return }
        self.hideCover(animated: true)
      }
    }
  }

  private func updateReveal(isLoading: Bool, progress: Double) {
    guard case .whenPainted(let sawLoading) = reveal else { return }
    if isLoading, !sawLoading { reveal = .whenPainted(sawLoading: true) }
    if sawLoading || isLoading, !isLoading { hideCover(animated: true) }
  }

  private func watchFirstLayout(of webView: WKWebView) {
    let start = webView.scrollView.contentSize
    layoutObservation = webView.scrollView.observe(\.contentSize, options: [.new]) { [weak self] scrollView, _ in
      MainActor.assumeIsolated {
        guard let self, case .whenPainted(let sawLoading) = self.reveal, sawLoading || self.page?.isLoading == true,
              scrollView.contentSize != start, scrollView.contentSize.height > scrollView.bounds.height + 1 else { return }
        self.layoutObservation = nil
        self.revealAfterPresentation()
      }
    }
  }

  private func showPlaceholder() {
    guard let tab = placeholderTab else { return }
    placeholderHost?.view.layer.removeAllAnimations()
    placeholderHost?.view.removeFromSuperview()
    let host = UIHostingController(rootView: PageLoadingPlaceholder(tab: tab, backdrop: backdrop, revealDelay: Motion.placeholderDelay))
    host.view.isUserInteractionEnabled = false
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    host.view.frame = bounds
    host.view.alpha = 1
    addSubview(host.view)
    placeholderHost = host
  }

  private func hidePlaceholder(animated: Bool) {
    guard let view = placeholderHost?.view, view.alpha > 0 else { return }
    guard animated else {
      view.layer.removeAllAnimations()
      view.alpha = 0
      return
    }
    UIView.animate(withDuration: 0.25, delay: 0, options: [.curveEaseOut, .allowUserInteraction, .beginFromCurrentState]) {
      view.alpha = 0
    }
  }

  private func hideCover(animated: Bool) {
    layoutObservation = nil
    revealDeadline?.cancel()
    revealDeadline = nil
    reveal = .none
    hidePlaceholder(animated: animated)
    guard !coverView.isHidden, coverView.image != nil else {
      coverView.isHidden = true
      return
    }
    guard animated else {
      coverView.isHidden = true
      coverView.image = nil
      return
    }
    scheduleToneSample(after: .milliseconds(200))
    UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseOut, .allowUserInteraction, .beginFromCurrentState]) {
      self.coverView.alpha = 0
    } completion: { finished in
      guard finished, self.coverView.alpha == 0 else { return }
      self.coverView.isHidden = true
      self.coverView.image = nil
    }
  }

  func detach() {
    cancelSwipe()
    resizeCover.finish()
    revealDeadline?.cancel()
    toneTask?.cancel()
    scrollObservation = nil
    for hosted in hostedWebViews {
      if hosted.scrollView.refreshControl === refreshControl { hosted.scrollView.refreshControl = nil }
      hosted.isHidden = false
      hosted.removeFromSuperview()
    }
    webView = nil
    page = nil
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    applyInsets()
  }

  override func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
    guard recognizer === swipePan, swipeMode == .anywhere, !resizeCover.isActive, let page, let webView else { return false }
    let velocity = swipePan.velocity(in: self)
    guard abs(velocity.x) > abs(velocity.y) * 1.6, abs(velocity.x) > 120 else { return false }
    let scrollView = webView.scrollView
    let canScrollHorizontally = scrollView.contentSize.width > scrollView.bounds.width + 1
    if velocity.x > 0 {
      guard page.canGoBack else { return false }
      if canScrollHorizontally, scrollView.contentOffset.x > -scrollView.adjustedContentInset.left + 1 { return false }
    } else {
      guard page.canGoForward else { return false }
      if canScrollHorizontally, scrollView.contentOffset.x + scrollView.bounds.width < scrollView.contentSize.width + scrollView.adjustedContentInset.right - 1 { return false }
    }
    return true
  }

}
