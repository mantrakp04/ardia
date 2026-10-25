@preconcurrency import ArdiaSyncCore
import Foundation
import Observation
#if canImport(UIKit)
import UIKit
#endif
#if os(iOS)
import BackgroundTasks
#endif

public struct PhraseCheck: Equatable, Sendable {
  public var wordCount: Int
  public var counterText: String
  public var isTooLong: Bool
  public var problem: String?
  public var isValid: Bool
}

public enum ConnectResult: Equatable, Sendable {
  case connected
  case invalidPhrase(String)
  case mismatch
  case noSyncData
  case folderUnavailable
  case keychainFailed

  public var message: String? {
    switch self {
    case .connected: nil
    case .invalidPhrase(let message): message
    case .mismatch: "This recovery phrase doesn’t match the synced data in this folder. Check the phrase, or choose the folder your other devices sync to."
    case .noSyncData: "There’s no synced data in this folder yet. Choose the folder your other devices sync to, or wait for it to finish downloading."
    case .folderUnavailable: "Ardia can’t open this folder. Choose the Ardia Sync folder in iCloud Drive."
    case .keychainFailed: "Couldn’t save the sync key in your Keychain."
    }
  }
}

@MainActor
@Observable
public final class SyncService {
  public static let backgroundTaskIdentifier = "com.ardia.ios.sync"
  public static let wordCount = RecoveryPhrase.wordCount

  public private(set) var phase: SyncPhase = .off
  public private(set) var snapshot: SyncSnapshot = .empty
  public private(set) var pendingDownloads = 0
  public private(set) var lastSynced: Date?
  public private(set) var isEnabled = false
  public private(set) var folderName: String?
  public let isDemo: Bool

  public var deviceName: String {
    didSet {
      guard deviceName != oldValue else { return }
      let trimmed = deviceName.trimmingCharacters(in: .whitespacesAndNewlines)
      meta.deviceName = trimmed.isEmpty ? SyncMeta.defaultDeviceName : trimmed
      saveMeta()
      localDidChange()
    }
  }

  public var selectedProfileId: String? {
    didSet {
      guard selectedProfileId != oldValue else { return }
      meta.selectedProfileId = selectedProfileId
      saveMeta()
    }
  }

  public var devicesThatReceiveTabs: [SyncedDevice] {
    snapshot.devices.filter { $0.canReceiveTabs && !$0.isCurrent }
  }

  public var selectedProfile: SyncedProfile? { snapshot.profile(selectedProfileId) }

  public var statusText: String {
    switch phase {
    case .off: return "Off"
    case .starting: return "Starting up"
    case .updating: return "Updating" + waitingText
    case .updated: return "Updated just now" + waitingText
    case .stalled:
      guard let lastSynced else { return "Not syncing" }
      return "Not syncing · Last synced \(Self.relative.localizedString(for: lastSynced, relativeTo: .now))"
    case .offline: return "Offline"
    case .needsFolderAccess: return "Choose your sync folder again to keep syncing."
    case .locked: return "Enter your recovery phrase to keep syncing on this iPhone."
    case .reset: return "This device is out of sync. Sync may have been reset from another device."
    }
  }

  @ObservationIgnored public weak var source: (any LocalBrowsingSource)?
  @ObservationIgnored private let files: SyncFiles
  @ObservationIgnored private let keyStore: any SyncKeyStore
  @ObservationIgnored private var meta: SyncMeta
  @ObservationIgnored private var engine: SyncEngine?
  @ObservationIgnored private var running = false
  @ObservationIgnored private var again = false
  @ObservationIgnored private var idle: [CheckedContinuation<Void, Never>] = []
  @ObservationIgnored private var visitsDue = true
  @ObservationIgnored private var localDirty = false
  @ObservationIgnored private var foregroundLoop: Task<Void, Never>?
  @ObservationIgnored private var debounce: Task<Void, Never>?
  @ObservationIgnored private let now: @Sendable () -> Date

