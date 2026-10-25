import ArdiaSyncCore
import Foundation
import Testing
@testable import ArdiaSync

@MainActor
@Suite struct SyncEndToEndTests {
  static let profile = "personal000000000000000000"
  static let scope = "p:\(profile)"

  func seededMac(_ sandbox: Sandbox, entropy: Data) throws -> FakeMac {
    let mac = try FakeMac(folder: sandbox.folder, entropy: entropy)
    try mac.put("app", "dev:\(mac.device)", #"{"n":"MacBook Pro"}"#)
    try mac.put("app", "prof:\(Self.profile)", #"{"n":"Personal","c":"blue","i":null,"d":true}"#)
    try mac.put("app", "set:searchEngine", #"{"v":"duckduckgo"}"#)
    try mac.put("app", "set:appearance", #"{"v":"dark"}"#)
    try mac.put(Self.scope, "tabs:\(mac.device)", #"{"n":"MacBook Pro","tabs":[{"u":"https://news.example/","t":"News"},{"u":"https://mail.example/","t":"Mail"}]}"#)
    try mac.put(Self.scope, "pin:t:tile", #"{"g":null,"u":"https://calendar.example/","t":null,"i":null,"ti":"Calendar","pos":"1"}"#)
    try mac.put(Self.scope, "pin:t:row", #"{"g":null,"u":"https://notes.example/","t":"Notes","i":null,"ti":"Notes page","pos":"2"}"#)
    try mac.put(Self.scope, "pinrow:row", "1")
    try mac.put(Self.scope, "pin:g:group", #"{"n":"Trip","i":null,"c":"orange","pos":"3"}"#)
    try mac.put(Self.scope, "pin:t:member", #"{"g":"group","u":"https://flights.example/","t":null,"i":null,"ti":"Flights","pos":"1"}"#)
    try mac.put(Self.scope, "bm:folder", #"{"k":"f","p":"bar","t":"Reading","a":1,"pos":"1"}"#)
    try mac.put(Self.scope, "bm:docs", #"{"k":"u","p":"folder","t":"Docs","u":"https://docs.example/","a":2,"pos":"1"}"#)
    try mac.put(Self.scope, "pw:https://bank.example\nluke", #"{"o":"https://bank.example","u":"luke","p":"hunter2"}"#)
    let visit = Date.now.addingTimeInterval(-3600).millisecondsSince1970
    try mac.put(Self.scope, "h:https://read.example/", #"{"t":"Reading","n":1,"vt":[\#(Int(visit))]}"#)
    try mac.sync(["app", Self.scope])
    return mac
  }

  func service(_ sandbox: Sandbox, source: FakeSource) -> SyncService {
    let service = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys))
    service.source = source
    return service
  }

  @Test func wrongPhrasesAreRejectedBeforeAnythingIsWritten() async throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    _ = try seededMac(sandbox, entropy: entropy)
    let words = RecoveryPhrase.words(for: entropy)
    let folderBefore = sandbox.contents(sandbox.folder)
    let service = service(sandbox, source: FakeSource())
    var swapped = words
    swapped.swapAt(0, 1)
    if (try? RecoveryPhrase.entropy(from: swapped.joined(separator: " "))) != nil { swapped.swapAt(2, 5) }
    let cases: [(String, ConnectResult)] = [
      (words.dropLast().joined(separator: " "), .invalidPhrase("Recovery phrase must be exactly 24 words.")),
      ((words.dropLast() + ["zzzzzz"]).joined(separator: " "), .invalidPhrase("“zzzzzz” is not a valid recovery phrase word.")),
      (swapped.joined(separator: " "), .invalidPhrase("This recovery phrase is not valid. Please check for typos.")),
      (RecoveryPhrase.words(for: RecoveryPhrase.generateEntropy()).joined(separator: " "), .mismatch),
    ]
    for (phrase, expected) in cases {
      #expect(await service.connect(phrase: phrase, folder: sandbox.root) == expected)
    }
    #expect(service.phase == .off)
    #expect(!service.isEnabled)
    #expect(sandbox.contents(sandbox.folder) == folderBefore)
    #expect(sandbox.contents(sandbox.keys).isEmpty)
    #expect(sandbox.contents(sandbox.state).isEmpty)

    let empty = sandbox.root.appendingPathComponent("Empty", isDirectory: true)
    try FileManager.default.createDirectory(at: empty, withIntermediateDirectories: true)
    #expect(await service.connect(phrase: words.joined(separator: " "), folder: empty) == .noSyncData)
    #expect(sandbox.contents(sandbox.keys).isEmpty)
  }

  @Test func theIPhoneJoinsSeesTheMacAndTheMacSeesTheIPhone() async throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    let mac = try seededMac(sandbox, entropy: entropy)
    let source = FakeSource()
    source.tabs = [LocalTabRecord(url: "https://phone.example/", title: "On the phone", lastActive: .now, profileSyncId: nil)]
    let service = service(sandbox, source: source)
    let kit = RecoveryPhrase.words(for: entropy).enumerated().map { "\($0.offset + 1). \($0.element.uppercased())" }.joined(separator: "\n")
    #expect(service.check(phrase: kit).isValid)

    #expect(await service.connect(phrase: kit, folder: sandbox.root) == .connected)
    await service.syncNow()
    #expect(service.phase == .updated)
    #expect(service.statusText == "Updated just now")
    #expect(service.folderName == "Ardia Sync")
    let profile = try #require(service.snapshot.defaultProfile)
    #expect(profile.name == "Personal")
    #expect(profile.deviceTabs.map(\.deviceName) == ["MacBook Pro"])
    #expect(profile.deviceTabs.first?.tabs.map(\.url) == ["https://news.example/", "https://mail.example/"])
    #expect(profile.pinned.tiles.map(\.title) == ["Calendar"])
    #expect(profile.pinned.sections.map(\.id) == ["t:row", "g:group"])
    #expect(profile.bookmarks.first?.children?.map(\.title) == ["Docs"])
    #expect(profile.history.map(\.url) == ["https://read.example/"])
    #expect(service.snapshot.search?.engineId == "duckduckgo")
    let me = try #require(service.snapshot.devices.first { $0.isCurrent })
    #expect(me.kind == .phone)
    #expect(service.devicesThatReceiveTabs.isEmpty)

    try mac.sync(["app", Self.scope])
    #expect((try mac.store("app")["dev:\(me.id)"] as? [String: Any])?["k"] as? String == "phone")
    let tabs = try #require(try mac.store(Self.scope)["tabs:\(me.id)"] as? [String: Any])
    #expect((tabs["tabs"] as? [[String: String]])?.map { $0["u"] } == ["https://phone.example/"])

    try mac.put(Self.scope, "send:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", #"{"u":"https://sent.example/","t":"Sent","to":"\#(me.id)","from":"\#(mac.device)","at":\#(Int(Date.now.millisecondsSince1970))}"#)
    try mac.sync([Self.scope])
    await service.syncNow()
    await service.syncNow()
    #expect(source.received.map(\.url) == ["https://sent.example/"])
    #expect(source.received.first?.fromDevice == "MacBook Pro")
    try mac.sync([Self.scope])
    #expect(try mac.store(Self.scope)["send:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] == nil)

    try mac.put("app", "dev:\(mac.device)", #"{"n":"MacBook Pro","k":"mac","f":["send"]}"#)
    try mac.sync(["app"])
    await service.syncNow()
    let target = try #require(service.devicesThatReceiveTabs.first)
    #expect(await service.send(url: URL(string: "https://to-mac.example/")!, title: "To Mac", to: target))
    await service.syncNow()
    try mac.sync([Self.scope])
    let sent = try mac.store(Self.scope).filter { $0.key.hasPrefix("send:") }.compactMap { $0.value as? [String: Any] }
    #expect(sent.map { $0["u"] as? String } == ["https://to-mac.example/"])
    #expect(sent.first?["to"] as? String == mac.device)

    await service.stopSyncing()
    #expect(service.phase == .off)
    #expect(sandbox.contents(sandbox.keys).isEmpty)
    try mac.sync(["app", Self.scope])
    #expect(try mac.store("app")["dev:\(me.id)"] == nil)
    #expect(try mac.store(Self.scope)["tabs:\(me.id)"] == nil)
    #expect(try mac.store(Self.scope)["bm:docs"] != nil)
    #expect(try mac.store(Self.scope)["pw:https://bank.example\nluke"] != nil)
  }

  @Test func damagedAndHalfWrittenFilesAreNotApplied() async throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    let mac = try seededMac(sandbox, entropy: entropy)
    let service = service(sandbox, source: FakeSource())
    #expect(await service.connect(phrase: RecoveryPhrase.words(for: entropy).joined(separator: " "), folder: sandbox.folder) == .connected)
    await service.syncNow()

    let scopeFolder = mac.scopeFolder(Self.scope)
    let before = Set(sandbox.contents(scopeFolder))
    try mac.put(Self.scope, "bm:late", #"{"k":"u","p":"other","t":"Late","u":"https://late.example/","a":3,"pos":"5"}"#)
    try mac.sync([Self.scope])
    let added = try #require(Set(sandbox.contents(scopeFolder)).subtracting(before).first)
    let file = scopeFolder.appendingPathComponent(added)
    let whole = try Data(contentsOf: file)
    try whole.prefix(whole.count / 2).write(to: file)
    try Data(repeating: 7, count: 2048).write(to: scopeFolder.appendingPathComponent("\(String(repeating: "a", count: 26)).nns"))

    await service.syncNow()
    #expect(service.phase == .updated)
    #expect(!(service.snapshot.defaultProfile?.bookmarks.contains { $0.title == "Late" } ?? true))

    try whole.write(to: file)
    await service.syncNow()
    #expect(service.snapshot.defaultProfile?.bookmarks.contains { $0.title == "Late" } == true)
    await service.stopSyncing()
  }

  @Test func stateSurvivesARelaunchAndACrashedWriteWithNoSeqReused() async throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    let mac = try seededMac(sandbox, entropy: entropy)
    let source = FakeSource()
    source.tabs = [LocalTabRecord(url: "https://one.example/", title: "One", lastActive: .now, profileSyncId: nil)]
    let first = service(sandbox, source: source)
    #expect(await first.connect(phrase: RecoveryPhrase.words(for: entropy).joined(separator: " "), folder: sandbox.root) == .connected)
    await first.syncNow()
    let me = try #require(first.snapshot.devices.first { $0.isCurrent }).id
    first.appWillResignActive()

    let scopeFolder = mac.scopeFolder(Self.scope)
    try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: scopeFolder.path)
    source.tabs.append(LocalTabRecord(url: "https://two.example/", title: "Two", lastActive: .now, profileSyncId: nil))
    await first.syncNow()
    if case .stalled = first.phase {} else { Issue.record("a failed write should stall, not report updated") }
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scopeFolder.path)
    #expect(sandbox.contents(sandbox.state).contains("sync-journal.nns"))

    let relaunched = service(sandbox, source: source)
    relaunched.start()
    await relaunched.syncNow()
    #expect(relaunched.phase == .updated)
    #expect(relaunched.snapshot.defaultProfile?.name == "Personal")
    source.tabs.append(LocalTabRecord(url: "https://three.example/", title: "Three", lastActive: .now, profileSyncId: nil))
    relaunched.localDidChange()
    await relaunched.syncNow()

    let logs = mac.logs(Self.scope, device: me)
    #expect(logs.map(\.seq) == Array(1...logs.count))
    #expect(logs.count == 3)
    #expect(logs[1].json.contains("two.example") && !logs[1].json.contains("three.example"))
    #expect(!sandbox.contents(sandbox.state).contains("sync-journal.nns"))
    await relaunched.stopSyncing()
  }

  @Test func waitingTextCountsFiles() {
    #expect(SyncService.waitingForDownloads(1) == "Waiting for 1 file to download")
    #expect(SyncService.waitingForDownloads(3) == "Waiting for 3 files to download")
  }
}
