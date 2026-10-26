import Foundation

public enum RecentSearches {
  public static let hosts = ["google.com", "bing.com", "duckduckgo.com", "ecosia.org", "brave.com", "kagi.com", "startpage.com", "yahoo.com", "perplexity.ai", "baidu.com", "yandex.com", "chatgpt.com"]
  public static let queryKeys = ["q", "query", "p", "text", "wd", "search_query"]

  public static func query(in url: String) -> String? {
    guard let components = URLComponents(string: url), let host = components.host,
          hosts.contains(where: { host == $0 || host.hasSuffix("." + $0) }) else { return nil }
    for key in queryKeys {
      if let raw = components.queryItems?.first(where: { $0.name == key })?.value {
        let value = raw.replacingOccurrences(of: "+", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { continue }
        return value
      }
    }
    return nil
  }

  public static func queries(fromNewestFirst urls: [String], limit: Int) -> [String] {
    var seen: Set<String> = []
    var result: [String] = []
    for url in urls {
      guard result.count < limit else { break }
      guard let query = query(in: url) else { continue }
      let key = query.lowercased()
      guard seen.insert(key).inserted else { continue }
      result.append(query)
    }
    return result
  }
}
