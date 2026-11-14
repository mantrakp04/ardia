import ArdiaSync
import Foundation
import SQLite3
import Testing
@testable import PhoneSync

final class Scratch {
  let root = FileManager.default.temporaryDirectory.appending(path: "phone-sync-\(UUID().uuidString)", directoryHint: .isDirectory)
  var database: URL { root.appending(path: "SQLite/browser.db") }
  var inboxFile: URL { root.appending(path: "PhoneSync/inbox.json") }

  init() throws {
    try FileManager.default.createDirectory(at: root.appending(path: "SQLite"), withIntermediateDirectories: true)
  }

  deinit { try? FileManager.default.removeItem(at: root) }

  func names(_ folder: String) -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: root.appending(path: folder).path(percentEncoded: false))) ?? []).sorted()
  }
}

final class Writer {
  private var handle: OpaquePointer?

  init(_ file: URL, version: Int32 = PhoneBrowsingSource.schemaVersion) throws {
    guard sqlite3_open(file.path(percentEncoded: false), &handle) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
    try run("PRAGMA journal_mode = WAL")
    try run("""
      CREATE TABLE IF NOT EXISTS tabs (id TEXT PRIMARY KEY NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL,
        lastActive INTEGER NOT NULL, archivedAt INTEGER, position REAL NOT NULL, profileSyncId TEXT, faviconUrl TEXT,
        themeColorHex TEXT, snapshotFileName TEXT, origin TEXT NOT NULL, receivedKey TEXT, receivedFromDevice TEXT)
      """)
    try run("""
      CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, visitedAt INTEGER NOT NULL,
        profileSyncId TEXT, transition TEXT NOT NULL)
      """)
    try run("PRAGMA user_version = \(version)")
  }

  deinit { close() }

  func close() {
    if let handle { sqlite3_close(handle) }
    handle = nil
  }

  func run(_ sql: String) throws {
    guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
  }

  func tab(_ url: String, at: Date, profile: String? = nil, archived: Bool = false) throws {
    let id = UUID().uuidString
    let ms = Int64(at.timeIntervalSince1970 * 1000)
    let profileValue = profile.map { "'\($0)'" } ?? "NULL"
    try run("INSERT INTO tabs (id, url, title, created, lastActive, archivedAt, position, profileSyncId, origin) VALUES ('\(id)', '\(url)', 'T \(url)', \(ms), \(ms), \(archived ? "\(ms)" : "NULL"), 1, \(profileValue), 'typed')")
  }

  func visit(_ url: String, at: Date, title: String = "", profile: String? = nil) throws {
    let profileValue = profile.map { "'\($0)'" } ?? "NULL"
    try run("INSERT INTO visits (url, title, visitedAt, profileSyncId, transition) VALUES ('\(url)', '\(title)', \(Int64(at.timeIntervalSince1970 * 1000)), \(profileValue), 'link')")
  }
}

func received(_ key: String, url: String = "https://sent.example/", sentAt: Date = .now) -> ReceivedTab {
  ReceivedTab(key: key, url: url, title: "Sent", fromDevice: "MacBook Pro", sentAt: sentAt, profileSyncId: "personal", fromDeviceId: "mac")
}

