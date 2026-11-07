import Foundation
import Observation
import WebKit

public enum ContentBlockerState: Equatable, Sendable {
  case preparing
  case ready(updated: Date?)
  case failed(String)
}

@MainActor
@Observable
public final class ContentBlocker {
  public let settings: BlockingSettings
  public let filterLists: FilterLists
  public private(set) var state: ContentBlockerState = .preparing
  public var isRefreshing: Bool { filterLists.isUpdating }

  @ObservationIgnored let directory: URL
  @ObservationIgnored private var store: WKContentRuleListStore?
  @ObservationIgnored private var seeds: [BlockingCategory: WKContentRuleList] = [:]
  @ObservationIgnored private var seedDomains: Set<String> = []
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private let controllers = NSHashTable<WKUserContentController>.weakObjects()
  @ObservationIgnored private var applied: [ObjectIdentifier: AppliedLists] = [:]
  @ObservationIgnored private var preparing: Task<Void, Never>?

  struct AppliedLists: Equatable {
    var revision: Int
    var exempt: Bool
  }

  public init(settings: BlockingSettings, directory: URL, session: URLSession = .shared, filterLists: FilterLists? = nil, defaults: UserDefaults? = nil) {
    self.settings = settings
    self.directory = directory
    self.filterLists = filterLists ?? FilterLists(directory: directory.appending(path: "Filters", directoryHint: .isDirectory), defaults: defaults ?? settings.defaults, session: session)
    settings.onChange = { [weak self] in self?.listsChanged() }
    self.filterLists.onCompiledChange = { [weak self] in self?.listsChanged() }
  }

  func domainsURL(_ category: BlockingCategory) -> URL { directory.appending(path: "seed-\(category.rawValue)-domains.txt") }

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
    var failures = 0
    for category in BlockingCategory.allCases {
      let source = SeedRules.list(for: category)
      let identifier = "\(category.identifier).\(FilterLists.hash(source).prefix(12))"
      if let existing = try? await store.contentRuleList(forIdentifier: identifier) {
        seeds[category] = existing
        continue
      }
      let conversion = await Self.convert(source)
      if let list = try? await store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: conversion.json) {
        seeds[category] = list
        try? await FilterLists.write(conversion.blockedDomains.joined(separator: "\n"), to: domainsURL(category))
      } else {
        failures += 1
      }
    }
    var domains: Set<String> = []
    for category in BlockingCategory.allCases { domains.formUnion(await FilterLists.readDomains(domainsURL(category))) }
    seedDomains = domains
    await filterLists.loadCompiled()
    listsChanged()
    state = failures == BlockingCategory.allCases.count && filterLists.lastUpdated == nil
      ? .failed(String(localized: "Content blocking isn’t available right now."))
      : .ready(updated: filterLists.lastUpdated)
  }

  public func refreshIfDue(now: Date = .now, force: Bool = false) async {
    await prepare()
    if force { await filterLists.updateNow() } else { await filterLists.updateIfNeeded(now: now) }
    if case .ready = state { state = .ready(updated: filterLists.lastUpdated) }
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
    let lists = filterLists.blockedDomains
    guard !seedDomains.isEmpty || !lists.isEmpty else { return false }
    var candidate = Substring(host.lowercased())
    while candidate.contains(".") {
      if seedDomains.contains(String(candidate)) || lists.contains(String(candidate)) { return true }
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

  private func listsChanged() {
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
    for list in activeLists() { controller.add(list) }
  }

  func activeLists() -> [WKContentRuleList] {
    var result: [WKContentRuleList] = []
    for category in BlockingCategory.allCases where settings.isEnabled(category) {
      if let seed = seeds[category] { result.append(seed) }
    }
    for compiled in filterLists.compiled where compiled.category.map(settings.isEnabled) ?? true {
      result.append(compiled.list)
    }
    return result
  }

  @concurrent
  static func convert(_ text: String) async -> FilterConversion {
    FilterListConverter.convert(text)
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
