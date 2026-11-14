import Foundation
import SwiftData
import Testing
@testable import ArdiaBrowser

@MainActor
@Suite struct TabSpacesTests {
  static let known: Set<String> = ["personal", "work"]

  static func spaces(_ current: String?) -> TabSpaces {
    TabSpaces(current: current, defaultID: "personal", known: known)
  }

  @Test func aTabWithNoSpaceOrAGoneSpaceBelongsToTheDefault() {
    let spaces = Self.spaces("work")
    #expect(spaces.space(of: nil) == "personal")
    #expect(spaces.space(of: "deleted-on-the-mac") == "personal")
    #expect(spaces.space(of: "work") == "work")
    #expect(spaces.contains("work"))
    #expect(!spaces.contains(nil))
    #expect(Self.spaces("personal").contains(nil))
  }

  @Test func withoutSyncEveryTabIsInTheOneSpace() {
    #expect(TabSpaces.unsynced.contains(nil))
    #expect(TabSpaces.unsynced.contains("work"))
    #expect(!TabSpaces.unsynced.isSplit)
    let waitingForProfiles = TabSpaces(current: "work", defaultID: nil, known: [])
    #expect(waitingForProfiles.contains(nil))
    #expect(!waitingForProfiles.isSplit)
  }

  @Test func theStoreListsOnlyTheCurrentSpace() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let store = fixture.store
    let before = fixture.open("https://before-sync.example/")
    store.spaces = Self.spaces("personal")
    let personal = fixture.open("https://personal.example/")
    store.spaces = Self.spaces("work")
    let work = fixture.open("https://work.example/")
    #expect(work.profileSyncId == "work")
    #expect(store.openTabs.map(\.id) == [work.id])
    #expect(store.allOpenTabs.count == 3)
    store.spaces = Self.spaces("personal")
    #expect(store.openTabs.map(\.id) == [before.id, personal.id])
    #expect(store.openTabs(inSpace: "work").map(\.id) == [work.id])
    store.spaces = .unsynced
    #expect(store.openTabs.map(\.id) == [before.id, personal.id, work.id])
    #expect(store.space(of: work.id) == nil)
  }

  @Test func switchingSpacesSelectsThatSpacesLastTab() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let store = fixture.store
    store.spaces = Self.spaces("personal")
    let older = fixture.open("https://personal.example/older")
    fixture.clock.advance(60)
    let newer = fixture.open("https://personal.example/newer")
    fixture.clock.advance(60)
    store.select(newer.id)
    store.spaces = Self.spaces("work")
    #expect(store.selectedTabID == nil)
    let work = fixture.open("https://work.example/")
    #expect(store.selectedTabID == work.id)
    store.spaces = Self.spaces("personal")
    #expect(store.selectedTabID == newer.id)
    #expect(store.selectedTab?.id == newer.id)
    store.select(older.id)
    let secret = store.open(.url(URL(string: "https://secret.example/")!), isPrivate: true)
    store.spaces = Self.spaces("work")
    #expect(store.selectedTabID == secret.id)
  }

  @Test func closingAllClosesOnlyThisSpaceButArchivingWatchesEverySpace() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let store = fixture.store
    store.spaces = Self.spaces("work")
    let idle = fixture.open("https://work.example/idle")
    store.spaces = Self.spaces("personal")
    let first = fixture.open("https://personal.example/1")
    let second = fixture.open("https://personal.example/2")
    store.closeAll()
    #expect(first.isArchived && second.isArchived)
    #expect(!idle.isArchived)
    #expect(store.openTabs.isEmpty)
    store.reopenLastClosed()
    #expect(store.openTabs.count == 2)
    fixture.clock.advance(2 * 24 * 3600)
    store.runAutoArchive()
    #expect(idle.isArchived)
  }

  @Test func movingInsideASpaceLeavesTheOtherSpaceInOrder() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let store = fixture.store
    store.spaces = Self.spaces("personal")
    let a = fixture.open("https://personal.example/a")
    store.spaces = Self.spaces("work")
    let x = fixture.open("https://work.example/x")
    store.spaces = Self.spaces("personal")
    let b = fixture.open("https://personal.example/b")
    store.spaces = Self.spaces("work")
    let y = fixture.open("https://work.example/y")
    store.spaces = Self.spaces("personal")
    let c = fixture.open("https://personal.example/c")
    store.move(c.id, to: 0)
    #expect(store.openTabs.map(\.id) == [c.id, a.id, b.id])
    store.move(c.id, to: 2)
    #expect(store.openTabs.map(\.id) == [a.id, b.id, c.id])
    store.spaces = Self.spaces("work")
    #expect(store.openTabs.map(\.id) == [x.id, y.id])
  }

  @Test func aTabCanMoveToAnotherSpace() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let store = fixture.store
    store.spaces = Self.spaces("personal")
    let stays = fixture.open("https://personal.example/stays")
    fixture.clock.advance(60)
    let moves = fixture.open("https://personal.example/moves")
    store.assign(moves.id, toSpace: "work")
    #expect(store.openTabs.map(\.id) == [stays.id])
    #expect(store.selectedTabID == stays.id)
    #expect(store.space(of: moves.id) == "work")
    #expect(store.syncedTabs().first { $0.url == moves.url }?.profileSyncId == "work")
  }

  @Test func reopeningAStoreKeepsEachTabInItsSpace() throws {
    let directory = URL.temporaryDirectory.appending(path: "ardia-spaces-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    let suite = "ardia.tests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    do {
      let container = try BrowserStore.makeContainer(.directory(directory))
      let store = TabStore(context: container.mainContext, defaults: defaults)
      store.open(.url(URL(string: "https://unsynced.example/")!))
      store.spaces = Self.spaces("work")
      store.open(.url(URL(string: "https://work.example/")!))
    }
    let container = try BrowserStore.makeContainer(.directory(directory))
    let store = TabStore(context: container.mainContext, defaults: defaults)
    #expect(store.openTabs.count == 2)
    store.spaces = Self.spaces("personal")
    #expect(store.openTabs.map(\.url) == ["https://unsynced.example/"])
    store.spaces = Self.spaces("work")
    #expect(store.openTabs.map(\.url) == ["https://work.example/"])
  }

  @Test func historyFollowsTheSameSpaceRulesAsTabs() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let store = fixture.store
    store.recordVisit(url: "https://before-sync.example/", title: "", transition: .typed)
    store.spaces = TabSpaces(current: "gone", defaultID: "personal", known: Self.known.union(["gone"]))
    fixture.clock.advance(60)
    store.recordVisit(url: "https://gone.example/", title: "", transition: .typed)
    store.spaces = Self.spaces("work")
    fixture.clock.advance(60)
    store.recordVisit(url: "https://work.example/", title: "", transition: .typed)
    #expect(store.visitsInCurrentSpace(limit: 10).map(\.url) == ["https://work.example/"])
    store.spaces = Self.spaces("personal")
    #expect(store.visitsInCurrentSpace(limit: 10).map(\.url) == ["https://gone.example/", "https://before-sync.example/"])
    store.spaces = .unsynced
    #expect(store.visitsInCurrentSpace(limit: 10).count == 3)
    #expect(store.visitsInCurrentSpace(limit: 2).count == 2)
    store.spaces = Self.spaces("personal")
    store.removeVisitsInCurrentSpace(urls: ["https://gone.example/", "https://work.example/"])
    #expect(store.visitsInCurrentSpace(limit: 10).map(\.url) == ["https://before-sync.example/"])
    store.spaces = Self.spaces("work")
    #expect(store.visitsInCurrentSpace(limit: 10).map(\.url) == ["https://work.example/"])
  }
}
