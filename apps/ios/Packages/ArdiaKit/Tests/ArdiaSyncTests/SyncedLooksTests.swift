import ArdiaSyncCore
import Foundation
import Testing
@testable import ArdiaSync

@Suite struct SyncedLooksTests {
  static let cachedBeforeLooks = #"""
  {"devices":[{"id":"mac","name":"MacBook Pro","kind":"mac","lastSeen":1790000000000,"isCurrent":false,"canReceiveTabs":true},{"id":"me","name":"iPhone","kind":"phone","isCurrent":true,"canReceiveTabs":true}],"profiles":[{"syncId":"p1","name":"Work","color":"green","icon":"briefcase","isDefault":true,"theme":{"colors":["#4F7CFF","#9B6BFF"],"darkColors":["#1E2A5A","#3A2466"]},"deviceTabs":[{"deviceId":"mac","deviceName":"MacBook Pro","kind":"mac","tabs":[{"url":"https://a.example/","title":"A"}]}],"pinned":{"tiles":[],"sections":[]},"bookmarks":[],"history":[],"sendTargets":["mac"]}],"search":{"engineId":"google","customEngines":[]},"syncedAt":1790000000000}
  """#

  static let viewWithLooks = #"""
  {"devices":[{"id":"ipad","name":"iPad","kind":"tablet","lastSeen":null,"isCurrent":true,"canReceiveTabs":true},{"id":"watch","name":"Watch","kind":"watch","lastSeen":null,"isCurrent":false,"canReceiveTabs":false}],
   "profiles":[{"syncId":"p1","name":"Work","color":"green","icon":"symbol:briefcase.fill","isDefault":true,
     "theme":{"colors":["#3366E6","#FF0080CC"],"darkColors":["#1A1A33"],"mode":"dark",
       "light":{"stops":[{"r":0.2,"g":0.4,"b":0.9,"a":1,"x":0.1,"y":0.9},{"r":1.2,"g":-0.1,"b":0.5,"a":0.8,"x":1,"y":0.5}],"intensity":1,"grain":0.35,"texture":"tweed","translucency":0.25,"angle":270},
       "dark":{"stops":[{"r":0.1,"g":0.1,"b":0.2,"a":1,"x":0.5,"y":0.5}],"intensity":0.3,"grain":0,"texture":"velvet","translucency":0,"angle":5}},
     "sendTargets":[],"deviceTabs":[],"pinned":{"tiles":[],"sections":[]},"bookmarks":[],"history":[]}],
   "search":null,
   "lookSettings":{"appearance":"dark","interfaceStyle":"classic","glassTintWithTheme":true,"glassTintAmount":0.4,"selectedTabGlow":"sparkle","pageFrame":6,"sidebarSide":"right","profileSwitcherIcons":null}}
  """#

  @Test func `a snapshot cached before themes and look settings synced still decodes, with the new values absent`() throws {
    let snapshot = try SyncEngine.decoder.decode(SyncSnapshot.self, from: Data(Self.cachedBeforeLooks.utf8))
    #expect(snapshot.profiles.first?.theme == SyncedTheme(colors: ["#4F7CFF", "#9B6BFF"], darkColors: ["#1E2A5A", "#3A2466"]))
    #expect(snapshot.profiles.first?.theme?.light == nil)
    #expect(snapshot.lookSettings == nil)
    #expect(snapshot.devices.map(\.kind) == [.mac, .phone])
  }

  @Test func `the engine's own cache read keeps a snapshot written before this version`() async throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    _ = try FakeMac(folder: sandbox.folder, entropy: entropy)
    let (grant, _) = try SyncFolderAccess.grant(picked: sandbox.folder)
    let files = SyncFiles(directory: sandbox.state)
    try FileManager.default.createDirectory(at: sandbox.state, withIntermediateDirectories: true)
    try files.writeSealed(Data(Self.cachedBeforeLooks.utf8), to: files.snapshotURL, keys: SyncKeys(entropy: entropy), fileId: SyncFiles.snapshotFile)
    let engine = try SyncEngine(directory: sandbox.state, deviceId: "cached00000000000000000000", entropy: entropy, folder: grant)
    let cached = try #require(await engine.cachedSnapshot())
    #expect(cached.profiles.map(\.name) == ["Work"])
  }

  @Test func `the whole theme, look settings and a tablet arrive, and a value this build doesn't know drops only itself`() throws {
    let snapshot = try SyncEngine.decoder.decode(SyncSnapshot.self, from: Data(Self.viewWithLooks.utf8))
    #expect(snapshot.devices.map(\.kind) == [.tablet, .mac])
    let theme = try #require(snapshot.profiles.first?.theme)
    #expect(theme.mode == .dark)
    #expect(theme.light?.stops.map(\.alpha) == [1, 0.8])
    #expect(theme.light?.stops.map(\.x) == [0.1, 1])
    #expect(theme.light?.stops.first?.red == 0.2)
    #expect(theme.light?.texture == .tweed)
    #expect(theme.light?.angle == 270)
    #expect(theme.light?.translucency == 0.25)
    #expect(theme.dark?.texture == .grain)
    #expect(theme.dark?.angle == 5)
    let settings = try #require(snapshot.lookSettings)
    #expect(settings.appearance == .dark)
    #expect(settings.interfaceStyle == .classic)
    #expect(settings.glassTintWithTheme == true)
    #expect(settings.glassTintAmount == 0.4)
    #expect(settings.selectedTabGlow == nil)
    #expect(settings.pageFrame == 6)
    #expect(settings.sidebarSide == .right)
    #expect(settings.profileSwitcherIcons == nil)
    let again = try SyncEngine.decoder.decode(SyncSnapshot.self, from: SyncEngine.encoder.encode(snapshot))
    #expect(again == snapshot)
  }

  @Test func `icons read the Mac's wire format: an SF Symbol, an emoji, or the name's first letter`() {
    #expect(SyncedIcon(wire: "symbol:briefcase.fill") == .symbol("briefcase.fill"))
    #expect(SyncedIcon(wire: "🎓") == .emoji("🎓"))
    #expect(SyncedIcon(wire: nil) == nil)
    #expect(SyncedIcon(wire: "") == nil)
    #expect(SyncedIcon(wire: "symbol:") == nil)
    #expect(SyncedIcon.badge(wire: nil, name: "  work") == .initial("W"))
    #expect(SyncedIcon.badge(wire: nil, name: "école") == .initial("É"))
    #expect(SyncedIcon.badge(wire: nil, name: "   ") == .initial("?"))
    #expect(SyncedIcon.badge(wire: "symbol:house.fill", name: "Home") == .symbol("house.fill"))
    let profile = SyncedProfile(syncId: "p", name: "Side", color: nil, icon: "🚀", isDefault: false, theme: nil, deviceTabs: [], pinned: PinnedArea(), bookmarks: [], history: [])
    #expect(profile.badge == .emoji("🚀"))
    #expect(PinnedTab(key: "t", title: "Notes", url: "https://n.example/", icon: "symbol:note.text").mark == .symbol("note.text"))
    #expect(PinnedGroup(key: "g", name: "Trip", icon: nil, color: nil, items: []).mark == nil)
    #expect(PinnedTile(key: "t", title: "Mail", url: "https://m.example/", icon: "✉️", folder: nil).mark == .emoji("✉️"))
  }

  @Test func `the demo snapshot uses the Mac's wire format for icons`() {
    let icons = SyncSnapshot.demo.profiles.compactMap(\.icon)
    #expect(!icons.isEmpty)
    #expect(icons.allSatisfy { $0.hasPrefix("symbol:") || $0.unicodeScalars.first?.properties.isEmoji == true })
    let work = SyncSnapshot.demo.profiles.first { $0.name == "Work" }
    #expect(work?.badge == .symbol("briefcase.fill"))
    #expect(work?.theme?.light != nil)
  }
}
