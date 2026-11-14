import Foundation
import OSLog
import SwiftData

public enum HistoryEraser {
  static let log = Logger(subsystem: "com.ardia.browser.ios", category: "history")

  @MainActor
  public static func erase(since date: Date?, at now: Date, in context: ModelContext) throws {
    let visits: [Visit]
    let hidden: [HiddenSyncedVisit]
    if let date {
      visits = try context.fetch(FetchDescriptor<Visit>(predicate: #Predicate { $0.visitedAt >= date }))
      hidden = try context.fetch(FetchDescriptor<HiddenSyncedVisit>(predicate: #Predicate { $0.lastVisit >= date }))
    } else {
      visits = try context.fetch(FetchDescriptor<Visit>())
      hidden = try context.fetch(FetchDescriptor<HiddenSyncedVisit>())
      for clearing in try context.fetch(FetchDescriptor<HistoryClearing>()) { context.delete(clearing) }
    }
    for visit in visits { context.delete(visit) }
    for record in hidden { context.delete(record) }
    context.insert(HistoryClearing(start: date, end: now))
    try context.save()
  }

  @MainActor
  static func erase(url: String, during interval: DateInterval, spaces: HistorySpaceFilter, rememberedBy fingerprint: HistoryFingerprint?, in context: ModelContext) throws {
    let start = interval.start
    let end = interval.end
    let visits = try context.fetch(FetchDescriptor<Visit>(predicate: #Predicate { $0.url == url && $0.visitedAt >= start && $0.visitedAt < end }))
      .filter { spaces.keeps($0.profileSyncId) }
    guard let newest = visits.map(\.visitedAt).max() else { return }
    if let fingerprint { try remember(fingerprint.of(url), lastVisit: newest, in: context) }
    for visit in visits { context.delete(visit) }
    try context.save()
  }

  @MainActor
  public static func hiding(in context: ModelContext, fingerprint: HistoryFingerprint) throws -> HistoryHiding {
    let windows = try context.fetch(FetchDescriptor<HistoryClearing>()).map { HistoryClearingWindow(start: $0.start, end: $0.end) }
    let deleted = Dictionary(try context.fetch(FetchDescriptor<HiddenSyncedVisit>()).map { ($0.fingerprint, $0.lastVisit) }, uniquingKeysWith: max)
    return HistoryHiding(windows: windows, deleted: deleted, fingerprint: fingerprint)
  }

  @MainActor
  public static func forgetExpired(before cutoff: Date, in context: ModelContext) {
    do {
      let hidden = try context.fetch(FetchDescriptor<HiddenSyncedVisit>(predicate: #Predicate { $0.lastVisit < cutoff }))
      let clearings = try context.fetch(FetchDescriptor<HistoryClearing>(predicate: #Predicate { $0.end < cutoff }))
      guard !hidden.isEmpty || !clearings.isEmpty else { return }
      for record in hidden { context.delete(record) }
      for clearing in clearings { context.delete(clearing) }
      try context.save()
    } catch {
      log.error("Couldn't forget expired history records: \(error.localizedDescription, privacy: .public)")
    }
  }

  @MainActor
  private static func remember(_ fingerprint: String, lastVisit: Date, in context: ModelContext) throws {
    var descriptor = FetchDescriptor<HiddenSyncedVisit>(predicate: #Predicate { $0.fingerprint == fingerprint })
    descriptor.fetchLimit = 1
    if let record = try context.fetch(descriptor).first {
      if record.lastVisit < lastVisit { record.lastVisit = lastVisit }
    } else {
      context.insert(HiddenSyncedVisit(fingerprint: fingerprint, lastVisit: lastVisit))
    }
  }
}
