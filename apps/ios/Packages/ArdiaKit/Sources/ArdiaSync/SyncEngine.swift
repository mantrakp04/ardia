import ArdiaShared
@preconcurrency import ArdiaSyncCore
import Foundation
import Synchronization

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

  static let offline = CycleOutcome(status: .unavailable, snapshot: nil, received: [], historyRemoved: [], pending: 0, published: 0, changed: 0)
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
  private let token: UUID
  private let script: ScriptEngine
  private let host: SyncHost
  private let now: @Sendable () -> Date
  private let fresh: Bool
  private let coordination: SyncCoordination
  private var loaded = false
  private var retired = false

  private static let live = Mutex<[String: UUID]>([:])

  public init(
    directory: URL,
    deviceId: String,
    entropy: Data,
    folder: SyncFolderGrant,
    fresh: Bool = false,
    coordinationTimeout: TimeInterval = SyncFolderAccess.defaultTimeout,
    now: @escaping @Sendable () -> Date = Date.init
  ) throws {
    let token = UUID()
    guard Self.live.withLock({ live in
      guard live[deviceId] == nil else { return false }
      live[deviceId] = token
      return true
    }) else { throw SyncError.engineAlreadyRunning }
    do {
      let keys = SyncKeys(entropy: entropy)
      let coordination = SyncCoordination(timeout: coordinationTimeout)
      let host = SyncHost(files: SyncFiles(directory: directory), keys: keys, grant: folder, coordination: coordination)
      let script = try ScriptEngine(scripts: [.sync])
      host.register(on: script)
      self.host = host
      self.script = script
      self.coordination = coordination
    } catch {
      Self.release(deviceId, token)
      throw error
    }
    self.deviceId = deviceId
    self.token = token
    self.now = now
    self.fresh = fresh
  }

  deinit {
    Self.release(deviceId, token)
  }

  private static func release(_ deviceId: String, _ token: UUID) {
    live.withLock { live in
      if live[deviceId] == token { live[deviceId] = nil }
    }
  }

  public static func check(entropy: Data, folder: URL) -> FolderCheck {
    guard SyncFolderAccess.isDirectory(folder), let names = SyncFolderAccess.coordinatedListing(folder) else { return .unavailable }
    if names.contains(SyncVault(folder: folder, keys: SyncKeys(entropy: entropy)).chainURL.lastPathComponent) { return .matches }
    return names.contains(where: SyncFolderAccess.isChainTag) ? .mismatch : .noSyncData
  }

  public nonisolated func cancelCoordination() {
    coordination.cancelAll()
  }

  public func changeFolder(_ grant: SyncFolderGrant) throws {
    try checkLive()
    host.use(grant)
  }

  public func cachedSnapshot() -> SyncSnapshot? {
    guard !retired, let data = host.files.readSealed(host.files.snapshotURL, keys: host.keys, fileId: SyncFiles.snapshotFile) else { return nil }
    return try? Self.decoder.decode(SyncSnapshot.self, from: data)
  }

  public func cycle(_ local: LocalBrowsing, retiring: Bool = false) throws -> CycleOutcome {
    try checkLive()
    try Task.checkCancellation()
    coordination.resume()
    host.timedOut = false
    try load()
    let input = CycleInput(
      name: local.deviceName,
      now: now().millisecondsSince1970,
      retiring: retiring,
      tabs: local.tabs?.map { .init(u: $0.url, t: $0.title, at: $0.lastActive.millisecondsSince1970, p: $0.profileSyncId) },
      visits: local.visits?.map { .init(u: $0.url, t: $0.title, vt: $0.visitedAt.map(\.millisecondsSince1970), p: $0.profileSyncId) }
    )
    let json: String
    do {
      json = try script.callAsync(.sync, "runCompanionCycle", json: [String(decoding: Self.encoder.encode(input), as: UTF8.self)])
    } catch {
      if host.timedOut { return .offline }
      throw error
    }
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
    try checkLive()
    try load()
    try mutate("companionSend", SendInput(profile: profileSyncId, key: UUID().uuidString.lowercased(), u: url, t: title, to: device, at: now().millisecondsSince1970))
  }

  public func acknowledge(_ tabs: [ReceivedTab]) throws {
    try checkLive()
    guard !tabs.isEmpty else { return }
    try load()
    try mutate("companionAcknowledge", AckInput(items: tabs.map { .init(profile: $0.profileSyncId, key: $0.key) }))
  }

  @discardableResult
  public func addBookmark(url: String, title: String, profileSyncId: String) throws -> String {
    try checkLive()
    try load()
    let key = UUID().uuidString.lowercased()
    try mutate("companionAddBookmark", BookmarkInput(profile: profileSyncId, key: key, u: url, t: title, at: now().millisecondsSince1970))
    return key
  }

  public func removeBookmark(key: String, profileSyncId: String) throws {
    try checkLive()
    try load()
    try mutate("companionRemoveBookmark", RemoveBookmarkInput(profile: profileSyncId, key: key))
  }

  @discardableResult
  public func stop(_ local: LocalBrowsing) throws -> Bool {
    try checkLive()
    let outcome = try cycle(local, retiring: true)
    guard outcome.status != .unavailable else {
      retire()
      return false
    }
    forget()
    return true
  }

  public func forget() {
    retire()
    host.files.removeSyncData()
    host.journal = SyncJournal()
  }

  public func setAside(_ reason: String) {
    retire()
    host.files.setAside(reason)
  }

  public func retire() {
    guard !retired else { return }
    retired = true
    _ = try? script.call(.sync, "companionUnload")
    loaded = false
    Self.release(deviceId, token)
  }

  private func checkLive() throws {
    if retired { throw SyncError.retired }
  }

  private func readWithRetry(_ url: URL, fileId: String) -> SyncFiles.SealedRead {
    let first = host.files.read(url, keys: host.keys, fileId: fileId)
    guard case .failed = first else { return first }
    Thread.sleep(forTimeInterval: 0.2)
    return host.files.read(url, keys: host.keys, fileId: fileId)
  }

  private func load() throws {
    guard !loaded else { return }
    let state: String?
    switch readWithRetry(host.files.stateURL, fileId: SyncFiles.stateFile) {
    case .failed: throw SyncError.stateUnavailable
    case .unreadable: throw SyncError.stateUnreadable
    case .missing:
      if !fresh && host.files.stateWasSaved { throw SyncError.stateUnreadable }
      state = nil
    case .opened(let data): state = String(decoding: data, as: UTF8.self)
    }
    switch readWithRetry(host.files.journalURL, fileId: SyncFiles.journalFile) {
    case .failed: throw SyncError.stateUnavailable
    case .unreadable: throw SyncError.stateUnreadable
    case .missing: host.journal = SyncJournal()
    case .opened(let data):
      guard let journal = try? JSONDecoder().decode(SyncJournal.self, from: data) else { throw SyncError.stateUnreadable }
      host.journal = journal
    }
    let device = String(decoding: try JSONEncoder().encode(deviceId), as: UTF8.self)
    let argument = "{\"device\":\(device),\"fresh\":\(state == nil),\"state\":\(state ?? "null"),\"journal\":\(host.journal.scriptJSON)}"
    do {
      _ = try script.call(.sync, "companionLoad", json: [argument])
    } catch {
      throw SyncError.stateUnreadable
    }
    loaded = true
  }

  private func mutate(_ function: String, _ input: some Encodable) throws {
    let json = try script.call(.sync, function, json: [String(decoding: Self.encoder.encode(input), as: UTF8.self)])
    let result = try? JSONDecoder().decode(Saved.self, from: Data(json.utf8))
    if result?.refused == true { throw SyncError.refused }
    if result?.saved != true { throw SyncError.couldNotSave }
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
  case refused
  case retired
  case engineAlreadyRunning
  case stateUnavailable
  case stateUnreadable
}

private struct Saved: Decodable {
  var saved: Bool
  var refused: Bool?
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
    var profile: String
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
