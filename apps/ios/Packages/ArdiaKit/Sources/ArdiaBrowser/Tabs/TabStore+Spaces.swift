import ArdiaSync
import Foundation

extension TabStore {
  public var currentSpace: String? { spaceRoster.space(of: profileSyncId) }

  public func space(of tab: BrowserTab) -> String? {
    tab.isPrivate ? nil : spaceRoster.space(of: tab.profileSyncId)
  }

  public func isInCurrentSpace(_ tab: BrowserTab) -> Bool {
    !tab.isPrivate && spaceRoster.space(of: tab.profileSyncId) == currentSpace
  }

  public func updateSpaces(roster: SpaceRoster, current: String?) {
    let rosterChanged = roster != spaceRoster
    if rosterChanged { spaceRoster = roster }
    if current != profileSyncId {
      profileSyncId = current
    } else if rosterChanged {
      spaceDidChange()
    }
  }

  public func showSpaceSelection() {
    let target = rememberedSelection()
    guard target != selectedTabID else { return }
    select(target)
  }

  public func moveToSpace(_ id: UUID, space: String) {
    guard let tab = allOpenTabs.first(where: { $0.id == id }), !tab.isPrivate, tab.profileSyncId != space else { return }
    let leavesCurrent = isInCurrentSpace(tab)
    let neighbour = leavesCurrent && selectedTabID == id ? neighbourInSpace(of: id) : nil
    tab.profileSyncId = space
    tab.position = endPosition()
    openers[id] = nil
    allOpenTabs.sort { $0.position < $1.position }
    if leavesCurrent, selectedTabID == id {
      selectedTabID = neighbour
      selectedTab?.lastActive = now()
    }
    if let key = selectionBySpace.first(where: { $0.value == id })?.key, key != Self.selectionKey(space) {
      selectionBySpace[key] = nil
    }
    saveSelection()
    refreshArchiveIfLoaded()
    listingRevision &+= 1
    persist(changedTabs: true)
  }

  func spaceDidChange() {
    refreshSpaceTabs()
    if let selected = selectedTab, selected.isPrivate || isInCurrentSpace(selected) {
      refreshArchiveIfLoaded()
      return
    }
    let target = rememberedSelection()
    if target != selectedTabID { select(target) }
    refreshArchiveIfLoaded()
  }

  func refreshSpaceTabs() {
    let roster = spaceRoster
    let current = roster.space(of: profileSyncId)
    let filtered = roster.isUnnamed ? allOpenTabs : allOpenTabs.filter { roster.space(of: $0.profileSyncId) == current }
    if filtered.map(\.id) != openTabs.map(\.id) { openTabs = filtered }
    let reopenable = undoStack.contains { group in group.contains { roster.space(of: $0.profileSyncId) == current } }
    if reopenable != canReopenClosed { canReopenClosed = reopenable }
  }

  func rememberedSelection() -> UUID? {
    if let id = selectionBySpace[Self.selectionKey(currentSpace)], openTabs.contains(where: { $0.id == id }) { return id }
    return openTabs.max(by: { $0.lastActive < $1.lastActive })?.id
  }

  func remember(_ tab: BrowserTab) {
    let key = Self.selectionKey(spaceRoster.space(of: tab.profileSyncId))
    guard selectionBySpace[key] != tab.id else { return }
    selectionBySpace[key] = tab.id
    saveSelection()
  }

  func neighbourInSpace(of id: UUID) -> UUID? {
    guard let index = openTabs.firstIndex(where: { $0.id == id }) else { return nil }
    let remaining = openTabs.filter { $0.id != id }
    guard !remaining.isEmpty else { return nil }
    return remaining[min(index, remaining.count - 1)].id
  }

  static func selectionKey(_ space: String?) -> String { space ?? "" }

  static func loadSelection(from defaults: UserDefaults) -> [String: UUID] {
    let stored = defaults.dictionary(forKey: selectionDefaultsKey) as? [String: String] ?? [:]
    return stored.compactMapValues(UUID.init(uuidString:))
  }

  func saveSelection() {
    defaults.set(selectionBySpace.mapValues(\.uuidString), forKey: Self.selectionDefaultsKey)
  }
}
