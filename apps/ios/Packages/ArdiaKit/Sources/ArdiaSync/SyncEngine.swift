import ArdiaShared
@preconcurrency import ArdiaSyncCore
import Foundation

public struct LocalBrowsing: Sendable {
  public var deviceName: String
  public var tabs: [LocalTabRecord]?
  public var visits: [LocalVisitRecord]?

  public init(deviceName: String, tabs: [LocalTabRecord]?, visits: [LocalVisitRecord]?) {
    self.deviceName = deviceName
    self.tabs = tabs
    self.visits = visits
  }
}

public struct HistoryRemoval: Equatable, Sendable {
  public var profileSyncId: String?
  public var urls: Set<String>
}

public struct CycleOutcome: Sendable {
  public enum Status: String, Sendable {
    case ok
    case missing
    case unavailable
  }

  public var status: Status
  public var snapshot: SyncSnapshot?
  public var received: [ReceivedTab]
  public var historyRemoved: [HistoryRemoval]
  public var pending: Int
  public var published: Int
  public var changed: Int
}

public enum FolderCheck: Equatable, Sendable {
  case matches
  case mismatch
  case noSyncData
  case unavailable
}

public actor SyncEngine {
  private let queue = DispatchSerialQueue(label: "com.ardia.ios.sync", qos: .utility)
  public nonisolated var unownedExecutor: UnownedSerialExecutor { queue.asUnownedSerialExecutor() }

  public let deviceId: String
  private let script: ScriptEngine
  private let host: SyncHost
  private let now: @Sendable () -> Date
  private var loaded = false

  public init(directory: URL, deviceId: String, entropy: Data, folder: SyncFolderGrant, now: @escaping @Sendable () -> Date = Date.init) throws {
    self.deviceId = deviceId
    self.now = now
    let keys = SyncKeys(entropy: entropy)
    let host = SyncHost(files: SyncFiles(directory: directory), keys: keys, vault: SyncVault(folder: folder.folder, keys: keys), grant: folder)
    let script = try ScriptEngine(scripts: [.sync])
    host.register(on: script)
    self.host = host
    self.script = script
  }

  public static func check(entropy: Data, folder: URL) -> FolderCheck {
    guard SyncFolderAccess.isDirectory(folder) else { return .unavailable }
    _ = SyncFolderAccess.coordinatedListing(folder)
    if SyncVault(folder: folder, keys: SyncKeys(entropy: entropy)).chainExists() { return .matches }
    return SyncFolderAccess.holdsChains(folder) ? .mismatch : .noSyncData
  }

  public func cachedSnapshot() -> SyncSnapshot? {
    guard let data = host.files.readSealed(host.files.snapshotURL, keys: host.keys, fileId: SyncFiles.snapshotFile) else { return nil }
    return try? Self.decoder.decode(SyncSnapshot.self, from: data)
  }

  public func cycle(_ local: LocalBrowsing, retiring: Bool = false) throws -> CycleOutcome {
    try Task.checkCancellation()
    try load()
    let input = CycleInput(
      name: local.deviceName,
      now: now().millisecondsSince1970,
      retiring: retiring,
      tabs: local.tabs?.map { .init(u: $0.url, t: $0.title, at: $0.lastActive.millisecondsSince1970, p: $0.profileSyncId) },
      visits: local.visits?.map { .init(u: $0.url, t: $0.title, vt: $0.visitedAt.map(\.millisecondsSince1970), p: $0.profileSyncId) }
    )
    let json = try script.callAsync(.sync, "runCompanionCycle", json: [String(decoding: Self.encoder.encode(input), as: UTF8.self)])
    let output = try Self.decoder.decode(CycleOutput.self, from: Data(json.utf8))
    var snapshot = output.view
    if var fresh = snapshot {
      fresh.syncedAt = now()
      snapshot = fresh
      if let data = try? Self.encoder.encode(fresh) {
        try? host.files.writeSealed(data, to: host.files.snapshotURL, keys: host.keys, fileId: SyncFiles.snapshotFile)
      }
    }
    return CycleOutcome(
      status: CycleOutcome.Status(rawValue: output.status) ?? .unavailable,
      snapshot: snapshot,
      received: output.received.map {
        ReceivedTab(key: $0.key, url: $0.u, title: $0.t, fromDevice: $0.fromName ?? "", sentAt: Date(millisecondsSince1970: $0.at), profileSyncId: $0.profile, fromDeviceId: $0.from)
      },
      historyRemoved: output.historyRemoved.map { HistoryRemoval(profileSyncId: $0.profile, urls: Set($0.urls)) },
      pending: output.pending,
      published: output.published,
      changed: output.changed
    )
  }

  public func send(url: String, title: String, to device: String, profileSyncId: String) throws {
    try load()
    try mutate("companionSend", SendInput(profile: profileSyncId, key: UUID().uuidString.lowercased(), u: url, t: title, to: device, at: now().millisecondsSince1970))
  }

  public func acknowledge(_ tabs: [ReceivedTab]) throws {
    guard !tabs.isEmpty else { return }
    try load()
    try mutate("companionAcknowledge", AckInput(items: tabs.map { .init(profile: $0.profileSyncId, key: $0.key) }))
  }

  @discardableResult
  public func addBookmark(url: String, title: String, profileSyncId: String) throws -> String {
    try load()
    let key = UUID().uuidString.lowercased()
    try mutate("companionAddBookmark", BookmarkInput(profile: profileSyncId, key: key, u: url, t: title, at: now().millisecondsSince1970))
    return key
  }

  public func removeBookmark(key: String, profileSyncId: String) throws {
    try load()
    try mutate("companionRemoveBookmark", RemoveBookmarkInput(profile: profileSyncId, key: key))
  }

  public func stop(_ local: LocalBrowsing) throws {
    defer { forget() }
    _ = try cycle(local, retiring: true)
  }

  public func forget() {
    _ = try? script.call(.sync, "companionUnload")
    loaded = false
    host.files.removeSyncData()
    host.journal = SyncJournal()
  }

  private func load() throws {
    guard !loaded else { return }
    let state = host.files.readSealed(host.files.stateURL, keys: host.keys, fileId: SyncFiles.stateFile).map { String(decoding: $0, as: UTF8.self) }
    if let data = host.files.readSealed(host.files.journalURL, keys: host.keys, fileId: SyncFiles.journalFile),
       let journal = try? JSONDecoder().decode(SyncJournal.self, from: data) {
      host.journal = journal
    }
    let device = String(decoding: try JSONEncoder().encode(deviceId), as: UTF8.self)
    let argument = "{\"device\":\(device),\"state\":\(state?.isEmpty == false ? state! : "null"),\"journal\":\(host.journal.scriptJSON)}"
    _ = try script.call(.sync, "companionLoad", json: [argument])
    loaded = true
  }

  private func mutate(_ function: String, _ input: some Encodable) throws {
    let json = try script.call(.sync, function, json: [String(decoding: Self.encoder.encode(input), as: UTF8.self)])
    if (try? JSONDecoder().decode(Saved.self, from: Data(json.utf8)))?.saved != true { throw SyncError.couldNotSave }
  }

  static let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .millisecondsSince1970
    return encoder
  }()

  static let decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .millisecondsSince1970
    return decoder
  }()
}

