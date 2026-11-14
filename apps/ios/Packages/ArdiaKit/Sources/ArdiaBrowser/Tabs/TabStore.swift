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
  public private(set) var allOpenTabs: [BrowserTab] = [] {
    didSet { openTabs = allOpenTabs.filter { spaces.contains($0.profileSyncId) } }
  }
  public private(set) var privateTabs: [BrowserTab] = []
  public private(set) var selectedTabID: UUID?
  public private(set) var archive: [ArchivedDay] = []
  public private(set) var lastReceived: [BrowserTab] = []
  public private(set) var historyRevision = 0
  public private(set) var listingRevision = 0

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

  public var spaces: TabSpaces = .unsynced {
    didSet {
      guard spaces != oldValue else { return }
      openTabs = allOpenTabs.filter { spaces.contains($0.profileSyncId) }
      reselectForSpace()
      listingRevision &+= 1
    }
  }

  public var profileSyncId: String? {
    get { spaces.current }
    set { spaces.current = newValue }
  }
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
    return allOpenTabs.first { $0.id == selectedTabID } ?? privateTabs.first { $0.id == selectedTabID }
  }

  public func space(of id: UUID) -> String? {
    guard let tab = allOpenTabs.first(where: { $0.id == id }) ?? tab(id), !tab.isPrivate else { return nil }
    return spaces.space(of: tab.profileSyncId)
  }

  public func openTabs(inSpace space: String?) -> [BrowserTab] {
    guard spaces.isSplit else { return allOpenTabs }
    return allOpenTabs.filter { spaces.space(of: $0.profileSyncId) == space }
  }

  public func assign(_ id: UUID, toSpace space: String?) {
    guard let tab = allOpenTabs.first(where: { $0.id == id }), tab.profileSyncId != space else { return }
    tab.profileSyncId = space
    allOpenTabs = allOpenTabs
    reselectForSpace()
    listingRevision &+= 1
    persist(changedTabs: true)
  }

  private func reselectForSpace() {
    if let selectedTabID, isPrivate(selectedTabID) || openTabs.contains(where: { $0.id == selectedTabID }) { return }
    selectedTabID = openTabs.max(by: { $0.lastActive < $1.lastActive })?.id
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
    tab.position = position(for: placement)
    context.insert(tab)
    insertSorted(tab)
    if selecting { select(tab.id) }
    listingRevision &+= 1
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
      tab.position = allOpenTabs.contains(where: { $0.position == closed.position }) ? position(for: .end) : closed.position
      insertSorted(tab)
      reopened.append(tab)
      if closed.wasSelected { selection = tab.id }
    }
    if let target = selection ?? reopened.last?.id { select(target) }
    refreshArchiveIfLoaded()
    listingRevision &+= 1
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
    listingRevision &+= 1
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
    var space = openTabs
    let tab = space.remove(at: from)
    let target = max(0, min(index, space.count))
    var all = allOpenTabs.filter { $0.id != id }
    let anchor: Int
    if target < space.count, let next = all.firstIndex(where: { $0 === space[target] }) {
      anchor = next
    } else if target > 0, let previous = all.firstIndex(where: { $0 === space[target - 1] }) {
      anchor = previous + 1
    } else {
      anchor = all.count
    }
    all.insert(tab, at: anchor)
    let lower = anchor > 0 ? all[anchor - 1].position : nil
    let upper = anchor + 1 < all.count ? all[anchor + 1].position : nil
    if let position = TabPositions.between(lower, upper) {
      tab.position = position
    } else {
      for (offset, each) in all.enumerated() { each.position = Double(offset) * TabPositions.step }
    }
    allOpenTabs = all
    persist(changedTabs: true)
  }

  public func delete(_ ids: Set<UUID>) {
    let tabs = ids.compactMap(tab)
    guard !tabs.isEmpty else { return }
    allOpenTabs.removeAll { ids.contains($0.id) }
    if let selectedTabID, ids.contains(selectedTabID) { self.selectedTabID = openTabs.max(by: { $0.lastActive < $1.lastActive })?.id }
    undoStack = undoStack.map { $0.filter { !ids.contains($0.id) } }.filter { !$0.isEmpty }
    canReopenClosed = !undoStack.isEmpty
    onTabsRemoved?(tabs)
    for tab in tabs { context.delete(tab) }
    refreshArchiveIfLoaded()
    listingRevision &+= 1
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

  @discardableResult
  public func runAutoArchive() -> Int {
    guard !isGridInteractionActive else {
      autoArchivePending = true
      return 0
    }
    autoArchivePending = false
    let date = now()
    let due = allOpenTabs.filter {
      AutoArchivePolicy.isDue(lastActive: $0.lastActive, now: date, interval: autoArchiveInterval, isBeingViewed: $0.id == selectedTabID)
    }
    guard !due.isEmpty else { return 0 }
    archiveTabs(due.map(\.id), undoable: false)
    return due.count
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

  public func visitsInCurrentSpace(limit: Int) -> [Visit] {
    var matches: [Visit] = []
    var offset = 0
    let batch = max(limit, 200)
    while matches.count < limit {
      var descriptor = FetchDescriptor<Visit>(predicate: currentSpaceVisits, sortBy: [SortDescriptor(\.visitedAt, order: .reverse)])
      descriptor.fetchLimit = batch
      descriptor.fetchOffset = offset
      let page = (try? context.fetch(descriptor)) ?? []
      matches.append(contentsOf: page.filter { spaces.contains($0.profileSyncId) })
      if page.count < batch { break }
      offset += batch
    }
    return Array(matches.prefix(limit))
  }

  private var currentSpaceVisits: Predicate<Visit>? {
    guard spaces.isSplit else { return nil }
    guard let current = spaces.current, current != spaces.defaultID else {
      let otherSpaces: [String?] = Array(spaces.known.subtracting([spaces.defaultID].compactMap { $0 }))
      return #Predicate { $0.profileSyncId == nil || !otherSpaces.contains($0.profileSyncId) }
    }
    return #Predicate { $0.profileSyncId == current }
  }

  public func removeVisitsInCurrentSpace(urls: Set<String>) {
    guard !urls.isEmpty else { return }
    let list = Array(urls)
    let visits = (try? context.fetch(FetchDescriptor<Visit>(predicate: #Predicate { list.contains($0.url) }))) ?? []
    for visit in visits where spaces.contains(visit.profileSyncId) { context.delete(visit) }
    historyRevision &+= 1
    try? context.save()
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

  private func archiveTabs(_ ids: [UUID], undoable: Bool) {
    let date = now()
    let set = Set(ids)
    let tabs = allOpenTabs.filter { set.contains($0.id) }
    guard !tabs.isEmpty else { return }
    if undoable {
      undoStack.append(tabs.map { ClosedTab(id: $0.id, position: $0.position, wasSelected: $0.id == selectedTabID) })
      if undoStack.count > Self.undoLimit { undoStack.removeFirst(undoStack.count - Self.undoLimit) }
      canReopenClosed = true
    }
    let selectedIndex = selectedTabID.flatMap { id in openTabs.firstIndex { $0.id == id } }
    for tab in tabs { tab.archivedAt = date }
    allOpenTabs.removeAll { set.contains($0.id) }
    if let selectedTabID, set.contains(selectedTabID) {
      let neighbour = selectedIndex.map { min($0, openTabs.count - 1) } ?? -1
      self.selectedTabID = neighbour >= 0 ? openTabs[neighbour].id : nil
      selectedTab?.lastActive = date
    }
    onTabsArchived?(tabs.map(\.id))
    refreshArchiveIfLoaded()
    listingRevision &+= 1
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
    allOpenTabs = (try? context.fetch(descriptor)) ?? []
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
      return (allOpenTabs.last?.position).map { $0 + TabPositions.step } ?? 0
    case .after(let id):
      guard let index = allOpenTabs.firstIndex(where: { $0.id == id }) else { return position(for: .end) }
      let lower = allOpenTabs[index].position
      let upper = index + 1 < allOpenTabs.count ? allOpenTabs[index + 1].position : nil
      if let between = TabPositions.between(lower, upper) { return between }
      for (offset, each) in allOpenTabs.enumerated() { each.position = Double(offset) * TabPositions.step }
      return allOpenTabs[index].position + TabPositions.step / 2
    }
  }

  private func insertSorted(_ tab: BrowserTab) {
    var all = allOpenTabs
    all.removeAll { $0.id == tab.id }
    let index = all.firstIndex { $0.position > tab.position } ?? all.count
    all.insert(tab, at: index)
    allOpenTabs = all
  }

  private func persist(changedTabs: Bool) {
    try? context.save()
    if changedTabs { onLocalChange?() }
  }
}
