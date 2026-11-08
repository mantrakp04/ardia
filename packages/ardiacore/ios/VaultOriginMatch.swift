import Foundation

enum VaultOriginMatch {
  private static let localHosts: Set<String> = ["localhost", "127.0.0.1", "::1"]

  static func isLocalHost(_ host: String) -> Bool { localHosts.contains(normalized(host)) }

  static func isSecure(_ origin: String) -> Bool {
    guard let page = parts(of: origin, assumingHTTPS: false) else { return false }
    return page.scheme == "https" || (page.scheme == "http" && localHosts.contains(page.host))
  }

  static func host(of text: String) -> String? { parts(of: text, assumingHTTPS: true)?.host }

  static func matches(_ urls: [String], origin: String) -> Bool { urls.contains { matches($0, origin: origin) } }

  static func matches(_ url: String, origin: String) -> Bool {
    guard isSecure(origin), let page = parts(of: origin, assumingHTTPS: false), let saved = parts(of: url, assumingHTTPS: true),
      saved.scheme == "https" || saved.scheme == "http"
    else { return false }
    if let port = saved.port, port != (page.port ?? defaultPort(page.scheme)) { return false }
    return hostsMatch(saved.host, page.host)
  }

  static func hostsMatch(_ first: String, _ second: String) -> Bool {
    let one = normalized(first)
    let other = normalized(second)
    guard !one.isEmpty, !other.isEmpty else { return false }
    if one == other { return true }
    guard !isAddress(one), !isAddress(other) else { return false }
    let shorter = one.count <= other.count ? one : other
    let longer = one.count <= other.count ? other : one
    guard shorter.contains("."), !shorter.hasPrefix(".") else { return false }
    return longer.hasSuffix("." + shorter)
  }

  static func parts(of text: String, assumingHTTPS: Bool) -> (scheme: String, host: String, port: Int?)? {
    var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return nil }
    if !value.contains("://") {
      guard assumingHTTPS else { return nil }
      value = "https://" + value
    }
    guard let components = URLComponents(string: value), let scheme = components.scheme?.lowercased(), let rawHost = components.host
    else { return nil }
    let host = normalized(rawHost)
    guard !host.isEmpty else { return nil }
    return (scheme, host, components.port)
  }

  private static func isAddress(_ host: String) -> Bool {
    host.contains(":") || host.allSatisfy { $0.isASCII && ($0.isNumber || $0 == ".") }
  }

  private static func defaultPort(_ scheme: String) -> Int { scheme == "http" ? 80 : 443 }

  private static func normalized(_ host: String) -> String {
    var value = host.lowercased()
    if value.hasPrefix("[") && value.hasSuffix("]") { value = String(value.dropFirst().dropLast()) }
    while value.hasSuffix(".") { value.removeLast() }
    return value
  }
}
