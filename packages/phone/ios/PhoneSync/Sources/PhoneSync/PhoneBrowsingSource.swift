import ArdiaSync
import Foundation
import SQLite3

@MainActor
public final class PhoneBrowsingSource: LocalBrowsingSource {
  public enum ReadFailure: Error, Equatable {
    case newerSchema(Int32)
    case unreadable(Int32)
  }

  nonisolated public static let schemaVersion: Int32 = 1
  nonisolated public static let syncedTabLimit = 30
  nonisolated public static let historyRetention: TimeInterval = 90 * 86_400
  nonisolated static let busyTimeoutMilliseconds: Int32 = 5_000
  nonisolated static let chunk = 500

  public let database: URL
  public let inbox: PhoneInbox
  private let isReady: () -> Bool
  private let now: () -> Date
  public var onReceived: (([ReceivedTab]) -> Void)?
  private var connection: OpaquePointer?
  private var reading = false
  private var empty = false

  public init(database: URL, inbox: PhoneInbox, isReady: @escaping () -> Bool = { true }, now: @escaping () -> Date = Date.init) {
    self.database = database
    self.inbox = inbox
    self.isReady = isReady
    self.now = now
  }

  isolated deinit {
    if let connection { sqlite3_close_v2(connection) }
  }

  public func beginRead() throws {
    endRead()
    guard isReady() else { throw LocalBrowsingNotReady() }
    guard FileManager.default.fileExists(atPath: database.path(percentEncoded: false)) else {
      empty = true
      reading = true
      return
    }
    let handle = try Self.open(database.path(percentEncoded: false))
    connection = handle
    do {
      sqlite3_busy_timeout(handle, Self.busyTimeoutMilliseconds)
      try execute("PRAGMA query_only = ON")
      try execute("BEGIN")
      reading = true
      let version = try rows("PRAGMA user_version", []).first?.first.flatMap { $0 as? Int64 }.map { Int32(truncatingIfNeeded: $0) } ?? 0
      if version > Self.schemaVersion { throw ReadFailure.newerSchema(version) }
      empty = version == 0
    } catch {
      endRead()
      throw error
    }
  }

  public func endRead() {
    if let connection {
      if reading { sqlite3_exec(connection, "ROLLBACK", nil, nil, nil) }
      sqlite3_close_v2(connection)
    }
    connection = nil
    reading = false
    empty = false
  }

  public func syncedTabs() throws -> [LocalTabRecord] {
    try withRead {
      guard !empty else { return [] }
      var counts: [String?: Int] = [:]
      return try rows("SELECT url, title, lastActive, profileSyncId FROM tabs WHERE archivedAt IS NULL", [])
        .compactMap { row -> LocalTabRecord? in
          guard let url = row[0] as? String, Self.isSyncable(url) else { return nil }
          return LocalTabRecord(url: url, title: row[1] as? String ?? "", lastActive: Self.date(row[2]), profileSyncId: row[3] as? String)
        }
        .sorted { $0.lastActive > $1.lastActive }
        .filter { tab in
          let count = counts[tab.profileSyncId, default: 0]
          counts[tab.profileSyncId] = count + 1
          return count < Self.syncedTabLimit
        }
    }
  }

  public func syncedVisits(since: Date) throws -> [LocalVisitRecord] {
    try withRead {
      guard !empty else { return [] }
      return try visits("SELECT url, title, visitedAt, profileSyncId FROM visits WHERE visitedAt >= ? ORDER BY visitedAt, id", [Self.milliseconds(since)])
    }
  }

  public func syncedVisits(urls: Set<String>) throws -> [LocalVisitRecord] {
    try withRead {
      guard !empty, !urls.isEmpty else { return [] }
      let cutoff = Self.milliseconds(now().addingTimeInterval(-Self.historyRetention))
      let list = urls.sorted()
      var found: [LocalVisitRecord] = []
      for start in stride(from: 0, to: list.count, by: Self.chunk) {
        let part = Array(list[start..<min(start + Self.chunk, list.count)])
        let marks = Array(repeating: "?", count: part.count).joined(separator: ",")
        found += try visits("SELECT url, title, visitedAt, profileSyncId FROM visits WHERE url IN (\(marks)) AND visitedAt >= ? ORDER BY visitedAt, id", part + [cutoff])
      }
      return found
    }
  }

  public func removeVisits(urls: Set<String>, profileSyncId: String?) throws {
    guard !urls.isEmpty else { return }
    guard inbox.remove(PhoneInbox.Removal(profileSyncId: profileSyncId, urls: urls)) else { throw PhoneInbox.WriteFailed() }
  }

