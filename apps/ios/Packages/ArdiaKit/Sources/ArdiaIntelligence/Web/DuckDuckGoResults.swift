import Foundation

public struct SearchResult: Sendable, Codable, Hashable, Identifiable {
  public var url: URL
  public var title: String
  public var snippet: String

  public init(url: URL, title: String, snippet: String) {
    self.url = url
    self.title = title
    self.snippet = snippet
  }

  public var id: URL { url }
  public var siteKey: String { SiteKey.key(for: url) }
  public var displayHost: String { SiteKey.displayHost(of: url) }
  public var faviconURL: URL? { SiteKey.faviconURL(for: url) }
}

enum SiteKey {
  private static let droppedLabels: Set<String> = ["www", "m", "mobile", "amp"]

  static func key(for url: URL) -> String {
    let labels = (url.host() ?? "").lowercased().split(separator: ".").map(String.init)
    var kept = labels
    while kept.count > 2, let first = kept.first, droppedLabels.contains(first) { kept.removeFirst() }
    if kept.count > 2 { kept = [kept[0]] + kept.dropFirst().filter { !droppedLabels.contains($0) } }
    return kept.joined(separator: ".")
  }

  static func displayHost(of url: URL) -> String {
    let host = (url.host() ?? url.absoluteString).lowercased()
    return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
  }

  static func faviconURL(for url: URL) -> URL? {
    guard let host = url.host()?.lowercased(), !host.isEmpty else { return nil }
    return URL(string: "https://external-content.duckduckgo.com/ip3/\(host).ico")
  }

  private static let unreadableSites = [
    "youtube.com", "youtu.be", "tiktok.com", "instagram.com", "facebook.com", "x.com", "twitter.com", "pinterest.com",
    "linkedin.com", "threads.net", "vimeo.com", "spotify.com",
  ]

  static func isLikelyReadable(_ url: URL) -> Bool {
    let key = key(for: url)
    if unreadableSites.contains(where: { key == $0 || key.hasSuffix(".\($0)") }) { return false }
    let path = url.path.lowercased()
    return !(path.hasSuffix(".pdf") || path.hasSuffix(".mp4") || path.hasSuffix(".zip"))
  }
}

public enum DuckDuckGoResults {
  public enum ParseError: Error, Equatable {
    case blocked
  }

  public static func searchURL(for query: String) -> URL {
    var components = URLComponents(string: "https://html.duckduckgo.com/html/")!
    components.queryItems = [URLQueryItem(name: "q", value: query)]
    return components.url!
  }

  public static func parse(_ html: String) throws(ParseError) -> [SearchResult] {
    if html.contains("anomaly-modal") || html.contains("challenge-form") {
      throw .blocked
    }
    var results: [SearchResult] = []
    var seen: Set<String> = []
    var containerIsAd = false
    var pending: (href: String, title: String, snippet: String)?
    var capture: Capture?

    func emit() {
      defer { pending = nil }
      guard let found = pending, let url = destination(fromHref: found.href) else { return }
      let title = ReadableExtractor.collapseWhitespace(found.title)
      guard !title.isEmpty else { return }
      let normalized = normalizedKey(url)
      guard seen.insert(normalized).inserted else { return }
      results.append(
        SearchResult(url: url, title: title, snippet: ReadableExtractor.collapseWhitespace(found.snippet)))
    }

    for token in HTMLTokenizer(html) {
      switch token {
      case .start(let name, let attributes, _):
        let classes = attributes.classNames
        if name == "div", classes.contains("result") {
          emit()
          capture = nil
          containerIsAd = classes.contains("result--ad")
          continue
        }
        if let current = capture {
          if name == current.element { capture?.depth += 1 }
          continue
        }
        if name == "a", classes.contains("result__a") {
          emit()
          let href = attributes["href"] ?? ""
          if containerIsAd || isAdLink(href) {
            pending = nil
            capture = Capture(element: name, field: .ignored)
          } else {
            pending = (href, "", "")
            capture = Capture(element: name, field: .title)
          }
        } else if classes.contains("result__snippet"), pending != nil {
          capture = Capture(element: name, field: .snippet)
        }
      case .end(let name):
        guard let current = capture, name == current.element else { continue }
        if current.depth > 0 {
          capture?.depth -= 1
        } else {
          capture = nil
        }
      case .text(let text):
        guard let current = capture else { continue }
        switch current.field {
        case .title: pending?.title += text
        case .snippet: pending?.snippet += text
        case .ignored: break
        }
      }
    }
    emit()
    return results
  }

  static func destination(fromHref href: String) -> URL? {
    let absolute = href.hasPrefix("//") ? "https:" + href : href
    guard let url = URL(string: absolute), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
      let host = url.host()?.lowercased()
    else { return nil }
    if host == "duckduckgo.com" || host.hasSuffix(".duckduckgo.com") {
      guard url.path == "/l" || url.path.hasPrefix("/l/"),
        let target = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: {
          $0.name == "uddg"
        })?.value
      else { return nil }
      return destination(fromHref: target)
    }
    return url
  }

  static func isAdLink(_ href: String) -> Bool {
    href.contains("duckduckgo.com/y.js") || href.contains("ad_domain=") || href.contains("ad_provider=")
  }

  static func normalizedKey(_ url: URL) -> String {
    var path = url.path
    while path.hasSuffix("/") { path.removeLast() }
    let query = url.query().map { "?" + $0 } ?? ""
    return SiteKey.key(for: url) + path + query
  }

  public static func distinctSites(_ results: [SearchResult], limit: Int) -> [SearchResult] {
    var seen: Set<String> = []
    var readable: [SearchResult] = []
    var others: [SearchResult] = []
    for result in results where seen.insert(result.siteKey).inserted {
      if SiteKey.isLikelyReadable(result.url) {
        readable.append(result)
      } else {
        others.append(result)
      }
    }
    return Array((readable + others).prefix(limit))
  }

  private struct Capture {
    enum Field { case title, snippet, ignored }
    var element: String
    var field: Field
    var depth = 0
  }
}
