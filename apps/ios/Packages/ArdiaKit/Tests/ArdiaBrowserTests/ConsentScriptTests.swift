import Foundation
import Testing
import WebKit
@testable import ArdiaBrowser

@MainActor
final class ConsentAllower: NSObject, WKScriptMessageHandlerWithReply {
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
    (true, nil)
  }
}

@MainActor
struct ConsentScriptTests {
  static let hiddenOneTrust = """
  <!doctype html><html class="ot-overflow-hidden" style="overflow:hidden"><head>
  <style>#onetrust-banner-sdk,#onetrust-consent-sdk{display:none!important}</style></head>
  <body style="overflow:hidden"><p>Article</p>
  <div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk">
  <button id="onetrust-reject-all-handler" onclick="window.rejectedConsent = true">Reject All</button>
  </div></div></body></html>
  """

  static let hiddenBannerWithoutButton = """
  <!doctype html><html class="ot-overflow-hidden"><head>
  <style>#onetrust-banner-sdk{display:none!important}.ot-overflow-hidden,.ot-overflow-hidden body{overflow:hidden}</style></head>
  <body><p>Article</p><div id="onetrust-banner-sdk"></div></body></html>
  """

  static let siteModalBesideIdleBanner = """
  <!doctype html><html><head>
  <style>#onetrust-banner-sdk{display:none}.modal-open{overflow:hidden}</style></head>
  <body class="modal-open"><p>Article</p><div id="onetrust-banner-sdk"></div><div role="dialog">Sign in</div></body></html>
  """

  static let disabledVisibleRejectBesideHiddenOne = """
  <!doctype html><html><head><style>#onetrust-banner-sdk{display:none!important}</style></head><body>
  <div id="onetrust-consent-sdk"><button class="ot-pc-refuse-all-handler" disabled>Reject All</button></div>
  <div id="onetrust-banner-sdk"><button id="onetrust-reject-all-handler" onclick="window.rejectedConsent = true">Reject All</button></div>
  </body></html>
  """

  func load(_ html: String) async throws -> WKWebView {
    let configuration = WKWebViewConfiguration()
    let world = WKContentWorld.world(name: "ArdiaBlockingTest")
    configuration.userContentController.addScriptMessageHandler(ConsentAllower(), contentWorld: world, name: BlockingScripts.handlerName)
    configuration.userContentController.addUserScript(WKUserScript(source: BlockingScripts.consent, injectionTime: .atDocumentEnd, forMainFrameOnly: false, in: world))
    let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 400, height: 800), configuration: configuration)
    let loader = PageLoader()
    try await loader.load(into: webView, html, base: "https://news.example.com/")
    return webView
  }

  func overflow(of webView: WKWebView) async throws -> String {
    try await webView.evaluateJavaScript("getComputedStyle(document.documentElement).overflow + ',' + getComputedStyle(document.body).overflow") as? String ?? ""
  }

  @Test func rejectsABannerTheFilterRulesAlreadyHid() async throws {
    let webView = try await load(Self.hiddenOneTrust)
    try await Task.sleep(for: .milliseconds(900))
    let rejected = try await webView.evaluateJavaScript("window.rejectedConsent === true") as? Bool
    #expect(rejected == true)
    #expect(try await overflow(of: webView) == "auto,auto")
  }

  @Test func unlocksScrollingWhenAHiddenBannerHasNoRejectButton() async throws {
    let webView = try await load(Self.hiddenBannerWithoutButton)
    try await Task.sleep(for: .milliseconds(400))
    #expect(try await overflow(of: webView) == "visible,visible")
  }

  @Test func leavesASiteModalLockedWhenTheBannerIsIdle() async throws {
    let webView = try await load(Self.siteModalBesideIdleBanner)
    try await Task.sleep(for: .milliseconds(900))
    #expect(try await overflow(of: webView) == "visible,hidden")
    #expect(try await webView.evaluateJavaScript("document.body.classList.contains('modal-open')") as? Bool == true)
  }

  @Test func skipsADisabledRejectButtonForAnEnabledOne() async throws {
    let webView = try await load(Self.disabledVisibleRejectBesideHiddenOne)
    try await Task.sleep(for: .milliseconds(600))
    #expect(try await webView.evaluateJavaScript("window.rejectedConsent === true") as? Bool == true)
  }
}
