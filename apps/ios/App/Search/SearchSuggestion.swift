import ArdiaBrowser
import Foundation

struct SearchSuggestion: Identifiable, Hashable {
  enum Kind: Hashable {
    case query
    case url
    case openTab(UUID)
    case remoteTab(deviceName: String)
    case history
    case bookmark
    case calculation
  }

  var id: String
  var kind: Kind
  var title: String
  var detail: String?
  var url: String?
  var query: String
  var favicon: String? = nil
  var copyValue: String? = nil

  var offersBrowseForMe: Bool {
    if case .query = kind { return !query.trimmingCharacters(in: .whitespaces).isEmpty }
    return false
  }

  var symbol: String {
    switch kind {
    case .query: "magnifyingglass"
    case .url: "globe"
    case .openTab: "square.on.square"
    case .remoteTab: "laptopcomputer"
    case .history: "clock"
    case .bookmark: "star"
    case .calculation: "equal"
    }
  }

  var showsFavicon: Bool {
    switch kind {
    case .query, .calculation: false
    default: url != nil
    }
  }

  static func query(_ text: String) -> SearchSuggestion {
    SearchSuggestion(id: "q:" + text.lowercased(), kind: .query, title: text, detail: nil, url: nil, query: text)
  }
}

enum SearchInput {
  enum Destination: Equatable {
    case url(URL)
    case search(String)
  }

  static func resolve(_ raw: String) -> Destination? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }
    if let url = url(from: text) { return .url(url) }
    return .search(text)
  }

  static func url(from text: String) -> URL? {
    guard !text.contains(" ") || text.lowercased().hasPrefix("http") else { return nil }
    let lower = text.lowercased()
    if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
      return URL(string: text.replacingOccurrences(of: " ", with: "%20"))
    }
    if lower.hasPrefix("about:") || lower.hasPrefix("ardia:") { return nil }
    let hostPart = String(lower.split(separator: "/", maxSplits: 1).first ?? "")
    let hostOnly = String(hostPart.split(separator: ":").first ?? "")
    if hostOnly == "localhost" || isIPv4(hostOnly) {
      return URL(string: "http://" + text)
    }
    let labels = hostOnly.split(separator: ".", omittingEmptySubsequences: false)
    guard labels.count >= 2, labels.allSatisfy({ !$0.isEmpty }), let tld = labels.last,
          tld.count >= 2, tld.allSatisfy({ $0.isLetter }) || tld.hasPrefix("xn--") else { return nil }
    guard hostOnly.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." }) else { return nil }
    return URL(string: "https://" + text)
  }

  static func isIPv4(_ text: String) -> Bool {
    let parts = text.split(separator: ".")
    return parts.count == 4 && parts.allSatisfy { Int($0).map { (0...255).contains($0) } ?? false }
  }

  static func displayHost(_ url: String) -> String {
    BrowserURL.host(of: url) ?? url
  }
}
