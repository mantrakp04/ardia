import CryptoKit
import Foundation
import Observation
import WebKit

public enum FilterListGroup: String, CaseIterable, Identifiable, Sendable {
  case builtIn
  case ads
  case privacy
  case malware
  case multipurpose
  case annoyances
  case regions
  case custom

  public var id: String { rawValue }

  public var title: String {
    switch self {
    case .builtIn: String(localized: "Built-in uBlock Filters")
    case .ads: String(localized: "Ads")
    case .privacy: String(localized: "Privacy")
    case .malware: String(localized: "Malware Protection")
    case .multipurpose: String(localized: "Multipurpose")
    case .annoyances: String(localized: "Cookie Notices and Annoyances")
    case .regions: String(localized: "Regions")
    case .custom: String(localized: "Your Lists")
    }
  }

  init(catalogGroup: String) {
    switch catalogGroup {
    case "default": self = .builtIn
    case "ads": self = .ads
    case "privacy": self = .privacy
    case "malware": self = .malware
    case "multipurpose": self = .multipurpose
    case "annoyances", "cookies": self = .annoyances
    case "regions": self = .regions
    default: self = .custom
    }
  }
}

public enum FilterListState: Equatable, Sendable {
  case ready
  case downloading
  case compiling
  case failed(String)
  case offline
}

public struct FilterListInfo: Identifiable, Equatable, Sendable {
  public var id: String
  public var title: String
  public var group: FilterListGroup
  public var category: BlockingCategory
  public var sourceURL: URL?
  public var supportURL: URL?
  public var languages: [String]
  public var isEnabled: Bool
  public var isDefault: Bool
  public var isCustom: Bool
  public var ruleCount: Int
  public var skippedCount: Int
  public var updatedAt: Date?
  public var state: FilterListState
}

public struct MyFiltersResult: Equatable, Sendable {
  public var ruleCount: Int
  public var skippedCount: Int

  public init(ruleCount: Int, skippedCount: Int) {
    self.ruleCount = ruleCount
    self.skippedCount = skippedCount
  }
}

public struct FilterListCatalog: Codable, Sendable {
  public struct Entry: Codable, Sendable, Equatable {
    public var id: String
    public var title: String
    public var group: String
    public var group2: String?
    public var parent: String?
    public var off: Bool
    public var lang: [String]?
    public var ua: String?
    public var tags: [String]?
    public var updateAfter: Int
    public var urls: [String]
    public var supportURL: String?
    public var instructionURL: String?

    var category: BlockingCategory {
      if group2 == "cookies" { return .cookieBanners }
      if group == "privacy" || id == "ublock-privacy" { return .trackers }
      return .ads
    }
  }

  public var ubo: String
  public var lists: [Entry]

  public static let bundled: FilterListCatalog = {
    guard let url = Bundle.module.url(forResource: "FilterListCatalog", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let catalog = try? JSONDecoder().decode(FilterListCatalog.self, from: data)
    else { return FilterListCatalog(ubo: "", lists: []) }
    return catalog
  }()

  public static let alwaysOn: Set<String> = ["fanboy-cookiemonster"]

  public func defaultSelection(languages: [String], isMobile: Bool) -> Set<String> {
    let codes = Set(languages.compactMap { Locale(identifier: $0).language.languageCode?.identifier.lowercased() })
    var selection = Set(lists.filter { !$0.off }.map(\.id)).union(Self.alwaysOn)
    for entry in lists {
      if let lang = entry.lang, !codes.isDisjoint(with: lang) { selection.insert(entry.id) }
      if isMobile, entry.ua == "mobile" { selection.insert(entry.id) }
    }
    return selection
  }
}

struct CustomFilterList: Codable, Equatable, Sendable {
  var id: String
  var url: URL
  var title: String
}

struct FilterListRecord: Codable, Equatable, Sendable {
  var etag: String?
  var lastModified: String?
  var downloadedAt: Date?
  var ruleCount = 0
  var skipped = 0
}

struct FilterBuildRecord: Codable, Equatable, Sendable {
  var lists: [String: FilterListRecord] = [:]
  var chunkHashes: [String: String] = [:]
  var chunkCategories: [String: String] = [:]
  var builtAt: Date?
  var signature: String?
}

struct CompiledFilterList {
  var identifier: String
  var category: BlockingCategory?
  var list: WKContentRuleList
}

public enum FilterListError: Error, Equatable, Sendable {
  case invalidAddress
  case alreadyAdded
  case unreachable(String)
  case notAFilterList