public enum SyncError: Error, Equatable, Sendable {
  case couldNotSave
}

private struct Saved: Decodable {
  var saved: Bool
}

private struct CycleInput: Encodable {
  struct Tab: Encodable {
    var u: String
    var t: String
    var at: Double
    var p: String?
  }

  struct Visit: Encodable {
    var u: String
    var t: String
    var vt: [Double]
    var p: String?
  }

  var name: String
  var now: Double
  var retiring: Bool
  var tabs: [Tab]?
  var visits: [Visit]?
}

private struct CycleOutput: Decodable {
  struct Received: Decodable {
    var profile: String
    var key: String
    var u: String
    var t: String
    var from: String
    var fromName: String?
    var at: Double
  }

  struct Removal: Decodable {
    var profile: String?
    var urls: [String]
  }

  var status: String
  var view: SyncSnapshot?
  var received: [Received]
  var historyRemoved: [Removal]
  var published: Int
  var changed: Int
  var pending: Int
}

private struct SendInput: Encodable {
  var profile: String
  var key: String
  var u: String
  var t: String
  var to: String
  var at: Double
}

private struct AckInput: Encodable {
  struct Item: Encodable {
    var profile: String
    var key: String
  }

  var items: [Item]
}

private struct BookmarkInput: Encodable {
  var profile: String
  var key: String
  var u: String
  var t: String
  var at: Double
}

private struct RemoveBookmarkInput: Encodable {
  var profile: String
  var key: String
}

extension Date {
  var millisecondsSince1970: Double { (timeIntervalSince1970 * 1000).rounded() }

  init(millisecondsSince1970 ms: Double) {
    self.init(timeIntervalSince1970: ms / 1000)
  }
}