  public static let defaultDirectory = URL.applicationSupportDirectory.appending(path: "Sync", directoryHint: .isDirectory)
  static let cycleInterval: Duration = .seconds(15)
  static let afterEdit: Duration = .seconds(3)
  static let historyWindow: TimeInterval = 90 * 86_400

  private static weak var active: SyncService?

  public init(directory: URL = SyncService.defaultDirectory, keyStore: any SyncKeyStore = KeychainKeyStore(service: "Ardia Sync Key"), now: @escaping @Sendable () -> Date = Date.init) {
    files = SyncFiles(directory: directory)
    self.keyStore = keyStore
    self.now = now
    meta = files.loadMeta()
    deviceName = meta.deviceName
    selectedProfileId = meta.selectedProfileId
    lastSynced = meta.lastSyncedAt
    folderName = meta.folder?.name
    isDemo = false
  }

  private init(demo snapshot: SyncSnapshot) {
    files = SyncFiles(directory: URL(filePath: "/dev/null"))
    keyStore = DemoKeyStore()
    now = Date.init
    meta = SyncMeta(deviceName: "iPhone", enabled: true)
    deviceName = "iPhone"
    isDemo = true
    self.snapshot = snapshot
    phase = .updated
    isEnabled = true
    folderName = "Ardia Sync"
    lastSynced = .now
  }

  public static var demo: SyncService { SyncService(demo: .demo) }

  public func start() {
    guard !isDemo else { return }
    Self.active = self
    meta = files.loadMeta()
    folderName = meta.folder?.name
    guard meta.enabled, let deviceId = meta.deviceId, let location = meta.folder else {
      set(\.isEnabled, false)
      set(\.phase, meta.outOfSync ? .reset : .off)
      return
    }
    set(\.isEnabled, true)
    guard let entropy = keyStore.load(account: deviceId), entropy.count == 32 else {
      set(\.phase, .locked)
      return
    }
    guard case .resolved(let grant, let refreshed) = SyncFolderAccess.resolve(location) else {
      set(\.phase, .needsFolderAccess)
      return
    }
    if let refreshed {
      meta.folder = refreshed
      saveMeta()
    }
    do {
      let engine = try SyncEngine(directory: files.directory, deviceId: deviceId, entropy: entropy, folder: grant, now: now)
      self.engine = engine
      set(\.phase, .starting)
      Task {
        if let cached = await engine.cachedSnapshot(), snapshot == .empty { snapshot = cached }
        await runCycle()
      }
    } catch {
      set(\.phase, .stalled(Self.stalledMessage))
    }
  }

  public func check(phrase: String) -> PhraseCheck {
    let count = RecoveryPhrase.tokens(in: phrase).count
    let tooLong = count > Self.wordCount
    var problem: String?
    var valid = false
    if count == Self.wordCount {
      do {
        _ = try RecoveryPhrase.entropy(from: phrase)
        valid = true
      } catch let failure as RecoveryPhrase.Problem {
        problem = Self.message(for: failure)
      } catch {
        problem = Self.message(for: .checksum)
      }
    }
    return PhraseCheck(wordCount: count, counterText: tooLong ? "too many words" : "\(count)/\(Self.wordCount) words", isTooLong: tooLong, problem: problem, isValid: valid)
  }