  public var message: String {
    switch self {
    case .invalidAddress: String(localized: "Enter an address that starts with https://.")
    case .alreadyAdded: String(localized: "This list is already in your lists.")
    case .unreachable(let reason): reason
    case .notAFilterList: String(localized: "This doesn’t look like a filter list. Check the address and try again.")
    }
  }
}

@MainActor
@Observable
public final class FilterLists {
  nonisolated public static let myFiltersID = "my-filters"
  static let keys = (selection: "filters.selection", custom: "filters.custom", mine: "filters.myFilters")

  public private(set) var lists: [FilterListInfo] = []
  public private(set) var isUpdating = false
  public private(set) var isOffline = false
  public private(set) var lastUpdated: Date?
  public private(set) var myFilters: String
  public private(set) var myFiltersResult = MyFiltersResult(ruleCount: 0, skippedCount: 0)
  public private(set) var buildError: String?

  public let catalog: FilterListCatalog
  @ObservationIgnored let directory: URL
  @ObservationIgnored let ruleLimit: Int
  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private let session: URLSession
  @ObservationIgnored private let languages: [String]
  @ObservationIgnored private let isMobile: Bool
  @ObservationIgnored private var selection: Set<String>
  @ObservationIgnored private var custom: [CustomFilterList]
  @ObservationIgnored private var record = FilterBuildRecord()
  @ObservationIgnored private var states: [String: FilterListState] = [:]
  @ObservationIgnored private var store: WKContentRuleListStore?
  @ObservationIgnored private var building: Task<Void, Never>?
  @ObservationIgnored private var needsBuild = false
  @ObservationIgnored private(set) var compiled: [CompiledFilterList] = []
  @ObservationIgnored private(set) var blockedDomains: Set<String> = []
  @ObservationIgnored var onCompiledChange: (@MainActor () -> Void)?
  @ObservationIgnored public private(set) var isDemo = false
  @ObservationIgnored private(set) var lastBuildStats = (reused: 0, compiled: 0, convertSeconds: 0.0, compileSeconds: 0.0)

  public init(
    directory: URL,
    defaults: UserDefaults,
    session: URLSession = .shared,
    languages: [String] = Locale.preferredLanguages,
    isMobile: Bool = true,
    catalog: FilterListCatalog = .bundled,
    ruleLimit: Int = FilterListConverter.webKitRuleLimit
  ) {
    self.directory = directory
    self.defaults = defaults
    self.session = session
    self.languages = languages
    self.isMobile = isMobile
    self.catalog = catalog
    self.ruleLimit = ruleLimit
    if let saved = defaults.stringArray(forKey: Self.keys.selection) {
      selection = Set(saved)
    } else {
      selection = catalog.defaultSelection(languages: languages, isMobile: isMobile)
      defaults.set(selection.sorted(), forKey: Self.keys.selection)
    }
    custom = defaults.data(forKey: Self.keys.custom).flatMap { try? JSONDecoder().decode([CustomFilterList].self, from: $0) } ?? []
    myFilters = defaults.string(forKey: Self.keys.mine) ?? ""
    record = (try? JSONDecoder().decode(FilterBuildRecord.self, from: Data(contentsOf: recordURL))) ?? FilterBuildRecord()
    lastUpdated = record.lists.values.compactMap(\.downloadedAt).max()
    refreshLists()
  }

