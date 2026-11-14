import Foundation

public struct ResearchLink: Equatable, Hashable, Sendable {
  public var url: URL
  public var title: String

  public init(url: URL, title: String) {
    self.url = url
    self.title = title
  }
}

public enum ResearchSearch {
  public static let resultLimit = 5

  public struct RawResult: Equatable, Sendable {
    public var href: String
    public var title: String

    public init(href: String, title: String) {
      self.href = href
      self.title = title
    }
  }

  static let unreadableHosts: Set<String> = [
    "youtube.com", "youtu.be", "m.youtube.com", "tiktok.com", "instagram.com", "facebook.com", "x.com", "twitter.com",
    "pinterest.com", "linkedin.com",
  ]

  public static func resultsPage(for query: String) -> URL? {
    var components = URLComponents(string: "https://html.duckduckgo.com/html/")
    components?.queryItems = [URLQueryItem(name: "q", value: query)]
    return components?.url
  }

  public static func links(from raw: [RawResult], limit: Int = resultLimit) -> [ResearchLink] {
    var links: [ResearchLink] = []
    var hosts: Set<String> = []
    for result in raw {
      guard let url = destination(of: result.href), let host = url.host()?.lowercased() else { continue }
      let bareHost = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
      guard !bareHost.hasSuffix("duckduckgo.com"), !unreadableHosts.contains(bareHost), hosts.insert(bareHost).inserted else { continue }
      let title = result.title.split(whereSeparator: \.isWhitespace).joined(separator: " ")
      links.append(ResearchLink(url: url, title: title.isEmpty ? bareHost : title))
      if links.count == limit { break }
    }
    return links
  }

  static func destination(of href: String) -> URL? {
    let absolute = href.hasPrefix("//") ? "https:" + href : href
    guard let components = URLComponents(string: absolute) else { return nil }
    if components.host?.hasSuffix("duckduckgo.com") == true {
      guard components.path == "/l/", let target = components.queryItems?.first(where: { $0.name == "uddg" })?.value else { return nil }
      return destination(of: target)
    }
    guard let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http", components.host != nil else { return nil }
    return components.url
  }

  public static func links(fromHTML html: String, limit: Int = resultLimit) -> [ResearchLink] {
    var raw: [RawResult] = []
    for match in html.matches(of: anchorPattern) {
      let tag = String(match.output.1)
      guard tag.contains("result__a"), let href = tag.firstMatch(of: hrefPattern)?.output.1 else { continue }
      raw.append(RawResult(href: decodingEntities(String(href)), title: decodingEntities(String(match.output.2).replacing(tagPattern, with: ""))))
    }
    return links(from: raw, limit: limit)
  }

  nonisolated(unsafe) static let anchorPattern = /(?s)<a(\s[^>]*)>(.*?)<\/a>/
  nonisolated(unsafe) static let hrefPattern = /href="([^"]*)"/
  nonisolated(unsafe) static let tagPattern = /<[^>]*>/

  static func decodingEntities(_ text: String) -> String {
    var result = text
    for (entity, value) in [("&quot;", "\""), ("&#x27;", "'"), ("&#39;", "'"), ("&lt;", "<"), ("&gt;", ">"), ("&nbsp;", " "), ("&amp;", "&")] {
      result = result.replacingOccurrences(of: entity, with: value)
    }
    return result
  }
}
