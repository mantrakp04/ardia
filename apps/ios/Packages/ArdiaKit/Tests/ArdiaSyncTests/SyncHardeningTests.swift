import ArdiaSyncCore
import Foundation
import Testing
@testable import ArdiaSync

@MainActor
@Suite struct SyncHardeningTests {
  static let scope = SyncEndToEndTests.scope

  struct Joined {
    let sandbox: Sandbox
    let entropy: Data
    let mac: FakeMac
    let source: FakeSource
    let clock: TestClock
    let service: SyncService
    let device: String
  }

  func makeService(_ sandbox: Sandbox, source: FakeSource, clock: TestClock, timeout: TimeInterval = 20) -> SyncService {
    let service = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), coordinationTimeout: timeout, now: { clock.now })
    service.source = source
    return service
  }

  func joined(timeout: TimeInterval = 20) async throws -> Joined {
    let sandbox = try Sandbox()
    let entropy = RecoveryPhrase.generateEntropy()
    let mac = try SyncEndToEndTests().seededMac(sandbox, entropy: entropy)
    let source = FakeSource()
    source.tabs = [LocalTabRecord(url: "https://phone.example/", title: "Phone", lastActive: .now, profileSyncId: nil)]
    let clock = TestClock()
    let service = makeService(sandbox, source: source, clock: clock, timeout: timeout)
    let result = await service.connect(phrase: RecoveryPhrase.words(for: entropy).joined(separator: " "), folder: sandbox.root)
    try #require(result == .connected)
    await service.syncNow()
    let device = try #require(service.snapshot.devices.first { $0.isCurrent }).id
    return Joined(sandbox: sandbox, entropy: entropy, mac: mac, source: source, clock: clock, service: service, device: device)
  }

  var stateFile: (Sandbox) -> URL { { $0.state.appendingPathComponent("sync-state.nns") } }

  @Test func aStateThatWontOpenStartsOverAsANewDeviceAndKeepsTheFileAside() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    await j.service.close()
    try Data(repeating: 9, count: 4096).write(to: stateFile(j.sandbox))

    let relaunched = makeService(j.sandbox, source: j.source, clock: j.clock)
    relaunched.start()
    await relaunched.syncNow()
    #expect(relaunched.phase == .updated)
    let fresh = try #require(relaunched.snapshot.devices.first { $0.isCurrent }).id
    #expect(fresh != j.device)
    #expect(j.sandbox.contents(j.sandbox.state).contains { $0.hasPrefix("sync-state.previous") })
    #expect(await relaunched.addBookmark(url: URL(string: "https://after.example/")!, title: "After"))
    await relaunched.syncNow()
    try j.mac.sync([Self.scope])
    #expect(try j.mac.store(Self.scope).values.contains { ($0 as? [String: Any])?["u"] as? String == "https://after.example/" })
    #expect(j.mac.logs(Self.scope, device: fresh).map(\.seq) == Array(1...j.mac.logs(Self.scope, device: fresh).count))
    j.clock.advance(15)
    await relaunched.syncNow()
    try j.mac.sync(["app", Self.scope])
    #expect(try j.mac.store("app")["dev:\(j.device)"] == nil)
    #expect(try j.mac.store(Self.scope)["tabs:\(j.device)"] == nil)
    await relaunched.stopSyncing()
  }

  @Test func aStateThatCantBeReadRightNowIsNeverOverwritten() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    await j.service.close()
    let file = stateFile(j.sandbox)
    let before = try Data(contentsOf: file)
    try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: file.path)

    let relaunched = makeService(j.sandbox, source: j.source, clock: j.clock)
    relaunched.start()
    await relaunched.syncNow()
    #expect(relaunched.phase != .updated)
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
    #expect(try Data(contentsOf: file) == before)

    await relaunched.syncNow()
    #expect(relaunched.phase == .updated)
    #expect(relaunched.snapshot.devices.first { $0.isCurrent }?.id == j.device)
    await relaunched.stopSyncing()
  }

  @Test func thereIsOnlyEverOneEngineForADevice() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    _ = try FakeMac(folder: sandbox.folder, entropy: entropy)
    let (grant, _) = try SyncFolderAccess.grant(picked: sandbox.folder)
    let first = try SyncEngine(directory: sandbox.state, deviceId: "onlyone00000000000000000000", entropy: entropy, folder: grant)
    #expect(throws: SyncError.self) {
      _ = try SyncEngine(directory: sandbox.state, deviceId: "onlyone00000000000000000000", entropy: entropy, folder: grant)
    }
    _ = first
  }

  @Test func aMissingChainNeedsTwoListingsAMinuteApartAndTheKeyStaysUntilTheResetIsSeen() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    try FileManager.default.removeItem(at: j.mac.vault.chainURL)
    try FileManager.default.createDirectory(at: j.sandbox.folder.appendingPathComponent(String(repeating: "b", count: 26)), withIntermediateDirectories: true)

    await j.service.syncNow()
    #expect(j.service.phase != .reset)
    #expect(!j.sandbox.contents(j.sandbox.keys).isEmpty)
    j.clock.advance(20)
    await j.service.syncNow()
    #expect(j.service.phase != .reset)
    j.clock.advance(45)
    await j.service.syncNow()
    #expect(j.service.phase == .reset)
    #expect(!j.sandbox.contents(j.sandbox.keys).isEmpty)
    #expect(j.sandbox.contents(j.sandbox.state).contains { $0.hasPrefix("sync-state.") && $0 != "sync-state.nns" })
    j.service.acknowledgeReset()
    #expect(j.service.phase == .off)
    #expect(j.sandbox.contents(j.sandbox.keys).isEmpty)
  }

  @Test func aCoordinatedReadThatNeverFinishesEndsTheCycleAsOffline() async throws {
    let j = try await joined(timeout: 0.3)
    defer { j.sandbox.remove() }
    let scopeFolder = j.mac.scopeFolder(Self.scope)
    let held = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    Thread.detachNewThread {
      NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: scopeFolder, options: .forReplacing, error: nil) { _ in
        held.signal()
        _ = release.wait(timeout: .now() + 10)
      }
    }
    await withCheckedContinuation { continuation in
      DispatchQueue.global().async {
        held.wait()
        continuation.resume()
      }
    }
    let started = Date.now
    await j.service.syncNow()
    #expect(Date.now.timeIntervalSince(started) < 3)
    #expect(j.service.phase == .offline)
    release.signal()
    await j.service.syncNow()
    #expect(j.service.phase == .updated)
    await j.service.stopSyncing()
  }

  @Test func changingTheFolderKeepsOneEngineAndEverySeqIsWrittenOnce() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    #expect(await j.service.changeFolder(j.sandbox.root) == .connected)
    #expect(await j.service.addBookmark(url: URL(string: "https://moved.example/")!, title: "Moved"))
    j.source.tabs.append(LocalTabRecord(url: "https://second.example/", title: "Second", lastActive: .now, profileSyncId: nil))
    j.service.localDidChange()
    await j.service.syncNow()
    #expect(j.service.phase == .updated)
    let seqs = j.mac.logs(Self.scope, device: j.device).map(\.seq)
    #expect(seqs == Array(1...seqs.count))
    try j.mac.sync([Self.scope])
    #expect(try j.mac.store(Self.scope).values.contains { ($0 as? [String: Any])?["u"] as? String == "https://moved.example/" })
    await j.service.stopSyncing()
  }

  @Test func aMissingFolderStaysOffline() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    try FileManager.default.moveItem(at: j.sandbox.folder, to: j.sandbox.root.appendingPathComponent("Away", isDirectory: true))
    for _ in 0..<3 {
      j.clock.advance(120)
      await j.service.syncNow()
      #expect(j.service.phase == .offline)
    }
    #expect(!j.sandbox.contents(j.sandbox.keys).isEmpty)
  }

  @Test func aChainDeletedFromItsOwnFolderIsAResetAndRejoiningRepublishes() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    try FileManager.default.removeItem(at: j.mac.vault.chainURL)
    #expect(j.sandbox.contents(j.sandbox.folder).isEmpty)
    await j.service.syncNow()
    #expect(j.service.phase == .offline)
    j.clock.advance(61)
    await j.service.syncNow()
    #expect(j.service.phase == .reset)
    j.service.acknowledgeReset()

    let mac = try SyncEndToEndTests().seededMac(j.sandbox, entropy: j.entropy)
    #expect(await j.service.connect(phrase: RecoveryPhrase.words(for: j.entropy).joined(separator: " "), folder: j.sandbox.root) == .connected)
    await j.service.syncNow()
    let device = try #require(j.service.snapshot.devices.first { $0.isCurrent }).id
    #expect(device != j.device)
    try mac.sync(["app", Self.scope])
    #expect(try mac.store("app")["dev:\(device)"] != nil)
    #expect(try mac.store(Self.scope)["tabs:\(device)"] != nil)
    await j.service.stopSyncing()
  }

  @Test func aMissingChainStreakEndsWhenTheFolderGoesAway() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    try FileManager.default.removeItem(at: j.mac.vault.chainURL)
    await j.service.syncNow()
    let away = j.sandbox.root.appendingPathComponent("Away", isDirectory: true)
    try FileManager.default.moveItem(at: j.sandbox.folder, to: away)
    j.clock.advance(30)
    await j.service.syncNow()
    try FileManager.default.moveItem(at: away, to: j.sandbox.folder)
    j.clock.advance(31)
    await j.service.syncNow()
    #expect(j.service.phase == .offline)
  }

  @Test func aRetiredEngineRefusesEverythingAndWritesNothing() async throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    _ = try SyncEndToEndTests().seededMac(sandbox, entropy: entropy)
    let (grant, _) = try SyncFolderAccess.grant(picked: sandbox.folder)
    try SyncEngine.prepareFresh(directory: sandbox.state, deviceId: "retired0000000000000000000", ghosts: [])
    let engine = try SyncEngine(directory: sandbox.state, deviceId: "retired0000000000000000000", entropy: entropy, folder: grant)
    let local = LocalBrowsing(deviceName: "iPhone", tabs: [], visits: nil)
    _ = try await engine.cycle(local)
    try await engine.stop(local)
    #expect(sandbox.contents(sandbox.state).filter { $0.hasSuffix(".nns") }.isEmpty)
    await #expect(throws: SyncError.retired) { try await engine.cycle(local) }
    await #expect(throws: SyncError.retired) { try await engine.acknowledge([ReceivedTab(key: "send:x", url: "https://x.example/", title: "", fromDevice: "", sentAt: .now, profileSyncId: "p")]) }
    #expect(sandbox.contents(sandbox.state).filter { $0.hasSuffix(".nns") }.isEmpty)
  }

  @Test func aKeychainFailureWhileStartingOverNeverReusesTheOldId() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    await j.service.close()
    try Data(repeating: 9, count: 4096).write(to: stateFile(j.sandbox))
    try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: j.sandbox.keys.path)
    let failing = makeService(j.sandbox, source: j.source, clock: j.clock)
    failing.start()
    await failing.syncNow()
    #expect(failing.phase != .updated)
    await failing.close()
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: j.sandbox.keys.path)

    let relaunched = makeService(j.sandbox, source: j.source, clock: j.clock)
    relaunched.start()
    await relaunched.syncNow()
    #expect(relaunched.phase == .updated)
    #expect(relaunched.snapshot.devices.first { $0.isCurrent }?.id != j.device)
    let seqs = j.mac.logs(Self.scope, device: j.device).map(\.seq)
    #expect(seqs == Array(Set(seqs)).sorted())
    await relaunched.stopSyncing()
  }

  @Test func aStateThatVanishedStartsOverUnderANewId() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    await j.service.close()
    try FileManager.default.removeItem(at: stateFile(j.sandbox))
    let relaunched = makeService(j.sandbox, source: j.source, clock: j.clock)
    relaunched.start()
    await relaunched.syncNow()
    #expect(relaunched.phase == .updated)
    #expect(relaunched.snapshot.devices.first { $0.isCurrent }?.id != j.device)
    #expect(j.mac.logs(Self.scope, device: j.device).map(\.seq) == [1])
    await relaunched.stopSyncing()
  }

  @Test func connectingWhileAStopIsRunningIsRefused() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    let service = j.service
    let stopped = Task { await service.stopSyncing() }
    let result = await service.connect(phrase: RecoveryPhrase.words(for: j.entropy).joined(separator: " "), folder: j.sandbox.root)
    await stopped.value
    #expect(result == .busy)
    #expect(j.service.phase == .off)
    #expect(j.sandbox.contents(j.sandbox.keys).isEmpty)
  }

  @Test func aMacDeletionRemovesVisitsWithNoProfileTooAndIsReportedUntilRemoved() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    let url = "https://gone.example/"
    j.source.visits = [LocalVisitRecord(url: url, title: "Gone", visitedAt: [j.clock.now], profileSyncId: nil)]
    j.service.localDidChange()
    await j.service.syncNow()
    try j.mac.sync([Self.scope])
    #expect(try j.mac.store(Self.scope)["h:\(url)"] != nil)
    try j.mac.delete(Self.scope, "h:\(url)")
    try j.mac.sync([Self.scope])
    await j.service.syncNow()
    let removals = j.source.removed.filter { $0.urls.contains(url) }
    #expect(removals.map(\.profile) == [SyncEndToEndTests.profile, nil])
    await j.service.syncNow()
    #expect(j.source.removed.filter { $0.urls.contains(url) }.count == 2)
    await j.service.stopSyncing()
  }

  @Test func aVisitThatLostToAConcurrentMacRecordIsFetchedAgainByURL() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    let url = "https://shared.example/"
    let mine = j.clock.now
    j.source.visits = [LocalVisitRecord(url: url, title: "Shared", visitedAt: [mine], profileSyncId: nil)]
    j.service.localDidChange()
    await j.service.syncNow()
    let theirs = Int(mine.addingTimeInterval(20).millisecondsSince1970)
    try j.mac.put(Self.scope, "h:\(url)", #"{"t":"Shared","n":1,"vt":[\#(theirs)]}"#)
    try j.mac.sync([Self.scope])
    j.clock.advance(30)
    await j.service.syncNow()
    #expect(j.source.urlFetches.last == [url])
    try j.mac.sync([Self.scope])
    let record = try #require(try j.mac.store(Self.scope)["h:\(url)"] as? [String: Any])
    #expect((record["vt"] as? [Double])?.contains(mine.millisecondsSince1970) == true)
    await j.service.stopSyncing()
  }

  @Test func stoppingWhileOfflineRetiresTheDeviceOnceTheFolderIsBack() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    let away = j.sandbox.root.appendingPathComponent("Away", isDirectory: true)
    try FileManager.default.moveItem(at: j.sandbox.folder, to: away)
    await j.service.stopSyncing()
    #expect(j.service.phase == .off)
    try FileManager.default.moveItem(at: away, to: j.sandbox.folder)

    let relaunched = makeService(j.sandbox, source: j.source, clock: j.clock)
    relaunched.start()
    await relaunched.syncNow()
    #expect(relaunched.phase == .off)
    try j.mac.sync(["app", Self.scope])
    #expect(try j.mac.store("app")["dev:\(j.device)"] == nil)
    #expect(try j.mac.store(Self.scope)["tabs:\(j.device)"] == nil)
    #expect(j.sandbox.contents(j.sandbox.keys).isEmpty)
  }

  @Test func visitsAreFetchedOnlyAfterALocalChangeAndOnlySinceTheLastPublish() async throws {
    let j = try await joined()
    defer { j.sandbox.remove() }
    let fetches = j.source.visitFetches.count
    for _ in 0..<3 {
      try j.mac.put(Self.scope, "bm:remote\(UUID().uuidString.prefix(4))", #"{"k":"u","p":"other","t":"Remote","u":"https://remote.example/","a":1,"pos":"9"}"#)
      try j.mac.sync([Self.scope])
      j.clock.advance(15)
      await j.service.syncNow()
    }
    #expect(j.source.visitFetches.count == fetches)
    j.clock.advance(15)
    j.source.visits = [LocalVisitRecord(url: "https://visited.example/", title: "Visited", visitedAt: [j.clock.now], profileSyncId: nil)]
    j.service.localDidChange()
    await j.service.syncNow()
    #expect(j.source.visitFetches.count == fetches + 1)
    let since = try #require(j.source.visitFetches.last)
    #expect(j.clock.now.timeIntervalSince(since) < 3600)
    await j.service.stopSyncing()
  }
}
