import ArdiaBrowser
import CryptoKit
import ExpoModulesCore
import Foundation
import Observation
import SwiftData
import UIKit
import WebKit

@MainActor
final class PageFind {
  let page: WebTab
  private let report: ([String: Any]?) -> Void
  private var query = ""
  private var hasSearched = false
  private var total = 0
  private var index = 0

  init(page: WebTab, report: @escaping ([String: Any]?) -> Void) {
    self.page = page
    self.report = report
  }

  func start(_ text: String) async {
    if hasSearched, text == query { return }
    hasSearched = true
    query = text
    index = 0
    total = 0
    guard let webView = page.webView, !text.isEmpty else {
      send()
      return
    }
    _ = try? await webView.callAsyncJavaScript("window.getSelection().removeAllRanges()", arguments: [:], in: nil, contentWorld: .defaultClient)
    let counted = try? await webView.callAsyncJavaScript(Self.countScript, arguments: ["query": text], in: nil, contentWorld: .defaultClient)
    let found = await search(webView, backwards: false)
    total = found ? max((counted as? NSNumber)?.intValue ?? 1, 1) : 0
    send()
  }

  func step(backwards: Bool) async {
    guard let webView = page.webView, !query.isEmpty, total > 0 else {
      send()
      return
    }
    guard await search(webView, backwards: backwards) else { return send() }
    index = backwards ? (index - 1 + total) % total : (index + 1) % total
    send()
  }

  func end() async {
    if let webView = page.webView {
      _ = try? await webView.callAsyncJavaScript("window.getSelection().removeAllRanges()", arguments: [:], in: nil, contentWorld: .defaultClient)
    }
    report(nil)
  }

  private func search(_ webView: WKWebView, backwards: Bool) async -> Bool {
    let configuration = WKFindConfiguration()
    configuration.backwards = backwards
    configuration.caseSensitive = false
    configuration.wraps = true
    return await withCheckedContinuation { continuation in
      webView.find(query, configuration: configuration) { result in continuation.resume(returning: result.matchFound) }
    }
  }

  private func send() {
    report(["query": query, "activeIndex": total == 0 ? 0 : index, "total": total, "isDone": true])
  }

  private static let countScript = """
  const needle = query.toLocaleLowerCase();
  const text = (document.body ? document.body.innerText : "").toLocaleLowerCase();
  let count = 0;
  for (let at = text.indexOf(needle); needle && at !== -1; at = text.indexOf(needle, at + needle.length)) count++;
  return count;
  """
}
