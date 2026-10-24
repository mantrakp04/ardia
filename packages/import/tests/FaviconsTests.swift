import Foundation
import SQLite3
import XCTest
@testable import ArdiaImportCore

final class FaviconsTests: XCTestCase {
  func testArcImportsOnlySidebarIconsAndChoosesClosestBitmap() throws {
    let result = try Importer(discovery: Fixtures.discovery()).importData(
      browserId: "arc", profileId: "Default", kinds: [.spaces, .pinnedTabs, .tabs, .favorites])
    let icons = Dictionary(uniqueKeysWithValues: result.favicons.map { ($0.page, $0) })
    XCTAssertEqual(Set(icons.keys), Set(["https://calendar.example/", "https://blog.example/post", "https://mail.example.com/"]))
    let snapshot = try SQLiteSnapshot(copying: Fixtures.support("Arc/User Data/Default/Favicons"))
    for (page, width) in [("https://calendar.example/", 32), ("https://blog.example/post", 16), ("https://mail.example.com/", 32)] {
      let icon = try XCTUnwrap(icons[page])
      XCTAssertEqual(icon.icon, URL(string: page)!.scheme! + "://" + URL(string: page)!.host! + "/favicon.png")
      let png = try XCTUnwrap(Data(base64Encoded: icon.png))
      var expected: Data?
      try snapshot.query("SELECT image_data FROM favicon_bitmaps JOIN icon_mapping ON icon_mapping.icon_id = favicon_bitmaps.icon_id WHERE page_url = ? AND width = ?", [.text(page), .int(Int64(width))]) { row in
        expected = row.blob(0)
        return false
      }
      XCTAssertEqual(png, expected)
    }
  }

  func testChromeTabsImportIconsButBookmarksAndHistoryDoNot() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    importer.setKey(Fixtures.chromiumKey, for: "chrome")
    let tabs = try importer.importData(browserId: "chrome", profileId: "Default", kinds: [.tabs])
    XCTAssertEqual(tabs.favicons.map(\.page), ["https://mail.example.com/"])
    XCTAssertEqual(tabs.favicons.first?.icon, "https://mail.example.com/favicon.png")
    XCTAssertNotNil(Data(base64Encoded: try XCTUnwrap(tabs.favicons.first?.png)))
    let other = try importer.importData(browserId: "chrome", profileId: "Default", kinds: [.bookmarks, .history])
    XCTAssertEqual(other.favicons, [])
  }

  func testMissingDatabaseIsSilent() {
    XCTAssertEqual(ChromiumFavicons.read(profile: Fixtures.support("missing-profile"), pages: ["https://a.test/"]), [])
  }

  func testReaderBoundsDeduplicatesAndRejectsInvalidBitmaps() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    var db: OpaquePointer?
    XCTAssertEqual(sqlite3_open(directory.appendingPathComponent("Favicons").path, &db), SQLITE_OK)
    defer { sqlite3_close(db) }
    func execute(_ sql: String) {
      XCTAssertEqual(sqlite3_exec(db, sql, nil, nil, nil), SQLITE_OK)
    }
    XCTAssertEqual(ChromiumFavicons.read(profile: directory, pages: ["https://a.test/"]), [])
    execute("CREATE TABLE icon_mapping(page_url TEXT, icon_id INTEGER)")
    execute("CREATE TABLE favicons(id INTEGER, url TEXT, icon_type INTEGER)")
    execute("CREATE TABLE favicon_bitmaps(icon_id INTEGER, image_data BLOB, width INTEGER)")
    execute("INSERT INTO favicons VALUES (1, 'https://a.test/favicon.png', 1)")
    execute("INSERT INTO favicon_bitmaps VALUES (1, X'89504E470D0A1A0A', 32)")
    let pages = (0..<501).map { "https://a.test/\($0)" }
    for page in pages { execute("INSERT INTO icon_mapping VALUES ('\(page)', 1)") }
    let icons = ChromiumFavicons.read(profile: directory, pages: ["file:///tmp/a"] + Array(pages.prefix(250)) + Array(pages.prefix(250)) + Array(pages.dropFirst(250)))
    XCTAssertEqual(icons.count, 500)
    XCTAssertEqual(icons.map(\.page), Array(pages.prefix(500)))
    execute("UPDATE favicon_bitmaps SET image_data = X'89504E470D0A1A0A' || zeroblob(65536)")
    XCTAssertTrue(ChromiumFavicons.read(profile: directory, pages: pages).isEmpty)
    execute("UPDATE favicon_bitmaps SET image_data = X'00010203'")
    XCTAssertTrue(ChromiumFavicons.read(profile: directory, pages: pages).isEmpty)
    execute("UPDATE favicon_bitmaps SET image_data = X'89504E470D0A1A0A'")
    execute("UPDATE favicons SET icon_type = 2")
    XCTAssertTrue(ChromiumFavicons.read(profile: directory, pages: pages).isEmpty)
  }

  func testFragmentPagesUseFragmentFreeMapping() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    var db: OpaquePointer?
    XCTAssertEqual(sqlite3_open(directory.appendingPathComponent("Favicons").path, &db), SQLITE_OK)
    defer { sqlite3_close(db) }
    func execute(_ sql: String) {
      XCTAssertEqual(sqlite3_exec(db, sql, nil, nil, nil), SQLITE_OK)
    }
    execute("CREATE TABLE icon_mapping(page_url TEXT, icon_id INTEGER)")
    execute("CREATE TABLE favicons(id INTEGER, url TEXT, icon_type INTEGER)")
    execute("CREATE TABLE favicon_bitmaps(icon_id INTEGER, image_data BLOB, width INTEGER)")
    execute("INSERT INTO icon_mapping VALUES ('https://a.test/page', 1)")
    execute("INSERT INTO favicons VALUES (1, 'https://a.test/favicon.png', 1)")
    execute("INSERT INTO favicon_bitmaps VALUES (1, X'89504E470D0A1A0A', 32)")
    XCTAssertEqual(ChromiumFavicons.read(profile: directory, pages: ["https://a.test/page#section"]).map(\.page), ["https://a.test/page#section"])
    XCTAssertEqual(ChromiumFavicons.read(profile: directory, pages: ["https://a.test/page#section", "https://a.test/page#other", "https://a.test/page"]).map(\.page), ["https://a.test/page#section"])
    XCTAssertEqual(ChromiumFavicons.read(profile: directory, pages: ["https://a.test/page"]).map(\.page), ["https://a.test/page"])
  }
}
