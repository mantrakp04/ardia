import ArdiaSyncCore
import Foundation

struct SyncMeta: Codable, Equatable, Sendable {
  var deviceId: String?
  var deviceName: String = SyncMeta.defaultDeviceName
  var folder: SyncFolderLocation?
  var enabled = false
  var setupAt: Date?
  var lastSyncedAt: Date?
  var selectedProfileId: String?
  var outOfSync = false
  var retiringDeviceId: String?
  var visitsSyncedThrough: Date?
  var chainSeen = false

  static let defaultDeviceName = "iPhone"
}

struct SyncJournal: Codable, Equatable, Sendable {
  struct Entry: Codable, Equatable, Sendable {
    var scope: String
    var seq: Int
    var batch: String
  }

  var entries: [Entry] = []

  private struct Sequence: Decodable {
    var seq: Int
  }

  mutating func add(scope: String, batches: [String]) throws {
    for batch in batches {
      let seq = try JSONDecoder().decode(Sequence.self, from: Data(batch.utf8)).seq
      if entries.contains(where: { $0.scope == scope && $0.seq == seq }) { continue }
      entries.append(Entry(scope: scope, seq: seq, batch: batch))
    }
  }

  mutating func prune(saved: [String: Int]) {
    entries.removeAll { $0.seq <= saved[$0.scope] ?? 0 }
  }

  private struct Origin: Decodable {
    var device: String
  }

  func only(device: String) -> SyncJournal {
    SyncJournal(entries: entries.filter { (try? JSONDecoder().decode(Origin.self, from: Data($0.batch.utf8)))?.device == device })
  }

  var scriptJSON: String {
    let scopes = Dictionary(grouping: entries, by: \.scope)
    let encoder = JSONEncoder()
    let fields = scopes.keys.sorted().map { scope -> String in
      let name = (try? encoder.encode(scope)).map { String(decoding: $0, as: UTF8.self) } ?? "\"\""
      return name + ":[" + scopes[scope]!.sorted { $0.seq < $1.seq }.map(\.batch).joined(separator: ",") + "]"
    }
    return "{" + fields.joined(separator: ",") + "}"
  }
}

struct SyncFiles: Sendable {
  let directory: URL

  var metaURL: URL { directory.appendingPathComponent("sync.json") }
  var stateURL: URL { directory.appendingPathComponent("sync-state.nns") }
  var journalURL: URL { directory.appendingPathComponent("sync-journal.nns") }
  var snapshotURL: URL { directory.appendingPathComponent("sync-snapshot.nns") }
  var freshURL: URL { directory.appendingPathComponent("sync-fresh.json") }

  struct Fresh: Codable, Equatable {
    var device: String
    var ghosts: [String]
  }

  static let stateFile = "state"
  static let journalFile = "journal"
  static let snapshotFile = "snapshot"
  static let localScope = "local"

  func loadMeta() -> SyncMeta {
    guard let data = try? Data(contentsOf: metaURL), let meta = try? JSONDecoder().decode(SyncMeta.self, from: data) else { return SyncMeta() }
    return meta
  }

  func saveMeta(_ meta: SyncMeta) throws {
    try write(JSONEncoder().encode(meta), to: metaURL)
  }

  enum SealedRead {
    case missing
    case opened(Data)
    case unreadable
    case failed
  }

  func readSealed(_ url: URL, keys: SyncKeys, fileId: String) -> Data? {
    if case .opened(let data) = read(url, keys: keys, fileId: fileId) { return data }
    return nil
  }

  func read(_ url: URL, keys: SyncKeys, fileId: String) -> SealedRead {
    guard FileManager.default.fileExists(atPath: url.path) else { return .missing }
    let data: Data
    do {
      data = try Data(contentsOf: url)
    } catch {
      return .failed
    }
    guard let plain = try? keys.open(data, scopeTag: Self.localScope, fileId: fileId) else { return .unreadable }
    return .opened(plain)
  }

  func writeFresh(_ fresh: Fresh) throws {
    try write(JSONEncoder().encode(fresh), to: freshURL)
  }

  func readFresh() -> Fresh? {
    guard let data = try? Data(contentsOf: freshURL) else { return nil }
    return try? JSONDecoder().decode(Fresh.self, from: data)
  }

  func clearFresh(for device: String) {
    guard readFresh()?.device == device else { return }
    try? FileManager.default.removeItem(at: freshURL)
  }

  func setAside(_ reason: String, state: Bool = true, journal: Bool = true) {
    for url in [state ? stateURL : nil, journal ? journalURL : nil].compactMap(\.self) where FileManager.default.fileExists(atPath: url.path) {
      let aside = directory.appendingPathComponent(url.deletingPathExtension().lastPathComponent + ".\(reason).nns")
      try? FileManager.default.removeItem(at: aside)
      try? FileManager.default.moveItem(at: url, to: aside)
    }
    try? FileManager.default.removeItem(at: snapshotURL)
  }

  func writeSealed(_ payload: Data, to url: URL, keys: SyncKeys, fileId: String) throws {
    try write(keys.seal(payload, scopeTag: Self.localScope, fileId: fileId), to: url)
  }

  func write(_ data: Data, to url: URL) throws {
    if !FileManager.default.fileExists(atPath: directory.path) {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      var folder = directory
      try? folder.setResourceValues(values)
    }
    #if os(iOS)
    try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    #else
    try data.write(to: url, options: [.atomic])
    #endif
  }

  func removeSyncData() {
    for url in [stateURL, journalURL, snapshotURL, freshURL] { try? FileManager.default.removeItem(at: url) }
  }
}