  public static func demo(directory: URL, defaults: UserDefaults) -> FilterLists {
    let lists = FilterLists(directory: directory, defaults: defaults, languages: ["en-US"], isMobile: true)
    lists.isDemo = true
    let counts: [String: (Int, Int)] = [
      "ublock-filters": (9460, 14490), "ublock-badware": (4375, 628), "ublock-privacy": (1115, 741), "ublock-unbreak": (1954, 617),
      "ublock-quick-fixes": (239, 265), "adguard-mobile": (7015, 927), "easylist": (84792, 1001), "easyprivacy": (56280, 103),
      "urlhaus-1": (77295, 0), "fanboy-cookiemonster": (25393, 2767), "plowe-0": (3563, 0),
    ]
    let now = Date.now
    for (offset, entry) in lists.catalog.lists.enumerated() {
      let count = counts[entry.id] ?? (2000 + (offset * 7919) % 30000, (offset * 131) % 900)
      lists.record.lists[entry.id] = FilterListRecord(downloadedAt: now.addingTimeInterval(-Double(3600 + offset * 1700)), ruleCount: count.0, skipped: count.1)
    }
    lists.lastUpdated = now.addingTimeInterval(-3600)
    lists.refreshLists()
    return lists
  }

  public func seedDemo(states: [String: FilterListState]) {
    guard isDemo else { return }
    self.states = states
    isOffline = states.values.contains(.offline)
    isUpdating = states.values.contains { $0 == .downloading || $0 == .compiling }
    refreshLists()
  }

  var recordURL: URL { directory.appending(path: "filters.json") }
  func fileURL(_ id: String) -> URL { directory.appending(path: "Lists", directoryHint: .isDirectory).appending(path: "\(id).txt") }

  public var enabledRuleCount: Int { lists.filter(\.isEnabled).reduce(0) { $0 + $1.ruleCount } + myFiltersResult.ruleCount }

  public func list(_ id: String) -> FilterListInfo? { lists.first { $0.id == id } }

  public func setEnabled(_ id: String, _ enabled: Bool) {
    guard (enabled ? selection.insert(id).inserted : selection.remove(id) != nil) else { return }
    defaults.set(selection.sorted(), forKey: Self.keys.selection)
    refreshLists()
    Task {
      if enabled, record.lists[id]?.downloadedAt == nil { await download([id], allowExpensive: true, force: false) }
      await rebuild()
    }
  }

  public func updateNow() async {
    await download(enabledIDs(), allowExpensive: true, force: true)
    await rebuild()
  }

  public func updateIfNeeded(now: Date = .now) async {
    var due: [String] = []
    var urgent: [String] = []
    for id in enabledIDs() {
      guard let downloaded = record.lists[id]?.downloadedAt else {
        urgent.append(id)
        continue
      }
      let interval = Double(updateAfter(id)) * 86_400
      let age = now.timeIntervalSince(downloaded)
      if age >= 2 * interval || age < 0 { urgent.append(id) } else if age >= interval { due.append(id) }
    }
    let changedUrgent = await download(urgent, allowExpensive: true, force: false)
    let changedDue = await download(due, allowExpensive: false, force: false)
    if changedUrgent || changedDue || compiled.isEmpty && !enabledIDs().isEmpty { await rebuild() }
  }

  public func addList(_ url: URL) async -> String? {
    do {
      _ = try await addCustomList(url: url)
      return nil
    } catch {
      return error.message
    }
  }

