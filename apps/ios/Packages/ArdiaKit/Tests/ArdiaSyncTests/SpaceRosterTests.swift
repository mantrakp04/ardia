import ArdiaSyncCore
import Foundation
import Testing
@testable import ArdiaSync

@MainActor
@Suite struct SpaceRosterTests {
  static let personal = "personal000000000000000000"
  static let work = "work00000000000000000000000"

  static func profile(_ syncId: String, isDefault: Bool) -> SyncedProfile {
    SyncedProfile(syncId: syncId, name: syncId, color: nil, icon: nil, isDefault: isDefault, theme: nil, deviceTabs: [], pinned: PinnedArea(), bookmarks: [], history: [])
  }

  @Test func aTabWithNoSpaceOrAGoneSpaceBelongsToTheDefault() {
    let roster = SpaceRoster(snapshot: SyncSnapshot(profiles: [Self.profile(Self.work, isDefault: false), Self.profile(Self.personal, isDefault: true)]))
    #expect(roster.ids == [Self.work, Self.personal])
    #expect(roster.space(of: nil) == Self.personal)
    #expect(roster.space(of: "gone") == Self.personal)
    #expect(roster.space(of: Self.work) == Self.work)
    #expect(roster.contains("gone", in: nil))
    #expect(!roster.contains(Self.work, in: Self.personal))
  }

  @Test func withSyncOffEveryTabIsInTheOneUnnamedSpace() {
    let roster = SpaceRoster.unnamed
    #expect(roster.isUnnamed)
    #expect(roster.space(of: nil) == nil)
    #expect(roster.space(of: Self.work) == nil)
    #expect(roster.contains(Self.work, in: Self.personal))
    #expect(roster.cycled(from: nil, by: 1) == nil)
  }

  @Test func cyclingWrapsLikeTheMacsNextAndPreviousSpace() {
    let roster = SpaceRoster(ids: ["a", "b", "c"], defaultId: "a")
    #expect(roster.cycled(from: "a", by: 1) == "b")
    #expect(roster.cycled(from: "c", by: 1) == "a")
    #expect(roster.cycled(from: "a", by: -1) == "c")
    #expect(roster.cycled(from: "gone", by: 1) == "b")
    #expect(SpaceRoster(ids: ["a"], defaultId: "a").cycled(from: "a", by: 1) == nil)
  }

  @Test(arguments: [true, false])
  func thePhoneFilesEachTabUnderTheSameSpaceTheSyncCyclePublishesItIn(markerOnPersonal: Bool) async throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    let mac = try FakeMac(folder: sandbox.folder, entropy: entropy)
    try mac.put("app", "dev:\(mac.device)", #"{"n":"MacBook Pro"}"#)
    try mac.put("app", "prof:\(Self.personal)", #"{"n":"Personal","c":"blue","i":null,"d":\#(markerOnPersonal)}"#)
    try mac.put("app", "prof:\(Self.work)", #"{"n":"Work","c":"green","i":"symbol:briefcase.fill"}"#)
    try mac.sync(["app"])
    let source = FakeSource()
    let spaces: [String?] = [nil, Self.work, Self.personal, "gone0000000000000000000000"]
    source.tabs = spaces.enumerated().map { index, space in
      LocalTabRecord(url: "https://tab\(index).example/", title: "Tab \(index)", lastActive: .now, profileSyncId: space)
    }
    let service = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys))
    service.source = source
    let kit = RecoveryPhrase.words(for: entropy).enumerated().map { "\($0.offset + 1). \($0.element.uppercased())" }.joined(separator: "\n")
    #expect(await service.connect(phrase: kit, folder: sandbox.root) == .connected)
    await service.syncNow()
    let me = try #require(service.snapshot.devices.first { $0.isCurrent })
    try mac.sync(["app", "p:\(Self.personal)", "p:\(Self.work)"])

    var published: [String: String] = [:]
    for scope in [Self.personal, Self.work] {
      let record = try mac.store("p:\(scope)")["tabs:\(me.id)"] as? [String: Any]
      for tab in record?["tabs"] as? [[String: Any]] ?? [] {
        if let url = tab["u"] as? String { published[url] = scope }
      }
    }
    let roster = SpaceRoster(snapshot: service.snapshot)
    #expect(roster.defaultId == (markerOnPersonal ? Self.personal : roster.ids.sorted().first))
    for (index, space) in spaces.enumerated() {
      #expect(published["https://tab\(index).example/"] == roster.space(of: space), "tab \(index) in \(space ?? "no space")")
    }
  }
}
