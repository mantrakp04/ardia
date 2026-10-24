import Foundation
import ImageIO
import SQLite3
import XCTest
@testable import ArdiaImportCore

final class ZenTests: XCTestCase {
  let id = "Profiles/zen12345.Default (release)"
  let old = "Profiles/old00000.No workspaces"
  let only = "Profiles/tabs0000.Tabs only"

  func testDiscoveryListsZenWorkspacesAndSkipsEmptyProfiles() throws {
    let zen = try XCTUnwrap(Fixtures.discovery().source(BrowserDefinition.find("zen")!))
    XCTAssertEqual(zen.family, .firefox)
    XCTAssertEqual(zen.profiles.map(\.id), [id, "Profiles/dev00000.Default (unofficial)", old, only])
    XCTAssertEqual(zen.profiles.map(\.isDefault), [true, false, false, false])
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
    XCTAssertEqual(own.map(\.isDefault), [true, true, false, false])
    let elsewhere = BrowserDiscovery(applicationSupport: Fixtures.support)
      .firefoxProfiles(zen, app: URL(fileURLWithPath: "/Applications/Other.app"))
    XCTAssertEqual(elsewhere.map(\.isDefault), [true, true, false, false])
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
    let a = try XCTUnwrap(sidebar.spaces[0].pinned.first)
    XCTAssertEqual(sidebar.spaces[0].pinned.count, 1)
    XCTAssertEqual(a.title, "A")
    XCTAssertEqual(a.children?.map(\.title), ["B", "https://a.example/"])
    XCTAssertEqual(a.children?.first?.children?.map(\.url), ["https://b.example/"])
  }

  func testZenWithoutWorkspacesImportsTabsFromTheFirefoxSession() throws {
    let profile = try XCTUnwrap(Fixtures.discovery().source(BrowserDefinition.find("zen")!)?.profiles.first { $0.id == old })
    XCTAssertEqual(profile.available, [.tabs])
    XCTAssertEqual(profile.spaces ?? [], [])
    let result = try Importer(discovery: Fixtures.discovery()).importData(browserId: "zen", profileId: old, kinds: [.tabs])
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(result.tabs.map(\.url), ["https://plain.example/", "https://pinned-plain.example/"])
    XCTAssertEqual(result.tabs.map(\.pinned), [false, true])
  }

  func testTabsOnlyProfileIsListedAndLoginsNeedKey4() throws {
    let profile = try XCTUnwrap(Fixtures.discovery().source(BrowserDefinition.find("zen")!)?.profiles.first { $0.id == only })
    XCTAssertEqual(Set(profile.available), [.tabs, .spaces, .pinnedTabs])
    XCTAssertEqual(profile.spaces?.map(\.name), ["Only"])
  }

  func testSessionImagesOverTheIconCapAreSkipped() {
    let small = "data:image/png;base64," + Data([0x89, 0x50, 0x4E, 0x47]).base64EncodedString()
    XCTAssertNotNil(ZenSidebar.imageData(small))
    let huge = "data:image/png;base64," + String(repeating: "A", count: FaviconReader.maxBytes * 2)
    XCTAssertNil(ZenSidebar.imageData(huge))
  }

  func testIconHostsIgnoreSchemeCase() {
    XCTAssertEqual(FaviconReader.host("HTTPS://Example.COM/x"), "https://example.com")
  }

  func testTallIconsAreShrunkToo() throws {
    let tall = try XCTUnwrap(Self.png(width: 16, height: 128))
    let out = try XCTUnwrap(FaviconReader.png(tall))
    let source = try XCTUnwrap(CGImageSourceCreateWithData(out as CFData, nil))
    let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
    XCTAssertEqual(props[kCGImagePropertyPixelHeight] as? Int, 64)
  }

  func testAnOversizedPreferredIconFallsBackToASmallerOne() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let small = try XCTUnwrap(Self.png(width: 16, height: 16))
    try Self.chromiumFavicons(at: dir, [
      ("https://big.example/", 32, Data(count: FaviconReader.maxBytes + 1)),
      ("https://big.example/", 16, small),
    ])
    let icons = try FaviconReader.load(.chromium, profile: dir, pages: ["https://big.example/"])
    XCTAssertEqual(icons["https://big.example/"].flatMap { Data(base64Encoded: $0.png) }, small)
  }

  func testAPageWhoseIconWontDecodeGetsItsSitesIcon() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let small = try XCTUnwrap(Self.png(width: 16, height: 16))
    try Self.chromiumFavicons(at: dir, [
      ("https://site.example/broken", 32, Data("not an image".utf8)),
      ("https://site.example/", 16, small),
    ])
    let icons = try FaviconReader.load(.chromium, profile: dir, pages: ["https://site.example/broken"])
    XCTAssertEqual(icons["https://site.example/broken"].flatMap { Data(base64Encoded: $0.png) }, small)
  }

  static func chromiumFavicons(at dir: URL, _ bitmaps: [(page: String, width: Int, blob: Data)]) throws {
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    var db: OpaquePointer?
    XCTAssertEqual(sqlite3_open(dir.appendingPathComponent("Favicons").path, &db), SQLITE_OK)
    defer { sqlite3_close(db) }
    XCTAssertEqual(sqlite3_exec(db, """
      CREATE TABLE favicons (id INTEGER PRIMARY KEY, url TEXT, icon_type INTEGER);
      CREATE TABLE favicon_bitmaps (id INTEGER PRIMARY KEY, icon_id INTEGER, image_data BLOB, width INTEGER);
      CREATE TABLE icon_mapping (id INTEGER PRIMARY KEY, page_url TEXT, icon_id INTEGER);
      """, nil, nil, nil), SQLITE_OK)
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for (id, bitmap) in bitmaps.enumerated() {
      var stmt: OpaquePointer?
      for sql in ["INSERT INTO favicons VALUES (?1, ?2, 1)", "INSERT INTO icon_mapping (page_url, icon_id) VALUES (?2, ?1)"] {
        sqlite3_prepare_v2(db, sql, -1, &stmt, nil)
        sqlite3_bind_int(stmt, 1, Int32(id + 1))
        sqlite3_bind_text(stmt, 2, bitmap.page, -1, transient)
        XCTAssertEqual(sqlite3_step(stmt), SQLITE_DONE)
        sqlite3_finalize(stmt)
      }
      sqlite3_prepare_v2(db, "INSERT INTO favicon_bitmaps (icon_id, image_data, width) VALUES (?, ?, ?)", -1, &stmt, nil)
      sqlite3_bind_int(stmt, 1, Int32(id + 1))
      _ = bitmap.blob.withUnsafeBytes { sqlite3_bind_blob(stmt, 2, $0.baseAddress, Int32(bitmap.blob.count), transient) }
      sqlite3_bind_int(stmt, 3, Int32(bitmap.width))
      XCTAssertEqual(sqlite3_step(stmt), SQLITE_DONE)
      sqlite3_finalize(stmt)
    }
  }

  static func png(width: Int, height: Int) -> Data? {
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
          let image = context.makeImage() else { return nil }
    let out = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(out, "public.png" as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, image, nil)
    return CGImageDestinationFinalize(dest) ? out as Data : nil
  }
}