  public func addCustomList(url: URL) async throws(FilterListError) -> FilterListInfo {
    guard url.scheme?.lowercased() == "https", url.host() != nil else { throw .invalidAddress }
    let known = Set(catalog.lists.flatMap(\.urls)).union(custom.map(\.url.absoluteString))
    guard !known.contains(url.absoluteString) else { throw .alreadyAdded }
    let id = "custom-" + Self.hash(url.absoluteString).prefix(12)
    if isDemo {
      custom.append(CustomFilterList(id: id, url: url, title: url.host() ?? url.absoluteString))
      selection.insert(id)
      record.lists[id] = FilterListRecord(downloadedAt: .now, ruleCount: 1240, skipped: 12)
      refreshLists()
      return list(id) ?? lists[lists.count - 1]
    }
    let fetched: FetchedList
    do {
      guard let result = try await fetch(url, record: nil, allowExpensive: true) else { throw FilterListError.notAFilterList }
      fetched = result
    } catch let error as FilterListError {
      throw error
    } catch {
      throw .unreachable(Self.message(for: error))
    }
    let parsed = await Self.parse(fetched.text, id: id)
    guard parsed.convertedLines > 0 else { throw .notAFilterList }
    let title = Self.title(in: fetched.text) ?? url.host() ?? url.absoluteString
    try? await Self.write(fetched.text, to: fileURL(id))
    record.lists[id] = FilterListRecord(etag: fetched.etag, lastModified: fetched.lastModified, downloadedAt: .now, ruleCount: 0, skipped: parsed.skippedLines)
    custom.append(CustomFilterList(id: id, url: url, title: title))
    selection.insert(id)
    saveCustom()
    defaults.set(selection.sorted(), forKey: Self.keys.selection)
    saveRecord()
    refreshLists()
    await rebuild()
    return list(id) ?? lists[lists.count - 1]
  }

  public func removeList(_ id: String) {
    guard custom.contains(where: { $0.id == id }) else { return }
    custom.removeAll { $0.id == id }
    selection.remove(id)
    record.lists[id] = nil
    try? FileManager.default.removeItem(at: fileURL(id))
    saveCustom()
    defaults.set(selection.sorted(), forKey: Self.keys.selection)
    saveRecord()
    refreshLists()
    Task { await rebuild() }
  }

  public func applyMyFilters(_ text: String) async -> MyFiltersResult {
    myFilters = text
    defaults.set(text, forKey: Self.keys.mine)
    let parsed = await Self.parse(text, id: Self.myFiltersID)
    myFiltersResult = MyFiltersResult(ruleCount: parsed.convertedLines, skippedCount: parsed.skippedLines)
    await rebuild()
    return myFiltersResult
  }

  public func resetToDefaults() async {
    selection = catalog.defaultSelection(languages: languages, isMobile: isMobile)
    for list in custom { try? FileManager.default.removeItem(at: fileURL(list.id)) }
    custom = []
    saveCustom()
    defaults.set(selection.sorted(), forKey: Self.keys.selection)
    refreshLists()
    await download(enabledIDs().filter { record.lists[$0]?.downloadedAt == nil }, allowExpensive: true, force: false)
    await rebuild()
  }

  public func loadCompiled() async {
    guard !isDemo, let store = openStore() else { return }
    var loaded: [CompiledFilterList] = []
    for (identifier, _) in record.chunkHashes.sorted(by: { $0.key < $1.key }) {
      guard let list = try? await store.contentRuleList(forIdentifier: identifier) else { continue }
      loaded.append(CompiledFilterList(identifier: identifier, category: record.chunkCategories[identifier].flatMap(BlockingCategory.init(rawValue:)), list: list))
    }
    compiled = loaded
    blockedDomains = await Self.readDomains(directory.appending(path: "domains.txt"))
    if !myFilters.isEmpty {
      let parsed = await Self.parse(myFilters, id: Self.myFiltersID)
      myFiltersResult = MyFiltersResult(ruleCount: parsed.convertedLines, skippedCount: parsed.skippedLines)
    }
    onCompiledChange?()
  }

  public func rebuild() async {
    if let building {
      needsBuild = true
      await building.value
      return
    }
    let task = Task { await runBuilds() }
    building = task
    await task.value
    building = nil
  }

  private func runBuilds() async {
    repeat {
      needsBuild = false
      await build()
    } while needsBuild
  }

