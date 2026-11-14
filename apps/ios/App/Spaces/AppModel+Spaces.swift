import ArdiaBrowser
import ArdiaSync
import Foundation

extension AppModel {
  var spaces: [SyncedProfile] {
    sync.isEnabled ? sync.snapshot.profiles : []
  }

  var currentSpace: SyncedProfile? {
    guard sync.isEnabled, !sync.snapshot.profiles.isEmpty else { return nil }
    return sync.selectedProfile
  }

  func applySpaces() {
    let profiles = sync.snapshot.profiles
    guard sync.isEnabled, !profiles.isEmpty else {
      tabs.spaces = .unsynced
      return
    }
    tabs.spaces = TabSpaces(
      current: sync.selectedProfile?.syncId,
      defaultID: sync.snapshot.defaultProfile?.syncId,
      known: Set(profiles.map(\.syncId))
    )
  }

  func switchSpace(to syncId: String) {
    guard sync.isEnabled, syncId != tabs.profileSyncId else { return }
    sync.selectedProfileId = syncId
    applySpaces()
  }

  func switchSpace(by step: Int) {
    let ids = spaces.map(\.syncId)
    guard ids.count > 1, let index = ids.firstIndex(of: currentSpace?.syncId ?? "") else { return }
    let target = index + step
    guard ids.indices.contains(target) else { return }
    switchSpace(to: ids[target])
  }

  func showSpace(of tabID: UUID) {
    guard tabs.spaces.isSplit, let space = tabs.space(of: tabID), space != tabs.profileSyncId else { return }
    switchSpace(to: space)
  }

  func openPinned(url: String, title: String) {
    openRemote(url: url, title: title, profileSyncId: currentSpace?.syncId)
  }

  func moveTab(_ id: UUID, toSpace syncId: String) {
    deck.forget([id])
    tabs.assign(id, toSpace: syncId)
  }
}
