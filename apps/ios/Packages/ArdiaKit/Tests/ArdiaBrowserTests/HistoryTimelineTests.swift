import Foundation
import Testing
@testable import ArdiaBrowser

@Suite struct HistoryTimelineTests {
  let now = Date(timeIntervalSince1970: 1_800_000_000)

  func visit(_ url: String, _ title: String = "", minutesAgo: Double) -> HistoryVisitInput {
    HistoryVisitInput(url: url, title: title, visitedAt: now.addingTimeInterval(-minutesAgo * 60))
  }

  @Test func oneRowPerPageAtItsLatestVisit() {
    let entries = HistoryTimeline.entries(
      local: [visit("https://a.example/", "A", minutesAgo: 30), visit("https://a.example/", "A again", minutesAgo: 5)],
      synced: [],
      hidden: [:]
    )
    #expect(entries.count == 1)
    #expect(entries.first?.title == "A again")
    #expect(entries.first?.visitedAt == now.addingTimeInterval(-300))
    #expect(entries.first?.source == .thisDevice)
  }

  @Test func thePhonesOwnVisitComingBackFromSyncStaysThisDevice() {
    let entries = HistoryTimeline.entries(
      local: [visit("https://a.example/", "A", minutesAgo: 5)],
      synced: [HistoryVisitInput(url: "https://a.example/", title: "A", visitedAt: now.addingTimeInterval(-299))],
      hidden: [:]
    )
    #expect(entries.map(\.source) == [.thisDevice])
  }

  @Test func aNewerVisitOnTheMacWins() {
    let entries = HistoryTimeline.entries(
      local: [visit("https://a.example/", "A", minutesAgo: 60)],
      synced: [visit("https://a.example/", "A on Mac", minutesAgo: 2), visit("https://b.example/", "B", minutesAgo: 10)],
      hidden: [:]
    )
    #expect(entries.map(\.url) == ["https://a.example/", "https://b.example/"])
    #expect(entries.map(\.source) == [.otherDevice, .otherDevice])
    #expect(entries.first?.title == "A on Mac")
  }

  @Test func hiddenPagesStayHiddenUntilVisitedAgain() {
    let row = HistoryEntry(url: "https://a.example/", title: "A", visitedAt: now.addingTimeInterval(-300), source: .otherDevice)
    let hidden = HistoryTimeline.hiding(row, in: [:])
    let before = HistoryTimeline.entries(local: [], synced: [visit("https://a.example/", "A", minutesAgo: 5)], hidden: hidden)
    #expect(before.isEmpty)
    let after = HistoryTimeline.entries(local: [visit("https://a.example/", "A", minutesAgo: 1)], synced: [visit("https://a.example/", "A", minutesAgo: 5)], hidden: hidden)
    #expect(after.map(\.source) == [.thisDevice])
  }

  @Test func hiddenPagesAreKeptOnlyWhileTheMacStillListsThem() {
    let old = now.addingTimeInterval(-3_600)
    let hidden = ["https://a.example/": old, "https://gone.example/": old]
    let kept = HistoryTimeline.keeping(hidden, stillIn: [visit("https://a.example/", "A", minutesAgo: 90)])
    #expect(kept == ["https://a.example/": old])
    let many = (0..<2_000).reduce(into: [String: Date]()) { hidden, index in
      let row = HistoryEntry(url: "https://\(index).example/", title: "", visitedAt: now, source: .otherDevice)
      hidden = HistoryTimeline.hiding(row, in: hidden)
    }
    #expect(many.count == 2_000)
  }

  @Test func clearingHistoryForgetsTheHiddenPagesInThatRange() {
    let hidden = ["https://old.example/": now.addingTimeInterval(-7_200), "https://new.example/": now.addingTimeInterval(-600)]
    #expect(HistoryTimeline.forgetting(hidden, since: now.addingTimeInterval(-3_600)) == ["https://old.example/": now.addingTimeInterval(-7_200)])
    #expect(HistoryTimeline.forgetting(hidden, since: nil).isEmpty)
  }

  @Test func searchMatchesEveryWordInTitleOrAddress() {
    let entries = [
      HistoryEntry(url: "https://www.google.com/search?q=sintra", title: "best time to visit sintra - Google Search", visitedAt: now, source: .thisDevice),
      HistoryEntry(url: "https://en.wikipedia.org/wiki/Lisbon", title: "Lisbon - Wikipedia", visitedAt: now, source: .otherDevice),
    ]
    #expect(HistoryTimeline.filter(entries, query: "  ").count == 2)
    #expect(HistoryTimeline.filter(entries, query: "wikipedia lisbon").map(\.title) == ["Lisbon - Wikipedia"])
    #expect(HistoryTimeline.filter(entries, query: "SINTRA google").count == 1)
    #expect(HistoryTimeline.filter(entries, query: "porto").isEmpty)
  }

  @Test func hostDropsWWW() {
    #expect(HistoryEntry(url: "https://www.google.com/search?q=a", title: "", visitedAt: now, source: .thisDevice).host == "google.com")
    #expect(HistoryEntry(url: "https://en.wikipedia.org/", title: "", visitedAt: now, source: .thisDevice).host == "en.wikipedia.org")
  }

  @Test func daysAreLabelledTodayYesterdayWeekdayThenDate() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let noon = calendar.date(bySettingHour: 12, minute: 0, second: 0, of: now)!
    let day: TimeInterval = 86_400
    #expect(HistoryTimeline.label(for: noon.addingTimeInterval(-3_600), now: noon, calendar: calendar) == .today)
    #expect(HistoryTimeline.label(for: noon.addingTimeInterval(-day), now: noon, calendar: calendar) == .yesterday)
    let threeDaysAgo = noon.addingTimeInterval(-3 * day)
    #expect(HistoryTimeline.label(for: threeDaysAgo, now: noon, calendar: calendar) == .weekday(calendar.startOfDay(for: threeDaysAgo)))
    let lastMonth = noon.addingTimeInterval(-30 * day)
    #expect(HistoryTimeline.label(for: lastMonth, now: noon, calendar: calendar) == .date(calendar.startOfDay(for: lastMonth)))
    let entries = [
      HistoryEntry(url: "https://a.example/", title: "", visitedAt: noon, source: .thisDevice),
      HistoryEntry(url: "https://b.example/", title: "", visitedAt: noon.addingTimeInterval(-60), source: .thisDevice),
      HistoryEntry(url: "https://c.example/", title: "", visitedAt: noon.addingTimeInterval(-day), source: .thisDevice),
    ]
    #expect(HistoryTimeline.days(entries, calendar: calendar).map(\.entries.count) == [2, 1])
  }
}
