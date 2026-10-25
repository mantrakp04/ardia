import Foundation
import XCTest
@testable import ArdiaImportCore

final class ZenTests: XCTestCase {
  let main = "Profiles/zen12345.Default (release)"

  func profile(_ id: String) -> URL { Fixtures.support("zen").appendingPathComponent(id) }

  func titles(_ nodes: [BookmarkNode]) -> [String] {
    nodes.map { $0.type == .url ? $0.title : "\($0.title)[\(titles($0.children ?? []).joined(separator: ", "))]" }
  }

  func testDiscoveryListsZenWithItsSpaces() throws {
    let zen = try XCTUnwrap(Fixtures.discovery().list().first { $0.id == "zen" })
    XCTAssertEqual(zen.family, .firefox)
    XCTAssertEqual(zen.sidebar, .zen)
    XCTAssertFalse(zen.needsKeychain)
    XCTAssertEqual(zen.profiles.map(\.name), ["Default (release)", "Legacy", "Recovered", "Plain"])
    XCTAssertEqual(zen.profiles.filter(\.isDefault).map(\.id), [main])

    let first = zen.profiles[0]
    XCTAssertEqual(Set(first.available), [.bookmarks, .history, .tabs, .passwords, .cookies, .spaces, .pinnedTabs, .favorites])
    let spaces = try XCTUnwrap(first.spaces)
    XCTAssertEqual(spaces.map(\.name), ["Work", "Space 2"])
    XCTAssertEqual(spaces.map(\.pinnedCount), [5, 2])
    XCTAssertEqual(spaces.map(\.tabCount), [2, 1])
    XCTAssertEqual(spaces[0].emoji, "\u{1F4BC}")
    XCTAssertEqual(spaces[0].color, "#FF0080")
    XCTAssertNil(spaces[1].emoji)
    XCTAssertEqual(spaces[1].color, "#00FF00")

    XCTAssertEqual(zen.profiles[1].spaces?.map(\.name), ["Old"])
    XCTAssertEqual(zen.profiles[2].spaces?.map(\.name), ["Newer"])
    XCTAssertNil(zen.profiles[3].spaces)
    XCTAssertFalse(zen.profiles[3].available.contains(.spaces))
    XCTAssertTrue(zen.profiles[3].available.contains(.tabs))
  }

  func testWorkspacesFoldersAndEssentials() throws {
    let sidebar = try ZenSidebar.load(profile: profile(main), profileId: main)
    let work = sidebar.spaces[0]
    XCTAssertEqual(work.colors, ["#FF0080", "#0A141E"])
    XCTAssertEqual(titles(work.pinned), ["Team chat", "Docs[Nested[Nested page], Left, Right, Doc A]"])
    XCTAssertEqual(work.pinned[0].pageTitle, "Chat")
    XCTAssertEqual(work.tabs.map(\.url), ["https://news.example/", "https://orphan.example/"])
    XCTAssertEqual(work.tabs[0].lastActive, Double(1788220800) * 1000)

    let play = sidebar.spaces[1]
    XCTAssertEqual(titles(play.pinned), ["Play", "Empty[]", "Loop A[Loop, Loop B[]]"])
    XCTAssertEqual(play.pinned[0].url, "https://play.example/")
    XCTAssertEqual(play.tabs.map(\.customTitle), ["Fun"])

    XCTAssertEqual(sidebar.essentials, [ImportedTab(url: "https://mail.example/", title: "Mail", pinned: true)])
    XCTAssertEqual(sidebar.favicons.map(\.page), ["https://chat.example/room", "https://play.example/"])
    XCTAssertEqual(sidebar.favicons[0].icon, "https://chat.example/favicon.ico")
    XCTAssertTrue(try XCTUnwrap(Data(base64Encoded: sidebar.favicons[1].png)).starts(with: ChromiumFavicons.pngSignature))
  }

  func testOlderSessionsAndBackups() throws {
    let legacy = try ZenSidebar.load(profile: profile("Profiles/old00000.Legacy"), profileId: "legacy")
    XCTAssertEqual(legacy.spaces.map(\.name), ["Old"])
    XCTAssertEqual(legacy.spaces[0].emoji, "\u{1F3E0}")
    XCTAssertEqual(titles(legacy.spaces[0].pinned), ["Old pin"])
    XCTAssertEqual(legacy.spaces[0].tabs.map(\.url), ["https://old-open.example/"])

    let recovered = try ZenSidebar.load(profile: profile("Profiles/bak00000.Recovered"), profileId: "recovered")
    XCTAssertEqual(recovered.spaces.map(\.name), ["Newer"])
    XCTAssertEqual(recovered.spaces[0].tabs.map(\.url), ["https://backup.example/"])

    XCTAssertEqual(try ZenSidebar.load(profile: profile("Profiles/pln00000.Plain"), profileId: "plain"), ZenSidebar())
  }

