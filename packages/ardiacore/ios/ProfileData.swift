import Foundation

enum ProfileData {
  typealias Done = ([String]) -> Void
  private typealias Step = (label: String, run: (@escaping (Bool) -> Void) -> Void)

  static func deleteDefault(_ done: @escaping Done) {
    let steps: [Step] = [
      ("history, cookies and cache", { ok in
        ArdiaServices.clearBrowsingData(profile: "", types: ["history", "siteData", "cache", "downloads"], since: 0) { ok(true) }
      }),
      ("autocomplete entries", { ok in
        ArdiaServices.call("ac_browsing_data_clear", profile: "", args: ["types": ["formData", "siteSettings"]]) { ok($0["ok"] as? Bool == true) }
      }),
      ("passwords", deletePasswords),
      ("addresses", { ok in clearEach(list: { done in ArdiaServices.addresses(profile: "") { value, _ in done(listed(value)) } }, key: "addresses", done: ok) {
        item, next in ArdiaServices.deleteAutofillEntry(item["id"] as? String ?? "", profile: "") { _, _ in next() }
      } }),
      ("cards", { ok in clearEach(list: { done in ArdiaServices.cards(profile: "") { value, _ in done(listed(value)) } }, key: "cards", done: ok) {
        item, next in ArdiaServices.deleteAutofillEntry(item["id"] as? String ?? "", profile: "") { _, _ in next() }
      } }),
      ("extensions", { ok in clearEach(list: runningExtensions, key: "extensions", done: ok) {
        item, next in ArdiaServices.setExtension(item["id"] as? String ?? "", enabled: false, profile: "") { _, _ in next() }
      } }),
      ("site settings", resetSiteSettings),
      ("zoom levels", resetZoom),
    ]
    var remaining: [String] = []
    func run(_ i: Int) {
      guard i < steps.count else { return done(remaining) }
      steps[i].run { ok in
        if !ok { remaining.append(steps[i].label) }
        run(i + 1)
      }
    }
    run(0)
  }

  private static func deletePasswords(_ ok: @escaping (Bool) -> Void) {
    clearEach(list: { done in ArdiaServices.listPasswords(profile: "") { value, _ in done(listed(value)) } }, key: "passwords", done: { deleted in
      ArdiaServices.neverSaveOrigins(profile: "") { result, _ in
        let origins = listed(result)["origins"] as? [String] ?? []
        forEach(origins, { origin, next in ArdiaServices.allowSaving(profile: "", origin: origin) { _, _ in next() } }) {
          ArdiaServices.neverSaveOrigins(profile: "") { again, _ in ok(deleted && (listed(again)["origins"] as? [String])?.isEmpty == true) }
        }
      }
    }) { item, next in
      ArdiaServices.deletePassword(profile: "", origin: item["origin"] as? String ?? "", username: item["username"] as? String ?? "") { _, _ in next() }
    }
  }

  private static func runningExtensions(_ completion: @escaping ([String: Any]) -> Void) {
    ArdiaServices.listExtensions(profile: "") { result, _ in
      guard let all = listed(result)["extensions"] as? [[String: Any]] else { return completion([:]) }
      completion(["extensions": all.filter { $0["mayModify"] as? Bool != false && $0["enabled"] as? Bool == true }])
    }
  }

  private static func resetSiteSettings(_ ok: @escaping (Bool) -> Void) {
    ArdiaServices.siteSettingsOrigins(profile: "") { origins, _ in
      forEach(origins as? [String] ?? [], { origin, next in
        ArdiaServices.call("ac_site_settings_reset", profile: "", args: ["origin": origin]) { _ in next() }
      }) {
        ArdiaServices.siteSettingsOrigins(profile: "") { left, _ in ok((left as? [String] ?? []).isEmpty) }
      }
    }
  }

  private static func resetZoom(_ ok: @escaping (Bool) -> Void) {
    ArdiaServices.zoomLevels(profile: "") { levels, _ in
      for host in (levels as? [String: Any] ?? [:]).keys { ArdiaServices.setZoom(1, profile: "", host: host) }
      func check(_ attempt: Int) {
        ArdiaServices.zoomLevels(profile: "") { left, _ in
          let remaining = left as? [String: Any] ?? [:]
          if remaining.isEmpty || attempt >= 20 { return ok(remaining.isEmpty) }
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { check(attempt + 1) }
        }
      }
      check(0)
    }
  }

  private static func clearEach(
    list: @escaping (@escaping ([String: Any]) -> Void) -> Void, key: String, done: @escaping (Bool) -> Void,
    clear: @escaping ([String: Any], @escaping () -> Void) -> Void
  ) {
    list { result in
      guard let items = result[key] as? [[String: Any]] else { return done(false) }
      forEach(items, clear) {
        list { again in done((again[key] as? [Any])?.isEmpty == true) }
      }
    }
  }

  private static func listed(_ value: Any?) -> [String: Any] { value as? [String: Any] ?? [:] }

  private static func forEach<T>(_ items: [T], _ body: @escaping (T, @escaping () -> Void) -> Void, then: @escaping () -> Void) {
    guard let first = items.first else { return then() }
    body(first) { forEach(Array(items.dropFirst()), body, then: then) }
  }
}
