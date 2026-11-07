import ArdiaShared
import ArdiaSync
import Foundation

public actor Omnibox {
  public static let bangListURL = URL(string: "https://services.helium.imput.net/bangs.json")!
  public static let bangRefreshInterval: TimeInterval = 7 * 24 * 3600

  private var loadedScript: ScriptEngine?
  private let session: URLSession
  private let bangsFile: URL?
  private var bangEtag: String?
  private var bangsLoaded = false
  private var bangsCheckedAt: Date?

  public init(directory: URL? = URL.applicationSupportDirectory.appending(path: "Omnibox", directoryHint: .isDirectory), session: URLSession = .shared) {
    self.session = session
    bangsFile = directory?.appending(path: "bangs.txt")
  }

  private var script: ScriptEngine {
    get throws {
      if let loadedScript { return loadedScript }
      let engine = try ScriptEngine(scripts: [.core])
      loadedScript = engine
      return engine
    }
  }

  public func warmUp() {
    _ = try? script.call(.core, "mobileWarmBangs")
  }

  public func setCandidates(_ candidates: OmniboxCandidates) {
    guard let json = Self.encode(candidates) else { return }
    _ = try? script.call(.core, "mobileSetSources", json: [json])
  }

  @discardableResult
  public func setSearch(_ search: SyncedSearch?, localEngineID: String) -> SearchEngineInfo? {
    struct Input: Encodable {
      var engineId: String
      var customUrl: String?
      var customEngines: [SyncedSearch.CustomEngine]
    }
    let input = Input(engineId: search?.engineId ?? localEngineID, customUrl: search?.customURL, customEngines: search?.customEngines ?? [])
    guard let json = Self.encode(input), let output = try? script.call(.core, "mobileSetSearch", json: [json]) else { return nil }
    return Self.decode(SearchEngineInfo.self, output)
  }

  public func engines() -> [SearchEngineInfo] {
    guard let output = try? script.call(.core, "mobileEngines") else { return [] }
    return Self.decode([SearchEngineInfo].self, output) ?? []
  }

  public func suggest(_ text: String, context: OmniboxContext = OmniboxContext(), remote: [String] = [], now: Date = .now) -> OmniboxResult {
    struct Options: Encodable {
      var currentUrl: String?
      var currentTabId: String?
      var remote: [String]
      var preference: String
      var preventInline: Bool
      var now: Double
    }
    let options = Options(
      currentUrl: context.currentURL,
      currentTabId: context.currentTabID?.uuidString,
      remote: remote,
      preference: context.prefersSearch ? "search" : "website",
      preventInline: context.preventInline,
      now: now.timeIntervalSince1970 * 1000
    )
    guard let textJSON = Self.encode(text), let optionsJSON = Self.encode(options),
          let output = try? script.call(.core, "mobileSuggest", json: [textJSON, optionsJSON]),
          let raw = Self.decode(RawSuggestionResult.self, output)
    else { return OmniboxResult(query: text, suggestions: [], inlineCompletion: "") }
    return raw.result(for: text)
  }

  public func resolve(_ text: String) -> OmniboxResolution? {
    guard let json = Self.encode(text), let output = try? script.call(.core, "mobileResolve", json: [json]),
          let raw = Self.decode(RawResolution.self, output), let url = URL(string: raw.url)
    else { return nil }
    return OmniboxResolution(kind: raw.kind, url: url, query: raw.query, engine: raw.engine)
  }

  public func remoteSuggestions(for text: String) async -> [String] {
    guard let json = Self.encode(text), let output = try? script.call(.core, "mobileSuggestRequest", json: [json]),
          let address = Self.decode(String?.self, output) ?? nil, let url = URL(string: address)
    else { return [] }
    var request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 4)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    guard !Task.isCancelled, let (data, response) = try? await session.data(for: request),
          (response as? HTTPURLResponse)?.statusCode == 200, !Task.isCancelled
    else { return [] }
    let body = String(decoding: data, as: UTF8.self)
    guard let bodyJSON = Self.encode(body), let parsed = try? script.call(.core, "mobileParseRemote", json: [bodyJSON]) else { return [] }
    return Self.decode([String].self, parsed) ?? []
  }

  public func cleanURL(_ url: URL) -> URL {
    guard let json = Self.encode(url.absoluteString), let output = try? script.call(.core, "mobileClean", json: [json]),
          let cleaned = Self.decode(String.self, output), let result = URL(string: cleaned)
    else { return url }
    return result
  }

  public func display(_ url: String, title: String = "") -> DisplayURL {
    guard let urlJSON = Self.encode(url), let titleJSON = Self.encode(title),
          let output = try? script.call(.core, "mobileDisplay", json: [urlJSON, titleJSON]),
          let display = Self.decode(DisplayURL.self, output)
    else { return DisplayURL(display: url, host: url, trail: []) }
    return display
  }

  public func loadBangs() async {
    guard !bangsLoaded else { return }
    bangsLoaded = true
    guard let bangsFile, let doc = await Self.read(bangsFile), let json = Self.encode(doc),
          let output = try? script.call(.core, "mobileLoadBangDocument", json: [json]),
          let etag = Self.decode(String?.self, output) ?? nil
    else {
      _ = try? script.call(.core, "mobileWarmBangs")
      return
    }
    bangEtag = etag.isEmpty ? nil : etag
    bangsCheckedAt = (try? bangsFile.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
  }

  public func refreshBangsIfDue(now: Date = .now) async {
    await loadBangs()
    if let bangsCheckedAt, now.timeIntervalSince(bangsCheckedAt) < Self.bangRefreshInterval, now >= bangsCheckedAt { return }
    bangsCheckedAt = now
    var request = URLRequest(url: Self.bangListURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
    if let bangEtag { request.setValue(bangEtag, forHTTPHeaderField: "If-None-Match") }
    guard let (data, response) = try? await session.data(for: request), let http = response as? HTTPURLResponse else { return }
    if http.statusCode == 304 {
      if let bangsFile { try? FileManager.default.setAttributes([.modificationDate: now], ofItemAtPath: bangsFile.path(percentEncoded: false)) }
      return
    }
    guard http.statusCode == 200, data.count < 8_000_000 else { return }
    let etag = http.value(forHTTPHeaderField: "ETag")
    guard let bodyJSON = Self.encode(String(decoding: data, as: UTF8.self)), let etagJSON = Self.encode(etag),
          let output = try? script.call(.core, "mobileBangDocument", json: [bodyJSON, etagJSON]),
          let doc = Self.decode(String?.self, output) ?? nil
    else { return }
    bangEtag = etag
    if let bangsFile { await Self.write(doc, to: bangsFile) }
  }

  @concurrent
  static func read(_ url: URL) async -> String? {
    try? String(contentsOf: url, encoding: .utf8)
  }

  @concurrent
  static func write(_ text: String, to url: URL) async {
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? Data(text.utf8).write(to: url, options: .atomic)
  }

  static func encode<Value: Encodable>(_ value: Value) -> String? {
    guard let data = try? JSONEncoder().encode(value) else { return nil }
    return String(decoding: data, as: UTF8.self)
  }

  static func decode<Value: Decodable>(_ type: Value.Type, _ json: String) -> Value? {
    try? JSONDecoder().decode(type, from: Data(json.utf8))
  }
}
