import ArdiaSync
import Foundation
import Observation
import SwiftData

@MainActor
@Observable
public final class TabStore: LocalBrowsingSource {
  public static let undoLimit = 20
  public static let historyRetention: TimeInterval = 90 * 24 * 3600
  public static let archiveRetention: TimeInterval = 90 * 24 * 3600
  public static let archiveLimit = 2000
  public static let syncedTabLimit = 30
  static let autoArchiveDefaultsKey = "tabs.autoArchiveInterval"
  static let selectionDefaultsKey = "tabs.selectionBySpace"
  static let autoArchiveCheckInterval: Duration = .seconds(15 * 60)

  public let context: ModelContext
  public internal(set) var allOpenTabs: [BrowserTab] = [] {
    didSet { refreshSpaceTabs() }
  }
  public internal(set) var openTabs: [BrowserTab] = []
  public internal(set) var privateTabs: [BrowserTab] = []
  public internal(set) var selectedTabID: UUID?
  public internal(set) var archive: [ArchivedDay] = []
  public private(set) var lastReceived: [BrowserTab] = []
  public private(set) var historyRevision = 0
  public internal(set) var listingRevision = 0
  public internal(set) var spaceRoster: SpaceRoster = .unnamed
  public internal(set) var canReopenClosed = false

  public var autoArchiveInterval: AutoArchiveInterval {
    didSet {
      guard autoArchiveInterval != oldValue else { return }
      defaults.set(autoArchiveInterval.rawValue, forKey: Self.autoArchiveDefaultsKey)
      runAutoArchive()
    }
  }

  public var isGridInteractionActive = false {
    didSet {
      if !isGridInteractionActive, autoArchivePending { runAutoArchive() }
    }
  }

  public var profileSyncId: String? {
    didSet {
      guard profileSyncId != oldValue else { return }
      spaceDidChange()
    }
  }

  public var searchTemplate = "https://www.google.com/search?q=%s"
  public var onLocalChange: (@MainActor () -> Void)?
  public var onTabsRemoved: (@MainActor ([BrowserTab]) -> Void)?
  public var onTabsArchived: (@MainActor ([UUID]) -> Void)?
  public var onPrivateTabsClosed: (@MainActor (_ ids: [UUID], _ noneLeft: Bool) -> Void)?

  @ObservationIgnored private let container: ModelContainer
  @ObservationIgnored let defaults: UserDefaults
  @ObservationIgnored let now: () -> Date
  @ObservationIgnored var undoStack: [[ClosedTab]] = []
  @ObservationIgnored var archiveLoaded = false
  @ObservationIgnored var autoArchivePending = false
  @ObservationIgnored private var isActive = false
  @ObservationIgnored private var scheduleTask: Task<Void, Never>?
  @ObservationIgnored var selectionBySpace: [String: UUID] = [:]
  @ObservationIgnored var openers: [UUID: UUID] = [:]

  struct ClosedTab {
    var id: UUID
    var position: Double
    var wasSelected: Bool
    var profileSyncId: String?
  }

  public init(context: ModelContext, defaults: UserDefaults = .standard, now: @escaping () -> Date = Date.init) {
    self.context = context
    self.container = context.container
    self.defaults = defaults
    self.now = now
    self.autoArchiveInterval = defaults.string(forKey: Self.autoArchiveDefaultsKey).flatMap(AutoArchiveInterval.init(rawValue:)) ?? .standard
    selectionBySpace = Self.loadSelection(from: defaults)
    reloadOpenTabs()
    selectedTabID = openTabs.max(by: { $0.lastActive < $1.lastActive })?.id
    pruneExpired()
  }

  public var selectedTab: BrowserTab? {
    guard let selectedTabID else { return nil }
    return allOpenTabs.first { $0.id == selectedTabID } ?? privateTabs.first { $0.id == selectedTabID }
  }

  public func isPrivate(_ id: UUID) -> Bool {
    privateTabs.contains { $0.id == id }
  }

