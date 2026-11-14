import ArdiaSyncCore
import Foundation
import Testing
@testable import ArdiaSync

@MainActor
@Suite struct SyncThroughICloudTests {
  static let profile = SyncEndToEndTests.profile
  static let scope = SyncEndToEndTests.scope

  struct Pair {
    let sandbox: Sandbox
    let cloud: FakeICloud
    let mac: FakeMac
    let source: FakeSource
    let service: SyncService
    let phrase: String
    let clock: TestClock
  }

  func pair(seed: UInt64) throws -> Pair {
    let sandbox = try Sandbox()
    let cloud = try FakeICloud(root: sandbox.root, seed: seed)
    let entropy = RecoveryPhrase.generateEntropy()
    let clock = TestClock()
    let mac = try FakeMac(folder: cloud.macFolder, entropy: entropy)
    mac.clock = clock
    try mac.put("app", "dev:\(mac.device)", #"{"n":"MacBook Pro","k":"mac","f":["send"]}"#)
    try mac.put("app", "prof:\(Self.profile)", #"{"n":"Personal","c":"blue","i":null,"d":true}"#)
    try mac.put(Self.scope, "tabs:\(mac.device)", #"{"n":"MacBook Pro","tabs":[{"u":"https://news.example/","t":"News"}]}"#)
    try mac.put(Self.scope, "bm:docs", #"{"k":"u","p":"bar","t":"Docs","u":"https://docs.example/","a":1,"pos":"1"}"#)
    try mac.sync(["app", Self.scope])
    let source = FakeSource()
    let service = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), now: { clock.now })
    service.source = source
    return Pair(sandbox: sandbox, cloud: cloud, mac: mac, source: source, service: service, phrase: RecoveryPhrase.words(for: entropy).joined(separator: " "), clock: clock)
  }

  static func titles(_ items: [BookmarkItem]) -> Set<String> {
    Set(items.flatMap { [$0.title] + Array(titles($0.children ?? [])) })
  }

  func phoneBookmarks(_ pair: Pair) -> Set<String> {
    Self.titles(pair.service.snapshot.defaultProfile?.bookmarks ?? []).subtracting(["Bookmarks Bar", "Other Bookmarks"])
  }

  func macBookmarks(_ pair: Pair) throws -> Set<String> {
    Set(try pair.mac.store(Self.scope).filter { $0.key.hasPrefix("bm:") }.compactMap { ($0.value as? [String: Any])?["t"] as? String })
  }

  @Test func filesThatArriveAsPlaceholdersWaitAndThenApply() async throws {
    let pair = try pair(seed: 1)
    defer { pair.sandbox.remove() }
    pair.source.tabs = [LocalTabRecord(url: "https://phone.example/", title: "On the phone", lastActive: .now, profileSyncId: nil)]
    pair.cloud.deliver(asPlaceholders: 1)
    #expect(await pair.service.connect(phrase: pair.phrase, folder: pair.cloud.phoneFolder) == .connected)
    await pair.service.syncNow()
    #expect(pair.service.pendingDownloads > 0)
    #expect(pair.service.statusText.contains("Waiting"))
    #expect(phoneBookmarks(pair).isEmpty)

    pair.cloud.deliver()
    await pair.service.syncNow()
    #expect(pair.service.phase == .updated)
    #expect(pair.service.pendingDownloads == 0)
    #expect(phoneBookmarks(pair) == ["Docs"])
    #expect(pair.service.snapshot.defaultProfile?.deviceTabs.first?.tabs.map(\.url) == ["https://news.example/"])

    pair.cloud.deliver(asPlaceholders: 1)
    try pair.mac.sync(["app", Self.scope])
    let me = try #require(pair.service.snapshot.devices.first { $0.isCurrent })
    #expect(try pair.mac.store(Self.scope)["tabs:\(me.id)"] == nil)
    pair.cloud.deliver()
    try pair.mac.sync(["app", Self.scope])
    let tabs = try #require(try pair.mac.store(Self.scope)["tabs:\(me.id)"] as? [String: Any])
    #expect((tabs["tabs"] as? [[String: String]])?.map { $0["u"] } == ["https://phone.example/"])
    await pair.service.stopSyncing()
  }

  @Test func conflictCopiesAndStrayFilesAreIgnored() async throws {
    let pair = try pair(seed: 2)
    defer { pair.sandbox.remove() }
    pair.cloud.deliverEverything()
    #expect(await pair.service.connect(phrase: pair.phrase, folder: pair.cloud.phoneFolder) == .connected)
    await pair.service.syncNow()
    #expect(phoneBookmarks(pair) == ["Docs"])

    try pair.mac.put(Self.scope, "bm:late", #"{"k":"u","p":"bar","t":"Late","u":"https://late.example/","a":2,"pos":"2"}"#)
    try pair.mac.sync([Self.scope])
    pair.cloud.deliverEverything()
    let scopeDirectory = pair.mac.scopeFolder(Self.scope).path.replacingOccurrences(of: pair.cloud.macFolder.path + "/", with: "")
    try pair.cloud.makeConflictCopies(in: scopeDirectory)
    let chainDirectory = (scopeDirectory as NSString).deletingLastPathComponent
    try FileManager.default.copyItem(
      at: pair.cloud.phoneFolder.appendingPathComponent(scopeDirectory),
      to: pair.cloud.phoneFolder.appendingPathComponent("\(scopeDirectory) 2")
    )
    try FileManager.default.createDirectory(at: pair.cloud.phoneFolder.appendingPathComponent("\(chainDirectory) 2"), withIntermediateDirectories: true)

    await pair.service.syncNow()
    await pair.service.syncNow()
    #expect(pair.service.phase == .updated)
    #expect(pair.service.pendingDownloads == 0)
    #expect(phoneBookmarks(pair) == ["Docs", "Late"])
    #expect(pair.service.snapshot.defaultProfile?.bookmarks.filter { $0.title == "Late" }.count == 1)

    try pair.mac.put(Self.scope, "bm:after", #"{"k":"u","p":"bar","t":"After","u":"https://after.example/","a":3,"pos":"3"}"#)
    try pair.mac.sync([Self.scope])
    pair.cloud.deliverEverything()
    await pair.service.syncNow()
    #expect(phoneBookmarks(pair) == ["Docs", "Late", "After"])
    await pair.service.stopSyncing()
  }

  @Test func randomDeliveryOrdersDelaysAndCompactionsConverge() async throws {
    for seed: UInt64 in [11, 23, 37] {
      try await soak(seed: seed)
    }
  }

  func soak(seed: UInt64) async throws {
    let pair = try pair(seed: seed)
    defer { pair.sandbox.remove() }
    var random = SeededRandom(seed: seed &* 7919)
    pair.cloud.deliverEverything()
    #expect(await pair.service.connect(phrase: pair.phrase, folder: pair.cloud.phoneFolder) == .connected)
    await pair.service.syncNow()
    pair.cloud.deliverEverything()
    try pair.mac.sync(["app", Self.scope])
    let me = try #require(pair.service.snapshot.devices.first { $0.isCurrent })

    var alive: Set<String> = ["Docs"]
    var nextBookmark = 0
    var sentToPhone: Set<String> = []
    var sentToMac: Set<String> = []
    var phoneTabs: [String] = []
    var seenOnPhone: Set<String> = []
    var lostOnPhone: [String] = []

    for round in 0..<70 {
      pair.clock.advance(180)
      if random.chance(0.7) {
        nextBookmark += 1
        let title = "B\(nextBookmark)"
        try pair.mac.put(Self.scope, "bm:\(title)", #"{"k":"u","p":"bar","t":"\#(title)","u":"https://\#(title.lowercased()).example/","a":\#(nextBookmark + 1),"pos":"\#(nextBookmark + 1)"}"#)
        alive.insert(title)
      }
      if random.chance(0.25), let doomed = alive.filter({ $0 != "Docs" }).sorted().randomElement(using: &random) {
        try pair.mac.delete(Self.scope, "bm:\(doomed)")
        alive.remove(doomed)
        seenOnPhone.remove(doomed)
      }
      if random.chance(0.15) {
        let url = "https://to-phone-\(round).example/"
        let id = UUID().uuidString.lowercased()
        try pair.mac.put(Self.scope, "send:\(id)", #"{"u":"\#(url)","t":"Sent \#(round)","to":"\#(me.id)","from":"\#(pair.mac.device)","at":\#(Int(pair.clock.now.millisecondsSince1970))}"#)
        sentToPhone.insert(url)
      }
      if random.chance(0.6) { try pair.mac.sync(["app", Self.scope]) }

      if random.chance(0.3) {
        phoneTabs = (0..<Int.random(in: 1...3, using: &random)).map { "https://phone-\(round)-\($0).example/" }
        pair.source.tabs = phoneTabs.map { LocalTabRecord(url: $0, title: $0, lastActive: pair.clock.now, profileSyncId: nil) }
      }
      if random.chance(0.1), let target = pair.service.devicesThatReceiveTabs.first {
        let url = "https://to-mac-\(round).example/"
        if await pair.service.send(url: URL(string: url)!, title: "To Mac \(round)", to: target) { sentToMac.insert(url) }
      }
      pair.cloud.deliver(chance: Double.random(in: 0.2...0.9, using: &random), asPlaceholders: Double.random(in: 0...0.5, using: &random))
      if random.chance(0.7) {
        await pair.service.syncNow()
        let now = phoneBookmarks(pair)
        lostOnPhone += seenOnPhone.subtracting(now).filter { alive.contains($0) }.map { "round \(round): \($0)" }
        seenOnPhone.formUnion(now.intersection(alive))
      }
    }

    for _ in 0..<4 {
      pair.clock.advance(60)
      pair.cloud.deliverEverything()
      try pair.mac.sync(["app", Self.scope])
      pair.cloud.deliverEverything()
      await pair.service.syncNow()
    }

    #expect(lostOnPhone.isEmpty, "seed \(seed): a bookmark the Mac still has went away on the phone: \(lostOnPhone)")
    #expect(pair.cloud.deletionsDelivered > 0, "seed \(seed): the soak never compacted")
    #expect(pair.service.phase == .updated, "seed \(seed)")
    #expect(pair.service.pendingDownloads == 0, "seed \(seed)")
    #expect(try macBookmarks(pair) == alive, "seed \(seed)")
    #expect(phoneBookmarks(pair) == alive, "seed \(seed)")
    #expect(Set(pair.source.received.map(\.url)) == sentToPhone, "seed \(seed)")
    #expect(pair.source.received.count == sentToPhone.count, "seed \(seed): a tab sent to the phone arrived twice")
    let macStore = try pair.mac.store(Self.scope)
    #expect(macStore.keys.filter { $0.hasPrefix("send:") }.compactMap { (macStore[$0] as? [String: Any])?["to"] as? String }.allSatisfy { $0 == pair.mac.device }, "seed \(seed): a send to the phone was never cleared")
    let toMac = macStore.filter { $0.key.hasPrefix("send:") }.compactMap { $0.value as? [String: Any] }.filter { $0["to"] as? String == pair.mac.device }
    #expect(Set(toMac.compactMap { $0["u"] as? String }) == sentToMac, "seed \(seed)")
    #expect(toMac.count == sentToMac.count, "seed \(seed)")
    if !phoneTabs.isEmpty {
      let tabs = macStore["tabs:\(me.id)"] as? [String: Any]
      #expect((tabs?["tabs"] as? [[String: String]])?.map { $0["u"] } == phoneTabs, "seed \(seed)")
    }
    let seqs = pair.mac.logs(Self.scope, device: me.id).map(\.seq)
    #expect(Set(seqs).count == seqs.count, "seed \(seed): the phone reused a seq")
    await pair.service.stopSyncing()
  }
}
