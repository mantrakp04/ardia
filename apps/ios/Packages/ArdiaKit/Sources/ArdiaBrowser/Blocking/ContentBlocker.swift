import Foundation
import Observation
import WebKit

public enum ContentBlockerState: Equatable, Sendable {
  case preparing
  case ready(updated: Date?)
  case failed(String)
}

struct BlockingMetadata: Codable, Equatable {
  struct Source: Codable, Equatable {
    var etag: String?
    var lastModified: String?
    var updated: Date
    var ruleCount: Int
  }

  var sources: [String: Source] = [:]
  var lastCheck: Date?
}

@MainActor
@Observable
public final class ContentBlocker {
  public static let refreshInterval: TimeInterval = 7 * 24 * 3600

  public let settings: BlockingSettings
  public private(set) var state: ContentBlockerState = .preparing
  public private(set) var isRefreshing = false

  @ObservationIgnored let directory: URL
  @ObservationIgnored private let session: URLSession
  @ObservationIgnored private var store: WKContentRuleListStore?
  @ObservationIgnored private var lists: [BlockingCategory: WKContentRuleList] = [:]
  @ObservationIgnored private var blockedDomains: Set<String> = []
  @ObservationIgnored private var metadata = BlockingMetadata()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private let controllers = NSHashTable<WKUserContentController>.weakObjects()
  @ObservationIgnored private var applied: [ObjectIdentifier: AppliedLists] = [:]
  @ObservationIgnored private var preparing: Task<Void, Never>?

  struct AppliedLists: Equatable {
    var revision: Int
    var exempt: Bool
  }

  public init(settings: BlockingSettings, directory: URL, session: URLSession = .shared) {
    self.settings = settings
    self.directory = directory
    self.session = session
    settings.onChange = { [weak self] in self?.settingsChanged() }
  }

  var metadataURL: URL { directory.appending(path: "metadata.json") }
  func domainsURL(_ category: BlockingCategory) -> URL { directory.appending(path: "\(category.rawValue)-domains.txt") }

  public func prepare() async {
    if let preparing { return await preparing.value }
    let task = Task { await load() }
    preparing = task
    await task.value
  }

