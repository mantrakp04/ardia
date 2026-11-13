import ArdiaSync
import CryptoKit
import Foundation
import Testing
@testable import ArdiaBrowser

@Suite struct HistoryTimelineTests {
  static let calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Lisbon")!
    return calendar
  }()

  static let noon = calendar.date(from: DateComponents(year: 2026, month: 11, day: 12, hour: 12))!

  static func at(_ hoursFromNoon: Double) -> Date {
    noon.addingTimeInterval(hoursFromNoon * 3600)
  }

  static func local(_ url: String, _ title: String = "", _ hoursFromNoon: Double) -> LocalVisitRow {
    LocalVisitRow(url: url, title: title, visitedAt: at(hoursFromNoon))
  }

  static func synced(_ url: String, _ title: String = "", _ hoursFromNoon: Double, visits: Int = 1) -> HistoryItem {
    HistoryItem(url: url, title: title, visits: visits, lastVisit: at(hoursFromNoon))
  }

  static let fingerprint = HistoryFingerprint(key: SymmetricKey(data: Data(repeating: 7, count: 32)))

  static func timeline(local: [LocalVisitRow] = [], synced: [HistoryItem] = [], hiding: HistoryHiding = .none) -> [HistoryEntry] {
    HistoryTimeline.entries(local: local, synced: synced, hiding: hiding, calendar: calendar)
  }

  static func hiding(windows: [HistoryClearingWindow] = [], deleted: [String: Date] = [:]) -> HistoryHiding {
    HistoryHiding(
      windows: windows,
      deleted: Dictionary(uniqueKeysWithValues: deleted.map { (fingerprint.of($0.key), $0.value) }),
      fingerprint: fingerprint
    )
  }

  @Test func localVisitsCollapseToOneRowPerPageEachDayNewestFirst() {
    let entries = Self.timeline(local: [
      Self.local("https://a.example/", "A old", -3),
      Self.local("https://a.example/", "A", -1),
      Self.local("https://b.example/", "B", -2),
      Self.local("https://a.example/", "A yesterday", -26),
    ])
    #expect(entries.map(\.url) == ["https://a.example/", "https://b.example/", "https://a.example/"])
    #expect(entries[0].visitCount == 2)
    #expect(entries[0].title == "A")
    #expect(entries[0].lastVisit == Self.at(-1))
    #expect(entries[2].title == "A yesterday")
    #expect(entries.allSatisfy { $0.source == .thisDevice })
  }

  @Test func daysGroupNewestFirstAtLocalMidnight() {
    let entries = Self.timeline(local: [
      Self.local("https://late.example/", "", 11.5),
      Self.local("https://early.example/", "", -11.5),
      Self.local("https://before.example/", "", -12.5),
    ])
    let days = HistoryTimeline.days(entries, calendar: Self.calendar)
    #expect(days.count == 2)
    #expect(days[0].day == Self.calendar.startOfDay(for: Self.noon))
    #expect(days[0].entries.map(\.url) == ["https://late.example/", "https://early.example/"])
    #expect(days[1].entries.map(\.url) == ["https://before.example/"])
  }

  @Test func syncedHistoryIsMarkedAndMergedByTime() {
    let entries = Self.timeline(
      local: [Self.local("https://phone.example/", "Phone", -1)],
      synced: [Self.synced("https://mac.example/", "Mac", -0.5, visits: 14)]
    )
    #expect(entries.map(\.source) == [.synced, .thisDevice])
    #expect(entries[0].title == "Mac")
  }

  @Test func syncedCopyOfThisDevicesOwnVisitIsShownOnceAsLocal() {
    let entries = Self.timeline(
      local: [Self.local("https://a.example/", "A", -1)],
      synced: [HistoryItem(url: "https://a.example/", title: "A", visits: 1, lastVisit: Self.at(-1).addingTimeInterval(0.0004))]
    )
    #expect(entries.count == 1)
    #expect(entries[0].source == .thisDevice)
  }

  @Test func macVisitToAPageThisDeviceAlsoVisitedShowsBoth() {
    let entries = Self.timeline(
      local: [Self.local("https://a.example/", "A", -3)],
      synced: [Self.synced("https://a.example/", "A", -1)]
    )
    #expect(entries.map(\.source) == [.synced, .thisDevice])
  }

  @Test func deletedLocalVisitsHideTheirSyncedCopyButNotLaterMacVisits() {
    let deleted = ["https://gone.example/": Self.at(-2), "https://again.example/": Self.at(-5)]
    let entries = Self.timeline(
      synced: [
        Self.synced("https://gone.example/", "Gone", -2),
        Self.synced("https://again.example/", "Again", -1),
        Self.synced("https://other.example/", "Other", -4),
      ],
      hiding: Self.hiding(deleted: deleted)
    )
    #expect(entries.map(\.url) == ["https://again.example/", "https://other.example/"])
  }

  @Test func titleFallsBackToNewestNonEmptyTitleOfTheDay() {
    let entries = Self.timeline(local: [
      Self.local("https://a.example/", "", -1),
      Self.local("https://a.example/", "Named", -2),
    ])
    #expect(entries[0].title == "Named")
  }

  @Test(arguments: [
    ("lisbon", ["https://en.wikipedia.org/wiki/Lisbon"]),
    ("LISBOA", ["https://visitlisboa.com/"]),
    ("swift.org", ["https://www.swift.org/blog/"]),
    ("  ", ["https://www.swift.org/blog/", "https://visitlisboa.com/", "https://en.wikipedia.org/wiki/Lisbon"]),
    ("pasteis", ["https://nata.example/"]),
  ])
  func searchMatchesTitleOrAddressIgnoringCaseAndAccents(query: String, expected: [String]) {
    let entries = Self.timeline(
      local: [
        Self.local("https://www.swift.org/blog/", "Blog | Swift.org", -1),
        Self.local("https://visitlisboa.com/", "Visit Lisboa", -2),
        Self.local("https://nata.example/", "Pastéis de nata", -30),
      ],
      synced: [Self.synced("https://en.wikipedia.org/wiki/Lisbon", "Lisbon - Wikipedia", -3)]
    )
    let found = HistoryTimeline.filter(entries, query: query).map(\.url)
    if query.trimmingCharacters(in: .whitespaces).isEmpty {
      #expect(found.count == 4)
    } else {
      #expect(found == expected)
    }
  }

  @Test func scopeKeepsOnlyTheChosenSource() {
    let entries = Self.timeline(
      local: [Self.local("https://phone.example/", "", -1)],
      synced: [Self.synced("https://mac.example/", "", -2)]
    )
    #expect(HistoryTimeline.filter(entries, query: "", scope: .thisDevice).map(\.url) == ["https://phone.example/"])
    #expect(HistoryTimeline.filter(entries, query: "", scope: .synced).map(\.url) == ["https://mac.example/"])
    #expect(HistoryTimeline.filter(entries, query: "", scope: .all).count == 2)
  }

  @Test func entryIdentitiesStayUniqueAcrossSourcesAndDays() {
    let entries = Self.timeline(
      local: [Self.local("https://a.example/", "", -1), Self.local("https://a.example/", "", -30)],
      synced: [Self.synced("https://a.example/", "", -0.5)]
    )
    #expect(Set(entries.map(\.id)).count == 3)
  }

  @Test func clearingAllHistoryHidesEverySyncedRowFromBeforeTheClear() {
    let entries = Self.timeline(
      synced: [
        Self.synced("https://before.example/", "", -30),
        Self.synced("https://just-before.example/", "", -0.01),
        Self.synced("https://after.example/", "", 1),
      ],
      hiding: Self.hiding(windows: [HistoryClearingWindow(start: nil, end: Self.noon)])
    )
    #expect(entries.map(\.url) == ["https://after.example/"])
  }

  @Test func clearingARangeHidesOnlySyncedRowsInsideIt() {
    let entries = Self.timeline(
      synced: [
        Self.synced("https://older.example/", "", -3),
        Self.synced("https://inside.example/", "", -0.5),
        Self.synced("https://later.example/", "", 2),
      ],
      hiding: Self.hiding(windows: [HistoryClearingWindow(start: Self.at(-1), end: Self.noon)])
    )
    #expect(entries.map(\.url) == ["https://later.example/", "https://older.example/"])
  }

  @Test func deletedPagesAreRememberedByAKeyedHashNotTheirAddress() {
    let print = Self.fingerprint.of("https://secret.example/page")
    #expect(!print.contains("secret"))
    #expect(print == Self.fingerprint.of("https://secret.example/page"))
    #expect(print != HistoryFingerprint(key: SymmetricKey(data: Data(repeating: 8, count: 32))).of("https://secret.example/page"))
  }
}