  private func build() async {
    guard !isDemo, let store = openStore() else { return }
    let ids = enabledIDs().filter { FileManager.default.fileExists(atPath: fileURL($0).path(percentEncoded: false)) }
    let signature = buildSignature(ids)
    if signature == record.signature, !compiled.isEmpty || ids.isEmpty && myFilters.isEmpty {
      lastBuildStats = (compiled.count, 0, 0, 0)
      return
    }
    let downloadStates = states
    for id in ids where states[id] == nil { states[id] = .compiling }
    refreshLists()
    let sources = ids.map { (id: $0, url: fileURL($0)) }
    let convertStart = Date.now
    let output = await Self.convertAll(sources: sources, myFilters: myFilters, limit: ruleLimit)
    let compileStart = Date.now
    var reused = 0
    var next: [CompiledFilterList] = []
    var hashes: [String: String] = [:]
    var categories: [String: String] = [:]
    var failed: Set<String> = []
    for chunk in output.chunks {
      let identifier = "ardia.filters.\(chunk.listID).\(chunk.index)"
      let category = chunk.listID == Self.myFiltersID ? nil : category(of: chunk.listID)
      let hash = Self.hash(chunk.json)
      if record.chunkHashes[identifier] == hash, let existing = try? await store.contentRuleList(forIdentifier: identifier) {
        next.append(CompiledFilterList(identifier: identifier, category: category, list: existing))
        hashes[identifier] = hash
        reused += 1
      } else if let list = try? await store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: chunk.json) {
        next.append(CompiledFilterList(identifier: identifier, category: category, list: list))
        hashes[identifier] = hash
      } else {
        failed.insert(chunk.listID)
        if let previous = compiled.first(where: { $0.identifier == identifier }) {
          next.append(previous)
          hashes[identifier] = record.chunkHashes[identifier]
        }
      }
      if let category { categories[identifier] = category.rawValue }
    }
    for identifier in record.chunkHashes.keys where hashes[identifier] == nil {
      try? await store.removeContentRuleList(forIdentifier: identifier)
    }
    for (id, counts) in output.counts {
      var entry = record.lists[id] ?? FilterListRecord()
      entry.ruleCount = counts.converted
      entry.skipped = counts.skipped
      if id != Self.myFiltersID { record.lists[id] = entry }
    }
    if let mine = output.counts[Self.myFiltersID] { myFiltersResult = MyFiltersResult(ruleCount: mine.converted, skippedCount: mine.skipped) }
    lastBuildStats = (reused, output.chunks.count - reused, compileStart.timeIntervalSince(convertStart), Date.now.timeIntervalSince(compileStart))
    record.chunkHashes = hashes
    record.chunkCategories = categories
    record.signature = failed.isEmpty ? signature : nil
    record.builtAt = .now
    saveRecord()
    for id in ids {
      states[id] = failed.contains(id) ? .failed(String(localized: "Ardia couldn’t use this list’s rules. It keeps the last version that worked.")) : downloadStates[id]
    }
    buildError = failed.isEmpty ? nil : String(localized: "Some lists couldn’t be applied. Ardia keeps the last version that worked.")
    compiled = next
    blockedDomains = output.domains
    try? await Self.write(output.domains.sorted().joined(separator: "\n"), to: directory.appending(path: "domains.txt"))
    refreshLists()
    onCompiledChange?()
  }

  struct FetchedList: Sendable {
    var text: String
    var etag: String?
    var lastModified: String?
  }

  @discardableResult
  private func download(_ ids: [String], allowExpensive: Bool, force: Bool) async -> Bool {
    guard !ids.isEmpty, !isDemo else { return false }
    isUpdating = true
    defer { isUpdating = false }
    var changed = false
    var offline = false
    for id in ids {
      states[id] = .downloading
      refreshLists()
      let urls = sourceURLs(id)
      var outcome: FilterListState? = .failed(String(localized: "This list couldn’t be downloaded. Ardia will try again later."))
      for url in urls {
        do {
          let previous = force ? nil : (FileManager.default.fileExists(atPath: fileURL(id).path(percentEncoded: false)) ? record.lists[id] : nil)
          guard let fetched = try await fetch(url, record: previous, allowExpensive: allowExpensive) else {
            if previous != nil {
              record.lists[id]?.downloadedAt = .now
              outcome = nil
              break
            }
            continue
          }
          try await Self.write(fetched.text, to: fileURL(id))
          var entry = record.lists[id] ?? FilterListRecord()
          entry.etag = fetched.etag
          entry.lastModified = fetched.lastModified
          entry.downloadedAt = .now
          record.lists[id] = entry
          changed = true
          outcome = nil
          break
        } catch {
          if (error as? URLError)?.code == .notConnectedToInternet || (error as? URLError)?.networkUnavailableReason != nil {
            offline = true
            outcome = .offline
            break
          }
          outcome = .failed(Self.message(for: error))
        }
      }
      states[id] = outcome
    }
    isOffline = offline
    saveRecord()
    lastUpdated = record.lists.values.compactMap(\.downloadedAt).max()
    refreshLists()
    return changed
  }