  private func load() async {
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    } catch {
      state = .failed(String(localized: "Ardia couldn’t set up content blocking. Restart Ardia to try again."))
      return
    }
    guard let store = WKContentRuleListStore(url: directory.appending(path: "Store", directoryHint: .isDirectory)) else {
      state = .failed(String(localized: "Ardia couldn’t set up content blocking. Restart Ardia to try again."))
      return
    }
    self.store = store
    metadata = (try? JSONDecoder().decode(BlockingMetadata.self, from: Data(contentsOf: metadataURL))) ?? BlockingMetadata()
    var failures = 0
    for category in BlockingCategory.allCases {
      if let existing = try? await store.contentRuleList(forIdentifier: category.identifier) {
        lists[category] = existing
        continue
      }
      let conversion = await Self.convert(SeedRules.list(for: category))
      do {
        lists[category] = try await compile(conversion, for: category)
        try? await Self.write(conversion.blockedDomains.joined(separator: "\n"), to: domainsURL(category))
      } catch {
        failures += 1
      }
    }
    blockedDomains = await Self.readDomains(BlockingCategory.allCases.map(domainsURL))
    revision += 1
    pushToControllers()
    let updated = metadata.sources.values.map(\.updated).max()
    state = failures == BlockingCategory.allCases.count
      ? .failed(String(localized: "Content blocking isn’t available right now."))
      : .ready(updated: updated)
  }

  public func refreshIfDue(now: Date = .now, force: Bool = false) async {
    await prepare()
    guard !isRefreshing else { return }
    if !force, let last = metadata.lastCheck, now.timeIntervalSince(last) < Self.refreshInterval, now >= last { return }
    isRefreshing = true
    defer { isRefreshing = false }
    var changed = false
    for category in BlockingCategory.allCases {
      do {
        guard let text = try await download(category) else { continue }
        let conversion = await Self.convert(SeedRules.list(for: category) + "\n" + text.body)
        guard conversion.ruleCount > 0 else { continue }
        lists[category] = try await compile(conversion, for: category)
        try? await Self.write(conversion.blockedDomains.joined(separator: "\n"), to: domainsURL(category))
        metadata.sources[category.rawValue] = .init(etag: text.etag, lastModified: text.lastModified, updated: now, ruleCount: conversion.ruleCount)
        changed = true
      } catch {
        continue
      }
    }
    metadata.lastCheck = now
    if let data = try? JSONEncoder().encode(metadata) { try? data.write(to: metadataURL, options: .atomic) }
    if changed {
      blockedDomains = await Self.readDomains(BlockingCategory.allCases.map(domainsURL))
      revision += 1
      pushToControllers()
    }
    if case .failed = state, !lists.isEmpty { state = .ready(updated: now) }
    if case .ready = state { state = .ready(updated: metadata.sources.values.map(\.updated).max()) }
  }

  public func install(on controller: WKUserContentController, counter: BlockedResourceCounter) {
    let key = ObjectIdentifier(controller)
    if controllers.contains(controller) { return }
    controllers.add(controller)
    let world = WKContentWorld.world(name: "ArdiaBlocking")
    controller.addScriptMessageHandler(BlockingMessageProxy(blocker: self, counter: counter), contentWorld: world, name: BlockingScripts.handlerName)
    controller.addUserScript(WKUserScript(source: BlockingScripts.counter, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: world))
    controller.addUserScript(WKUserScript(source: BlockingScripts.consent, injectionTime: .atDocumentEnd, forMainFrameOnly: false, in: world))
    applied[key] = nil
    apply(to: controller, exempt: false)
  }

  public func prepareNavigation(of controller: WKUserContentController, toHost host: String?) {
    apply(to: controller, exempt: settings.isExempt(host))
  }

  public func blocksRequest(toHost host: String) -> Bool {
    guard !blockedDomains.isEmpty else { return false }
    var candidate = Substring(host.lowercased())
    while candidate.contains(".") {
      if blockedDomains.contains(String(candidate)) { return true }
      guard let dot = candidate.firstIndex(of: ".") else { return false }
      candidate = candidate[candidate.index(after: dot)...]
    }
    return false
  }

  func shouldRejectConsent(onHost host: String?) -> Bool {
    settings.hidesCookieBanners && !settings.isExempt(host)
  }

  func countBlocked(_ hosts: [String], pageHost: String?, into counter: BlockedResourceCounter) {
    guard !settings.isExempt(pageHost) else { return }
    counter.add(hosts.count { blocksRequest(toHost: $0) })
  }

  private func settingsChanged() {
    revision += 1
    pushToControllers()
  }

  private func pushToControllers() {
    for controller in controllers.allObjects {
      let exempt = applied[ObjectIdentifier(controller)]?.exempt ?? false
      apply(to: controller, exempt: exempt)
    }
    let live = Set(controllers.allObjects.map(ObjectIdentifier.init))
    applied = applied.filter { live.contains($0.key) }
  }

  private func apply(to controller: WKUserContentController, exempt: Bool) {
    let key = ObjectIdentifier(controller)
    let target = AppliedLists(revision: revision, exempt: exempt)
    guard applied[key] != target else { return }
    applied[key] = target
    controller.removeAllContentRuleLists()
    guard !exempt else { return }
    for category in BlockingCategory.allCases where settings.isEnabled(category) {
      if let list = lists[category] { controller.add(list) }
    }
  }

  private func compile(_ conversion: FilterConversion, for category: BlockingCategory) async throws -> WKContentRuleList {
    guard let store else { throw CocoaError(.featureUnsupported) }
    guard let list = try await store.compileContentRuleList(forIdentifier: category.identifier, encodedContentRuleList: conversion.json) else {
      throw CocoaError(.coderInvalidValue)
    }
    return list
  }

  private func download(_ category: BlockingCategory) async throws -> (body: String, etag: String?, lastModified: String?)? {
    var request = URLRequest(url: category.sourceURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
    let previous = metadata.sources[category.rawValue]
    if lists[category] != nil, let previous {
      if let etag = previous.etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
      if let modified = previous.lastModified { request.setValue(modified, forHTTPHeaderField: "If-Modified-Since") }
    }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { return nil }
    if http.statusCode == 304 { return nil }
    guard http.statusCode == 200, data.count < 20_000_000, let body = String(data: data, encoding: .utf8), body.contains("||") || body.contains("##") else { return nil }
    return (body, http.value(forHTTPHeaderField: "ETag"), http.value(forHTTPHeaderField: "Last-Modified"))
  }

  @concurrent
  static func convert(_ text: String) async -> FilterConversion {
    FilterListConverter.convert(text)
  }

  @concurrent
  static func write(_ text: String, to url: URL) async throws {
    try Data(text.utf8).write(to: url, options: .atomic)
  }

  @concurrent
  static func readDomains(_ urls: [URL]) async -> Set<String> {
    var domains: Set<String> = []
    for url in urls {
      guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
      for line in text.split(separator: "\n") where !line.isEmpty { domains.insert(String(line)) }
    }
    return domains
  }
}

@MainActor
final class BlockingMessageProxy: NSObject, WKScriptMessageHandlerWithReply {
  weak var blocker: ContentBlocker?
  weak var counter: BlockedResourceCounter?

  init(blocker: ContentBlocker, counter: BlockedResourceCounter) {
    self.blocker = blocker
    self.counter = counter
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
    guard let blocker, let body = message.body as? [String: Any], let type = body["type"] as? String else { return (nil, nil) }
    let pageHost = message.webView?.url?.host()
    switch type {
    case "consent":
      return (blocker.shouldRejectConsent(onHost: pageHost), nil)
    case "blocked":
      if let counter, let hosts = body["hosts"] as? [String] { blocker.countBlocked(Array(hosts.prefix(500)), pageHost: pageHost, into: counter) }
      return (nil, nil)
    default:
      return (nil, nil)
    }
  }
}