@Suite struct PhoneInboxTests {
  @Test func anUnparsableInboxIsSetAsideReportedAndRefusesTheNextWrite() throws {
    let scratch = try Scratch()
    try FileManager.default.createDirectory(at: scratch.inboxFile.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("{\"entries\": [ {\"id\": 1, ".utf8).write(to: scratch.inboxFile)
    let inbox = PhoneInbox(file: scratch.inboxFile)
    #expect(inbox.problem == PhoneInbox.unreadableMessage)
    #expect(scratch.names("PhoneSync").contains { $0.hasPrefix("inbox.json.unreadable-") })
    #expect(!inbox.receive([received("send:a")]))
    #expect(inbox.entries().isEmpty)
    #expect(inbox.receive([received("send:a")]))
    #expect(inbox.entries().flatMap(\.received).map(\.key) == ["send:a"])
    #expect(PhoneInbox(file: scratch.inboxFile).problem == nil)
  }

  @Test func anEmptyOrWrongShapeFileIsNeverTreatedAsAnEmptyInbox() throws {
    for text in ["", "42", "{\"entries\": 3}"] {
      let scratch = try Scratch()
      try FileManager.default.createDirectory(at: scratch.inboxFile.deletingLastPathComponent(), withIntermediateDirectories: true)
      try Data(text.utf8).write(to: scratch.inboxFile)
      let inbox = PhoneInbox(file: scratch.inboxFile)
      #expect(!inbox.remove(PhoneInbox.Removal(profileSyncId: nil, urls: ["https://a.example/"])))
      #expect(inbox.problem == PhoneInbox.unreadableMessage)
    }
  }

  @Test func unreadableEntriesAreSetAsideAndTheRestKept() throws {
    let scratch = try Scratch()
    try FileManager.default.createDirectory(at: scratch.inboxFile.deletingLastPathComponent(), withIntermediateDirectories: true)
    let good = PhoneInbox.json(PhoneInbox.Entry(id: 2, received: [received("send:b")], removals: []))
    let file: [String: Any] = ["v": 2, "entries": [["id": "x"], good], "applied": [], "readUpTo": 0]
    try JSONSerialization.data(withJSONObject: file).write(to: scratch.inboxFile)
    let inbox = PhoneInbox(file: scratch.inboxFile)
    #expect(inbox.entries().map(\.id) == [2])
    #expect(inbox.problem == PhoneInbox.partlyUnreadableMessage)
    #expect(inbox.receive([received("send:c")]))
  }

  @Test func aReplayAfterTheAppAppliedButBeforeSyncAcknowledgedAddsNothing() throws {
    let scratch = try Scratch()
    let inbox = PhoneInbox(file: scratch.inboxFile)
    #expect(inbox.receive([received("send:a"), received("send:a")]))
    let first = inbox.entries()
    #expect(first.flatMap(\.received).map(\.key) == ["send:a"])
    #expect(inbox.receive([received("send:a")]))
    #expect(inbox.entries().count == 1)
    try inbox.applied(Set(first.map(\.id)))
    #expect(inbox.receive([received("send:a")]))
    #expect(inbox.entries().isEmpty)
    let relaunched = PhoneInbox(file: scratch.inboxFile)
    #expect(relaunched.receive([received("send:a")]))
    #expect(relaunched.entries().isEmpty)
  }

  @Test func removalsAreDeduplicatedAndNeverDropped() throws {
    let scratch = try Scratch()
    let inbox = PhoneInbox(file: scratch.inboxFile)
    #expect(inbox.remove(PhoneInbox.Removal(profileSyncId: "p", urls: ["https://a.example/", "https://b.example/"])))
    #expect(inbox.remove(PhoneInbox.Removal(profileSyncId: "p", urls: ["https://b.example/", "https://c.example/"])))
    #expect(inbox.remove(PhoneInbox.Removal(profileSyncId: nil, urls: ["https://a.example/"])))
    let read = inbox.entries()
    #expect(read.count == 1)
    #expect(read[0].removals.first { $0.profileSyncId == "p" }?.urls == ["https://a.example/", "https://b.example/", "https://c.example/"])
    #expect(inbox.remove(PhoneInbox.Removal(profileSyncId: "p", urls: ["https://d.example/"])))
    let after = inbox.entries()
    #expect(after.map(\.id) == [1, 2])
    #expect(after[0] == read[0])
    for _ in 0..<(PhoneInbox.receivedLimit + 10) {
      #expect(inbox.receive([received("send:\(UUID().uuidString)")]))
    }
    #expect(inbox.removedUrls(profileSyncId: "p") == ["https://a.example/", "https://b.example/", "https://c.example/", "https://d.example/"])
    #expect(inbox.entries().flatMap(\.received).count == PhoneInbox.receivedLimit)
  }

  @Test func onChangeReportsTheCountOutsideTheLock() throws {
    let scratch = try Scratch()
    let inbox = PhoneInbox(file: scratch.inboxFile)
    var counts: [Int] = []
    inbox.onChange = { count in
      counts.append(count)
      _ = inbox.entries()
    }
    #expect(inbox.receive([received("send:a")]))
    try inbox.applied(Set(inbox.entries().map(\.id)))
    #expect(counts == [1, 0])
  }
}

@MainActor
@Suite struct PhoneBrowsingSourceTests {
  @Test func aMissingDatabaseIsAnEmptyPhone() throws {
    let scratch = try Scratch()
    let source = PhoneBrowsingSource(database: scratch.database, inbox: PhoneInbox(file: scratch.inboxFile))
    try source.beginRead()
    #expect(try source.syncedTabs().isEmpty)
    #expect(try source.syncedVisits(since: .distantPast).isEmpty)
    source.endRead()
    #expect(!FileManager.default.fileExists(atPath: scratch.database.path(percentEncoded: false)))
  }

