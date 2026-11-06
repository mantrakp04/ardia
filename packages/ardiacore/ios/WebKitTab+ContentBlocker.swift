import WebKit

final class WebKitBlockedCount {
  var count = 0
  var lastURL = ""
  var generation = 0
  var emitQueued = false
}

extension WebKitTab {
  @objc(_webView:contentRuleListWithIdentifier:performedAction:forURL:)
  func contentRuleList(_ webView: WKWebView, identifier: String, performedAction action: NSObject, forURL url: URL) {
    guard webView === self.webView, (action.value(forKey: "blockedLoad") as? Bool) == true else { return }
    blocked.count += 1
    blocked.lastURL = url.absoluteString
    guard !blocked.emitQueued else { return }
    blocked.emitQueued = true
    let generation = blocked.generation
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self, weak webView] in
      guard let self, let webView, webView === self.webView, self.blocked.generation == generation else { return }
      self.blocked.emitQueued = false
      self.emit("contentBlocked", ["count": self.blocked.count, "url": self.blocked.lastURL])
    }
  }

  func resetBlocked() {
    blocked.generation += 1
    blocked.emitQueued = false
    let had = blocked.count > 0 || !blocked.lastURL.isEmpty
    blocked.count = 0
    blocked.lastURL = ""
    if had { emit("contentBlocked", ["count": 0, "url": ""]) }
  }

  func loadWhenBlockerReady(_ url: String, in view: WebKitWebView) {
    WebKitContentBlocker.shared.whenReady(within: 1) { [weak self, weak view] in
      guard let self, let view, self.webView === view, view.url == nil, !view.isLoading else { return }
      self.loadURL(url, userInitiated: false)
    }
  }
}
