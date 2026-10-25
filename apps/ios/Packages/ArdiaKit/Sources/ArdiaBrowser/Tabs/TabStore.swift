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
  static let autoArchiveCheckInterval: Duration = .seconds(15 * 60)

  public let context: ModelContext
  public private(set) var openTabs: [BrowserTab] = []
  public private(set) var privateTabs: [BrowserTab] = []
  public private(set) var selectedTabID: UUID?
  public private(set) var archive: [ArchivedDay] = []
  public private(set) var lastReceived: [BrowserTab] = []
  public private(set) var historyRevision = 0

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

  public var profileSyncId: String?
  public var searchTemplate = "https://www.google.com/search?q=%s"
  public var onLocalChange: (@MainActor () -> Void)?
  public var onTabsRemoved: (@MainActor ([BrowserTab]) -> Void)?
  public var onTabsArchived: (@MainActor ([UUID]) -> Void)?
  public var onPrivateTabsClosed: (@MainActor (_ ids: [UUID], _ noneLeft: Bool) -> Void)?

  @ObservationIgnored private let container: ModelContainer
  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private let now: () -> Date
  @ObservationIgnored private var undoStack: [[ClosedTab]] = []
  @ObservationIgnored private var archiveLoaded = false
  @ObservationIgnored private var autoArchivePending = false
  @ObservationIgnored private var isActive = false
  @ObservationIgnored private var scheduleTask: Task<Void, Never>?

  public private(set) var canReopenClosed = false

  struct ClosedTab {
    var id: UUID
    var position: Double
    var wasSelected: Bool
  }

  public init(context: ModelContext, defaults: UserDefaults = .standard, now: @escaping () -> Date = Date.init) {
    self.context = context
    self.container = context.container
    self.defaults = defaults
    self.now = now
    self.autoArchiveInterval = defaults.string(forKey: Self.autoArchiveDefaultsKey).flatMap(AutoArchiveInterval.init(rawValue:)) ?? .standard
    reloadOpenTabs()
    selectedTabID = openTabs.max(by: { $0.lastActive < $1.lastActive })?.id
    pruneExpired()
  }

  public var selectedTab: BrowserTab? {
    guard let selectedTabID else { return nil }
    return openTabs.first { $0.id == selectedTabID } ?? privateTabs.first { $0.id == selectedTabID }
  }

  public func isPrivate(_ id: UUID) -> Bool {
    privateTabs.contains { $0.id == id }
  }

  public func tab(_ id: UUID) -> BrowserTab? {
    if let open = openTabs.first(where: { $0.id == id }) { return open }
    if let open = privateTabs.first(where: { $0.id == id }) { return open }
    var descriptor = FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.id == id })
    descriptor.fetchLimit = 1
    return try? context.fetch(descriptor).first
  }

  @discardableResult
  public func open(_ destination: TabDestination, placement: TabPlacement = .end, selecting: Bool = true, isPrivate: Bool = false) -> BrowserTab {
    let date = now()
    let tab: BrowserTab
    switch destination {
    case .url(let url, let origin):
      tab = BrowserTab(url: url.absoluteString, created: date, position: 0, origin: origin, profileSyncId: profileSyncId)
    case .search(let query):
      tab = BrowserTab(url: BrowserURL.searchURL(template: searchTemplate, query: query), title: query, created: date, position: 0, origin: .search, profileSyncId: profileSyncId)
    case .browseForMe(let query, let resultID):
      tab = BrowserTab(url: BrowserURL.browseForMe(resultID), title: query, created: date, position: 0, origin: .browseForMe, profileSyncId: profileSyncId, browseResultID: resultID)
    case .sent(let received):
      tab = BrowserTab(url: received.url, title: received.title, created: date, position: 0, origin: .sent, profileSyncId: received.profileSyncId, receivedKey: received.key)
    }
    if isPrivate || (placementIsPrivate(placement)) {
      tab.isPrivate = true
      tab.profileSyncId = nil
      tab.receivedKey = nil
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
    tab.position = position(for: placement)
    context.insert(tab)
    insertSorted(tab)
    if selecting { select(tab.id) }
    persist(changedTabs: true)
    return tab
  }

  public func select(_ id: UUID?) {
    let date = now()
    if let current = selectedTab, current.id != id { current.lastActive = date }
    selectedTabID = id
    if let tab = selectedTab {
      tab.lastActive = date
      if !tab.isPrivate { persist(changedTabs: true) }
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
        self.selectedTabID = openTabs.max(by: { $0.lastActive < $1.lastActive })?.id
      }
    }
    onPrivateTabsClosed?(ids, privateTabs.isEmpty)
  }

  public func archive(_ id: UUID) {
    archiveTabs([id], undoable: true)
  }

  public func closeAll() {
    archiveTabs(openTabs.map(\.id), undoable: true)
  }

  @discardableResult
  public func reopenLastClosed() -> [BrowserTab] {
    guard let group = undoStack.popLast() else { return [] }
    canReopenClosed = !undoStack.isEmpty
    var reopened: [BrowserTab] = []
    var selection: UUID?
    for closed in group {
      guard let tab = tab(closed.id), tab.isArchived else { continue }
      tab.archivedAt = nil
      tab.lastActive = now()
      tab.position = openTabs.contains(where: { $0.position == closed.position }) ? position(for: .end) : closed.position
      insertSorted(tab)
      reopened.append(tab)
      if closed.wasSelected { selection = tab.id }
    }
    if let target = selection ?? reopened.last?.id { select(target) }
    refreshArchiveIfLoaded()
    persist(changedTabs: true)
    return reopened
  }

  public func restore(_ id: UUID) {
    guard let tab = tab(id), tab.isArchived else { return }
    tab.archivedAt = nil
    tab.position = position(for: .end)
    tab.lastActive = now()
    insertSorted(tab)
    select(id)
    refreshArchiveIfLoaded()
    persist(changedTabs: true)
  }

  public func move(_ id: UUID, to index: Int) {
    if let from = privateTabs.firstIndex(where: { $0.id == id }) {
      let tab = privateTabs.remove(at: from)
      privateTabs.insert(tab, at: max(0, min(index, privateTabs.count)))
      for (offset, each) in privateTabs.enumerated() { each.position = Double(offset) * TabPositions.step }
      return
    }
    guard let from = openTabs.firstIndex(where: { $0.id == id }) else { return }
    let tab = openTabs.remove(at: from)
    let target = max(0, min(index, openTabs.count))
    let lower = target > 0 ? openTabs[target - 1].position : nil
    let upper = target < openTabs.count ? openTabs[target].position : nil
    openTabs.insert(tab, at: target)
    if let position = TabPositions.between(lower, upper) {
      tab.position = position
    } else {
      for (offset, each) in openTabs.enumerated() { each.position = Double(offset) * TabPositions.step }
    }
    persist(changedTabs: true)
  }

  public func delete(_ ids: Set<UUID>) {
    let tabs = ids.compactMap(tab)
    guard !tabs.isEmpty else { return }
    openTabs.removeAll { ids.contains($0.id) }
    if let selectedTabID, ids.contains(selectedTabID) { self.selectedTabID = openTabs.max(by: { $0.lastActive < $1.lastActive })?.id }
    undoStack = undoStack.map { $0.filter { !ids.contains($0.id) } }.filter { !$0.isEmpty }
    canReopenClosed = !undoStack.isEmpty
    onTabsRemoved?(tabs)
    for tab in tabs { context.delete(tab) }
    refreshArchiveIfLoaded()
    persist(changedTabs: true)
  }

  public func clearArchive() {
    let archived = (try? context.fetch(FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.archivedAt != nil }))) ?? []
    delete(Set(archived.map(\.id)))
  }

  public func loadArchive() {
    archiveLoaded = true
    refreshArchive()
  }

  public func searchArchive(_ text: String) -> [BrowserTab] {
    let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return archive.flatMap(\.tabs) }
    var descriptor = FetchDescriptor<BrowserTab>(
      predicate: #Predicate { $0.archivedAt != nil && ($0.title.localizedStandardContains(query) || $0.url.localizedStandardContains(query)) },
      sortBy: [SortDescriptor(\.archivedAt, order: .reverse)]
    )
    descriptor.fetchLimit = 200
    return (try? context.fetch(descriptor)) ?? []
  }

  public func update(_ id: UUID, url: String? = nil, title: String? = nil, faviconURL: String? = nil, themeColorHex: String? = nil, snapshotFileName: String? = nil) {
    guard let tab = tab(id) else { return }
    if tab.isPrivate {
      if let url { tab.url = url }
      if let title { tab.title = title }
      if let faviconURL { tab.faviconURL = faviconURL }
      if let themeColorHex { tab.themeColorHex = themeColorHex }
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
    let visit = Visit(url: url, title: title, visitedAt: now(), profileSyncId: profileSyncId, transition: transition)
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

  @discardableResult
  public func runAutoArchive() -> Int {
    guard !isGridInteractionActive else {
      autoArchivePending = true
      return 0
    }
    autoArchivePending = false
    let date = now()
    let due = openTabs.filter {
      AutoArchivePolicy.isDue(lastActive: $0.lastActive, now: date, interval: autoArchiveInterval, isBeingViewed: $0.id == selectedTabID)
    }
    guard !due.isEmpty else { return 0 }
    archiveTabs(due.map(\.id), undoable: false)
    return due.count
  }

  public func syncedTabs() -> [LocalTabRecord] {
    openTabs
      .filter { BrowserURL.isSyncable($0.url) }
      .sorted { $0.lastActive > $1.lastActive }
      .prefix(Self.syncedTabLimit)
      .map { LocalTabRecord(url: $0.url, title: $0.title, lastActive: $0.lastActive, profileSyncId: $0.profileSyncId) }
  }

  public func syncedVisits(since date: Date) -> [LocalVisitRecord] {
    let descriptor = FetchDescriptor<Visit>(predicate: #Predicate { $0.visitedAt >= date }, sortBy: [SortDescriptor(\.visitedAt)])
    guard let visits = try? context.fetch(descriptor) else { return [] }
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

  public func receive(_ tabs: [ReceivedTab]) {
    guard !tabs.isEmpty else { return }
    let known = Set(((try? context.fetch(FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.receivedKey != nil }))) ?? []).compactMap(\.receivedKey))
    var opened: [BrowserTab] = []
    for received in tabs.sorted(by: { $0.sentAt < $1.sentAt }) where !known.contains(received.key) {
      guard BrowserURL.isSyncable(received.url) else { continue }
      opened.append(open(.sent(received), selecting: false))
    }
    if !opened.isEmpty { lastReceived = opened }
  }

  public func clearLastReceived() {
    lastReceived = []
  }

  private func archiveTabs(_ ids: [UUID], undoable: Bool) {
    let date = now()
    let set = Set(ids)
    let tabs = openTabs.filter { set.contains($0.id) }
    guard !tabs.isEmpty else { return }
    if undoable {
      undoStack.append(tabs.map { ClosedTab(id: $0.id, position: $0.position, wasSelected: $0.id == selectedTabID) })
      if undoStack.count > Self.undoLimit { undoStack.removeFirst(undoStack.count - Self.undoLimit) }
      canReopenClosed = true
    }
    let selectedIndex = selectedTabID.flatMap { id in openTabs.firstIndex { $0.id == id } }
    for tab in tabs { tab.archivedAt = date }
    openTabs.removeAll { set.contains($0.id) }
    if let selectedTabID, set.contains(selectedTabID) {
      let neighbour = selectedIndex.map { min($0, openTabs.count - 1) } ?? -1
      self.selectedTabID = neighbour >= 0 ? openTabs[neighbour].id : nil
      selectedTab?.lastActive = date
    }
    onTabsArchived?(tabs.map(\.id))
    refreshArchiveIfLoaded()
    persist(changedTabs: true)
  }

  private func pruneExpired() {
    let date = now()
    let historyCutoff = date.addingTimeInterval(-Self.historyRetention)
    try? context.delete(model: Visit.self, where: #Predicate { $0.visitedAt < historyCutoff })
    let archiveCutoff = date.addingTimeInterval(-Self.archiveRetention)
    var expired = (try? context.fetch(FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.archivedAt != nil && $0.archivedAt! < archiveCutoff }))) ?? []
    var overflow = FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.archivedAt != nil }, sortBy: [SortDescriptor(\.archivedAt, order: .reverse)])
    overflow.fetchOffset = Self.archiveLimit
    expired += (try? context.fetch(overflow)) ?? []
    if !expired.isEmpty {
      delete(Set(expired.map(\.id)))
    } else {
      try? context.save()
    }
  }

  private func reloadOpenTabs() {
    let descriptor = FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.archivedAt == nil }, sortBy: [SortDescriptor(\.position)])
    openTabs = (try? context.fetch(descriptor)) ?? []
  }

  private func refreshArchiveIfLoaded() {
    if archiveLoaded { refreshArchive() }
  }

  private func refreshArchive() {
    var descriptor = FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.archivedAt != nil }, sortBy: [SortDescriptor(\.archivedAt, order: .reverse)])
    descriptor.fetchLimit = Self.archiveLimit
    let tabs = (try? context.fetch(descriptor)) ?? []
    let calendar = Calendar.current
    var days: [ArchivedDay] = []
    for tab in tabs {
      let day = calendar.startOfDay(for: tab.archivedAt ?? tab.lastActive)
      if days.last?.day == day {
        days[days.count - 1].tabs.append(tab)
      } else {
        days.append(ArchivedDay(day: day, tabs: [tab]))
      }
    }
    archive = days
  }

  private func position(for placement: TabPlacement) -> Double {
    switch placement {
    case .end:
      return (openTabs.last?.position).map { $0 + TabPositions.step } ?? 0
    case .after(let id):
      guard let index = openTabs.firstIndex(where: { $0.id == id }) else { return position(for: .end) }
      let lower = openTabs[index].position
      let upper = index + 1 < openTabs.count ? openTabs[index + 1].position : nil
      if let between = TabPositions.between(lower, upper) { return between }
      for (offset, each) in openTabs.enumerated() { each.position = Double(offset) * TabPositions.step }
      return openTabs[index].position + TabPositions.step / 2
    }
  }

  private func insertSorted(_ tab: BrowserTab) {
    openTabs.removeAll { $0.id == tab.id }
    let index = openTabs.firstIndex { $0.position > tab.position } ?? openTabs.count
    openTabs.insert(tab, at: index)
  }

  private func persist(changedTabs: Bool) {
    try? context.save()
    if changedTabs { onLocalChange?() }
  }
}
