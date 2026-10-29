import Foundation
import WebKit

final class WebKitTransfers {
  private final class WeakTab {
    weak var tab: WebKitTab?
    init(_ tab: WebKitTab) { self.tab = tab }
  }

  private var owners: [ObjectIdentifier: WeakTab] = [:]
  private var liveByKey: [String: WeakTab] = [:]
  private let ledger = ArdiaTransferLedger()
  private var parked: [String: WKWebView] = [:]
  private var offered: [String: WKWebView] = [:]
  private var lastOffer = 0
  private static let reloadHoldSeconds = 30.0
  private static let offerSeconds = 60.0

  init() {
    NotificationCenter.default.addObserver(forName: Notification.Name("RCTBridgeWillReloadNotification"), object: nil, queue: nil) { [weak self] _ in
      if Thread.isMainThread { self?.holdAcrossReload() } else { DispatchQueue.main.async { self?.holdAcrossReload() } }
    }
  }

  var liveTabs: [WebKitTab] { owners.values.compactMap(\.tab) }

  var views: [WKWebView] { liveTabs.compactMap(\.webView) + Array(parked.values) + Array(offered.values) }

  func register(_ webView: WKWebView, tab: WebKitTab) { owners[ObjectIdentifier(webView)] = WeakTab(tab) }

  func unregister(_ webView: WKWebView) { owners.removeValue(forKey: ObjectIdentifier(webView)) }

  func owner(of webView: WKWebView) -> WebKitTab? { owners[ObjectIdentifier(webView)]?.tab }

  func noteLive(_ tab: WebKitTab, key: String) { liveByKey[key] = WeakTab(tab) }

  func forgetLive(_ tab: WebKitTab, key: String) {
    if liveByKey[key]?.tab === tab || liveByKey[key]?.tab == nil { liveByKey.removeValue(forKey: key) }
  }

  func liveTab(_ key: String) -> WebKitTab? { liveByKey[key]?.tab }

  func prepare(_ key: String) {
    _ = ledger.prepare(key)
  }

  func release(_ key: String) {
    let generation = ledger.drop(key)
    DispatchQueue.main.async { self.retireParked(key, generation: generation) }
  }

  func isPrepared(_ key: String) -> Bool { ledger.isPrepared(key) }

  func park(_ webView: WKWebView, key: String) -> Bool {
    guard ledger.park(key) != 0 else { return false }
    if let old = parked[key], old !== webView { WebKitHub.close(old) }
    parked[key] = webView
    return true
  }

  func claimParked(_ key: String) -> WKWebView? {
    ledger.claim(key)
    return parked.removeValue(forKey: key)
  }

  private func retireParked(_ key: String, generation: Int) {
    guard ledger.retireParked(key, generation: generation), let view = parked.removeValue(forKey: key) else { return }
    WebKitHub.close(view)
  }

  func offer(_ webView: WKWebView) -> String {
    lastOffer += 1
    let id = "webkit:\(lastOffer)"
    offered[id] = webView
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.offerSeconds) { [weak self] in
      if let left = self?.offered.removeValue(forKey: id) { WebKitHub.close(left) }
    }
    return id
  }

  func claimOffered(_ id: String) -> WKWebView? { offered.removeValue(forKey: id) }

  var parkedKeys: [String] { parked.keys.sorted() }

  func closeViews(using store: WKWebsiteDataStore) {
    let uses = { (view: WKWebView) in view.configuration.websiteDataStore === store }
    for tab in liveTabs where tab.webView.map(uses) == true { tab.close() }
    for (key, view) in parked where uses(view) {
      ledger.unpark(key)
      parked.removeValue(forKey: key)
      WebKitHub.close(view)
    }
    for (id, view) in offered where uses(view) {
      offered.removeValue(forKey: id)
      WebKitHub.close(view)
    }
  }

  private func holdAcrossReload() {
    let holds = liveTabs.filter { $0.webView != nil }.compactMap(\.transferKey).filter { !$0.isEmpty }.map { ($0, ledger.hold(forReload: $0)) }
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.reloadHoldSeconds) { [weak self] in
      guard let self else { return }
      for (key, generation) in holds where self.ledger.expireReloadHold(key, generation: generation) {
        self.retireParked(key, generation: generation)
      }
    }
  }
}
