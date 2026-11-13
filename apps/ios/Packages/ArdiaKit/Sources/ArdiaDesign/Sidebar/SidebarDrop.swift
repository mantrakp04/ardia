import ArdiaBrowser
import Foundation

public enum SidebarDrop {
  public enum Destination: Equatable, Sendable {
    case page(URL)
    case search(String)
  }

  public static let maxQueryLength = 512
  public static let ownRowType = "com.ardia.browser.ios.sidebar-row"

  public static func exportedLink(url: String, isPrivate: Bool) -> URL? {
    guard !isPrivate, BrowserURL.isSyncable(url) else { return nil }
    return URL(string: url)
  }

  public static func accepts(typeIdentifiers: [String]) -> Bool {
    !typeIdentifiers.contains(ownRowType)
  }
  static let webSchemes: Set<String> = ["http", "https"]

  public static func destination(for url: URL) -> Destination? {
    guard let scheme = url.scheme?.lowercased(), webSchemes.contains(scheme), url.host() != nil else { return nil }
    return .page(url)
  }

  public static func destination(for text: String) -> Destination? {
    let words = text.split(whereSeparator: \.isWhitespace)
    guard !words.isEmpty else { return nil }
    if words.count == 1, let url = webURL(String(words[0])) { return .page(url) }
    return .search(query(from: words))
  }

  static func webURL(_ token: String) -> URL? {
    if let url = URL(string: token), let scheme = url.scheme?.lowercased() {
      if webSchemes.contains(scheme) { return url.host() == nil ? nil : url }
      if token.contains("://") || !looksLikeHost(token) { return nil }
    }
    guard looksLikeHost(token) else { return nil }
    return URL(string: "https://" + token)
  }

  static func looksLikeHost(_ token: String) -> Bool {
    let host = token.split(separator: "/", maxSplits: 1).first.map(String.init) ?? ""
    let hostOnly = host.split(separator: ":").first.map(String.init) ?? ""
    let labels = hostOnly.split(separator: ".", omittingEmptySubsequences: false)
    guard labels.count >= 2, labels.allSatisfy({ !$0.isEmpty }), let tld = labels.last else { return false }
    guard tld.count >= 2, tld.allSatisfy(\.isLetter) || tld.hasPrefix("xn--") else { return false }
    return hostOnly.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." }
  }

  static func query(from words: [Substring]) -> String {
    var query = ""
    for word in words {
      let next = query.isEmpty ? String(word) : query + " " + word
      guard next.count <= maxQueryLength else { break }
      query = next
    }
    return query.isEmpty ? String(words[0].prefix(maxQueryLength)) : query
  }
}
