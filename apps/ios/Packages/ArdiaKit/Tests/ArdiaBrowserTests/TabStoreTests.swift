import ArdiaSync
import Foundation
import SwiftData
import Testing
@testable import ArdiaBrowser

@MainActor
final class Clock {
  var now: Date
  init(_ now: Date) { self.now = now }
  func advance(_ seconds: TimeInterval) { now = now.addingTimeInterval(seconds) }
}

@MainActor
struct StoreFixture {
  let container: ModelContainer
  let store: TabStore
  let clock: Clock
  let defaults: UserDefaults
  let suite: String

  init() throws {
    container = try BrowserStore.makeContainer(.inMemory)
    clock = Clock(Date(timeIntervalSinceReferenceDate: 800_000_000))
    suite = "ardia.tests.\(UUID().uuidString)"
    defaults = UserDefaults(suiteName: suite)!
    let clock = clock
    store = TabStore(context: container.mainContext, defaults: defaults, now: { clock.now })
  }

  func cleanUp() {
    defaults.removePersistentDomain(forName: suite)
  }

  @discardableResult
  func open(_ string: String) -> BrowserTab {
    store.open(.url(URL(string: string)!))
  }
}

@MainActor
@Suite struct TabStoreTests {
  @Test(arguments: [
    (TimeInterval(24 * 3600 - 1), false),
    (TimeInterval(24 * 3600), true),
    (TimeInterval(24 * 3600 + 1), true),
    (TimeInterval(-3600), false),
  ])
  func autoArchiveAtTheEdges(elapsed: TimeInterval, archived: Bool) throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let idle = fixture.open("https://example.com/idle")
    let viewed = fixture.open("https://example.com/viewed")
    fixture.clock.advance(elapsed)
    fixture.store.runAutoArchive()
    #expect(idle.isArchived == archived)
    #expect(!viewed.isArchived)
    #expect(fixture.store.selectedTabID == viewed.id)
  }

  @Test func clockMovingBackwardsNeverArchivesAndTheIntervalStillCountsFromTheLastUse() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let tab = fixture.open("https://example.com/a")
    fixture.open("https://example.com/b")
    fixture.clock.advance(-7 * 24 * 3600)
    #expect(fixture.store.runAutoArchive() == 0)
    fixture.clock.advance(8 * 24 * 3600)
    #expect(fixture.store.runAutoArchive() == 1)
    #expect(tab.isArchived)
  }

  @Test func archivingWaitsForTheGridGestureToEnd() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let idle = fixture.open("https://example.com/a")
    fixture.open("https://example.com/b")
    fixture.clock.advance(2 * 24 * 3600)
    fixture.store.isGridInteractionActive = true
    #expect(fixture.store.runAutoArchive() == 0)
    #expect(!idle.isArchived)
    fixture.store.isGridInteractionActive = false
    #expect(idle.isArchived)
  }

  @Test func neverKeepsEveryTabOpen() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    fixture.store.autoArchiveInterval = .never
    let tab = fixture.open("https://example.com/a")
    fixture.open("https://example.com/b")
    fixture.clock.advance(365 * 24 * 3600)
    #expect(fixture.store.runAutoArchive() == 0)
    #expect(!tab.isArchived)
  }

  @Test func reopenUndoesCloseArchiveAndCloseAllInOrder() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let a = fixture.open("https://a.example/")
    let b = fixture.open("https://b.example/")
    let c = fixture.open("https://c.example/")
    fixture.store.close(b.id)
    #expect(fixture.store.selectedTabID == c.id)
    fixture.store.archive(c.id)
    #expect(fixture.store.selectedTabID == a.id)
    fixture.store.closeAll()
    #expect(fixture.store.openTabs.isEmpty)
    #expect(fixture.store.selectedTabID == nil)

    #expect(fixture.store.reopenLastClosed().map(\.id) == [a.id])
    #expect(fixture.store.reopenLastClosed().map(\.id) == [c.id])
    #expect(fixture.store.reopenLastClosed().map(\.id) == [b.id])
    #expect(fixture.store.openTabs.map(\.id) == [a.id, b.id, c.id])
    #expect(fixture.store.selectedTabID == b.id)
    #expect(!fixture.store.canReopenClosed)
    #expect(fixture.store.reopenLastClosed().isEmpty)
  }

  @Test func undoKeepsOnlyTheLastTwentyAndSkipsDeletedTabs() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let tabs = (0..<22).map { fixture.open("https://example.com/\($0)") }
    for tab in tabs { fixture.store.close(tab.id) }
    fixture.store.delete([tabs[21].id])
    var reopened: [UUID] = []
    while fixture.store.canReopenClosed { reopened += fixture.store.reopenLastClosed().map(\.id) }
    #expect(reopened == tabs[2..<21].reversed().map(\.id))
  }

  @Test func archiveGroupsByDayNewestFirst() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    fixture.store.loadArchive()
    let first = fixture.open("https://one.example/")
    fixture.store.close(first.id)
    fixture.clock.advance(2 * 24 * 3600)
    let second = fixture.open("https://two.example/")
    fixture.store.close(second.id)
    #expect(fixture.store.archive.map { $0.tabs.map(\.id) } == [[second.id], [first.id]])
    fixture.store.restore(first.id)
    #expect(fixture.store.archive.map { $0.tabs.map(\.id) } == [[second.id]])
    #expect(fixture.store.selectedTabID == first.id)
  }

  @Test func movingKeepsOrderAcrossARelaunch() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let tabs = (0..<4).map { fixture.open("https://example.com/\($0)") }
    for _ in 0..<60 { fixture.store.move(tabs[3].id, to: 1); fixture.store.move(tabs[1].id, to: 1) }
    let order = fixture.store.openTabs.map(\.id)
    let relaunched = TabStore(context: fixture.container.mainContext, defaults: fixture.defaults)
    #expect(relaunched.openTabs.map(\.id) == order)
  }

  @Test func syncSeesRecentWebTabsAndGroupedVisits() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let start = fixture.clock.now
    fixture.open("https://old.example/")
    fixture.clock.advance(10)
    fixture.store.open(.browseForMe(query: "best tents", resultID: UUID()))
    fixture.store.recordVisit(url: "https://a.example/", title: "", transition: .typed)
    fixture.clock.advance(10)
    let visit = try #require(fixture.store.recordVisit(url: "https://a.example/", title: "A", transition: .link))
    fixture.store.amend(visit, title: "A page")
    fixture.store.recordVisit(url: "ardia://browse/x", title: "", transition: .link)
    fixture.clock.advance(10)
    fixture.store.recordVisit(url: "https://b.example/", title: "B", transition: .link)

    #expect(fixture.store.syncedTabs().map(\.url) == ["https://old.example/"])
    let visits = fixture.store.syncedVisits(since: start)
    #expect(visits.map(\.url) == ["https://a.example/", "https://b.example/"])
    #expect(visits.first?.visitedAt.count == 2)
    #expect(visits.first?.title == "A page")

    fixture.store.removeVisits(urls: ["https://a.example/"], profileSyncId: nil)
    #expect(fixture.store.syncedVisits(since: start).map(\.url) == ["https://b.example/"])
  }

  @Test func receivedTabsOpenOnceInTheBackground() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let current = fixture.open("https://here.example/")
    let sent = ReceivedTab(key: "send:1", url: "https://there.example/", title: "There", fromDevice: "Mac", sentAt: fixture.clock.now, profileSyncId: "p")
    let unsafe = ReceivedTab(key: "send:2", url: "javascript:alert(1)", title: "", fromDevice: "Mac", sentAt: fixture.clock.now, profileSyncId: "p")
    fixture.store.receive([sent, unsafe])
    fixture.store.receive([sent])
    #expect(fixture.store.openTabs.map(\.url) == ["https://here.example/", "https://there.example/"])
    #expect(fixture.store.selectedTabID == current.id)
    #expect(fixture.store.lastReceived.map(\.origin) == [.sent])
  }

  @Test func searchesUseTheEngineTemplateWithURIComponentEncoding() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    fixture.store.searchTemplate = "https://duckduckgo.com/?q=%s"
    let tab = fixture.store.open(.search("  c++ & rust's \"best\" ? "))
    #expect(tab.url == "https://duckduckgo.com/?q=c%2B%2B%20%26%20rust's%20%22best%22%20%3F")
  }

  @Test func privateTabsNeverReachTheStoreHistorySyncOrUndo() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let start = fixture.clock.now
    let normal = fixture.open("https://normal.example/")
    let secret = fixture.store.open(.url(URL(string: "https://secret.example/")!), isPrivate: true)
    let child = fixture.store.open(.url(URL(string: "https://secret.example/next")!, origin: .link), placement: .after(secret.id))
    #expect(child.isPrivate)
    #expect(fixture.store.recordVisit(url: "https://secret.example/", title: "Secret", transition: .typed, fromTab: secret.id) == nil)
    fixture.store.update(secret.id, title: "Secret")
    #expect(fixture.store.syncedTabs().map(\.url) == ["https://normal.example/"])
    #expect(fixture.store.syncedVisits(since: start).isEmpty)
    #expect(try fixture.container.mainContext.fetchCount(FetchDescriptor<BrowserTab>()) == 1)

    var closed: [(Int, Bool)] = []
    fixture.store.onPrivateTabsClosed = { ids, noneLeft in closed.append((ids.count, noneLeft)) }
    fixture.store.close(child.id)
    #expect(fixture.store.selectedTabID == secret.id)
    fixture.store.closeAllPrivate()
    #expect(closed.map(\.0) == [1, 1] && closed.map(\.1) == [false, true])
    #expect(fixture.store.selectedTabID == normal.id)
    #expect(!fixture.store.canReopenClosed)
    let relaunched = TabStore(context: fixture.container.mainContext, defaults: fixture.defaults)
    #expect(relaunched.openTabs.map(\.id) == [normal.id])
    #expect(relaunched.privateTabs.isEmpty)
  }

  @Test func removingVisitsTouchesOnlyTheGivenProfile() throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let start = fixture.clock.now
    let url = "https://shared.example/"
    for profile in ["work", "home", nil] as [String?] {
      fixture.store.profileSyncId = profile
      fixture.store.recordVisit(url: url, title: "", transition: .link)
    }
    let profiles = { Set(fixture.store.syncedVisits(since: start).map { $0.profileSyncId ?? "none" }) }
    fixture.store.removeVisits(urls: [url], profileSyncId: "work")
    #expect(profiles() == ["home", "none"])
    fixture.store.removeVisits(urls: [url], profileSyncId: nil)
    #expect(profiles() == ["home"])
  }
}
