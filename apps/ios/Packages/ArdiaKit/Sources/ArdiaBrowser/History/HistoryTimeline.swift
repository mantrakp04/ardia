import Foundation

public struct HistoryEntry: Equatable, Hashable, Identifiable, Sendable {
  public enum Source: Sendable {
    case thisDevice
    case otherDevice
  }

  public var url: String
  public var title: String
  public var visitedAt: Date
  public var source: Source

  public var id: String { url }

  public var host: String {
    guard let host = URL(string: url)?.host() else { return url }
    return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
  }

  public init(url: String, title: String, visitedAt: Date, source: Source) {
    self.url = url
    self.title = title
    self.visitedAt = visitedAt
    self.source = source
  }
}

public struct HistoryDay: Equatable, Identifiable, Sendable {
  public var day: Date
  public var entries: [HistoryEntry]

  public var id: Date { day }
}

public struct HistoryVisitInput: Sendable {
  public var url: String
  public var title: String
  public var visitedAt: Date

  public init(url: String, title: String, visitedAt: Date) {
    self.url = url
    self.title = title
    self.visitedAt = visitedAt
  }
}

public enum HistoryTimeline {
  public static let sameVisitTolerance: TimeInterval = 2

  public static func entries(local: [HistoryVisitInput], synced: [HistoryVisitInput], hidden: [String: Date]) -> [HistoryEntry] {
    var byURL: [String: HistoryEntry] = [:]
    for visit in local where isVisible(visit, hidden: hidden) {
      if let existing = byURL[visit.url], existing.visitedAt >= visit.visitedAt {
        if existing.title.isEmpty, !visit.title.isEmpty { byURL[visit.url]?.title = visit.title }
        continue
      }
      let title = visit.title.isEmpty ? (byURL[visit.url]?.title ?? "") : visit.title
      byURL[visit.url] = HistoryEntry(url: visit.url, title: title, visitedAt: visit.visitedAt, source: .thisDevice)
    }
    for visit in synced where isVisible(visit, hidden: hidden) {
      if let existing = byURL[visit.url] {
        guard visit.visitedAt > existing.visitedAt.addingTimeInterval(sameVisitTolerance) else {
          if existing.title.isEmpty, !visit.title.isEmpty { byURL[visit.url]?.title = visit.title }
          continue
        }
        let title = visit.title.isEmpty ? existing.title : visit.title
        byURL[visit.url] = HistoryEntry(url: visit.url, title: title, visitedAt: visit.visitedAt, source: .otherDevice)
      } else {
        byURL[visit.url] = HistoryEntry(url: visit.url, title: visit.title, visitedAt: visit.visitedAt, source: .otherDevice)
      }
    }
    return byURL.values.sorted { $0.visitedAt == $1.visitedAt ? $0.url < $1.url : $0.visitedAt > $1.visitedAt }
  }

  public static func filter(_ entries: [HistoryEntry], query: String) -> [HistoryEntry] {
    let words = query.lowercased().split(whereSeparator: \.isWhitespace)
    guard !words.isEmpty else { return entries }
    return entries.filter { entry in
      let haystack = "\(entry.title) \(entry.url)".lowercased()
      return words.allSatisfy { haystack.contains($0) }
    }
  }

  public static func days(_ entries: [HistoryEntry], calendar: Calendar = .current) -> [HistoryDay] {
    var days: [HistoryDay] = []
    for entry in entries {
      let day = calendar.startOfDay(for: entry.visitedAt)
      if days.last?.day == day {
        days[days.count - 1].entries.append(entry)
      } else {
        days.append(HistoryDay(day: day, entries: [entry]))
      }
    }
    return days
  }

  public enum DayLabel: Equatable, Sendable {
    case today
    case yesterday
    case weekday(Date)
    case date(Date)
  }

  public static func label(for day: Date, now: Date, calendar: Calendar = .current) -> DayLabel {
    let today = calendar.startOfDay(for: now)
    let start = calendar.startOfDay(for: day)
    let distance = calendar.dateComponents([.day], from: start, to: today).day ?? 0
    switch distance {
    case ...0: return .today
    case 1: return .yesterday
    case 2..<7: return .weekday(start)
    default: return .date(start)
    }
  }

  public static func hiding(_ entry: HistoryEntry, in hidden: [String: Date]) -> [String: Date] {
    var next = hidden
    next[entry.url] = max(entry.visitedAt, hidden[entry.url] ?? .distantPast)
    return next
  }

  public static func keeping(_ hidden: [String: Date], stillIn synced: [HistoryVisitInput]) -> [String: Date] {
    let urls = Set(synced.map(\.url))
    return hidden.filter { urls.contains($0.key) }
  }

  public static func forgetting(_ hidden: [String: Date], since date: Date?) -> [String: Date] {
    guard let date else { return [:] }
    return hidden.filter { $0.value < date }
  }

  private static func isVisible(_ visit: HistoryVisitInput, hidden: [String: Date]) -> Bool {
    guard let cutoff = hidden[visit.url] else { return true }
    return visit.visitedAt > cutoff.addingTimeInterval(sameVisitTolerance)
  }
}
