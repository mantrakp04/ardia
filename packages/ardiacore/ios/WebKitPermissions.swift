import Foundation
import WebKit

final class WebKitPermissions {
  typealias StoreID = WebKitStores.StoreID
  typealias SiteKey = WebKitStores.SiteKey

  private struct Pending {
    let browserId: Int32
    let store: StoreID
    let keys: [SiteKey]
    let decide: (Bool) -> Void
  }

  static let kinds = ["camera", "microphone"]

  private unowned let stores: WebKitStores
  private unowned let transfers: WebKitTransfers
  private var pending: [String: Pending] = [:]
  private var lastRequest = 0

  init(stores: WebKitStores, transfers: WebKitTransfers) {
    self.stores = stores
    self.transfers = transfers
  }

  func request(browserId: Int32, tabId: String?, profile: String, origin: String, kinds: [String], decide: @escaping (Bool) -> Void) {
    let store = stores.id(of: profile)
    let keys = kinds.map { SiteKey(site: origin, kind: $0) }
    let remembered = stores.state(store).remembered
    let answers = keys.map { remembered[$0] }
    if answers.contains(false) { return decide(false) }
    if answers.allSatisfy({ $0 == true }) { return decide(true) }
    lastRequest += 1
    let id = "wk-permission-\(lastRequest)"
    pending[id] = Pending(browserId: browserId, store: store, keys: keys, decide: decide)
    ArdiaEvents.emit("permissions.requested", data: ["id": id, "tabId": tabId ?? NSNull(), "origin": origin, "permissions": kinds])
  }

  func resolve(_ id: String, result: String, remember: Bool) {
    guard let request = pending.removeValue(forKey: id) else { return }
    let allowed = result == "accept"
    if remember && result != "dismiss" {
      stores.update(request.store) { state in for key in request.keys { state.remembered[key] = allowed } }
    }
    request.decide(allowed)
  }

  func drop(browserId: Int32) {
    dismiss { $0.browserId == browserId }
  }

  func drop(store: StoreID) {
    dismiss { $0.store == store }
  }

  private func dismiss(_ matching: (Pending) -> Bool) {
    for (id, request) in pending where matching(request) {
      pending.removeValue(forKey: id)
      request.decide(false)
      ArdiaEvents.emit("permissions.dismissed", data: ["id": id])
    }
  }

  func siteSettings(profile: String, origin: String) -> [String: [String: Any]] {
    let remembered = stores.state(stores.id(of: profile)).remembered
    var settings: [String: [String: Any]] = [:]
    for kind in Self.kinds {
      let answer = remembered[SiteKey(site: origin, kind: kind)]
      settings[kind] = ["value": answer.map { $0 ? "allow" : "block" } ?? "ask", "isDefault": answer == nil]
    }
    return settings
  }

  func setSiteSetting(profile: String, origin: String, kind: String, value: String) {
    guard Self.kinds.contains(kind) else { return }
    let key = SiteKey(site: origin, kind: kind)
    stores.update(stores.id(of: profile)) { state in
      switch value {
      case "allow": state.remembered[key] = true
      case "block": state.remembered[key] = false
      default: state.remembered.removeValue(forKey: key)
      }
    }
    guard value == "block" else { return }
    let store = stores.dataStore(for: profile)
    for view in transfers.views.compactMap({ $0 as? WebKitWebView })
    where view.configuration.websiteDataStore === store && view.captureOrigins[kind]?.contains(origin) == true {
      view.stopCapture(kind)
    }
  }

  func reconcileCapture(_ view: WebKitWebView, profile: String) {
    let remembered = stores.state(stores.id(of: profile)).remembered
    for (kind, origins) in view.captureOrigins where origins.contains(where: { remembered[SiteKey(site: $0, kind: kind)] == false }) {
      view.stopCapture(kind)
    }
  }
}
