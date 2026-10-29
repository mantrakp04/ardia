import Foundation

protocol PageEngine {
  func owns(_ id: String) -> Bool
  func resolvePermission(_ id: String, result: String, remember: Bool)
  func resolveExternalApp(_ id: String, open: Bool, remember: Bool)
  func downloadCommand(_ action: String, id: String)
  func externalAppAllowances(profile: String, done: @escaping ([[String: Any]]) -> Void)
  func removeExternalAppAllowance(profile: String, origin: String, scheme: String)
  func siteSettings(profile: String, origin: String, done: @escaping (Any?, String?) -> Void)
  func setSiteSetting(profile: String, origin: String, type: String, value: String)
  func clearSiteData(profile: String, origin: String, done: @escaping (Any?, String?) -> Void)
  func prepareTransfer(_ key: String)
  func releaseTransfer(_ key: String)
  func clearBrowsingData(profile: String, types: [String], since: Double, done: @escaping () -> Void)
  func deleteProfileData(profile: String, done: @escaping ([String]) -> Void)
}

struct ChromiumPageEngine: PageEngine {
  func owns(_ id: String) -> Bool { true }

  func resolvePermission(_ id: String, result: String, remember: Bool) {
    ArdiaHost.resolvePermission(id, result: result, remember: remember)
  }

  func resolveExternalApp(_ id: String, open: Bool, remember: Bool) {
    ArdiaHost.resolveExternalApp(id, open: open, remember: remember)
  }

  func downloadCommand(_ action: String, id: String) { ArdiaServices.downloadCommand(action, id: id) }

  func externalAppAllowances(profile: String, done: @escaping ([[String: Any]]) -> Void) {
    ArdiaServices.externalAppAllowances(profile: profile) { value, _ in done(value as? [[String: Any]] ?? []) }
  }

  func removeExternalAppAllowance(profile: String, origin: String, scheme: String) {
    ArdiaServices.removeExternalAppAllowance(profile: profile, origin: origin, scheme: scheme)
  }

  func siteSettings(profile: String, origin: String, done: @escaping (Any?, String?) -> Void) {
    ArdiaServices.siteSettings(profile: profile, origin: origin, reply: done)
  }

  func setSiteSetting(profile: String, origin: String, type: String, value: String) {
    ArdiaServices.setSiteSetting(value, profile: profile, origin: origin, type: type)
  }

  func clearSiteData(profile: String, origin: String, done: @escaping (Any?, String?) -> Void) {
    ArdiaServices.clearSiteData(profile: profile, origin: origin, reply: done)
  }

  func prepareTransfer(_ key: String) { ArdiaWebView.prepareTransfer(key) }

  func releaseTransfer(_ key: String) { ArdiaWebView.releaseTransfer(key) }

  func clearBrowsingData(profile: String, types: [String], since: Double, done: @escaping () -> Void) {
    ArdiaServices.clearBrowsingData(profile: profile, types: types, since: since, completion: done)
  }

  func deleteProfileData(profile: String, done: @escaping ([String]) -> Void) {
    if profile.isEmpty { return ProfileData.deleteDefault(done) }
    ArdiaHost.deleteProfileData(profile, completion: done)
  }
}

struct WebKitPageEngine: PageEngine {
  var hub: WebKitHub { WebKitHub.shared }

  func owns(_ id: String) -> Bool { id.hasPrefix("wk-") }

  func resolvePermission(_ id: String, result: String, remember: Bool) {
    hub.permissions.resolve(id, result: result, remember: remember)
  }

  func resolveExternalApp(_ id: String, open: Bool, remember: Bool) { hub.externalApps.resolve(id, open: open, remember: remember) }

  func downloadCommand(_ action: String, id: String) { hub.downloads.command(action, id: id) }

  func externalAppAllowances(profile: String, done: @escaping ([[String: Any]]) -> Void) {
    done(hub.externalApps.allowances(profile: profile))
  }

  func removeExternalAppAllowance(profile: String, origin: String, scheme: String) {
    hub.externalApps.removeAllowance(profile: profile, origin: origin, scheme: scheme)
  }

  func siteSettings(profile: String, origin: String, done: @escaping (Any?, String?) -> Void) {
    done(hub.permissions.siteSettings(profile: profile, origin: origin), nil)
  }

  func setSiteSetting(profile: String, origin: String, type: String, value: String) {
    hub.permissions.setSiteSetting(profile: profile, origin: origin, kind: type, value: value)
  }

  func clearSiteData(profile: String, origin: String, done: @escaping (Any?, String?) -> Void) {
    guard let host = URL(string: origin)?.host, !host.isEmpty else { return done(["cookies": false, "storage": false], nil) }
    hub.clearSiteData(profile: profile, host: host) { done($0, nil) }
  }

  func prepareTransfer(_ key: String) { hub.transfers.prepare(key) }

  func releaseTransfer(_ key: String) { hub.transfers.release(key) }

  func clearBrowsingData(profile: String, types: [String], since: Double, done: @escaping () -> Void) {
    hub.clearBrowsingData(profile: profile, types: types, since: since, completion: done)
  }

  func deleteProfileData(profile: String, done: @escaping ([String]) -> Void) {
    hub.deleteProfileData(profile) { deleted in done(deleted ? [] : ["WebKit data"]) }
  }
}

enum PageEngines {
  static let chromium = ChromiumPageEngine()
  static let webKit = WebKitPageEngine()
  static let all: [PageEngine] = [webKit, chromium]

  static func owner(of id: String) -> PageEngine { all.first { $0.owns(id) } ?? chromium }

  static func externalAppAllowances(profile: String, done: @escaping ([[String: Any]]) -> Void) {
    chromium.externalAppAllowances(profile: profile) { chromiumAllowances in
      webKit.externalAppAllowances(profile: profile) { webKitAllowances in
        let key = { (a: [String: Any]) in "\(a["origin"] ?? "")|\(a["scheme"] ?? "")" }
        let seen = Set(chromiumAllowances.map(key))
        done(chromiumAllowances + webKitAllowances.filter { !seen.contains(key($0)) })
      }
    }
  }

  static func removeExternalAppAllowance(profile: String, origin: String, scheme: String) {
    for engine in all { engine.removeExternalAppAllowance(profile: profile, origin: origin, scheme: scheme) }
  }

  static func clearBrowsingData(profile: String, types: [String], since: Double, done: @escaping () -> Void) {
    var left = all.count
    for engine in all {
      engine.clearBrowsingData(profile: profile, types: types, since: since) {
        left -= 1
        if left == 0 { done() }
      }
    }
  }

  static func deleteProfileData(profile: String, done: @escaping ([String]) -> Void) {
    var chromiumLeft: [String]?
    var webKitLeft: [String]?
    let finish = {
      guard let chromiumLeft, let webKitLeft else { return }
      done(chromiumLeft + webKitLeft)
    }
    chromium.deleteProfileData(profile: profile) { chromiumLeft = $0; finish() }
    webKit.deleteProfileData(profile: profile) { webKitLeft = $0; finish() }
  }
}
