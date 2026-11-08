import Foundation

enum VaultOriginMatch {
  private static let localHosts: Set<String> = ["localhost", "127.0.0.1", "::1"]
  private static let registrySuffixes: Set<String> = [
    "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "ac.uk", "gov.uk", "nhs.uk", "com.au", "net.au", "org.au", "edu.au",
    "gov.au", "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "co.nz", "org.nz", "net.nz", "co.za", "co.in", "net.in", "org.in",
    "co.kr", "or.kr", "com.br", "net.br", "org.br", "com.cn", "net.cn", "org.cn", "com.hk", "com.tw", "com.sg", "com.my", "com.mx",
    "com.ar", "com.tr", "com.ua", "co.il", "co.id", "com.ph", "com.vn", "com.pk", "com.ng", "com.eg", "com.sa", "co.th", "com.pl",
    "com.es", "com.pt", "com.ru", "co.at", "or.at", "co.ke",
  ]
  private static let sharedHostingSuffixes: Set<String> = [
    "github.io", "gitlab.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "web.app", "firebaseapp.com",
    "blogspot.com", "azurewebsites.net", "cloudfront.net", "appspot.com", "s3.amazonaws.com", "amplifyapp.com", "onrender.com",
    "fly.dev", "glitch.me", "repl.co", "ngrok.io", "ngrok-free.app", "wordpress.com", "myshopify.com", "surge.sh",
  ]
  private static let registryLabels: Set<String> = ["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "gob", "mil", "nom"]

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
    guard shorter.contains("."), !shorter.hasPrefix("."), !isRegistrySuffix(shorter), !isSharedHosting(longer) else { return false }
    return longer.hasSuffix("." + shorter)
  }

  static func isRegistrySuffix(_ host: String) -> Bool {
    if registrySuffixes.contains(host) || sharedHostingSuffixes.contains(host) { return true }
    let labels = host.split(separator: ".")
    return labels.count == 2 && labels[1].count == 2 && registryLabels.contains(String(labels[0]))
  }

  static func isSharedHosting(_ host: String) -> Bool {
    sharedHostingSuffixes.contains { host == $0 || host.hasSuffix("." + $0) }
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
    guard !host.isEmpty, host.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "-.:_".contains($0)) }) else { return nil }
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
