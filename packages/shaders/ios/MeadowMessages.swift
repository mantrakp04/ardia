import WebKit

final class MeadowMessages: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  static let name = "meadow"

  private weak var view: MeadowView?
  private let page: URL

  init(view: MeadowView, page: URL) {
    self.view = view
    self.page = page
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let state = body["state"] as? String else { return }
    view?.pageSaid(state, body)
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    let samePage = action.request.url.map { $0.absoluteString.split(separator: "#").first == Substring(page.absoluteString) } ?? false
    decisionHandler(samePage && action.targetFrame?.isMainFrame == true ? .allow : .cancel)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    view?.pageSaid("failed", [:])
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    view?.pageSaid("failed", [:])
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    view?.pageSaid("failed", [:])
  }
}
