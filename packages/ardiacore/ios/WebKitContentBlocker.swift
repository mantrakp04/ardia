import CryptoKit
import Foundation
import WebKit

final class WebKitContentBlocker {
  static let shared = WebKitContentBlocker()
  static let changed = Notification.Name("ArdiaContentBlockerDidChange")

  private static let format = "f3"
  private static let ruleBudget = 140_000
  private static let ignoreTopDocuments =
    #"{"action":{"type":"ignore-previous-rules"},"trigger":{"load-context":["top-frame"],"resource-type":["document"],"url-filter":".*"}}"#
  private static let sources: [String: [String]] = [
    "ublock-filters": ["ublock-filters"],
    "annoyances-ai": ["fanboy-ai-suggestions"],
    "annoyances-cookies": ["fanboy-cookiemonster", "ublock-cookies-easylist", "adguard-cookies", "ublock-cookies-adguard"],
    "annoyances-overlays": ["easylist-newsletters", "ublock-annoyances", "adguard-popup-overlays"],
    "annoyances-social": ["fanboy-social", "fanboy-thirdparty_social", "adguard-social"],
    "annoyances-widgets": ["easylist-chat", "adguard-widgets"],
    "annoyances-others": ["easylist-annoyances", "adguard-other-annoyances"],
    "annoyances-notifications": ["easylist-notifications"],
  ]

  private struct Settings: Codable, Equatable {
    var enabled = true
    var lists: [String]?
    var allowedHosts: [String] = []
  }

  private struct Ruleset: Decodable {
    let id: String
    let enabled: Bool
  }

  private struct Bundled: Decodable {
    let version: String
    let digest: String?
    let rulesets: [Ruleset]
  }

  private let rulesDirectory = Bundle.main.resourceURL?.appendingPathComponent("ContentRules")
  private lazy var bundled: Bundled? = rulesDirectory
    .flatMap { try? Data(contentsOf: $0.appendingPathComponent("rulesets.json")) }
    .flatMap { try? JSONDecoder().decode(Bundled.self, from: $0) }
  private var base: URL {
    URL(fileURLWithPath: (ArdiaHost.dataDirectory as NSString).deletingLastPathComponent).appendingPathComponent("WebKit Content Rules")
  }
  private lazy var store: WKContentRuleListStore? = {
    let url = base.appendingPathComponent("Store")
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return WKContentRuleListStore(url: url)
  }()

  private var started = false
  private var settings = Settings()
  private var lists: [WKContentRuleList] = []
  private var listsKey = ""
  private var loadingKey: String?
  private var desiredKey = ""
  private var failedKey: String?
  private var ready = false
  private var waiters: [() -> Void] = []
  private var lastCompileMs: Double = 0
  private var lastError: String?
  private let controllers = NSHashTable<WKUserContentController>.weakObjects()
  private let applied = NSMapTable<WKUserContentController, NSString>.weakToStrongObjects()

  func attach(_ controller: WKUserContentController) {
    start()
    controllers.add(controller)
    apply(controller)
  }

  @discardableResult
  func configure(_ preferences: WKWebpagePreferences, for url: URL) -> Bool {
    guard preferences.responds(to: NSSelectorFromString("_setContentBlockersEnabled:")) else { return false }
    let exempt = trusted((url.host ?? "").lowercased())
    preferences.setValue(!exempt, forKey: "contentBlockersEnabled")
    return exempt
  }