  public func connect(phrase: String, folder: URL) async -> ConnectResult {
    guard !isDemo else { return .connected }
    let entropy: Data
    do {
      entropy = try RecoveryPhrase.entropy(from: phrase)
    } catch let failure as RecoveryPhrase.Problem {
      return .invalidPhrase(Self.message(for: failure))
    } catch {
      return .invalidPhrase(Self.message(for: .checksum))
    }
    guard let prepared = await Self.prepare(folder: folder, entropy: entropy) else { return .folderUnavailable }
    switch prepared.check {
    case .matches: break
    case .mismatch: return .mismatch
    case .noSyncData: return .noSyncData
    case .unavailable: return .folderUnavailable
    }
    let reuse = phase == .locked ? meta.deviceId.flatMap { id in Self.opensState(files, entropy: entropy) ? id : nil } : nil
    let deviceId = reuse ?? SyncKeys.newFileId()
    guard keyStore.save(entropy, account: deviceId) else { return .keychainFailed }
    if reuse == nil {
      if let old = meta.deviceId { keyStore.delete(account: old) }
      files.removeSyncData()
      meta.setupAt = now()
      meta.lastSyncedAt = nil
      lastSynced = nil
      snapshot = .empty
    }
    meta.deviceId = deviceId
    meta.folder = prepared.location
    meta.enabled = true
    meta.outOfSync = false
    saveMeta()
    do {
      engine = try SyncEngine(directory: files.directory, deviceId: deviceId, entropy: entropy, folder: prepared.grant, now: now)
    } catch {
      set(\.phase, .stalled(Self.stalledMessage))
      return .connected
    }
    Self.active = self
    folderName = prepared.location.name
    set(\.isEnabled, true)
    set(\.phase, .starting)
    visitsDue = true
    startForegroundLoop()
    Task { await runCycle() }
    return .connected
  }

  @discardableResult
  public func changeFolder(_ folder: URL) async -> ConnectResult {
    guard !isDemo else { return .connected }
    guard meta.enabled, let deviceId = meta.deviceId, let entropy = keyStore.load(account: deviceId) else { return .keychainFailed }
    guard let prepared = await Self.prepare(folder: folder, entropy: entropy) else { return .folderUnavailable }
    switch prepared.check {
    case .matches: break
    case .mismatch: return .mismatch
    case .noSyncData: return .noSyncData
    case .unavailable: return .folderUnavailable
    }
    meta.folder = prepared.location
    saveMeta()
    folderName = prepared.location.name
    do {
      engine = try SyncEngine(directory: files.directory, deviceId: deviceId, entropy: entropy, folder: prepared.grant, now: now)
    } catch {
      set(\.phase, .stalled(Self.stalledMessage))
      return .connected
    }
    set(\.phase, .starting)
    Task { await runCycle() }
    return .connected
  }

  public func syncNow() async {
    visitsDue = true
    guard running else { return await runCycle() }
    again = true
    await withCheckedContinuation { idle.append($0) }
  }

  public func localDidChange() {
    guard isEnabled, !isDemo else { return }
    localDirty = true
    visitsDue = true
    debounce?.cancel()
    debounce = Task { [weak self] in
      try? await Task.sleep(for: Self.afterEdit)
      guard !Task.isCancelled else { return }
      await self?.runCycle()
    }
  }

  public func appBecameActive() {
    guard !isDemo else { return }
    if phase == .locked || (meta.enabled && engine == nil && phase != .needsFolderAccess) { start() }
    guard isEnabled, engine != nil else { return }
    visitsDue = true
    startForegroundLoop()
    Task { await runCycle() }
  }

  public func appWillResignActive() {
    guard !isDemo else { return }
    foregroundLoop?.cancel()
    foregroundLoop = nil
    meta.lastSyncedAt = lastSynced
    saveMeta()
    guard isEnabled, engine != nil else { return }
    scheduleBackgroundRefresh()
    guard localDirty || debounce != nil else { return }
    debounce?.cancel()
    debounce = nil
    #if canImport(UIKit)
    let application = UIApplication.shared
    let assertion = application.beginBackgroundTask(withName: "Sync")
    Task {
      await runCycle()
      application.endBackgroundTask(assertion)
    }
    #else
    Task { await runCycle() }
    #endif
  }

  public func stopSyncing() async {
    guard !isDemo else { return }
    foregroundLoop?.cancel()
    foregroundLoop = nil
    debounce?.cancel()
    debounce = nil
    let local = gatherLocal()
    if let engine {
      if case .locked = phase {
        await engine.forget()
      } else {
        try? await engine.stop(local)
      }
    } else {
      files.removeSyncData()
    }
    if let deviceId = meta.deviceId { keyStore.delete(account: deviceId) }
    engine = nil
    meta.enabled = false
    meta.deviceId = nil
    meta.lastSyncedAt = nil
    meta.outOfSync = false
    saveMeta()
    snapshot = .empty
    lastSynced = nil
    set(\.pendingDownloads, 0)
    set(\.isEnabled, false)
    set(\.phase, .off)
  }

