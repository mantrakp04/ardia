import ArdiaDesign
import OSLog
import UIKit
import WebKit

@MainActor
final class PageResizeCover {
  private static let log = Logger(subsystem: "com.ardia.browser.ios", category: "chrome")

  private var cover: UIView?
  private var snapshot: UIView?
  private var baseSize: CGSize = .zero
  private var settledSize: CGSize = .zero
  private var startContentWidth: CGFloat = 0
  private var scalesWithCard = false
  private var startedAtTop = false
  private var isRevealing = false
  private var isFading = false
  private var generation = 0
  private var settleTask: Task<Void, Never>?
  private var paintTask: Task<Void, Never>?
  private var deadlineTask: Task<Void, Never>?
  private var contentObservation: NSKeyValueObservation?
  private var offsetObservation: NSKeyValueObservation?
  private weak var webView: WKWebView?

  var isActive: Bool { cover != nil }

  func covers(_ candidate: WKWebView) -> Bool {
    isActive && webView === candidate
  }

  func follow(in host: UIView, webView: WKWebView, size: CGSize) {
    let isResizing = cover == nil || !PageResize.isStill(from: settledSize, to: size)
    if isResizing { interruptReveal() }
    if cover == nil, !begin(in: host, webView: webView) {
      webView.frame = host.bounds
      return
    }
    guard let cover, let snapshot else { return }
    cover.frame = CGRect(origin: .zero, size: size)
    let scale = PageResize.coverScale(from: baseSize, to: size, scalesWithCard: scalesWithCard, reduceMotion: UIAccessibility.isReduceMotionEnabled)
    snapshot.transform = CGAffineTransform(scaleX: scale, y: scale)
    if webView.frame != host.bounds { webView.frame = host.bounds }
    guard isResizing else { return }
    keepAtTop()
    settledSize = size
    scheduleSettle()
  }

  private func interruptReveal() {
    if isFading {
      finish()
    } else if isRevealing {
      isRevealing = false
      paintTask?.cancel()
      deadlineTask?.cancel()
    }
  }

  func finish() {
    generation += 1
    settleTask?.cancel()
    paintTask?.cancel()
    deadlineTask?.cancel()
    settleTask = nil
    paintTask = nil
    deadlineTask = nil
    contentObservation = nil
    offsetObservation = nil
    cover?.layer.removeAllAnimations()
    cover?.removeFromSuperview()
    cover = nil
    snapshot = nil
    isRevealing = false
    isFading = false
    startedAtTop = false
    webView = nil
  }

  private func begin(in host: UIView, webView: WKWebView) -> Bool {
    guard webView.window != nil, !webView.isHidden, !webView.bounds.isEmpty,
          let snapshot = webView.snapshotView(afterScreenUpdates: false) ?? Self.imageSnapshot(of: webView) else { return false }
    let scrollView = webView.scrollView
    let base = webView.bounds.size
    let anchorY = min(max(webView.pageTopInset, 0), base.height)
    let cover = UIView(frame: host.bounds)
    cover.clipsToBounds = true
    cover.isUserInteractionEnabled = false
    cover.backgroundColor = webView.underPageBackgroundColor ?? host.backgroundColor
    snapshot.isUserInteractionEnabled = false
    snapshot.layer.anchorPoint = CGPoint(x: 0, y: anchorY / base.height)
    snapshot.bounds = CGRect(origin: .zero, size: base)
    snapshot.layer.position = CGPoint(x: 0, y: anchorY)
    cover.addSubview(snapshot)
    host.insertSubview(cover, aboveSubview: webView)
    self.cover = cover
    self.snapshot = snapshot
    self.webView = webView
    baseSize = base
    settledSize = base
    startContentWidth = scrollView.contentSize.width
    scalesWithCard = PageResize.scalesWithCard(minimumZoomScale: scrollView.minimumZoomScale)
    startedAtTop = PageInsets.isAtTop(offsetY: scrollView.contentOffset.y, adjustedTop: webView.pageTopInset)
    Self.log.info("resize cover begins, scales with card \(self.scalesWithCard), minimum zoom \(scrollView.minimumZoomScale), zoom \(scrollView.zoomScale), offset \(scrollView.contentOffset.y), adjusted top \(scrollView.adjustedContentInset.top), obscured top \(webView.obscuredContentInsets.top)")
    return true
  }