  @Test func aNewerSchemaFailsTheReadInsteadOfGuessing() throws {
    let scratch = try Scratch()
    let writer = try Writer(scratch.database, version: PhoneBrowsingSource.schemaVersion + 1)
    try writer.tab("https://a.example/", at: .now)
    let source = PhoneBrowsingSource(database: scratch.database, inbox: PhoneInbox(file: scratch.inboxFile))
    #expect(throws: PhoneBrowsingSource.ReadFailure.newerSchema(PhoneBrowsingSource.schemaVersion + 1)) { try source.beginRead() }
    #expect(throws: PhoneBrowsingSource.ReadFailure.newerSchema(PhoneBrowsingSource.schemaVersion + 1)) { try source.syncedTabs() }
  }

  @Test func oneReadSeesOneMomentWhileTheAppKeepsWriting() throws {
    let scratch = try Scratch()
    let writer = try Writer(scratch.database)
    try writer.tab("https://one.example/", at: .now)
    let source = PhoneBrowsingSource(database: scratch.database, inbox: PhoneInbox(file: scratch.inboxFile))
    try source.beginRead()
    #expect(try source.syncedTabs().map(\.url) == ["https://one.example/"])
    try writer.tab("https://two.example/", at: .now.addingTimeInterval(1))
    try writer.visit("https://two.example/", at: .now)
    #expect(try source.syncedTabs().map(\.url) == ["https://one.example/"])
    #expect(try source.syncedVisits(since: .distantPast).isEmpty)
    source.endRead()
    try source.beginRead()
    #expect(try source.syncedTabs().map(\.url) == ["https://two.example/", "https://one.example/"])
    source.endRead()
  }

  @Test func aCleanlyClosedDatabaseIsStillReadable() throws {
    let scratch = try Scratch()
    let writer = try Writer(scratch.database)
    try writer.tab("https://closed.example/", at: .now)
    writer.close()
    for name in ["browser.db-wal", "browser.db-shm"] {
      try? FileManager.default.removeItem(at: scratch.root.appending(path: "SQLite/\(name)"))
    }
    #expect(scratch.names("SQLite") == ["browser.db"])
    let source = PhoneBrowsingSource(database: scratch.database, inbox: PhoneInbox(file: scratch.inboxFile))
    try source.beginRead()
    #expect(try source.syncedTabs().map(\.url) == ["https://closed.example/"])
    source.endRead()
  }

  @Test func onlyOpenWebTabsAndTheNewestThirtyPerProfileAreShared() throws {
    let scratch = try Scratch()
    let writer = try Writer(scratch.database)
    let start = Date.now.addingTimeInterval(-3600)
    for index in 0..<35 { try writer.tab("https://p\(index).example/", at: start.addingTimeInterval(Double(index)), profile: "work") }
    try writer.tab("https://personal.example/", at: start)
    try writer.tab("https://archived.example/", at: .now, archived: true)
    try writer.tab("about:blank", at: .now)
    try writer.tab("file:///etc/hosts", at: .now)
    let source = PhoneBrowsingSource(database: scratch.database, inbox: PhoneInbox(file: scratch.inboxFile))
    let tabs = try source.syncedTabs()
    #expect(tabs.filter { $0.profileSyncId == "work" }.count == 30)
    #expect(tabs.first?.url == "https://p34.example/")
    #expect(tabs.contains { $0.url == "https://personal.example/" && $0.profileSyncId == nil })
    #expect(!tabs.contains { $0.url.contains("archived") || !$0.url.hasPrefix("https://") })
  }

  @Test func visitsGroupByPageAndProfileAndSkipWhatTheMacRemoved() throws {
    let scratch = try Scratch()
    let writer = try Writer(scratch.database)
    let now = Date.now
    try writer.visit("https://a.example/", at: now.addingTimeInterval(-30), title: "Old")
    try writer.visit("https://a.example/", at: now.addingTimeInterval(-20), title: "New")
    try writer.visit("https://a.example/", at: now.addingTimeInterval(-10), profile: "work")
    try writer.visit("https://gone.example/", at: now.addingTimeInterval(-5), profile: "work")
    try writer.visit("https://ancient.example/", at: now.addingTimeInterval(-100 * 86_400))
    let inbox = PhoneInbox(file: scratch.inboxFile)
    #expect(inbox.remove(PhoneInbox.Removal(profileSyncId: "work", urls: ["https://gone.example/"])))
    let source = PhoneBrowsingSource(database: scratch.database, inbox: inbox, now: { now })
    try source.beginRead()
    let visits = try source.syncedVisits(since: now.addingTimeInterval(-60))
    #expect(visits.map(\.url) == ["https://a.example/", "https://a.example/"])
    #expect(visits.first { $0.profileSyncId == nil }?.title == "New")
    #expect(visits.first { $0.profileSyncId == nil }?.visitedAt.count == 2)
    #expect(try source.syncedVisits(urls: ["https://ancient.example/", "https://gone.example/"]).isEmpty)
    #expect(try source.syncedVisits(urls: ["https://a.example/"]).count == 2)
    source.endRead()
  }