  func testImporterMapsSpacesTabsAndEssentials() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    let all = try importer.importData(browserId: "zen", profileId: main, kinds: [.tabs, .spaces, .pinnedTabs, .favorites])
    XCTAssertEqual(all.failed, [])
    XCTAssertEqual(all.spaces.map(\.id), ["{work-space}", "{play-space}"])
    XCTAssertEqual(all.tabs.count, 3)
    XCTAssertFalse(all.tabs.contains { $0.url == "https://firefox-only.example/" })
    XCTAssertEqual(all.favorites.map(\.url), ["https://mail.example/"])
    XCTAssertEqual(all.favicons.map(\.page), ["https://chat.example/room", "https://play.example/"])

    let play = try importer.importData(browserId: "zen", profileId: main, kinds: [.tabs, .spaces, .pinnedTabs],
                                       options: ImportOptions(spaceIds: ["{play-space}"]))
    XCTAssertEqual(play.spaces.map(\.name), ["Space 2"])
    XCTAssertEqual(play.tabs.map(\.url), ["https://games.example/"])
    XCTAssertEqual(play.favicons.map(\.page), ["https://play.example/"])

    let tabsOnly = try importer.importData(browserId: "zen", profileId: main, kinds: [.tabs])
    XCTAssertTrue(tabsOnly.spaces.allSatisfy(\.pinned.isEmpty))

    let plain = try importer.importData(browserId: "zen", profileId: "Profiles/pln00000.Plain", kinds: [.tabs, .spaces, .pinnedTabs])
    XCTAssertEqual(plain.failed, [])
    XCTAssertEqual(plain.spaces, [])
    XCTAssertEqual(plain.tabs.map(\.url), ["https://plain.example/", "https://pinned-plain.example/"])
    XCTAssertTrue(plain.warnings.contains { $0.kind == .spaces && $0.code == "empty" })
  }

  func testBookmarksHistoryCookiesComeFromTheFirefoxReaders() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    let result = try importer.importData(browserId: "zen", profileId: main, kinds: [.bookmarks, .history, .cookies])
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(result.bookmarks?.linkCount, 4)
    XCTAssertEqual(result.historyCount, 4)
    XCTAssertEqual(result.cookieCount, 6)
  }

  func testPasswordsReadLoginsDatabaseAndLoginsJSON() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    XCTAssertEqual(try importer.importData(browserId: "zen", profileId: main, kinds: [.passwords]).failed, [.passwords])
    try importer.unlock(browserId: "zen")
    let result = try importer.importData(browserId: "zen", profileId: main, kinds: [.passwords])
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(result.credentials.map(\.password), ["workspace pass", "local edit", "from sync", "only in json"])
    let first = result.credentials[0]
    XCTAssertEqual(first.username, "zen@example.com")
    XCTAssertEqual(first.url, "https://zen.example")
    XCTAssertEqual(first.realm, "https://zen.example")
    XCTAssertEqual(first.timesUsed, 1)
    XCTAssertEqual(first.lastUsed, Double(1788220800) * 1000)
  }

  func testLoginsJSONDoesNotBringBackWhatLoginsDBDeletedOrReplaced() throws {
    let rows = try FirefoxLogins.logins(profile: profile(main))
    XCTAssertFalse(rows.contains { $0.password == "deleted" })
    XCTAssertFalse(rows.contains { $0.password == "stale json copy" })
    XCTAssertTrue(rows.contains { $0.password == "only in json" })
  }

  func testAnUnreadableLoginsJSONKeepsTheLoginsDBResults() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("zen-logins-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    for name in ["key4.db", "logins.db"] {
      try FileManager.default.copyItem(at: profile(main).appendingPathComponent(name), to: dir.appendingPathComponent(name))
    }
    try Data("{".utf8).write(to: dir.appendingPathComponent("logins.json"))
    XCTAssertEqual(try FirefoxLogins.logins(profile: dir).map(\.password), ["workspace pass", "local edit", "from sync"])
  }

  func testAnExtremeSessionIndexDoesNotTrap() throws {
    let tab: [String: Any] = ["entries": [["url": "https://x.example/", "title": "X"]], "index": Int.min, "zenWorkspace": "s"]
    let zen = try JSONSerialization.data(withJSONObject: ["spaces": [["uuid": "s", "name": "S"]], "tabs": [tab]])
    XCTAssertEqual(try ZenSidebar.parse(zen, profileId: "p").spaces.first?.tabs.map(\.url), ["https://x.example/"])
    let firefox = try JSONSerialization.data(withJSONObject: ["windows": [["selected": Int.min, "tabs": [tab]]]])
    XCTAssertEqual(try Firefox.session(firefox).tabs.map(\.url), ["https://x.example/"])
  }

  func testJWERejectsTamperingAndOtherAlgorithms() {
    let key = Data(repeating: 7, count: 32)
    XCTAssertNil(FirefoxLogins.decryptJWE("a.b.c.d.e", key: key))
    XCTAssertNil(FirefoxLogins.decryptJWE("eyJhbGciOiJSU0EtT0FFUCJ9..AAAAAAAAAAAAAAAA.AA.AAAAAAAAAAAAAAAAAAAAAA", key: key))
  }

  func testFirefoxPasswordsSkipTheSyncAccount() throws {
    let rows = try FirefoxLogins.logins(profile: Fixtures.support("Firefox/Profiles/abcd1234.default-release"))
    XCTAssertFalse(rows.contains { $0.url.hasPrefix("chrome://") })
  }
}
