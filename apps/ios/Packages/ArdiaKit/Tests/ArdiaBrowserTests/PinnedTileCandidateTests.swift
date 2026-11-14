import ArdiaSync
import Foundation
import Testing
@testable import ArdiaBrowser

struct PinnedTileCandidateTests {
  @Test func aTilesCustomIconIsNeverPassedAsAFaviconAddress() {
    let tiles = [
      PinnedTile(key: "home", title: "Home", url: "https://home.example/", icon: "symbol:house.fill", folder: nil),
      PinnedTile(key: "music", title: "Music", url: "https://music.example/", icon: "🎵", folder: nil),
      PinnedTile(key: "plain", title: "Plain", url: "https://plain.example/", icon: nil, folder: [
        PinnedTab(key: "child", title: "Child", url: "https://child.example/", icon: "symbol:star"),
      ]),
    ]
    let profile = SyncedProfile(syncId: "p", name: "Personal", color: nil, icon: nil, isDefault: true, theme: nil, deviceTabs: [], pinned: PinnedArea(tiles: tiles), bookmarks: [], history: [])
    let candidates = OmniboxCandidates.merge(openTabs: [], localHistory: [], snapshot: SyncSnapshot(profiles: [profile]), profileSyncId: nil)
    #expect(Set(candidates.bookmarks.map(\.url)) == ["https://home.example/", "https://music.example/", "https://plain.example/", "https://child.example/"])
    #expect(candidates.bookmarks.allSatisfy { $0.favicon == nil })
  }
}