  @discardableResult
  public func send(url: URL, title: String, to device: SyncedDevice, profileSyncId: String? = nil) async -> Bool {
    guard !isDemo else { return true }
    guard let engine, let profile = profileSyncId ?? selectedProfile?.syncId else { return false }
    do {
      try await engine.send(url: url.absoluteString, title: title, to: device.id, profileSyncId: profile)
    } catch {
      return false
    }
    Task { await runCycle() }
    return true
  }

  @discardableResult
  public func addBookmark(url: URL, title: String, profileSyncId: String? = nil) async -> Bool {
    guard !isDemo else { return true }
    guard let engine, let profile = profileSyncId ?? selectedProfile?.syncId else { return false }
    do {
      try await engine.addBookmark(url: url.absoluteString, title: title, profileSyncId: profile)
    } catch {
      return false
    }
    Task { await runCycle() }
    return true
  }

  @discardableResult
  public func removeBookmark(key: String, profileSyncId: String? = nil) async -> Bool {
    guard !isDemo else { return true }
    guard let engine, let profile = profileSyncId ?? selectedProfile?.syncId else { return false }
    do {
      try await engine.removeBookmark(key: key, profileSyncId: profile)
    } catch {
      return false
    }
    Task { await runCycle() }
    return true
  }

  public static func registerBackgroundRefresh() {
    #if os(iOS)
    BGTaskScheduler.shared.register(forTaskWithIdentifier: backgroundTaskIdentifier, using: .main) { task in
      MainActor.assumeIsolated {
        guard let task = task as? BGAppRefreshTask else {
          task.setTaskCompleted(success: false)
          return
        }
        let work = Task { @MainActor in await SyncService.active?.backgroundCycle() ?? true }
        task.expirationHandler = { work.cancel() }
        Task { @MainActor in
          let success = await work.value
          SyncService.active?.scheduleBackgroundRefresh()
          task.setTaskCompleted(success: success)
        }
      }
    }
    #endif
  }

