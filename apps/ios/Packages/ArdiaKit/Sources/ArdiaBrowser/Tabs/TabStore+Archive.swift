import ArdiaSync
import Foundation
import SwiftData

extension TabStore {
  public var hasArchivedTabs: Bool {
    if spaceRoster.isUnnamed {
      let descriptor = FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.archivedAt != nil })
      return ((try? context.fetchCount(descriptor)) ?? 0) > 0
    }
    return !archivedInSpace(limit: Self.archiveLimit).isEmpty
  }

  public func archive(_ id: UUID) {
    archiveTabs([id], undoable: true)
  }

  public func closeAll() {
    archiveTabs(openTabs.map(\.id), undoable: true)
  }

  @discardableResult
  public func reopenLastClosed() -> [BrowserTab] {
    let current = currentSpace
    guard let groupIndex = undoStack.lastIndex(where: { group in group.contains { spaceRoster.space(of: $0.profileSyncId) == current } }) else { return [] }
    let group = undoStack.remove(at: groupIndex)
    var reopened: [BrowserTab] = []
    var selection: UUID?
    for closed in group {
      guard let tab = tab(closed.id), tab.isArchived else { continue }
      tab.archivedAt = nil
      tab.lastActive = now()
      tab.position = allOpenTabs.contains(where: { $0.position == closed.position }) ? endPosition() : closed.position
      insertSorted(tab)
      reopened.append(tab)
      if closed.wasSelected { selection = tab.id }
    }
    refreshSpaceTabs()
    if let target = selection ?? reopened.last?.id { select(target) }
    refreshArchiveIfLoaded()
    listingRevision &+= 1
    persist(changedTabs: true)
    return reopened
  }

  public func restore(_ id: UUID) {
    guard let tab = tab(id), tab.isArchived else { return }
    tab.archivedAt = nil
    tab.position = endPosition()
    tab.lastActive = now()
    insertSorted(tab)
    select(id)
    refreshArchiveIfLoaded()
    listingRevision &+= 1
    persist(changedTabs: true)
  }

  public func delete(_ ids: Set<UUID>) {
    let tabs = ids.compactMap(tab)
    guard !tabs.isEmpty else { return }
    let selectionGone = selectedTabID.map(ids.contains) ?? false
    allOpenTabs.removeAll { ids.contains($0.id) }
    undoStack = undoStack.map { $0.filter { !ids.contains($0.id) } }.filter { !$0.isEmpty }
    refreshSpaceTabs()
    if selectionGone { selectedTabID = openTabs.max(by: { $0.lastActive < $1.lastActive })?.id }
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

  public func clearSpaceArchive() {
    delete(Set(archivedInSpace(limit: nil).map(\.id)))
  }

  public func loadArchive() {
    archiveLoaded = true
    refreshArchive()
  }

  public func searchArchive(_ text: String, inAllSpaces: Bool = false) -> [BrowserTab] {
    let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else {
      return inAllSpaces ? ((try? context.fetch(Self.archivedNewestFirst(limit: Self.archiveLimit))) ?? []) : archive.flatMap(\.tabs)
    }
    var descriptor = FetchDescriptor<BrowserTab>(
      predicate: #Predicate { $0.archivedAt != nil && ($0.title.localizedStandardContains(query) || $0.url.localizedStandardContains(query)) },
      sortBy: [SortDescriptor(\.archivedAt, order: .reverse)]
    )
    descriptor.fetchLimit = inAllSpaces || spaceRoster.isUnnamed ? 200 : Self.archiveLimit
    let found = (try? context.fetch(descriptor)) ?? []
    return inAllSpaces ? found : Array(found.filter(inCurrentSpace).prefix(200))
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

  func archiveTabs(_ ids: [UUID], undoable: Bool) {
    let date = now()
    let set = Set(ids)
    let tabs = allOpenTabs.filter { set.contains($0.id) }
    guard !tabs.isEmpty else { return }
    if undoable {
      undoStack.append(tabs.map { ClosedTab(id: $0.id, position: $0.position, wasSelected: $0.id == selectedTabID, profileSyncId: $0.profileSyncId) })
      if undoStack.count > Self.undoLimit { undoStack.removeFirst(undoStack.count - Self.undoLimit) }
    }
    let selectedIndex = selectedTabID.flatMap { id in openTabs.firstIndex { $0.id == id } }
    for tab in tabs { tab.archivedAt = date }
    allOpenTabs.removeAll { set.contains($0.id) }
    if let selectedTabID, set.contains(selectedTabID) {
      let neighbour = selectedIndex.map { min($0, openTabs.count - 1) } ?? -1
      self.selectedTabID = neighbour >= 0 ? openTabs[neighbour].id : nil
      selectedTab?.lastActive = date
    }
    refreshSpaceTabs()
    onTabsArchived?(tabs.map(\.id))
    refreshArchiveIfLoaded()
    listingRevision &+= 1
    persist(changedTabs: true)
  }

  func pruneExpired() {
    let date = now()
    let historyCutoff = date.addingTimeInterval(-Self.historyRetention)
    try? context.delete(model: Visit.self, where: #Predicate { $0.visitedAt < historyCutoff })
    HistoryEraser.forgetExpired(before: historyCutoff, in: context)
    let archiveCutoff = date.addingTimeInterval(-Self.archiveRetention)
    var expired = (try? context.fetch(FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.archivedAt != nil && $0.archivedAt! < archiveCutoff }))) ?? []
    var overflow = Self.archivedNewestFirst(limit: nil)
    overflow.fetchOffset = Self.archiveLimit
    expired += (try? context.fetch(overflow)) ?? []
    if !expired.isEmpty {
      delete(Set(expired.map(\.id)))
    } else {
      try? context.save()
    }
  }

  func refreshArchiveIfLoaded() {
    if archiveLoaded { refreshArchive() }
  }

  private func refreshArchive() {
    let tabs = archivedInSpace(limit: Self.archiveLimit)
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

  private func archivedInSpace(limit: Int?) -> [BrowserTab] {
    let tabs = (try? context.fetch(Self.archivedNewestFirst(limit: limit))) ?? []
    return spaceRoster.isUnnamed ? tabs : tabs.filter(inCurrentSpace)
  }

  private func inCurrentSpace(_ tab: BrowserTab) -> Bool {
    spaceRoster.space(of: tab.profileSyncId) == currentSpace
  }

  private static func archivedNewestFirst(limit: Int?) -> FetchDescriptor<BrowserTab> {
    var descriptor = FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.archivedAt != nil }, sortBy: [SortDescriptor(\.archivedAt, order: .reverse)])
    descriptor.fetchLimit = limit
    return descriptor
  }
}
