import Foundation

public enum OmniboxSuggestion: Identifiable, Sendable, Equatable {
  case page(url: String, title: String, favicon: String?, tabID: UUID?, bookmarked: Bool, visited: Bool)
  case search(query: String, url: String, engine: String, suggested: Bool, isBang: Bool)
  case calculation(expression: String, value: String, url: String)

  public var id: String {
    switch self {
    case .page(let url, _, _, let tabID, _, _): (tabID == nil ? "page:" : "tab:") + url
    case .search(_, let url, _, _, _): "search:" + url
    case .calculation(let expression, _, _): "calc:" + expression
    }
  }

  public var url: String {
    switch self {
    case .page(let url, _, _, _, _, _), .search(_, let url, _, _, _), .calculation(_, _, let url): url
    }
  }
}

public struct OmniboxResult: Sendable, Equatable {
  public var query: String
  public var suggestions: [OmniboxSuggestion]
  public var inlineCompletion: String

  public static let empty = OmniboxResult(query: "", suggestions: [], inlineCompletion: "")
}

public struct OmniboxResolution: Sendable, Equatable {
  public enum Kind: String, Sendable, Decodable {
    case url
    case search
    case bang
  }

  public var kind: Kind
  public var url: URL
  public var query: String
  public var engine: String
}

public struct SearchEngineInfo: Sendable, Equatable, Identifiable, Decodable {
  public var id: String
  public var name: String
  public var url: String
  public var suggests: Bool?
  public var custom: Bool?
}

public struct DisplayURL: Sendable, Equatable, Decodable {
  public var display: String
  public var host: String
  public var trail: [String]
}

public struct OmniboxContext: Sendable, Equatable {
  public var currentURL: String?
  public var currentTabID: UUID?
  public var prefersSearch: Bool
  public var preventInline: Bool

  public init(currentURL: String? = nil, currentTabID: UUID? = nil, prefersSearch: Bool = false, preventInline: Bool = false) {
    self.currentURL = currentURL
    self.currentTabID = currentTabID
    self.prefersSearch = prefersSearch
    self.preventInline = preventInline
  }
}

public struct OmniboxCandidates: Sendable, Equatable, Encodable {
  public struct Tab: Sendable, Equatable, Encodable {
    public var id: String
    public var url: String
    public var title: String
    public var favicon: String?
  }

  public struct HistoryRow: Sendable, Equatable, Encodable {
    public var url: String
    public var title: String
    public var favicon: String?
    public var visits: Int
    public var lastVisit: Double
  }

  public struct Bookmark: Sendable, Equatable, Encodable {
    public var url: String
    public var title: String
    public var favicon: String?
  }

  public var tabs: [Tab]
  public var history: [HistoryRow]
  public var bookmarks: [Bookmark]

  public init(tabs: [Tab] = [], history: [HistoryRow] = [], bookmarks: [Bookmark] = []) {
    self.tabs = tabs
    self.history = history
    self.bookmarks = bookmarks
  }

  enum CodingKeys: String, CodingKey {
    case tabs, history, bookmarks
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(tabs, forKey: .tabs)
    try container.encode(history, forKey: .history)
    try container.encode(bookmarks, forKey: .bookmarks)
  }
}

struct RawSuggestionResult: Decodable {
  struct Item: Decodable {
    var kind: String
    var url: String?
    var title: String?
    var favicon: String?
    var tabId: String?
    var bookmarked: Bool?
    var visited: Bool?
    var query: String?
    var engine: String?
    var suggested: Bool?
    var bang: Bool?
    var expression: String?
    var value: String?
  }

  var items: [Item]
  var completion: String

  func result(for query: String) -> OmniboxResult {
    let suggestions: [OmniboxSuggestion] = items.compactMap { item in
      switch item.kind {
      case "page":
        guard let url = item.url else { return nil }
        return .page(url: url, title: item.title ?? "", favicon: item.favicon, tabID: item.tabId.flatMap(UUID.init(uuidString:)), bookmarked: item.bookmarked ?? false, visited: item.visited ?? false)
      case "search":
        guard let url = item.url, let query = item.query else { return nil }
        return .search(query: query, url: url, engine: item.engine ?? "", suggested: item.suggested ?? false, isBang: item.bang ?? false)
      case "calc":
        guard let url = item.url, let expression = item.expression, let value = item.value else { return nil }
        return .calculation(expression: expression, value: value, url: url)
      default:
        return nil
      }
    }
    return OmniboxResult(query: query, suggestions: suggestions, inlineCompletion: completion)
  }
}

struct RawResolution: Decodable {
  var kind: OmniboxResolution.Kind
  var url: String
  var query: String
  var engine: String
}
