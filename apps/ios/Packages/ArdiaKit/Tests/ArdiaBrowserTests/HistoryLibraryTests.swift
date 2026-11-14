import ArdiaSync
import Foundation
import SwiftData
import Testing
@testable import ArdiaBrowser

@MainActor
@Suite struct HistoryLibraryTests {
  let fixture: StoreFixture
  let calendar = HistoryTimelineTests.calendar

  init() throws {
    fixture = try StoreFixture()
  }

  var context: ModelContext { fixture.container.mainContext }

  func visit(_ url: String, _ title: String = "", hoursFromNoon: Double, space: String? = nil) {
    context.insert(Visit(url: url, title: title, visitedAt: HistoryTimelineTests.at(hoursFromNoon), profileSyncId: space, transition: .typed))
    try? context.save()
  }

  func library(clock: Date = HistoryTimelineTests.noon) -> HistoryLibrary {
    HistoryLibrary(context: context, fingerprint: HistoryTimelineTests.fingerprint, calendar: calendar, now: { clock })
  }

  func storedText() throws -> String {
    let hidden = try context.fetch(FetchDescriptor<HiddenSyncedVisit>()).map { "\($0.fingerprint) \($0.lastVisit)" }
    let clearings = try context.fetch(FetchDescriptor<HistoryClearing>()).map { "\(String(describing: $0.start)) \($0.end)" }
    return (hidden + clearings).joined(separator: "\n")
  }

  @Test func loadsThisDevicesVisitsWithTheMacsHistory() async {
    defer { fixture.cleanUp() }
    visit("https://phone.example/", "Phone", hoursFromNoon: -1)
    let history = library()
    await history.reload(synced: [HistoryTimelineTests.synced("https://mac.example/", "Mac", -2)])
    #expect(history.isLoaded)
    #expect(history.entries.map(\.url) == ["https://phone.example/", "https://mac.example/"])
    #expect(history.entries.map(\.source) == [.thisDevice, .synced])
  }

  @Test func privateTabVisitsNeverReachTheList() async {
    defer { fixture.cleanUp() }
    let tab = fixture.store.open(.url(URL(string: "https://secret.example/")!), isPrivate: true)
    fixture.store.recordVisit(url: "https://secret.example/", title: "Secret", transition: .typed, fromTab: tab.id)
    fixture.store.recordVisit(url: "https://open.example/", title: "Open", transition: .typed)
    let history = library()
    await history.reload(synced: [])
    #expect(history.entries.map(\.url) == ["https://open.example/"])
  }

  @Test func thisDevicesVisitsFollowTheCurrentSpaceLikeItsTabs() async {
    defer { fixture.cleanUp() }
    visit("https://work.example/", hoursFromNoon: -1, space: "work")
    visit("https://home.example/", hoursFromNoon: -2, space: "personal")
    visit("https://loose.example/", hoursFromNoon: -3, space: nil)
    visit("https://gone.example/", hoursFromNoon: -4, space: "deleted-space")
    let roster = SpaceRoster(ids: ["personal", "work"], defaultId: "personal")
    let history = library()
    await history.reload(synced: [], spaces: HistorySpaceFilter(roster: roster, current: "work"))
    #expect(history.entries.map(\.url) == ["https://work.example/"])
    await history.reload(synced: [], spaces: HistorySpaceFilter(roster: roster, current: "personal"))
    #expect(history.entries.map(\.url) == ["https://home.example/", "https://loose.example/", "https://gone.example/"])
    await history.reload(synced: [], spaces: HistorySpaceFilter(roster: .unnamed, current: nil))
    #expect(history.entries.count == 4)
  }

  @Test func deletingARowRemovesThatPagesVisitsForThatDayInThatSpaceOnly() async throws {
    defer { fixture.cleanUp() }
    visit("https://a.example/", "A", hoursFromNoon: -1, space: "work")
    visit("https://a.example/", "A", hoursFromNoon: -2, space: "work")
    visit("https://a.example/", "A", hoursFromNoon: -1.5, space: "personal")
    visit("https://a.example/", "A", hoursFromNoon: -30, space: "work")
    visit("https://b.example/", "B", hoursFromNoon: -3, space: "work")
    let spaces = HistorySpaceFilter(roster: SpaceRoster(ids: ["personal", "work"], defaultId: "personal"), current: "work")
    let history = library()
    await history.reload(synced: [], spaces: spaces)
    let today = try #require(history.entries.first { $0.url == "https://a.example/" && $0.visitCount == 2 })
    try history.delete(today)
    #expect(history.entries.map(\.url) == ["https://b.example/", "https://a.example/"])
    await history.reload(synced: [], spaces: spaces)
    #expect(history.entries.map(\.url) == ["https://b.example/", "https://a.example/"])
    let left = try context.fetch(FetchDescriptor<Visit>()).filter { $0.url == "https://a.example/" }
    #expect(Set(left.map(\.visitedAt)) == [HistoryTimelineTests.at(-30), HistoryTimelineTests.at(-1.5)])
  }