  public func tab(_ id: UUID) -> BrowserTab? {
    if let open = allOpenTabs.first(where: { $0.id == id }) { return open }
    if let open = privateTabs.first(where: { $0.id == id }) { return open }
    var descriptor = FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.id == id })
    descriptor.fetchLimit = 1
    return try? context.fetch(descriptor).first
  }

  @discardableResult
  public func open(_ destination: TabDestination, placement: TabPlacement = .end, selecting: Bool = true, isPrivate: Bool = false) -> BrowserTab {
    let date = now()
    let profile = openerProfile(placement) ?? profileSyncId
    let tab: BrowserTab
    switch destination {
    case .url(let url, let origin):
      tab = BrowserTab(url: url.absoluteString, created: date, position: 0, origin: origin, profileSyncId: profile)
    case .search(let query):
      tab = BrowserTab(url: BrowserURL.searchURL(template: searchTemplate, query: query), title: query, created: date, position: 0, origin: .search, profileSyncId: profile)
    case .sent(let received):
      tab = BrowserTab(url: received.url, title: received.title, created: date, position: 0, origin: .sent, profileSyncId: received.profileSyncId, receivedKey: received.key, receivedFromDevice: received.fromDevice)
    }
    if isPrivate || (placementIsPrivate(placement)) {
      tab.isPrivate = true
      tab.profileSyncId = nil
      tab.receivedKey = nil
      tab.receivedFromDevice = nil
      tab.position = (privateTabs.last?.position).map { $0 + TabPositions.step } ?? 0
      if case .after(let id) = placement, let index = privateTabs.firstIndex(where: { $0.id == id }) {
        let upper = index + 1 < privateTabs.count ? privateTabs[index + 1].position : nil
        tab.position = TabPositions.between(privateTabs[index].position, upper) ?? tab.position
      }
      privateTabs.append(tab)
      privateTabs.sort { $0.position < $1.position }
      if selecting { select(tab.id) }
      return tab
    }
    tab.position = position(for: placement, profileSyncId: profile, background: !selecting)
    if case .after(let opener) = placement { openers[tab.id] = opener }
    context.insert(tab)
    insertSorted(tab)
    if selecting { select(tab.id) }
    listingRevision &+= 1
    persist(changedTabs: true)
    return tab
  }

  public func select(_ id: UUID?) {
    let date = now()
    let previous = selectedTab
    if let previous, previous.id != id { previous.lastActive = date }
    if let previous, let id, previous.id != id { keepOrForgetOpeners(from: previous.id, to: id) }
    selectedTabID = id
    if let tab = selectedTab {
      tab.lastActive = date
      if !tab.isPrivate {
        remember(tab)
        persist(changedTabs: true)
      }
    }
  }

  public func close(_ id: UUID) {
    if isPrivate(id) {
      closePrivate([id])
    } else {
      archiveTabs([id], undoable: true)
    }
  }

  public func closeAllPrivate() {
    closePrivate(privateTabs.map(\.id))
  }

  private func openerProfile(_ placement: TabPlacement) -> String?? {
    guard case .after(let id) = placement, let opener = tab(id), !opener.isPrivate else { return nil }
    return .some(opener.profileSyncId)
  }

  private func placementIsPrivate(_ placement: TabPlacement) -> Bool {
    if case .after(let id) = placement { return isPrivate(id) }
    return false
  }

  private func closePrivate(_ ids: [UUID]) {
    let set = Set(ids)
    guard privateTabs.contains(where: { set.contains($0.id) }) else { return }
    let selectedIndex = selectedTabID.flatMap { id in privateTabs.firstIndex { $0.id == id } }
    privateTabs.removeAll { set.contains($0.id) }
    if let selectedTabID, set.contains(selectedTabID) {
      if let selectedIndex, !privateTabs.isEmpty {
        self.selectedTabID = privateTabs[min(selectedIndex, privateTabs.count - 1)].id
      } else {
        self.selectedTabID = rememberedSelection()
      }
    }
    onPrivateTabsClosed?(ids, privateTabs.isEmpty)
  }

  public func update(_ id: UUID, url: String? = nil, title: String? = nil, faviconURL: String? = nil, themeColorHex: String? = nil, snapshotFileName: String? = nil) {
    guard let tab = tab(id) else { return }
    if tab.isPrivate {
      if let url { tab.url = url }
      if let title { tab.title = title }
      if let faviconURL { tab.faviconURL = faviconURL }
      if let themeColorHex { tab.themeColorHex = themeColorHex }
      if let snapshotFileName { tab.snapshotFileName = snapshotFileName }
      return
    }
    var syncVisible = false
    if let url, url != tab.url {
      tab.url = url
      syncVisible = true
    }
    if let title, title != tab.title {
      tab.title = title
      syncVisible = true
    }
    if let faviconURL, faviconURL != tab.faviconURL { tab.faviconURL = faviconURL }
    if let themeColorHex, themeColorHex != tab.themeColorHex { tab.themeColorHex = themeColorHex }
    if let snapshotFileName, snapshotFileName != tab.snapshotFileName { tab.snapshotFileName = snapshotFileName }
    if syncVisible { listingRevision &+= 1 }
    persist(changedTabs: syncVisible)
  }

  public func saveInteractionState(_ data: Data?, for id: UUID) {
    guard let tab = tab(id), tab.interactionState != data else { return }
    tab.interactionState = data
    if !tab.isPrivate { persist(changedTabs: false) }
  }

  @discardableResult
  public func recordVisit(url: String, title: String, transition: VisitTransition, fromTab tabID: UUID? = nil) -> Visit? {
    guard BrowserURL.isSyncable(url), !(tabID.map(isPrivate) ?? false) else { return nil }
    let profile = tabID.flatMap { tab($0) }.map(\.profileSyncId) ?? profileSyncId
    let visit = Visit(url: url, title: title, visitedAt: now(), profileSyncId: profile, transition: transition)
    context.insert(visit)
    historyRevision &+= 1
    persist(changedTabs: true)
    return visit
  }

  public func amend(_ visit: Visit, url: String? = nil, title: String? = nil) {
    if let url, BrowserURL.isSyncable(url) { visit.url = url }
    if let title, !title.isEmpty { visit.title = title }
    historyRevision &+= 1
    persist(changedTabs: true)
  }

  public func clearHistory(since date: Date? = nil) {
    if let date {
      try? context.delete(model: Visit.self, where: #Predicate { $0.visitedAt >= date })
    } else {
      try? context.delete(model: Visit.self)
    }
    historyRevision &+= 1
    persist(changedTabs: false)
  }

  public func appBecameActive() {
    isActive = true
    if let tab = selectedTab { tab.lastActive = now() }
    runAutoArchive()
    pruneExpired()
    scheduleTask?.cancel()
    scheduleTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.autoArchiveCheckInterval, tolerance: .seconds(60))
        guard !Task.isCancelled else { return }
        self?.runAutoArchive()
      }
    }
  }

  public func appWillResignActive() {
    isActive = false
    scheduleTask?.cancel()
    scheduleTask = nil
    if let tab = selectedTab { tab.lastActive = now() }
    persist(changedTabs: false)
  }

  public func syncedTabs() -> [LocalTabRecord] {
    var countBySpace: [String?: Int] = [:]
    return allOpenTabs
      .filter { BrowserURL.isSyncable($0.url) }
      .sorted { $0.lastActive > $1.lastActive }
      .filter { tab in
        let count = countBySpace[tab.profileSyncId, default: 0]
        countBySpace[tab.profileSyncId] = count + 1
        return count < Self.syncedTabLimit
      }
      .map { LocalTabRecord(url: $0.url, title: $0.title, lastActive: $0.lastActive, profileSyncId: $0.profileSyncId) }
  }

  public func syncedVisits(since date: Date) -> [LocalVisitRecord] {
    let descriptor = FetchDescriptor<Visit>(predicate: #Predicate { $0.visitedAt >= date }, sortBy: [SortDescriptor(\.visitedAt)])
    return Self.group((try? context.fetch(descriptor)) ?? [])
  }

  public func syncedVisits(urls: Set<String>) -> [LocalVisitRecord] {
    guard !urls.isEmpty else { return [] }
    let list = Array(urls)
    let cutoff = now().addingTimeInterval(-Self.historyRetention)
    let descriptor = FetchDescriptor<Visit>(predicate: #Predicate { list.contains($0.url) && $0.visitedAt >= cutoff }, sortBy: [SortDescriptor(\.visitedAt)])
    return Self.group((try? context.fetch(descriptor)) ?? [])
  }

  static func group(_ visits: [Visit]) -> [LocalVisitRecord] {
    struct Key: Hashable {
      var url: String
      var profile: String?
    }
    var order: [Key] = []
    var records: [Key: LocalVisitRecord] = [:]
    for visit in visits {
      let key = Key(url: visit.url, profile: visit.profileSyncId)
      if var record = records[key] {
        record.visitedAt.append(visit.visitedAt)
        if !visit.title.isEmpty { record.title = visit.title }
        records[key] = record
      } else {
        order.append(key)
        records[key] = LocalVisitRecord(url: visit.url, title: visit.title, visitedAt: [visit.visitedAt], profileSyncId: visit.profileSyncId)
      }
    }
    return order.compactMap { records[$0] }
  }

  public func removeVisits(urls: Set<String>, profileSyncId: String?) {
    guard !urls.isEmpty else { return }
    let list = Array(urls)
    if let profileSyncId {
      try? context.delete(model: Visit.self, where: #Predicate { list.contains($0.url) && $0.profileSyncId == profileSyncId })
    } else {
      try? context.delete(model: Visit.self, where: #Predicate { list.contains($0.url) && $0.profileSyncId == nil })
    }
    historyRevision &+= 1
    try? context.save()
  }

  @discardableResult
  public func receive(_ tabs: [ReceivedTab]) -> Bool {
    guard !tabs.isEmpty else { return true }
    let known = Set(((try? context.fetch(FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.receivedKey != nil }))) ?? []).compactMap(\.receivedKey))
    var opened: [BrowserTab] = []
    for received in tabs.sorted(by: { $0.sentAt < $1.sentAt }) where !known.contains(received.key) {
      guard BrowserURL.isSyncable(received.url) else { continue }
      opened.append(open(.sent(received), selecting: false))
    }
    if !opened.isEmpty { lastReceived = opened }
    do {
      try context.save()
      return true
    } catch {
      return false
    }
  }

  public func clearLastReceived() {
    lastReceived = []
  }

  func reloadOpenTabs() {
    let descriptor = FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.archivedAt == nil }, sortBy: [SortDescriptor(\.position)])
    allOpenTabs = (try? context.fetch(descriptor)) ?? []
  }

  func persist(changedTabs: Bool) {
    try? context.save()
    if changedTabs { onLocalChange?() }
  }
}
