import ArdiaBrowser
import ArdiaSync
import Foundation
import Observation

extension AppModel {
  var spaceRoster: SpaceRoster {
    sync.isEnabled ? SpaceRoster(snapshot: sync.snapshot) : .unnamed
  }

  var spaces: [SyncedProfile] {
    sync.isEnabled ? sync.snapshot.profiles : []
  }

  var currentSpace: SyncedProfile? {
    sync.isEnabled ? sync.selectedProfile : nil
  }

  var spaceTabs: [BrowserTab] {
    tabs.openTabs
  }

  func connectSpaces() {
    applySpaces()
    observeSpaces()
    SpacesDemo.apply(to: self)
  }

  var showsSpaceIcons: Bool {
    sync.snapshot.lookSettings?.profileSwitcherIcons == true || SpacesDemo.showsSpaceIcons
  }

  func selectSpace(_ syncId: String) {
    guard sync.isEnabled, spaces.contains(where: { $0.syncId == syncId }) else { return }
    let before = tabs.selectedTabID
    if isIncognito { isIncognito = false }
    if sync.selectedProfileId != syncId { sync.selectedProfileId = syncId }
    tabs.updateSpaces(roster: spaceRoster, current: syncId)
    tabs.showSpaceSelection()
    showSelection(changedFrom: before)
  }

  func stepSpace(_ delta: Int) {
    guard let target = spaceRoster.cycled(from: currentSpace?.syncId, by: delta) else { return }
    selectSpace(target)
  }

  func moveTab(_ id: UUID, toSpace syncId: String) {
    guard let space = spaces.first(where: { $0.syncId == syncId }), let tab = tabs.tab(id), !tab.isPrivate else { return }
    let before = tabs.selectedTabID
    deck.forget([id])
    browse.covers.forget(id)
    tabs.moveToSpace(id, space: syncId)
    showSelection(changedFrom: before)
    toasts.show(Toast(String(localized: "Moved to \(space.name)"), symbol: "arrow.right.square"))
  }

  func moveTab(_ id: UUID, toIndex index: Int) {
    tabs.move(id, to: index)
  }

  func spacesToMove(_ tab: BrowserTab) -> [SyncedProfile] {
    guard !tab.isPrivate else { return [] }
    let current = tabs.space(of: tab)
    return spaces.filter { $0.syncId != current }
  }

  func revealSpace(of id: UUID) {
    guard let tab = tabs.tab(id), !tab.isPrivate, !tabs.isInCurrentSpace(tab), let space = tabs.space(of: tab) else { return }
    selectSpace(space)
  }

  private func applySpaces() {
    let before = tabs.selectedTabID
    tabs.updateSpaces(roster: spaceRoster, current: sync.isEnabled ? sync.selectedProfile?.syncId : nil)
    showSelection(changedFrom: before)
  }

  private func observeSpaces() {
    withObservationTracking {
      _ = sync.isEnabled
      _ = sync.selectedProfileId
      _ = sync.snapshot.profiles.count
    } onChange: { [weak self] in
      Task { @MainActor in
        self?.applySpaces()
        self?.observeSpaces()
      }
    }
  }

  private func showSelection(changedFrom before: UUID?) {
    guard tabs.selectedTabID != before, surface == .browsing else { return }
    if let id = tabs.selectedTabID {
      _ = web.webTab(for: id)
    } else {
      surface = .search
    }
  }
}