  @Test func deletingAVisitTheMacNeverSawLeavesNothingBehind() async throws {
    defer { fixture.cleanUp() }
    visit("https://private-ish.example/", hoursFromNoon: -1)
    let history = library()
    await history.reload(synced: [HistoryTimelineTests.synced("https://other.example/", "", -2)])
    try history.delete(try #require(history.entries.first { $0.source == .thisDevice }))
    #expect(try context.fetchCount(FetchDescriptor<HiddenSyncedVisit>()) == 0)
    #expect(try context.fetchCount(FetchDescriptor<Visit>()) == 0)
  }

  @Test func deletingAVisitTheMacHoldsRemembersOnlyAKeyedHash() async throws {
    defer { fixture.cleanUp() }
    visit("https://a.example/secret", "A", hoursFromNoon: -1)
    let echo = HistoryTimelineTests.synced("https://a.example/secret", "A", -1)
    let history = library()
    await history.reload(synced: [echo])
    try history.delete(try #require(history.entries.first))
    let stored = try storedText()
    #expect(try context.fetchCount(FetchDescriptor<HiddenSyncedVisit>()) == 1)
    #expect(!stored.contains("a.example"))
    #expect(!stored.contains("secret"))
    await history.reload(synced: [echo])
    #expect(history.entries.isEmpty)
    await history.reload(synced: [HistoryTimelineTests.synced("https://a.example/secret", "A", 1)])
    #expect(history.entries.map(\.source) == [.synced])
  }

  @Test func syncedRowsAreReadOnly() async throws {
    defer { fixture.cleanUp() }
    let history = library()
    await history.reload(synced: [HistoryTimelineTests.synced("https://mac.example/", "Mac", -1)])
    let row = try #require(history.entries.first)
    #expect(throws: HistoryLibraryError.readOnly) { try history.delete(row) }
    #expect(history.entries.count == 1)
  }

  @Test func clearingARangeKeepsOlderVisitsAndHidesSyncedRowsFromThatRange() async throws {
    defer { fixture.cleanUp() }
    visit("https://recent.example/", hoursFromNoon: -0.5)
    visit("https://old.example/", hoursFromNoon: -5)
    let synced = [
      HistoryTimelineTests.synced("https://recent.example/", "", -0.5),
      HistoryTimelineTests.synced("https://mac-older.example/", "", -2),
    ]
    let history = library()
    try history.clear(since: HistoryTimelineTests.at(-1))
    await history.reload(synced: synced)
    #expect(history.entries.map(\.url) == ["https://mac-older.example/", "https://old.example/"])
    #expect(!(try storedText()).contains("example"))
  }

  @Test func clearingAllHistoryKeepsNoListOfAddresses() async throws {
    defer { fixture.cleanUp() }
    visit("https://a.example/one", hoursFromNoon: -1)
    visit("https://b.example/two", hoursFromNoon: -40)
    let history = library()
    await history.reload(synced: [HistoryTimelineTests.synced("https://a.example/one", "", -1)])
    try history.delete(try #require(history.entries.first { $0.source == .thisDevice }))
    try history.clear(since: nil)
    #expect(try context.fetchCount(FetchDescriptor<Visit>()) == 0)
    #expect(try context.fetchCount(FetchDescriptor<HiddenSyncedVisit>()) == 0)
    #expect(try context.fetchCount(FetchDescriptor<HistoryClearing>()) == 1)
    #expect(!(try storedText()).contains("example"))
    await history.reload(synced: [
      HistoryTimelineTests.synced("https://mac.example/old", "", -2),
      HistoryTimelineTests.synced("https://mac.example/new", "", 1),
    ])
    #expect(history.entries.map(\.url) == ["https://mac.example/new"])
  }

  @Test func clearBrowsingDataLeavesNoClearedAddressInTheStore() async throws {
    defer { fixture.cleanUp() }
    fixture.store.recordVisit(url: "https://cleared.example/page", title: "Cleared", transition: .typed)
    await BrowsingDataCleaner.clear([.history], tabs: fixture.store)
    #expect(try context.fetchCount(FetchDescriptor<Visit>()) == 0)
    #expect(try context.fetchCount(FetchDescriptor<HiddenSyncedVisit>()) == 0)
    #expect(!(try storedText()).contains("cleared.example"))
  }

  @Test func expiredHidingRecordsGoWithTheRestOfHistoryWithoutOpeningIt() throws {
    defer { fixture.cleanUp() }
    let launch = fixture.clock.now
    context.insert(HiddenSyncedVisit(fingerprint: "stale", lastVisit: launch.addingTimeInterval(-91 * 86_400)))
    context.insert(HiddenSyncedVisit(fingerprint: "fresh", lastVisit: launch.addingTimeInterval(-86_400)))
    context.insert(HistoryClearing(start: nil, end: launch.addingTimeInterval(-91 * 86_400)))
    context.insert(HistoryClearing(start: launch.addingTimeInterval(-7200), end: launch.addingTimeInterval(-3600)))
    try context.save()
    fixture.store.appBecameActive()
    fixture.store.appWillResignActive()
    #expect(try context.fetch(FetchDescriptor<HiddenSyncedVisit>()).map(\.fingerprint) == ["fresh"])
    #expect(try context.fetch(FetchDescriptor<HistoryClearing>()).map(\.end) == [launch.addingTimeInterval(-3600)])
  }
}