  public func scheduleBackgroundRefresh() {
    #if os(iOS)
    guard isEnabled, !isDemo else { return }
    let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskIdentifier)
    request.earliestBeginDate = now().addingTimeInterval(15 * 60)
    try? BGTaskScheduler.shared.submit(request)
    #endif
  }

  func backgroundCycle() async -> Bool {
    if engine == nil { start() }
    guard isEnabled, engine != nil, !Task.isCancelled else { return true }
    visitsDue = true
    await runCycle()
    return phase == .updated
  }

  private func startForegroundLoop() {
    guard foregroundLoop == nil else { return }
    foregroundLoop = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.cycleInterval)
        guard !Task.isCancelled, let self else { return }
        await self.runCycle()
      }
    }
  }

  private func runCycle() async {
    guard let engine, isEnabled, !isDemo else { return }
    if running {
      again = true
      return
    }
    running = true
    defer {
      running = false
      let waiting = idle
      idle = []
      for continuation in waiting { continuation.resume() }
    }
    repeat {
      again = false
      debounce?.cancel()
      debounce = nil
      let local = gatherLocal()
      let hadVisits = local.visits != nil
      let dirty = localDirty
      localDirty = false
      let slow = Task { [weak self] in
        try? await Task.sleep(for: .seconds(1))
        guard !Task.isCancelled, let self, self.phase == .updated else { return }
        self.set(\.phase, .updating)
      }
      do {
        let outcome = try await engine.cycle(local)
        if hadVisits { visitsDue = false }
        await apply(outcome, engine: engine)
      } catch is CancellationError {
        localDirty = localDirty || dirty
      } catch {
        localDirty = localDirty || dirty
        set(\.phase, .stalled(Self.stalledMessage))
      }
      slow.cancel()
    } while again && self.engine === engine && isEnabled
  }

  private func apply(_ outcome: CycleOutcome, engine: SyncEngine) async {
    guard self.engine === engine else { return }
    switch outcome.status {
    case .unavailable:
      set(\.phase, .offline)
    case .missing:
      await resetFromElsewhere(engine)
    case .ok:
      if let fresh = outcome.snapshot, !Self.same(fresh, snapshot) { snapshot = fresh }
      set(\.pendingDownloads, outcome.pending)
      set(\.phase, .updated)
      lastSynced = now()
      if outcome.changed > 0 { visitsDue = true }
      for removal in outcome.historyRemoved {
        source?.removeVisits(urls: removal.urls, profileSyncId: removal.profileSyncId)
      }
      if !outcome.received.isEmpty, let source {
        source.receive(outcome.received)
        try? await engine.acknowledge(outcome.received)
      }
    }
  }

  private func resetFromElsewhere(_ engine: SyncEngine) async {
    await engine.forget()
    if let deviceId = meta.deviceId { keyStore.delete(account: deviceId) }
    self.engine = nil
    foregroundLoop?.cancel()
    foregroundLoop = nil
    meta.enabled = false
    meta.deviceId = nil
    meta.outOfSync = true
    saveMeta()
    snapshot = .empty
    set(\.isEnabled, false)
    set(\.phase, .reset)
  }

  private func gatherLocal() -> LocalBrowsing {
    guard let source else { return LocalBrowsing(deviceName: meta.deviceName, tabs: nil, visits: nil) }
    let visits = visitsDue ? source.syncedVisits(since: now().addingTimeInterval(-Self.historyWindow)) : nil
    return LocalBrowsing(deviceName: meta.deviceName, tabs: source.syncedTabs(), visits: visits)
  }

  private func saveMeta() {
    guard !isDemo else { return }
    try? files.saveMeta(meta)
  }

  private func set<Value: Equatable>(_ keyPath: ReferenceWritableKeyPath<SyncService, Value>, _ value: Value) {
    if self[keyPath: keyPath] != value { self[keyPath: keyPath] = value }
  }

  private var waitingText: String {
    guard pendingDownloads > 0 else { return "" }
    return " · " + Self.waitingForDownloads(pendingDownloads)
  }

  static func waitingForDownloads(_ count: Int) -> String {
    String(AttributedString(localized: "Waiting for ^[\(count) file](inflect: true) to download").characters)
  }

  static func same(_ a: SyncSnapshot, _ b: SyncSnapshot) -> Bool {
    var a = a
    a.syncedAt = b.syncedAt
    return a == b
  }

  static func message(for problem: RecoveryPhrase.Problem) -> String {
    switch problem {
    case .wordCount: "Recovery phrase must be exactly 24 words."
    case .unknownWord(let word): "“\(word)” is not a valid recovery phrase word."
    case .checksum: "This recovery phrase is not valid. Please check for typos."
    }
  }

  static let stalledMessage = "Ardia couldn’t read or write the sync folder. It will try again."

  private static let relative: RelativeDateTimeFormatter = {
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .full
    return formatter
  }()

  private struct Prepared: Sendable {
    var grant: SyncFolderGrant
    var location: SyncFolderLocation
    var check: FolderCheck
  }

  @concurrent
  private static func prepare(folder: URL, entropy: Data) async -> Prepared? {
    guard let (grant, location) = try? SyncFolderAccess.grant(picked: folder) else { return nil }
    return Prepared(grant: grant, location: location, check: SyncEngine.check(entropy: entropy, folder: grant.folder))
  }

  private static func opensState(_ files: SyncFiles, entropy: Data) -> Bool {
    files.readSealed(files.stateURL, keys: SyncKeys(entropy: entropy), fileId: SyncFiles.stateFile) != nil
  }
}

private struct DemoKeyStore: SyncKeyStore {
  func load(account: String) -> Data? { nil }
  func save(_ secret: Data, account: String) -> Bool { true }
  func delete(account: String) {}
}