  public func receive(_ tabs: [ReceivedTab]) -> Bool {
    let kept = tabs.filter { Self.isSyncable($0.url) }
    guard inbox.receive(kept) else { return false }
    if !kept.isEmpty { onReceived?(kept) }
    return true
  }

  nonisolated public static func isSyncable(_ url: String) -> Bool {
    let lower = url.lowercased()
    return lower.hasPrefix("https://") || lower.hasPrefix("http://")
  }

  private func withRead<Value>(_ body: () throws -> Value) throws -> Value {
    if reading { return try body() }
    try beginRead()
    defer { endRead() }
    return try body()
  }

  private func visits(_ sql: String, _ arguments: [Any]) throws -> [LocalVisitRecord] {
    var removed: [String?: Set<String>] = [:]
    var order: [String] = []
    var records: [String: LocalVisitRecord] = [:]
    for row in try rows(sql, arguments) {
      guard let url = row[0] as? String else { continue }
      let title = row[1] as? String ?? ""
      let at = Self.date(row[2])
      let profile = row[3] as? String
      if removed[profile] == nil { removed[profile] = inbox.removedUrls(profileSyncId: profile) }
      if removed[profile]?.contains(url) == true { continue }
      let key = "\(profile ?? "")\u{0}\(profile == nil ? "n" : "p")\u{0}\(url)"
      if var record = records[key] {
        record.visitedAt.append(at)
        if !title.isEmpty { record.title = title }
        records[key] = record
      } else {
        order.append(key)
        records[key] = LocalVisitRecord(url: url, title: title, visitedAt: [at], profileSyncId: profile)
      }
    }
    return order.compactMap { records[$0] }
  }

  private static func open(_ path: String) throws -> OpaquePointer {
    var failure = SQLITE_CANTOPEN
    for flags in [SQLITE_OPEN_READONLY, SQLITE_OPEN_READWRITE] {
      var handle: OpaquePointer?
      let opened = sqlite3_open_v2(path, &handle, flags | SQLITE_OPEN_NOMUTEX, nil)
      if opened == SQLITE_OK, let handle {
        if sqlite3_exec(handle, "SELECT count(*) FROM sqlite_master", nil, nil, nil) == SQLITE_OK { return handle }
        failure = sqlite3_errcode(handle)
      } else {
        failure = opened
      }
      if let handle { sqlite3_close_v2(handle) }
      guard failure == SQLITE_CANTOPEN else { break }
    }
    throw ReadFailure.unreadable(failure)
  }

  private func execute(_ sql: String) throws {
    let result = sqlite3_exec(connection, sql, nil, nil, nil)
    guard result == SQLITE_OK else { throw ReadFailure.unreadable(result) }
  }

  private func rows(_ sql: String, _ arguments: [Any]) throws -> [[Any?]] {
    guard let connection else { throw ReadFailure.unreadable(SQLITE_MISUSE) }
    var statement: OpaquePointer?
    let prepared = sqlite3_prepare_v2(connection, sql, -1, &statement, nil)
    guard prepared == SQLITE_OK, let statement else { throw ReadFailure.unreadable(prepared) }
    defer { sqlite3_finalize(statement) }
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for (index, argument) in arguments.enumerated() {
      let position = Int32(index + 1)
      switch argument {
      case let text as String: sqlite3_bind_text(statement, position, text, -1, transient)
      case let number as Int64: sqlite3_bind_int64(statement, position, number)
      default: sqlite3_bind_null(statement, position)
      }
    }
    var found: [[Any?]] = []
    while true {
      let step = sqlite3_step(statement)
      if step == SQLITE_DONE { break }
      guard step == SQLITE_ROW else { throw ReadFailure.unreadable(step) }
      found.append((0..<sqlite3_column_count(statement)).map { column -> Any? in
        switch sqlite3_column_type(statement, column) {
        case SQLITE_NULL: return nil
        case SQLITE_INTEGER: return sqlite3_column_int64(statement, column)
        case SQLITE_FLOAT: return sqlite3_column_double(statement, column)
        default: return sqlite3_column_text(statement, column).map { String(cString: $0) }
        }
      })
    }
    return found
  }

  private static func milliseconds(_ date: Date) -> Int64 { Int64((date.timeIntervalSince1970 * 1000).rounded()) }

  private static func date(_ value: Any?) -> Date {
    switch value {
    case let number as Int64: Date(timeIntervalSince1970: Double(number) / 1000)
    case let number as Double: Date(timeIntervalSince1970: number / 1000)
    default: .distantPast
    }
  }
}