  private func fetch(_ url: URL, record previous: FilterListRecord?, allowExpensive: Bool) async throws -> FetchedList? {
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
    request.allowsExpensiveNetworkAccess = allowExpensive
    request.allowsConstrainedNetworkAccess = allowExpensive
    if let etag = previous?.etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
    if let modified = previous?.lastModified { request.setValue(modified, forHTTPHeaderField: "If-Modified-Since") }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw FilterListError.notAFilterList }
    if http.statusCode == 304 { return nil }
    guard (200..<300).contains(http.statusCode) else {
      throw FilterListError.unreachable(String(localized: "The server couldn’t provide this list right now. Ardia will try again later."))
    }
    guard data.count < 40_000_000, let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1), Self.looksLikeFilterList(text) else {
      throw FilterListError.notAFilterList
    }
    return FetchedList(text: text, etag: http.value(forHTTPHeaderField: "ETag"), lastModified: http.value(forHTTPHeaderField: "Last-Modified"))
  }

  private func buildSignature(_ ids: [String]) -> String {
    var parts = ["limit=\(ruleLimit)", "mine=\(Self.hash(myFilters))"]
    for id in ids {
      let attributes = try? FileManager.default.attributesOfItem(atPath: fileURL(id).path(percentEncoded: false))
      let size = attributes?[.size] as? Int ?? 0
      let modified = (attributes?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
      parts.append("\(id):\(size):\(modified)")
    }
    return Self.hash(parts.joined(separator: "|"))
  }

  private func openStore() -> WKContentRuleListStore? {
    if let store { return store }
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    store = WKContentRuleListStore(url: directory.appending(path: "Compiled", directoryHint: .isDirectory))
    return store
  }

  private func enabledIDs() -> [String] {
    catalog.lists.map(\.id).filter(selection.contains) + custom.map(\.id).filter(selection.contains)
  }

  private func sourceURLs(_ id: String) -> [URL] {
    if let entry = catalog.lists.first(where: { $0.id == id }) { return entry.urls.compactMap(URL.init(string:)) }
    return custom.first { $0.id == id }.map { [$0.url] } ?? []
  }

  private func updateAfter(_ id: String) -> Int {
    catalog.lists.first { $0.id == id }?.updateAfter ?? 5
  }

  func category(of id: String) -> BlockingCategory {
    catalog.lists.first { $0.id == id }?.category ?? .ads
  }

  private func refreshLists() {
    let defaultSelection = catalog.defaultSelection(languages: languages, isMobile: isMobile)
    let catalogLists = catalog.lists.map { entry in
      FilterListInfo(
        id: entry.id, title: entry.title, group: FilterListGroup(catalogGroup: entry.group2 == "cookies" ? "cookies" : entry.group),
        category: entry.category, sourceURL: entry.urls.first.flatMap(URL.init(string:)), supportURL: entry.supportURL.flatMap(URL.init(string:)),
        languages: entry.lang ?? [], isEnabled: selection.contains(entry.id), isDefault: defaultSelection.contains(entry.id), isCustom: false,
        ruleCount: record.lists[entry.id]?.ruleCount ?? 0, skippedCount: record.lists[entry.id]?.skipped ?? 0,
        updatedAt: record.lists[entry.id]?.downloadedAt, state: states[entry.id] ?? .ready
      )
    }
    let customLists = custom.map { list in
      FilterListInfo(
        id: list.id, title: list.title, group: .custom, category: .ads, sourceURL: list.url, supportURL: nil, languages: [],
        isEnabled: selection.contains(list.id), isDefault: false, isCustom: true,
        ruleCount: record.lists[list.id]?.ruleCount ?? 0, skippedCount: record.lists[list.id]?.skipped ?? 0,
        updatedAt: record.lists[list.id]?.downloadedAt, state: states[list.id] ?? .ready
      )
    }
    let next = catalogLists + customLists
    if next != lists { lists = next }
  }

  private func saveCustom() {
    if let data = try? JSONEncoder().encode(custom) { defaults.set(data, forKey: Self.keys.custom) }
  }

  private func saveRecord() {
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    if let data = try? JSONEncoder().encode(record) { try? data.write(to: recordURL, options: .atomic) }
  }

  struct BuildOutput: Sendable {
    var chunks: [FilterChunk]
    var counts: [String: (converted: Int, skipped: Int)]
    var domains: Set<String>
  }

  @concurrent
  static func convertAll(sources: [(id: String, url: URL)], myFilters: String, limit: Int) async -> BuildOutput {
    var parsed: [ParsedFilterList] = []
    for source in sources {
      guard let text = try? String(contentsOf: source.url, encoding: .utf8) else { continue }
      parsed.append(FilterListConverter.parse(text, id: source.id))
    }
    if !myFilters.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      parsed.append(FilterListConverter.parse(myFilters, id: myFiltersID))
    }
    let chunks = FilterListConverter.build(parsed, limit: limit, ownerID: myFiltersID)
    var counts: [String: (converted: Int, skipped: Int)] = [:]
    var domains: Set<String> = []
    for list in parsed {
      counts[list.id] = (list.convertedLines, list.skippedLines)
      domains.formUnion(list.blockedDomains)
    }
    return BuildOutput(chunks: chunks, counts: counts, domains: domains)
  }

  @concurrent
  static func parse(_ text: String, id: String) async -> ParsedFilterList {
    FilterListConverter.parse(text, id: id)
  }

  @concurrent
  static func write(_ text: String, to url: URL) async throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data(text.utf8).write(to: url, options: .atomic)
  }

  @concurrent
  static func readDomains(_ url: URL) async -> Set<String> {
    guard let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }
    return Set(text.split(separator: "\n").map(String.init))
  }

  nonisolated static func looksLikeFilterList(_ text: String) -> Bool {
    let head = text.prefix(200_000)
    if head.contains("[Adblock") || head.contains("! Title:") { return true }
    if head.range(of: "<html", options: .caseInsensitive) != nil || head.range(of: "<!doctype", options: .caseInsensitive) != nil { return false }
    var rules = 0
    head.enumerateLines { line, stop in
      if line.hasPrefix("||") || line.contains("##") || line.hasPrefix("@@") || line.hasPrefix("0.0.0.0 ") || line.hasPrefix("127.0.0.1 ") { rules += 1 }
      if rules >= 3 { stop = true }
    }
    return rules >= 1
  }

  nonisolated static func title(in text: String) -> String? {
    var found: String?
    text.prefix(4000).enumerateLines { line, stop in
      if line.hasPrefix("! Title:") {
        found = line.dropFirst("! Title:".count).trimmingCharacters(in: .whitespaces)
        stop = true
      }
    }
    return found?.isEmpty == false ? found : nil
  }

  nonisolated static func hash(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  static func message(for error: any Error) -> String {
    if let error = error as? FilterListError { return error.message }
    switch (error as? URLError)?.code {
    case .notConnectedToInternet?, .networkConnectionLost?: return String(localized: "Your iPhone isn’t connected to the internet.")
    case .timedOut?: return String(localized: "The server took too long to respond. Ardia will try again later.")
    case .cannotFindHost?, .dnsLookupFailed?: return String(localized: "The server can’t be found. Check the address and try again.")
    default: return String(localized: "This list couldn’t be downloaded. Ardia will try again later.")
    }
  }
}