  func whenReady(within seconds: Double, _ then: @escaping () -> Void) {
    start()
    if ready { return then() }
    var done = false
    let once = {
      guard !done else { return }
      done = true
      then()
    }
    waiters.append(once)
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: once)
  }

  var state: [String: Any] {
    [
      "ready": ready, "enabled": settings.enabled, "lists": lists.count, "key": listsKey, "loading": loadingKey ?? NSNull(),
      "rulesets": wantedRulesets(), "allowedHosts": settings.allowedHosts, "compileMs": lastCompileMs,
      "error": lastError ?? NSNull(), "version": bundled?.version ?? "",
    ]
  }

  private func start() {
    guard !started else { return }
    started = true
    if let data = try? Data(contentsOf: base.appendingPathComponent("settings.json")),
      let saved = try? JSONDecoder().decode(Settings.self, from: data)
    {
      settings = saved
    }
    NotificationCenter.default.addObserver(forName: Self.changed, object: nil, queue: nil) { [weak self] note in
      let info = note.userInfo ?? [:]
      if Thread.isMainThread { self?.noteChange(info) } else { DispatchQueue.main.async { self?.noteChange(info) } }
    }
    reselect()
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { ArdiaContentBlocker.state { _ in } }
  }

  private func noteChange(_ info: [AnyHashable: Any]) {
    var next = settings
    if let enabled = info["enabled"] as? Bool { next.enabled = enabled }
    if let lists = info["lists"] as? [String] { next.lists = lists.map { $0.lowercased() }.sorted() }
    if let hosts = info["allowedHosts"] as? [String] { next.allowedHosts = hosts.map { $0.lowercased() }.sorted() }
    if let host = (info["host"] as? String)?.lowercased(), let allowed = info["allowed"] as? Bool {
      var kept = next.allowedHosts.filter { allowed ? $0 != host : !WebKitHub.covers($0, host: host) }
      if allowed { kept.append(host) }
      next.allowedHosts = kept.sorted()
    }
    if let list = (info["list"] as? String)?.lowercased(), let on = info["listEnabled"] as? Bool, var lists = next.lists {
      lists.removeAll { $0 == list }
      if on { lists.append(list) }
      next.lists = lists.sorted()
    }
    guard next != settings else { return }
    settings = next
    save()
    reselect()
    applyAll()
  }

  private func save() {
    let snapshot = settings
    let url = base
    DispatchQueue.global(qos: .utility).async {
      guard let data = try? JSONEncoder().encode(snapshot) else { return }
      try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
      try? data.write(to: url.appendingPathComponent("settings.json"), options: .atomic)
    }
  }

  private func trusted(_ host: String) -> Bool {
    !host.isEmpty && settings.allowedHosts.contains { WebKitHub.covers($0, host: host) }
  }

  private func wantedRulesets() -> [String] {
    guard let bundled else { return [] }
    guard let chosen = settings.lists.map(Set.init) else { return bundled.rulesets.filter(\.enabled).map(\.id) }
    return bundled.rulesets.map(\.id).filter { id in (Self.sources[id] ?? [id]).contains { chosen.contains($0.lowercased()) } }
  }

  private func key(for rulesets: [String]) -> String {
    let digest = SHA256.hash(data: Data(rulesets.sorted().joined(separator: ",").utf8))
    let hex = digest.prefix(6).map { String(format: "%02x", $0) }.joined()
    return "\(bundled?.digest ?? bundled?.version ?? "none")-\(Self.format)-\(hex)"
  }

  private func reselect() {
    let rulesets = settings.enabled ? wantedRulesets() : []
    desiredKey = rulesets.isEmpty || store == nil ? "" : key(for: rulesets)
    if desiredKey == listsKey {
      markReady()
      return applyAll()
    }
    if desiredKey.isEmpty { return install(key: "", lists: []) }
    guard loadingKey == nil, desiredKey != failedKey else { return }
    load(rulesets, key: desiredKey)
  }

  private func load(_ rulesets: [String], key wanted: String) {
    guard let store else { return }
    loadingKey = wanted
    let prefix = "ardia-ubol-\(wanted)-"
    store.getAvailableContentRuleListIdentifiers { [weak self] identifiers in
      guard let self else { return }
      guard wanted == self.desiredKey else {
        self.loadingKey = nil
        return self.reselect()
      }
      let mine = (identifiers ?? []).filter { $0.hasPrefix(prefix) }
      let total = mine.first.flatMap { Int($0.components(separatedBy: "of").last ?? "") } ?? 0
      let expected = (0..<total).map { "\(prefix)\($0)of\(total)" }
      if total > 0 && Set(expected).isSubset(of: Set(mine)) {
        self.lookUp(expected, key: wanted, rulesets: rulesets)
      } else {
        self.markReady()
        self.compile(rulesets, key: wanted)
      }
    }
  }

  private func lookUp(_ identifiers: [String], key: String, rulesets: [String]) {
    guard let store else { return }
    var found: [Int: WKContentRuleList] = [:]
    var left = identifiers.count
    var failed = false
    for (index, identifier) in identifiers.enumerated() {
      store.lookUpContentRuleList(forIdentifier: identifier) { [weak self] list, _ in
        if let list { found[index] = list } else { failed = true }
        left -= 1
        guard left == 0, let self else { return }
        if failed {
          self.markReady()
          return self.compile(rulesets, key: key)
        }
        self.finishLoading(key: key, lists: (0..<identifiers.count).compactMap { found[$0] })
      }
    }
  }

  private func compile(_ rulesets: [String], key: String) {
    guard let store, let directory = rulesDirectory else { return finishLoading(key: key, lists: nil) }
    let started = Date()
    DispatchQueue.global(qos: .utility).async { [weak self] in
      let encoded = Self.assemble(rulesets, from: directory)
      DispatchQueue.main.async {
        guard let self else { return }
        guard !encoded.isEmpty else {
          self.lastError = "no rules for \(rulesets.joined(separator: ","))"
          return self.finishLoading(key: key, lists: nil)
        }
        var made: [Int: WKContentRuleList] = [:]
        var left = encoded.count
        var failure: String?
        for (index, json) in encoded.enumerated() {
          let identifier = "ardia-ubol-\(key)-\(index)of\(encoded.count)"
          store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: json) { list, error in
            if let list { made[index] = list } else { failure = failure ?? error?.localizedDescription ?? "failed" }
            left -= 1
            guard left == 0 else { return }
            self.lastCompileMs = Date().timeIntervalSince(started) * 1000
            if let failure {
              NSLog("[blocker] WebKit rules didn't compile: %@", failure)
              self.lastError = failure
              return self.finishLoading(key: key, lists: nil)
            }
            NSLog("[blocker] WebKit rules for %@ compiled in %.0f ms", rulesets.joined(separator: ","), self.lastCompileMs)
            self.lastError = nil
            let previous = self.listsKey
            self.finishLoading(key: key, lists: (0..<encoded.count).compactMap { made[$0] })
            if self.listsKey == key { self.removeStale(keeping: [key, previous]) }
          }
        }
      }
    }
  }

  private struct Rule {
    let priority: Int
    let exception: Bool
    let json: Substring
  }

  private static func assemble(_ rulesets: [String], from directory: URL) -> [String] {
    var blocks: [Rule] = [], allows: [Rule] = [], cosmetic: [Substring] = []
    var texts: [String] = []
    for id in rulesets {
      guard let data = try? Data(contentsOf: directory.appendingPathComponent("\(id).rules")),
        let raw = try? (data as NSData).decompressed(using: .zlib)
      else { continue }
      texts.append(String(decoding: raw as Data, as: UTF8.self))
    }
    for text in texts {
      for line in text.split(separator: "\n") {
        guard let tag = line.first, let tab = line.firstIndex(of: "\t") else { continue }
        let priority = Int(line[line.index(after: line.startIndex)..<tab]) ?? 1
        let json = line[line.index(after: tab)...]
        switch tag {
        case "p": blocks.append(Rule(priority: priority, exception: false, json: json))
        case "b": blocks.append(Rule(priority: priority, exception: false, json: json))
        case "a": allows.append(Rule(priority: priority, exception: true, json: json))
        case "c": cosmetic.append(json)
        default: break
        }
      }
    }
    let ordered: (Rule, Rule) -> Bool = { a, b in
      a.priority != b.priority ? a.priority < b.priority : !a.exception && b.exception
    }
    blocks.sort(by: ordered)
    var out: [String] = []
    if !blocks.isEmpty {
      let budget = max(1000, ruleBudget - allows.count - 1)
      var start = 0
      repeat {
        let end = min(blocks.count, start + budget)
        var parts = (blocks[start..<end] + allows).sorted(by: ordered).map(\.json)
        parts.append(Substring(ignoreTopDocuments))
        out.append("[" + parts.joined(separator: ",") + "]")
        start = end
      } while start < blocks.count
    }
    var start = 0
    while start < cosmetic.count {
      let end = min(cosmetic.count, start + ruleBudget)
      out.append("[" + cosmetic[start..<end].joined(separator: ",") + "]")
      start = end
    }
    return out
  }

  private func removeStale(keeping keys: [String]) {
    guard let store else { return }
    let prefixes = keys.filter { !$0.isEmpty }.map { "ardia-ubol-\($0)-" }
    store.getAvailableContentRuleListIdentifiers { identifiers in
      for identifier in identifiers ?? [] where !prefixes.contains(where: identifier.hasPrefix) {
        store.removeContentRuleList(forIdentifier: identifier) { _ in }
      }
    }
  }

  private func finishLoading(key: String, lists made: [WKContentRuleList]?) {
    loadingKey = nil
    if made == nil { failedKey = key }
    if let made, key == desiredKey { install(key: key, lists: made) }
    markReady()
    if desiredKey != listsKey { reselect() }
  }

  private func install(key: String, lists made: [WKContentRuleList]) {
    listsKey = key
    lists = made
    markReady()
    applyAll()
  }

  private func markReady() {
    guard !ready else { return }
    ready = true
    let pending = waiters
    waiters = []
    pending.forEach { $0() }
  }

  private func applyAll() {
    for controller in controllers.allObjects { apply(controller) }
  }

  private func apply(_ controller: WKUserContentController) {
    let want = settings.enabled && !lists.isEmpty ? listsKey : ""
    if (applied.object(forKey: controller) as String?) == want { return }
    controller.removeAllContentRuleLists()
    if !want.isEmpty { lists.forEach(controller.add) }
    applied.setObject(want as NSString, forKey: controller)
  }
}
