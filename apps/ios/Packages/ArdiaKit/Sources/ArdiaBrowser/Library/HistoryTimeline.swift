import ArdiaSync
import Foundation

public enum HistorySource: String, Sendable, Hashable {
  case thisDevice
  case synced
}

public enum HistoryScope: String, Sendable, Hashable, CaseIterable, Identifiable {
  case all
  case thisDevice
  case synced

  public var id: String { rawValue }

  func includes(_ source: HistorySource) -> Bool {
    switch self {
    case .all: true
    case .thisDevice: source == .thisDevice
    case .synced: source == .synced
    }
  }
}

public struct LocalVisitRow: Sendable, Hashable {
  public var url: String
  public var title: String
  public var visitedAt: Date
  public var profileSyncId: String?

  public init(url: String, title: String, visitedAt: Date, profileSyncId: String? = nil) {
    self.url = url
    self.title = title
    self.visitedAt = visitedAt
    self.profileSyncId = profileSyncId
  }
}

public struct HistorySpaceFilter: Sendable, Equatable {
  public var roster: SpaceRoster
  public var current: String?

  public init(roster: SpaceRoster, current: String?) {
    self.roster = roster
    self.current = current
  }

  public static let everySpace = HistorySpaceFilter(roster: .unnamed, current: nil)

  public func keeps(_ profileSyncId: String?) -> Bool {
    roster.isUnnamed || roster.space(of: profileSyncId) == roster.space(of: current)
  }
}

public struct HistoryClearingWindow: Sendable, Hashable {
  public var start: Date?
  public var end: Date

  public init(start: Date?, end: Date) {
    self.start = start
    self.end = end
  }

  func covers(_ date: Date, tolerance: TimeInterval) -> Bool {
    let afterStart = start.map { date >= $0.addingTimeInterval(-tolerance) } ?? true
    return afterStart && date <= end.addingTimeInterval(tolerance)
  }
}

public struct HistoryHiding {
  public var windows: [HistoryClearingWindow]
  public var deleted: [String: Date]
  public var fingerprint: HistoryFingerprint?

  public init(windows: [HistoryClearingWindow], deleted: [String: Date], fingerprint: HistoryFingerprint?) {
    self.windows = windows
    self.deleted = deleted
    self.fingerprint = fingerprint
  }

  public static var none: HistoryHiding { HistoryHiding(windows: [], deleted: [:], fingerprint: nil) }

  func hides(_ item: HistoryItem, tolerance: TimeInterval) -> Bool {
    if windows.contains(where: { $0.covers(item.lastVisit, tolerance: tolerance) }) { return true }
    guard !deleted.isEmpty, let fingerprint, let lastDeleted = deleted[fingerprint.of(item.url)] else { return false }
    return item.lastVisit <= lastDeleted.addingTimeInterval(tolerance)
  }
}

public struct HistoryEntry: Identifiable, Sendable, Hashable {
  public var url: String
  public var title: String
  public var lastVisit: Date
  public var visitCount: Int
  public var source: HistorySource
  public var day: Date

  public var id: String { "\(source.rawValue)|\(day.timeIntervalSinceReferenceDate)|\(url)" }
  public var host: String { BrowserURL.host(of: url) ?? url }
  public var displayTitle: String {
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? host : trimmed
  }
}

public struct HistoryDay: Identifiable, Sendable, Hashable {
  public var day: Date
  public var entries: [HistoryEntry]

  public var id: Date { day }
}

public enum HistoryTimeline {
  public static let sameVisitTolerance: TimeInterval = 2

  public static func entries(local: [LocalVisitRow], synced: [HistoryItem], hiding: HistoryHiding, calendar: Calendar) -> [HistoryEntry] {
    let localEntries = collapse(local, calendar: calendar)
    let localTimes = Dictionary(grouping: local, by: \.url).mapValues { $0.map(\.visitedAt) }
    let syncedEntries = synced.compactMap { item -> HistoryEntry? in
      let copiesThisDevice = localTimes[item.url]?.contains { abs($0.timeIntervalSince(item.lastVisit)) <= sameVisitTolerance } ?? false
      guard !copiesThisDevice, !hiding.hides(item, tolerance: sameVisitTolerance) else { return nil }
      return HistoryEntry(
        url: item.url,
        title: item.title,
        lastVisit: item.lastVisit,
        visitCount: item.visits,
        source: .synced,
        day: calendar.startOfDay(for: item.lastVisit)
      )
    }
    return (localEntries + syncedEntries).sorted(by: newestFirst)
  }

  public static func days(_ entries: [HistoryEntry], calendar: Calendar) -> [HistoryDay] {
    let grouped = Dictionary(grouping: entries) { calendar.startOfDay(for: $0.lastVisit) }
    return grouped
      .map { HistoryDay(day: $0.key, entries: $0.value.sorted(by: newestFirst)) }
      .sorted { $0.day > $1.day }
  }

  public static func filter(_ entries: [HistoryEntry], query: String, scope: HistoryScope = .all) -> [HistoryEntry] {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return entries.filter { entry in
      scope.includes(entry.source)
        && (trimmed.isEmpty || entry.title.localizedStandardContains(trimmed) || entry.url.localizedStandardContains(trimmed))
    }
  }

  private static func collapse(_ visits: [LocalVisitRow], calendar: Calendar) -> [HistoryEntry] {
    struct Key: Hashable {
      var url: String
      var day: Date
    }
    let groups = Dictionary(grouping: visits) { Key(url: $0.url, day: calendar.startOfDay(for: $0.visitedAt)) }
    return groups.map { key, visits in
      let newest = visits.sorted { $0.visitedAt > $1.visitedAt }
      let title = newest.first { !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }?.title ?? ""
      return HistoryEntry(
        url: key.url,
        title: title,
        lastVisit: newest[0].visitedAt,
        visitCount: visits.count,
        source: .thisDevice,
        day: key.day
      )
    }
  }

  private static func newestFirst(_ lhs: HistoryEntry, _ rhs: HistoryEntry) -> Bool {
    if lhs.lastVisit != rhs.lastVisit { return lhs.lastVisit > rhs.lastVisit }
    if lhs.url != rhs.url { return lhs.url < rhs.url }
    return lhs.source.rawValue < rhs.source.rawValue
  }
}
