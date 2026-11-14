import ArdiaBrowser
import ArdiaDesign
import UIKit
import WebKit

extension PageContainerView {
  func scheduleToneSample(after delay: Duration) {
    toneTask?.cancel()
    toneTask = Task { @MainActor [weak self] in
      try? await Task.sleep(for: delay)
      guard let self, !Task.isCancelled else { return }
      self.toneTask = nil
      self.sampleTone()
    }
  }

  func sampleTone() {
    guard let webView, let page, webView.window != nil, !webView.isHidden, webView.url != nil,
          webView.bounds.height > BrowseLayout.barHeight * 3, swipe == nil else { return }
    let id = page.id
    let bounds = webView.bounds
    let top = webView.safeAreaInsets.top + 1
    let bottom = bounds.height - bottomInset - ToneSampler.bandHeight - 2
    Task { @MainActor [weak self, weak webView] in
      guard let webView else { return }
      async let topImage = Self.snapshot(of: webView, in: CGRect(x: 0, y: top, width: bounds.width, height: ToneSampler.bandHeight))
      async let bottomImage = Self.snapshot(of: webView, in: CGRect(x: 0, y: bottom, width: bounds.width, height: ToneSampler.bandHeight))
      let images = await (topImage, bottomImage)
      guard let self, self.page?.id == id else { return }
      let tone = PageTone(top: images.0.flatMap(ToneSampler.dominant), bottom: images.1.flatMap(ToneSampler.dominant))
      guard tone.top != nil || tone.bottom != nil else { return }
      self.onTone?(id, tone)
    }
  }

  static func snapshot(of webView: WKWebView, in rect: CGRect) async -> UIImage? {
    let configuration = WKSnapshotConfiguration()
    configuration.rect = rect
    configuration.afterScreenUpdates = false
    configuration.snapshotWidth = NSNumber(value: ToneSampler.sampleWidth)
    return try? await webView.takeSnapshot(configuration: configuration)
  }

  func observeScroll(of webView: WKWebView) {
    scrollObservation = webView.scrollView.observe(\.contentOffset, options: []) { [weak self] _, _ in
      MainActor.assumeIsolated { self?.scrollMoved() }
    }
  }

  func scrollMoved() {
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
      self.sampleTone()
    }
  }
}
