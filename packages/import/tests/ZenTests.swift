import Foundation
import ImageIO
import XCTest
@testable import ArdiaImportCore

final class ZenTests: XCTestCase {
  let id = "Profiles/zen12345.Default (release)"

  func testDiscoveryListsZenWorkspacesAndSkipsEmptyProfiles() throws {
    let zen = try XCTUnwrap(Fixtures.discovery().source(BrowserDefinition.find("zen")!))
    XCTAssertEqual(zen.family, .firefox)
    XCTAssertEqual(zen.profiles.map(\.id), [id, "Profiles/dev00000.Default (unofficial)"])
    XCTAssertEqual(zen.profiles.map(\.isDefault), [true, false])
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

  func testTabIconsComeFromTheSourceProfile() throws {
    let result = try Importer(discovery: Fixtures.discovery())
      .importData(browserId: "zen", profileId: id, kinds: [.tabs, .spaces, .pinnedTabs, .favorites])
    XCTAssertEqual(result.favicons.mapValues(\.icon), [
      "https://mail.example/": "https://mail.example/favicon.ico",
      "https://calendar.example/": "https://calendar.example/cal-32.png",
      "https://docs.example/a": "https://docs.example/d.png",
      "https://docs.example/spec": "https://docs.example/d.png",
      "https://recipes.example/": "https://recipes.example/favicon.ico",
      "https://shop.example/": "https://shop.example/favicon.ico",
    ])
    func size(_ page: String) -> Int? {
      let png = Data(base64Encoded: result.favicons[page]!.png)!
      let source = CGImageSourceCreateWithData(png as CFData, nil)!
      return (CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])?[kCGImagePropertyPixelWidth] as? Int
    }
    XCTAssertEqual(size("https://recipes.example/"), 64)
    XCTAssertEqual(size("https://shop.example/"), 16)
    for f in result.favicons.values {
      XCTAssertEqual(Data(base64Encoded: f.png)?.prefix(4), Data([0x89, 0x50, 0x4E, 0x47]))
    }
    let profile = Fixtures.support("zen/Profiles/zen12345.Default (release)")
    XCTAssertEqual(try FaviconReader.load(.firefox, profile: profile, pages: ["https://vector.example/", "about:blank"]), [:])

    let chrome = try FaviconReader.load(.chromium, profile: Fixtures.support("Google/Chrome/Default"),
                                        pages: ["https://example.com/", "https://other.example/x", "https://none.example/"])
    XCTAssertEqual(chrome.mapValues(\.icon), [
      "https://example.com/": "https://example.com/favicon.ico",
      "https://other.example/x": "https://other.example/icon.png",
    ])
  }

  func testEveryInstallDefaultStaysWhenNoProfileWasLastRunByTheApp() throws {
    let zen = BrowserDefinition.find("zen")!
    let own = BrowserDiscovery(applicationSupport: Fixtures.support).firefoxProfiles(zen)
    XCTAssertEqual(own.map(\.isDefault), [true, true])
    let elsewhere = BrowserDiscovery(applicationSupport: Fixtures.support)
      .firefoxProfiles(zen, app: URL(fileURLWithPath: "/Applications/Other.app"))
    XCTAssertEqual(elsewhere.map(\.isDefault), [true, true])
  }

  func testFoldersInAParentCycleStillComeThrough() throws {
    let pin: (String, String) -> [String: Any] = { url, group in
      ["entries": [["url": url, "title": url]], "index": 1, "pinned": true, "zenWorkspace": "s", "zenSyncId": url, "groupId": group]
    }
    let session: [String: Any] = [
      "spaces": [["uuid": "s", "name": "S"]],
      "folders": [["id": "a", "name": "A", "parentId": "b"], ["id": "b", "name": "B", "parentId": "a"]],
      "tabs": [pin("https://a.example/", "a"), pin("https://b.example/", "b")],
    ]
    let sidebar = try ZenSidebar.parse(JSONSerialization.data(withJSONObject: session), profileId: "x")
    XCTAssertEqual(sidebar.spaces[0].pinned.reduce(0) { $0 + $1.linkCount }, 2)
  }
}