  @Test func removalsAndReceivedTabsGoToTheInbox() throws {
    let scratch = try Scratch()
    let inbox = PhoneInbox(file: scratch.inboxFile)
    let source = PhoneBrowsingSource(database: scratch.database, inbox: inbox)
    try source.removeVisits(urls: ["https://a.example/"], profileSyncId: nil)
    #expect(source.receive([received("send:a"), received("send:b", url: "javascript:alert(1)")]))
    let entries = inbox.entries()
    #expect(entries.flatMap(\.received).map(\.key) == ["send:a"])
    #expect(entries.flatMap(\.removals).flatMap(\.urls) == ["https://a.example/"])
  }

  @Test func aRemovalTheInboxCouldNotKeepFailsSoSyncDoesNotAcknowledgeIt() throws {
    let scratch = try Scratch()
    try FileManager.default.createDirectory(at: scratch.inboxFile.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("not json".utf8).write(to: scratch.inboxFile)
    let source = PhoneBrowsingSource(database: scratch.database, inbox: PhoneInbox(file: scratch.inboxFile))
    #expect(throws: PhoneInbox.WriteFailed.self) { try source.removeVisits(urls: ["https://a.example/"], profileSyncId: nil) }
    try source.removeVisits(urls: ["https://a.example/"], profileSyncId: nil)
  }
}

@MainActor
@Suite struct LegacyImportGateTests {
  func gate(_ scratch: Scratch) -> LegacyImportGate {
    LegacyImportGate(
      legacyStores: [scratch.root.appending(path: "Group/Browser.store"), scratch.root.appending(path: "Ardia/Browser.store")],
      marker: scratch.root.appending(path: "PhoneSync/legacy-imported.json")
    )
  }

  func source(_ scratch: Scratch, _ gate: LegacyImportGate) throws -> PhoneBrowsingSource {
    let writer = try Writer(scratch.database)
    try writer.tab("https://a.example/", at: .now)
    return PhoneBrowsingSource(database: scratch.database, inbox: PhoneInbox(file: scratch.inboxFile), isReady: { !gate.holdsSync })
  }

  @Test func withNoLegacyStoreSyncReadsAtOnce() throws {
    let scratch = try Scratch()
    let gate = gate(scratch)
    #expect(!gate.hasLegacyStore && !gate.imported && !gate.holdsSync)
    let source = try source(scratch, gate)
    try source.beginRead()
    #expect(try source.syncedTabs().count == 1)
    source.endRead()
  }

  @Test func aLegacyStoreWithoutTheMarkerHoldsEveryRead() throws {
    let scratch = try Scratch()
    let gate = gate(scratch)
    try FileManager.default.createDirectory(at: scratch.root.appending(path: "Ardia"), withIntermediateDirectories: true)
    try Data("store".utf8).write(to: scratch.root.appending(path: "Ardia/Browser.store"))
    #expect(gate.holdsSync)
    let source = try source(scratch, gate)
    #expect(throws: LocalBrowsingNotReady.self) { try source.beginRead() }
    #expect(throws: LocalBrowsingNotReady.self) { try source.syncedTabs() }
    #expect(throws: LocalBrowsingNotReady.self) { try source.syncedVisits(since: .distantPast) }
  }

  @Test func theMarkerReleasesTheHoldAndLivesOutsideTheOldStore() throws {
    let scratch = try Scratch()
    let gate = gate(scratch)
    try FileManager.default.createDirectory(at: scratch.root.appending(path: "Group"), withIntermediateDirectories: true)
    try Data("store".utf8).write(to: scratch.root.appending(path: "Group/Browser.store"))
    let source = try source(scratch, gate)
    #expect(throws: LocalBrowsingNotReady.self) { try source.beginRead() }
    try gate.markImported(at: Date(timeIntervalSince1970: 1_000))
    let first = try Data(contentsOf: gate.marker)
    try gate.markImported(at: Date(timeIntervalSince1970: 2_000))
    #expect(try Data(contentsOf: gate.marker) == first)
    #expect(gate.imported && !gate.holdsSync)
    #expect(scratch.names("Group") == ["Browser.store"])
    try source.beginRead()
    #expect(try source.syncedTabs().count == 1)
    source.endRead()
  }
}
