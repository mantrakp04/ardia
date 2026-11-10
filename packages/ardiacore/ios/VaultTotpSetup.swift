import CoreGraphics
import Foundation

struct VaultTotpOffer: Sendable {
  let uri: String
  let issuer: String
  let account: String
  let origin: String
  let at: Date
}

final class VaultCodeAnswer: @unchecked Sendable {
  let answer: ([String: String]?) -> Void
  let image: CGImage?

  init(_ answer: @escaping ([String: String]?) -> Void, image: CGImage?) {
    self.answer = answer
    self.image = image
  }
}

enum VaultTotpSetup {
  static let lifetime: TimeInterval = 600
  static let maxOffers = 8
  static let longestLabel = 120
  private static let lock = NSLock()
  nonisolated(unsafe) private static var offers: [String: VaultTotpOffer] = [:]

  static func enable(_ enabled: Bool) {
    ArdiaWebView.setVaultCodeReader { image, text, origin, answer in
      Self.read(image: image, text: text, origin: origin, answer)
    }
    ArdiaWebView.setVaultCodeSetup(enabled)
    if !enabled { forgetAll() }
  }

  static func read(image: CGImage?, text: String?, origin: String, _ answer: @escaping ([String: String]?) -> Void) {
    let reply = VaultCodeAnswer(answer, image: image)
    DispatchQueue.global(qos: .userInitiated).async {
      var found: String?
      if let picture = reply.image {
        found = Self.setupURI(in: VaultQRDecoder.payloads(in: picture))
      } else if let text {
        found = Self.setupURI(inText: text, origin: origin)
      }
      let offer = found.flatMap { Self.keep($0, origin: origin) }
      DispatchQueue.main.async { reply.answer(offer) }
    }
  }

  static func keep(_ uri: String, origin: String) -> [String: String]? {
    guard let names = labels(uri) else { return nil }
    let token = UUID().uuidString
    let now = Date()
    lock.lock()
    defer { lock.unlock() }
    offers = offers.filter { now.timeIntervalSince($0.value.at) < lifetime }
    while offers.count >= maxOffers, let oldest = offers.min(by: { $0.value.at < $1.value.at })?.key { offers[oldest] = nil }
    offers[token] = VaultTotpOffer(uri: uri, issuer: names.issuer, account: names.account, origin: origin, at: now)
    return ["token": token, "issuer": names.issuer, "account": names.account]
  }

  static func offer(_ token: String) -> VaultTotpOffer? {
    lock.lock()
    defer { lock.unlock() }
    guard let found = offers[token] else { return nil }
    guard Date().timeIntervalSince(found.at) < lifetime else {
      offers[token] = nil
      return nil
    }
    return found
  }

  static func forget(_ token: String) {
    lock.lock()
    offers[token] = nil
    lock.unlock()
  }

  static func forgetAll() {
    lock.lock()
    offers = [:]
    lock.unlock()
  }

  static func isSetupURI(_ text: String) -> Bool {
    text.lowercased().hasPrefix("otpauth://totp/") && VaultTotpSecret(text) != nil
  }

  static func setupURI(in payloads: [String]) -> String? {
    var distinct: [String] = []
    for payload in payloads {
      let trimmed = payload.trimmingCharacters(in: .whitespacesAndNewlines)
      if isSetupURI(trimmed), !distinct.contains(trimmed) { distinct.append(trimmed) }
    }
    return distinct.count == 1 ? distinct[0] : nil
  }

  static func setupURI(inText text: String, origin: String) -> String? {
    guard text.count <= 2048 else { return nil }
    if let range = text.range(of: #"otpauth://[^\s"'<>]+"#, options: [.regularExpression, .caseInsensitive]) {
      let found = String(text[range])
      return isSetupURI(found) ? found : nil
    }
    return keyURI(text, origin: origin)
  }

  static func keyURI(_ text: String, origin: String) -> String? {
    let cleaned = text.uppercased().filter { !$0.isWhitespace && $0 != "-" && $0 != "=" }
    guard (16...128).contains(cleaned.count), VaultTotpSecret.base32(cleaned) != nil, VaultOriginMatch.isSecure(origin),
      let host = VaultOriginMatch.host(of: origin)
    else { return nil }
    let site = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    var components = URLComponents()
    components.scheme = "otpauth"
    components.host = "totp"
    components.path = "/" + site
    components.queryItems = [URLQueryItem(name: "secret", value: cleaned), URLQueryItem(name: "issuer", value: site)]
    guard let uri = components.string, isSetupURI(uri) else { return nil }
    return uri
  }

  static func labels(_ uri: String) -> (issuer: String, account: String)? {
    guard isSetupURI(uri), let components = URLComponents(string: uri) else { return nil }
    let path = components.path
    let label = path.hasPrefix("/") ? String(path.dropFirst()) : path
    let parts = label.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).map {
      $0.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    let named = components.queryItems?.first { $0.name.lowercased() == "issuer" }?.value?.trimmingCharacters(in: .whitespacesAndNewlines)
    let issuer = named.flatMap { $0.isEmpty ? nil : $0 } ?? (parts.count == 2 ? parts[0] : "")
    let account = parts.count == 2 ? parts[1] : (parts.first ?? "")
    return (String(issuer.prefix(longestLabel)), String(account.prefix(longestLabel)))
  }
}
