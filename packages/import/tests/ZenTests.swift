import Foundation
import XCTest
@testable import ArdiaImportCore

final class ZenTests: XCTestCase {
  let id = "Profiles/zen12345.Default (release)"

  func testDiscoveryListsZenWorkspacesAndSkipsEmptyProfiles() throws {
    let zen = try XCTUnwrap(Fixtures.discovery().source(BrowserDefinition.find("zen")!))
    XCTAssertEqual(zen.family, .firefox)
    XCTAssertEqual(zen.profiles.map(\.id), [id])
    let profile = zen.profiles[0]
    XCTAssertTrue(profile.isDefault)
    XCTAssertEqual(Set(profile.available), [.bookmarks, .history, .tabs, .passwords, .spaces, .pinnedTabs, .favorites])
    XCTAssertEqual(profile.available.filter { $0 == .tabs }.count, 1)
    XCTAssertEqual(profile.spaces?.map(\.name), ["Work", "Space 2"])
    XCTAssertEqual(profile.spaces?.map(\.pinnedCount), [3, 1])
    XCTAssertEqual(profile.spaces?.map(\.tabCount), [2, 1])
    XCTAssertEqual(profile.spaces?.first?.emoji, "💼")
    XCTAssertNil(profile.spaces?.last?.emoji)
    XCTAssertEqual(profile.spaces?.first?.color, Hex.color(red: 1, green: 128.0 / 255, blue: 0))
  }

  func testImportMapsWorkspacesEssentialsPinsAndFolders() throws {
    let result = try Importer(discovery: Fixtures.discovery())
      .importData(browserId: "zen", profileId: id, kinds: [.bookmarks, .history, .tabs, .spaces, .pinnedTabs, .favorites])
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(result.bookmarks?.linkCount, 4)
    XCTAssertEqual(result.favorites.map(\.url), ["https://mail.example/"])
    XCTAssertEqual(result.favorites.map(\.title), ["Mail"])

    let work = try XCTUnwrap(result.spaces.first)
    XCTAssertEqual(work.pinned.map(\.title), ["Cal", "Docs"])
    XCTAssertEqual(work.pinned[0].pageTitle, "Calendar")
    XCTAssertEqual(work.pinned[1].children?.map(\.title), ["Specs", "Doc A"])
    XCTAssertEqual(work.pinned[1].children?.first?.children?.map(\.url), ["https://docs.example/spec"])
    XCTAssertEqual(work.tabs.map(\.url), ["https://news.example/", "https://orphan.example/"])

    let home = result.spaces[1]
    XCTAssertEqual(home.pinned.map(\.url), ["https://recipes.example/"])
    XCTAssertEqual(home.tabs.map(\.url), ["https://shop.example/"])
    XCTAssertEqual(result.tabs.count, 3)
  }

  func testOnlyChosenSpacesAndKindsComeBack() throws {
    let result = try Importer(discovery: Fixtures.discovery())
      .importData(browserId: "zen", profileId: id, kinds: [.spaces, .tabs], options: ImportOptions(spaceIds: ["{home-space}"]))
    XCTAssertEqual(result.spaces.map(\.id), ["{home-space}"])
    XCTAssertEqual(result.spaces[0].pinned, [])
    XCTAssertEqual(result.tabs.map(\.url), ["https://shop.example/"])
  }

  func testWindowedSessionStoreDedupesPinsAcrossWindows() throws {
    let window: [String: Any] = [
      "spaces": [["uuid": "s", "name": "S"]],
      "tabs": [["entries": [["url": "https://pin.example/", "title": "Pin"]], "index": 1, "pinned": true, "zenSyncId": "p", "zenWorkspace": "s"]],
    ]
    let sidebar = try ZenSidebar.parse(JSONSerialization.data(withJSONObject: ["windows": [window, window]]), profileId: "x")
    XCTAssertEqual(sidebar.spaces.map { $0.pinned.count }, [1])
    XCTAssertEqual(try ZenSidebar.parse(Data("{}".utf8), profileId: "x"), ArcSidebar())
  }

  func testPasswordsComeFromLoginsDatabase() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    try importer.unlock(browserId: "zen")
    let result = try importer.importData(browserId: "zen", profileId: id, kinds: [.passwords])
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(result.credentials.map { "\($0.username)@\($0.url)=\($0.password)" }, [
      "zen@example.com@https://zen.example=workspace pass",
      "synced@https://synced.example=from sync",
    ])
    XCTAssertEqual(result.credentials[0].realm, "https://zen.example")
    XCTAssertEqual(result.credentials[0].lastUsed, Double(1788220800) * 1000)
    XCTAssertNil(FirefoxLogins.decryptJWE("a.b.c", key: Data(count: 32)))
  }
}
