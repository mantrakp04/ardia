import ArdiaDesign
import UIKit
import WebKit

extension PageContainerView {
  func endRefreshing() {
    if refreshControl.isRefreshing { refreshControl.endRefreshing() }
  }

  func applyInsets() {
    guard let webView else { return }
    let obscured = PageInsets.obscured(safeTop: safeAreaInsets.top, topInset: topInset, bottomInset: bottomInset)
    let insets = UIEdgeInsets(top: obscured.top, left: 0, bottom: obscured.bottom, right: 0)
    guard webView.obscuredContentInsets != insets else { return }
    let scrollView = webView.scrollView
    let oldTop = webView.pageTopInset
    let offset = scrollView.contentOffset.y
    webView.obscuredContentInsets = insets
    if let resting = PageInsets.restingOffset(offsetY: offset, oldAdjustedTop: oldTop, newAdjustedTop: webView.pageTopInset) {
      scrollView.contentOffset.y = resting
    }
  }

  @objc func refreshPulled() {
    guard let page else { return endRefreshing() }
    refreshFeedback.impactOccurred()
    page.reload()
    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .seconds(8))
      self?.endRefreshing()
    }
  }
}

extension WKWebView {
  var pageTopInset: CGFloat {
    max(scrollView.adjustedContentInset.top, obscuredContentInsets.top)
  }
}
