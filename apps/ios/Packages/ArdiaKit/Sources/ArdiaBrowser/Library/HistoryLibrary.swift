import ArdiaSync
import Foundation
import Observation
import SwiftData

public enum HistoryLibraryError: Error, Equatable {
  case readOnly
}

@ModelActor
actor LocalVisitReader {
  static let limit = 20_000

  func visits() throws -> [LocalVisitRow] {
    var descriptor = FetchDescriptor<Visit>(sortBy: [SortDescriptor(\.visitedAt, order: .reverse)])
    descriptor.propertiesToFetch = [\.url, \.title, \.visitedAt, \.profileSyncId]
    descriptor.fetchLimit = Self.limit
    return try modelContext.fetch(descriptor).map { LocalVisitRow(url: $0.url, title: $0.title, visitedAt: $0.visitedAt, profileSyncId: $0.profileSyncId) }
  }
}

@MainActor
@Observable
public final class HistoryLibrary {
  public private(set) var entries: [HistoryEntry] = []
  public private(set) var isLoaded = false
  public private(set) var loadProblem: String?

  @ObservationIgnored private let context: ModelContext
  @ObservationIgnored private let fingerprint: HistoryFingerprint
  @ObservationIgnored private let calendar: Calendar
  @ObservationIgnored private let now: () -> Date
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var syncedPages: Set<String> = []
  @ObservationIgnored private var spaces = HistorySpaceFilter.everySpace

  public init(context: ModelContext, fingerprint: HistoryFingerprint? = nil, calendar: Calendar = .current, now: @escaping () -> Date = Date.init) {
    self.context = context
    self.fingerprint = fingerprint ?? .forStore(context.container)
    self.calendar = calendar
    self.now = now
  }

  public func reload(synced: [HistoryItem], spaces: HistorySpaceFilter = .everySpace) async {
    generation &+= 1
    let current = generation
    do {
      let hiding = try HistoryEraser.hiding(in: context, fingerprint: fingerprint)
      let local = try await LocalVisitReader(modelContainer: context.container).visits().filter { spaces.keeps($0.profileSyncId) }
      guard current == generation else { return }
      entries = HistoryTimeline.entries(local: local, synced: synced, hiding: hiding, calendar: calendar)
      syncedPages = Set(synced.map(\.url))
      self.spaces = spaces
      loadProblem = nil
    } catch {
      guard current == generation else { return }
      loadProblem = String(localized: "Ardia couldn’t read this device’s history.")
    }
    isLoaded = true
  }

  public func days(matching query: String, scope: HistoryScope) -> [HistoryDay] {
    HistoryTimeline.days(HistoryTimeline.filter(entries, query: query, scope: scope), calendar: calendar)
  }

  public func delete(_ entry: HistoryEntry) throws {
    guard entry.source == .thisDevice else { throw HistoryLibraryError.readOnly }
    let end = calendar.date(byAdding: .day, value: 1, to: entry.day) ?? entry.day.addingTimeInterval(86_400)
    try HistoryEraser.erase(
      url: entry.url,
      during: DateInterval(start: entry.day, end: end),
      spaces: spaces,
      rememberedBy: syncedPages.contains(entry.url) ? fingerprint : nil,
      in: context
    )
    generation &+= 1
    entries = entries.filter { $0.id != entry.id }
  }

  public func clear(since date: Date?) throws {
    try HistoryEraser.erase(since: date, at: now(), in: context)
    generation &+= 1
    entries = entries.filter { entry in
      entry.source == .synced || date.map { entry.lastVisit < $0 } == true
    }
  }
}
