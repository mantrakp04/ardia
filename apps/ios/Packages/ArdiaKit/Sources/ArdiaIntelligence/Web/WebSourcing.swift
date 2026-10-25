import Foundation

public enum SourceError: Error, Sendable, Hashable {
  case offline
  case timedOut
  case blocked
  case badStatus(Int)
  case notAPage
  case nothingToRead
  case failed
}

public protocol BrowseSourcing: Sendable {
  func search(_ query: String) async throws -> [SearchResult]
  func read(_ result: SearchResult) async throws -> ReadablePage
}

public struct WebSourcing: BrowseSourcing {
  static let userAgent =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1"
  static let maximumPageBytes = 2_500_000

  private let session: URLSession
  private let searchTimeout: TimeInterval
  private let readTimeout: TimeInterval

  public init(session: URLSession = WebSourcing.makeSession(), searchTimeout: TimeInterval = 10, readTimeout: TimeInterval = 7) {
    self.session = session
    self.searchTimeout = searchTimeout
    self.readTimeout = readTimeout
  }

  public static func makeSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieAcceptPolicy = .never
    configuration.httpShouldSetCookies = false
    configuration.urlCache = nil
    configuration.httpMaximumConnectionsPerHost = 2
    configuration.waitsForConnectivity = false
    configuration.timeoutIntervalForResource = 15
    return URLSession(configuration: configuration)
  }

  @concurrent
  public func search(_ query: String) async throws -> [SearchResult] {
    let (data, response) = try await fetch(DuckDuckGoResults.searchURL(for: query), timeout: searchTimeout)
    guard response.statusCode == 200 else {
      throw response.statusCode == 202 || response.statusCode == 403 ? SourceError.blocked : SourceError.badStatus(response.statusCode)
    }
    do {
      return try DuckDuckGoResults.parse(Self.decode(data, response: response))
    } catch {
      throw SourceError.blocked
    }
  }

  @concurrent
  public func read(_ result: SearchResult) async throws -> ReadablePage {
    let (data, response) = try await fetch(result.url, timeout: readTimeout)
    guard (200..<300).contains(response.statusCode) else { throw SourceError.badStatus(response.statusCode) }
    let mimeType = response.mimeType?.lowercased() ?? "text/html"
    guard mimeType.contains("html") || mimeType.contains("xml") || mimeType == "text/plain" else {
      throw SourceError.notAPage
    }
    try Task.checkCancellation()
    let bytes = Array(data.prefix(Self.maximumPageBytes))
    let html = Self.decode(Data(bytes), response: response)
    let page = ReadableExtractor.extract(html: html, url: response.url ?? result.url)
    guard page.hasReadableText else { throw SourceError.nothingToRead }
    return page
  }

  private func fetch(_ url: URL, timeout: TimeInterval) async throws -> (Data, HTTPURLResponse) {
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
    request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
    request.setValue("text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", forHTTPHeaderField: "Accept")
    request.setValue(Self.acceptLanguage, forHTTPHeaderField: "Accept-Language")
    do {
      let (data, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else { throw SourceError.failed }
      return (data, http)
    } catch let error as URLError {
      throw Self.map(error)
    }
  }

  static func map(_ error: URLError) -> any Error {
    switch error.code {
    case .cancelled: CancellationError()
    case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
      SourceError.offline
    case .timedOut: SourceError.timedOut
    default: SourceError.failed
    }
  }

  private static var acceptLanguage: String {
    let languages = Locale.preferredLanguages.prefix(3)
    return languages.enumerated().map { index, language in
      index == 0 ? language : "\(language);q=\(String(format: "%.1f", 1.0 - Double(index) * 0.2))"
    }.joined(separator: ", ")
  }

  static func decode(_ data: Data, response: HTTPURLResponse) -> String {
    if let name = response.textEncodingName ?? sniffCharset(data), let encoding = encoding(named: name),
      encoding != .utf8, let text = String(data: data, encoding: encoding)
    {
      return text
    }
    return String(decoding: data, as: UTF8.self)
  }

  private static func sniffCharset(_ data: Data) -> String? {
    let head = String(decoding: data.prefix(2048), as: UTF8.self).lowercased()
    guard let range = head.range(of: "charset=") else { return nil }
    let value = head[range.upperBound...].drop { $0 == "\"" || $0 == "'" }
    let name = value.prefix { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
    return name.isEmpty ? nil : String(name)
  }

  private static func encoding(named name: String) -> String.Encoding? {
    let cfEncoding = CFStringConvertIANACharSetNameToEncoding(name as CFString)
    guard cfEncoding != kCFStringEncodingInvalidId else { return nil }
    return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cfEncoding))
  }
}
