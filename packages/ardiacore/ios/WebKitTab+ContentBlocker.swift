import WebKit

final class WebKitBlockedCount {
  var count = 0
  var lastURL = ""
  var generation = 0
  var emitQueued = false
  var exemptLoad = false
}

final class WebKitPopupPolicy: NSObject, WKNavigationDelegate {
  static let shared = WebKitPopupPolicy()

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences,
               decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
    if action.targetFrame?.isMainFrame == true, let url = action.request.url { WebKitContentBlocker.shared.configure(preferences, for: url) }
    decisionHandler(.allow, preferences)
  }
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

  func applyBlockerPolicy(_ action: WKNavigationAction, preferences: WKWebpagePreferences, in webView: WKWebView) -> Bool {
    guard let url = action.request.url else { return true }
    let exempt = WebKitContentBlocker.shared.configure(preferences, for: url)
    let redirect = action.responds(to: NSSelectorFromString("_isRedirect")) && (action.value(forKey: "isRedirect") as? Bool) == true
    if redirect && blocked.exemptLoad && !exempt {
      blocked.exemptLoad = false
      let request = action.request
      DispatchQueue.main.async { [weak webView] in webView?.load(request) }
      return false
    }
    if !redirect || exempt { blocked.exemptLoad = exempt }
    return true
  }

  func loadWhenBlockerReady(_ url: String, in view: WebKitWebView) {
    WebKitContentBlocker.shared.whenReady(within: 1) { [weak self, weak view] in
      guard let self, let view, self.webView === view, view.url == nil, !view.isLoading else { return }
      self.loadURL(url, userInitiated: false)
    }
  }
}
