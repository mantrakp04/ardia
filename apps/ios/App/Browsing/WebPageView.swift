import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UIKit
import WebKit

enum PagePinch: Equatable {
  case began
  case changed(CGFloat)
  case ended(scale: CGFloat, velocity: CGFloat)
  case cancelled
}

struct WebPageView: UIViewRepresentable {
  let page: WebTab?
  var tab: BrowserTab?
  var cover: UIImage?
  var swipeMode: SwipeNavigationMode
  var bottomInset: CGFloat
  var pinchEnabled: Bool
  var onPinch: (PagePinch) -> Void

  func makeUIView(context: Context) -> PageContainerView {
    let view = PageContainerView()
    view.backgroundColor = UIColor(BrowsePalette.pageBackdrop)
    return view
  }

  func updateUIView(_ view: PageContainerView, context: Context) {
    view.swipeMode = swipeMode
    view.pinchEnabled = pinchEnabled
    view.onPinch = onPinch
    view.bottomInset = bottomInset
    guard let page else {
      view.show(nil, cover: nil, isLoading: false, progress: 0)
      return
    }
    view.placeholderTab = tab
    view.show(page, cover: cover, isLoading: page.isLoading, progress: page.progress)
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
  var pinchEnabled = true
  var onPinch: ((PagePinch) -> Void)?
  var bottomInset: CGFloat = 0 {
    didSet { if bottomInset != oldValue { applyInsets() } }
  }

  var placeholderTab: BrowserTab?
  private var placeholderHost: UIHostingController<PageLoadingPlaceholder>?
  private weak var page: WebTab?
  private weak var webView: WKWebView?
  private let refreshControl = UIRefreshControl()
  private let coverView = UIImageView()
  private var reveal: Reveal = .none
  private var revealDeadline: Task<Void, Never>?
  private var layoutObservation: NSKeyValueObservation?
  private lazy var swipePan = UIPanGestureRecognizer(target: self, action: #selector(handleSwipe(_:)))
  private lazy var pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
  private var swipe: SwipeState?
  private var isPinchingOut = false
  private lazy var refreshFeedback = UIImpactFeedbackGenerator(style: .light, view: self)
  private lazy var swipeFeedback = UISelectionFeedbackGenerator(view: self)

  private struct SwipeState {
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
    pinch.delegate = self
    addGestureRecognizer(pinch)
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

  func show(_ next: WebTab?, cover: UIImage?, isLoading: Bool, progress: Double) {
    guard let next else {
      cancelSwipe()
      page = nil
      webView = nil
      hostedWebViews.forEach { $0.isHidden = true }
      hideCover(animated: false)
      hidePlaceholder(animated: false)
      return
    }
    if page !== next || webView == nil || webView !== next.webView || next.webView?.superview !== self {
      switchTo(next, cover: cover)
    }
    if case .whenPainted = reveal, coverView.isHidden, let cover {
      coverView.image = cover
      coverView.alpha = 1
      coverView.isHidden = false
      coverView.frame = bounds
      bringSubviewToFront(coverView)
    }
    updateReveal(isLoading: isLoading, progress: progress)
  }

  private func switchTo(_ next: WebTab, cover: UIImage?) {
    cancelSwipe()
    let wasLive = next.isLive
    page = next
    next.makeLive()
    guard let webView = next.webView else { return }
    if webView.superview !== self {
      webView.removeFromSuperview()
      webView.frame = bounds
      webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      insertSubview(webView, belowSubview: coverView)
    }
    for other in hostedWebViews where other !== webView {
      other.isHidden = true
      if other.scrollView.refreshControl === refreshControl { other.scrollView.refreshControl = nil }
    }
    webView.isHidden = false
    insertSubview(webView, belowSubview: coverView)
    self.webView = webView
    webView.scrollView.refreshControl = refreshControl
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
    let settled = wasLive && !next.isLoading && webView.url != nil
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
    let host = placeholderHost ?? {
      let host = UIHostingController(rootView: PageLoadingPlaceholder(tab: tab))
      host.view.isUserInteractionEnabled = false
      host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      host.view.frame = bounds
      host.view.alpha = 0
      addSubview(host.view)
      placeholderHost = host
      return host
    }()
    host.rootView = PageLoadingPlaceholder(tab: tab)
    host.view.layer.removeAllAnimations()
    host.view.frame = bounds
    bringSubviewToFront(host.view)
    host.view.alpha = 1
  }

  private func hidePlaceholder(animated: Bool) {
    guard let view = placeholderHost?.view, view.alpha > 0 else { return }
    guard animated else {
      view.layer.removeAllAnimations()
      view.alpha = 0
      return
    }
    UIView.animate(withDuration: 0.2, delay: 0, options: [.curveEaseOut, .allowUserInteraction, .beginFromCurrentState]) {
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
    revealDeadline?.cancel()
    for hosted in hostedWebViews {
      if hosted.scrollView.refreshControl === refreshControl { hosted.scrollView.refreshControl = nil }
      hosted.isHidden = false
      hosted.removeFromSuperview()
    }
    webView = nil
    page = nil
  }

  func prepareForSnapshot(_ hidden: Bool) {
    refreshControl.isHidden = hidden
  }

  func endRefreshing() {
    if refreshControl.isRefreshing { refreshControl.endRefreshing() }
  }

  private func applyInsets() {
    guard let scrollView = webView?.scrollView else { return }
    if scrollView.contentInset.bottom != bottomInset {
      scrollView.contentInset.bottom = bottomInset
      scrollView.verticalScrollIndicatorInsets.bottom = bottomInset
    }
  }

  @objc private func refreshPulled() {
    guard let page else { return endRefreshing() }
    refreshFeedback.impactOccurred()
    page.reload()
    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .seconds(8))
      self?.endRefreshing()
    }
  }

  override func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
    if recognizer === pinch { return pinchEnabled && page?.isLive == true }
    guard recognizer === swipePan, swipeMode == .anywhere, let page, let webView else { return false }
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

  func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    recognizer === pinch
  }

  @objc private func handleSwipe(_ recognizer: UIPanGestureRecognizer) {
    guard let webView, let page else { return }
    let width = bounds.width
    switch recognizer.state {
    case .began:
      let direction: SwipeNavigationDirection = recognizer.velocity(in: self).x > 0 ? .back : .forward
      let scrollPan = webView.scrollView.panGestureRecognizer
      scrollPan.isEnabled = false
      scrollPan.isEnabled = true
      let target: UIView
      if let image = page.snapshotForSwipe(direction) {
        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        target = imageView
      } else {
        target = UIView()
      }
      target.backgroundColor = webView.underPageBackgroundColor ?? .systemBackground
      target.frame = bounds
      let shade = UIView(frame: bounds)
      shade.backgroundColor = UIColor.black.withAlphaComponent(0.12)
      shade.isUserInteractionEnabled = false
      if direction == .back {
        insertSubview(target, belowSubview: webView)
        insertSubview(shade, aboveSubview: target)
        target.transform = CGAffineTransform(translationX: -width * Self.parallax, y: 0)
      } else {
        insertSubview(target, aboveSubview: webView)
        target.transform = CGAffineTransform(translationX: width, y: 0)
        target.layer.shadowColor = UIColor.black.cgColor
        target.layer.shadowOpacity = 0.18
        target.layer.shadowRadius = 12
        target.layer.shadowPath = UIBezierPath(rect: target.bounds).cgPath
        insertSubview(shade, belowSubview: target)
      }
      webView.layer.shadowColor = UIColor.black.cgColor
      webView.layer.shadowOpacity = direction == .back ? 0.18 : 0
      webView.layer.shadowRadius = 12
      webView.layer.shadowPath = UIBezierPath(rect: webView.bounds).cgPath
      swipe = SwipeState(direction: direction, target: target, shade: shade)
      swipeFeedback.prepare()
    case .changed:
      guard var swipe else { return }
      let raw = recognizer.translation(in: self).x
      layoutSwipe(swipe, progress: progress(for: raw, direction: swipe.direction))
      let signed = swipe.direction == .back ? raw : -raw
      let isPastCommit = swipe.isPastCommit ? signed > Self.commitDistance - Self.commitHysteresis : signed > Self.commitDistance
      if isPastCommit != swipe.isPastCommit {
        swipe.isPastCommit = isPastCommit
        self.swipe = swipe
        swipeFeedback.selectionChanged()
      }
    case .ended, .cancelled, .failed:
      guard let swipe else { return }
      let raw = recognizer.translation(in: self).x
      let velocity = recognizer.velocity(in: self).x
      let signed = swipe.direction == .back ? raw : -raw
      let signedVelocity = swipe.direction == .back ? velocity : -velocity
      let commits = recognizer.state == .ended && (signed > Self.commitDistance && signedVelocity > -50 || signed > Self.flickDistance && signedVelocity > 600)
      finishSwipe(swipe, commit: commits, velocity: abs(velocity))
    default:
      break
    }
  }

  private func progress(for translation: CGFloat, direction: SwipeNavigationDirection) -> CGFloat {
    let signed = direction == .back ? translation : -translation
    return min(max(signed / max(bounds.width, 1), 0), 1)
  }

  private func layoutSwipe(_ swipe: SwipeState, progress: CGFloat) {
    guard let webView else { return }
    let width = bounds.width
    switch swipe.direction {
    case .back:
      webView.transform = CGAffineTransform(translationX: width * progress, y: 0)
      swipe.target.transform = CGAffineTransform(translationX: -width * Self.parallax * (1 - progress), y: 0)
      swipe.shade.alpha = 1 - progress
    case .forward:
      swipe.target.transform = CGAffineTransform(translationX: width * (1 - progress), y: 0)
      webView.transform = CGAffineTransform(translationX: -width * Self.parallax * progress, y: 0)
      swipe.shade.alpha = progress
    }
  }

  private func finishSwipe(_ swipe: SwipeState, commit: Bool, velocity: CGFloat) {
    let distance = max(bounds.width, 1)
    let initial = min(velocity / distance, 6)
    let animator = UIViewPropertyAnimator(duration: 0.22, timingParameters: UISpringTimingParameters(dampingRatio: 1, initialVelocity: CGVector(dx: initial, dy: 0)))
    animator.addAnimations { [self] in layoutSwipe(swipe, progress: commit ? 1 : 0) }
    animator.addCompletion { [weak self] _ in
      guard let self else { return }
      self.webView?.transform = .identity
      self.webView?.layer.shadowOpacity = 0
      swipe.shade.removeFromSuperview()
      self.swipe = nil
      guard commit, let page = self.page else {
        swipe.target.removeFromSuperview()
        return
      }
      self.bringSubviewToFront(swipe.target)
      swipe.target.transform = .identity
      swipe.target.layer.shadowOpacity = 0
      if swipe.direction == .back { page.goBack() } else { page.goForward() }
      UIView.animate(withDuration: 0.2, delay: 0.25, options: [.curveEaseOut, .allowUserInteraction]) {
        swipe.target.alpha = 0
      } completion: { _ in
        swipe.target.removeFromSuperview()
      }
    }
    animator.startAnimation()
  }

  private func cancelSwipe() {
    guard let swipe else { return }
    swipe.target.removeFromSuperview()
    swipe.shade.removeFromSuperview()
    webView?.transform = .identity
    webView?.layer.shadowOpacity = 0
    self.swipe = nil
  }

  @objc private func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
    guard let scrollView = webView?.scrollView else { return }
    switch recognizer.state {
    case .began:
      isPinchingOut = scrollView.zoomScale <= scrollView.minimumZoomScale + 0.01 && recognizer.scale <= 1.02
      if isPinchingOut { onPinch?(.began) }
    case .changed:
      guard isPinchingOut else { return }
      if scrollView.zoomScale > scrollView.minimumZoomScale + 0.01, recognizer.scale > 1 {
        isPinchingOut = false
        onPinch?(.cancelled)
        return
      }
      onPinch?(.changed(min(recognizer.scale, 1)))
    case .ended:
      guard isPinchingOut else { return }
      isPinchingOut = false
      onPinch?(.ended(scale: min(recognizer.scale, 1), velocity: recognizer.velocity))
      if scrollView.zoomScale < scrollView.minimumZoomScale {
        scrollView.setZoomScale(scrollView.minimumZoomScale, animated: false)
      }
    case .cancelled, .failed:
      guard isPinchingOut else { return }
      isPinchingOut = false
      onPinch?(.cancelled)
    default:
      break
    }
  }
}