  private func scheduleSettle() {
    generation += 1
    let generation = generation
    settleTask?.cancel()
    paintTask?.cancel()
    deadlineTask?.cancel()
    contentObservation = nil
    settleTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(PageResize.settleDelay))
      guard !Task.isCancelled, let self, self.generation == generation else { return }
      self.awaitLayout(generation: generation)
    }
  }

  private func awaitLayout(generation: Int) {
    guard let webView else { return finish() }
    let scrollView = webView.scrollView
    if PageResize.hasLaidOut(contentWidth: scrollView.contentSize.width, viewWidth: scrollView.bounds.width) {
      return reveal(generation: generation, reason: "already laid out")
    }
    contentObservation = scrollView.observe(\.contentSize, options: [.new]) { [weak self] scrollView, _ in
      MainActor.assumeIsolated {
        guard let self, self.generation == generation,
              PageResize.hasLaidOut(contentWidth: scrollView.contentSize.width, viewWidth: scrollView.bounds.width) else { return }
        self.reveal(generation: generation, reason: "content width")
      }
    }
    let startWidth = startContentWidth
    paintTask = Task { [weak self, weak webView] in
      await Self.waitForPaint(of: webView)
      guard !Task.isCancelled, let self, self.generation == generation, let webView,
            PageResize.hasRelaidOut(contentWidth: webView.scrollView.contentSize.width, startWidth: startWidth) else { return }
      self.reveal(generation: generation, reason: "painted")
    }
    deadlineTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(PageResize.paintDeadline))
      guard !Task.isCancelled, let self, self.generation == generation else { return }
      self.reveal(generation: generation, reason: "deadline")
    }
  }

  @discardableResult
  private func keepAtTop() -> Bool {
    guard startedAtTop, let webView else { return false }
    let scrollView = webView.scrollView
    let top = -webView.pageTopInset
    guard abs(scrollView.contentOffset.y - top) > PageInsets.topTolerance else { return false }
    scrollView.contentOffset.y = top
    return true
  }

  private func reveal(generation: Int, reason: String) {
    guard cover != nil, !isRevealing, self.generation == generation else { return }
    isRevealing = true
    contentObservation = nil
    paintTask?.cancel()
    deadlineTask?.cancel()
    guard keepAtTop(), let webView else { return fade(generation: generation, reason: reason) }
    paintTask = Task { [weak self, weak webView] in
      if let webView { await Self.presentationUpdate(of: webView) }
      guard !Task.isCancelled, let self, self.generation == generation else { return }
      self.keepAtTop()
      self.fade(generation: generation, reason: reason)
    }
    deadlineTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(PageResize.revealDeadline))
      guard !Task.isCancelled, let self, self.generation == generation, self.isRevealing else { return }
      self.keepAtTop()
      self.fade(generation: generation, reason: reason + " past the deadline")
    }
  }

  private func fade(generation: Int, reason: String) {
    guard let cover, self.generation == generation, !isFading else { return }
    isFading = true
    if startedAtTop, let scrollView = webView?.scrollView {
      offsetObservation = scrollView.observe(\.contentOffset, options: []) { [weak self] _, _ in
        MainActor.assumeIsolated { _ = self?.keepAtTop() }
      }
    }
    Self.log.info("resize cover reveals: \(reason, privacy: .public)")
    UIView.animate(withDuration: PageResize.revealDuration, delay: 0, options: [.curveEaseOut, .allowUserInteraction, .beginFromCurrentState]) {
      cover.alpha = 0
    } completion: { [weak self] _ in
      guard let self, self.generation == generation else { return }
      self.finish()
    }
  }

  private static func waitForPaint(of webView: WKWebView?) async {
    for _ in 0..<2 {
      guard let webView else { return }
      await presentationUpdate(of: webView)
    }
  }

  private static func presentationUpdate(of webView: WKWebView) async {
    let configuration = WKSnapshotConfiguration()
    configuration.afterScreenUpdates = true
    configuration.snapshotWidth = NSNumber(value: Double(PageResizeMetrics.probeWidth))
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      webView.takeSnapshot(with: configuration) { _, _ in
        continuation.resume()
      }
    }
  }

  private static func imageSnapshot(of webView: WKWebView) -> UIView? {
    guard let image = PageCoverCache.capture(webView) else { return nil }
    let view = UIImageView(image: image)
    view.contentMode = .topLeft
    return view
  }
}

enum PageResizeMetrics {
  static let probeWidth: CGFloat = 8
}
