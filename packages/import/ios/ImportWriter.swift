import Foundation
import ArdiaCore

final class ImportVault: @unchecked Sendable {
  struct Entry {
    var cookies: [Cookie]
    var addresses: [ImportedAddress]
    var cards: [ImportedCard]
    var kept: Date
  }

  private static let lifetime: TimeInterval = 600
  private let lock = NSLock()
  private var entries: [String: Entry] = [:]

  func keep(cookies: [Cookie], addresses: [ImportedAddress], cards: [ImportedCard]) -> String? {
    guard !cookies.isEmpty || !addresses.isEmpty || !cards.isEmpty else { return nil }
    let token = UUID().uuidString
    lock.withLock {
      purge()
      entries[token] = Entry(cookies: cookies, addresses: addresses, cards: cards, kept: Date())
    }
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + Self.lifetime + 1) { [weak self] in
      self?.lock.withLock { self?.purge() }
    }
    return token
  }

  func take(_ token: String) -> Entry? {
    lock.withLock {
      purge()
      return entries.removeValue(forKey: token)
    }
  }

  func discard(_ token: String) { _ = take(token) }
  func discardAll() { lock.withLock { entries.removeAll() } }

  private func purge() {
    let cutoff = Date().addingTimeInterval(-Self.lifetime)
    entries = entries.filter { $0.value.kept > cutoff }
  }
}

enum ImportWriter {
  static let cookieBatch = 500
  static let autofillBatch = 500

  @MainActor
  static func write(_ entry: ImportVault.Entry, profile: String, kinds: Set<ImportKind>) async -> String {
    var out: [String: Int] = ["cookies": 0, "cookiesRejected": 0, "cookiesExisting": 0, "addresses": 0, "cards": 0]
    var error: String?
    func add(_ key: String, _ reply: [String: Any], _ field: String) {
      out[key, default: 0] += (reply[field] as? NSNumber)?.intValue ?? 0
    }
    if kinds.contains(.cookies), !entry.cookies.isEmpty {
      let wire = CookieWire.batches(entry.cookies, size: cookieBatch)
      out["cookiesRejected"] = wire.dropped
      for batch in wire.batches {
        let reply = await engine("ac_cookies_import", profile: profile, args: batch)
        if let message = reply["error"] as? String {
          error = message
          out["cookiesFailed"] = 1
          break
        }
        add("cookies", reply, "imported")
        add("cookiesRejected", reply, "rejected")
        add("cookiesExisting", reply, "existing")
      }
      wire.batches.forEach { $0.wipe() }
    }
    if kinds.contains(.autofill) {
      var start = 0
      while start < max(entry.addresses.count, entry.cards.count) {
        let addresses = Array(entry.addresses[min(start, entry.addresses.count)..<min(start + autofillBatch, entry.addresses.count)])
        let cards = Array(entry.cards[min(start, entry.cards.count)..<min(start + autofillBatch, entry.cards.count)])
        start += autofillBatch
        let reply = await engine("ac_autofill_import", profile: profile, args: AutofillWire.batch(addresses: addresses, cards: cards))
        if let message = reply["error"] as? String {
          error = error ?? message
          out["autofillFailed"] = 1
          break
        }
        add("addresses", reply, "addresses")
        add("cards", reply, "cards")
      }
    }
    var body: [String: Any] = out
    if let error { body["error"] = error }
    let data = (try? JSONSerialization.data(withJSONObject: body)) ?? Data("{}".utf8)
    return String(decoding: data, as: UTF8.self)
  }

  @MainActor
  private static func engine(_ name: String, profile: String, args: SecretBytes) async -> [String: Any] {
    let data = args.withUnsafeBytes { NSMutableData(bytes: $0.baseAddress, length: $0.count) }
    args.wipe()
    let json: String = await withCheckedContinuation { done in
      ArdiaEngineBridge.callWithSecret(name, profile: profile, args: data) { done.resume(returning: $0) }
    }
    let parsed = try? JSONSerialization.jsonObject(with: Data(json.utf8))
    return parsed as? [String: Any] ?? ["error": "bad reply from the engine"]
  }
}
