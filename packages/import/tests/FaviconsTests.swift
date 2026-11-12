import Foundation
import SQLite3
import XCTest
@testable import ArdiaImportCore

final class FaviconsTests: XCTestCase {
  private var directories: [URL] = []

  override func tearDown() {
    for directory in directories { try? FileManager.default.removeItem(at: directory) }
    directories = []
  }

  private func png(_ width: Int) -> Data {
    Data([137, 80, 78, 71, 13, 10, 26, 10]) + Data("w\(width)".utf8)
  }

  private func profile(_ rows: [(page: String, icon: String, bitmaps: [(width: Int, data: Data)])]) throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("favicons-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    directories.append(directory)
    var db: OpaquePointer?
    XCTAssertEqual(sqlite3_open(directory.appendingPathComponent("Favicons").path, &db), SQLITE_OK)
    defer { sqlite3_close(db) }
    func run(_ sql: String, _ blob: Data? = nil) {
      var stmt: OpaquePointer?
      XCTAssertEqual(sqlite3_prepare_v2(db, sql, -1, &stmt, nil), SQLITE_OK, sql)
      if let blob {
        _ = blob.withUnsafeBytes { sqlite3_bind_blob(stmt, 1, $0.baseAddress, Int32(blob.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
      }
      XCTAssertEqual(sqlite3_step(stmt), SQLITE_DONE, sql)
      sqlite3_finalize(stmt)
    }
    run("CREATE TABLE favicons(id INTEGER PRIMARY KEY, url LONGVARCHAR NOT NULL, icon_type INTEGER DEFAULT 1)")
    run("CREATE TABLE favicon_bitmaps(id INTEGER PRIMARY KEY, icon_id INTEGER NOT NULL, last_updated INTEGER DEFAULT 0, image_data BLOB, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0, last_requested INTEGER DEFAULT 0)")
    run("CREATE TABLE icon_mapping(id INTEGER PRIMARY KEY, page_url LONGVARCHAR NOT NULL, icon_id INTEGER)")
    for (id, row) in rows.enumerated() {
      run("INSERT INTO favicons(id, url, icon_type) VALUES (\(id + 1), '\(row.icon)', 1)")
      run("INSERT INTO icon_mapping(page_url, icon_id) VALUES ('\(row.page)', \(id + 1))")
      for bitmap in row.bitmaps {
        run("INSERT INTO favicon_bitmaps(icon_id, image_data, width, height) VALUES (\(id + 1), ?, \(bitmap.width), \(bitmap.width))", bitmap.data)
      }
    }
    return directory
  }

  private func decoded(_ icon: ImportedFavicon?) -> Data? { icon.flatMap { Data(base64Encoded: $0.png) } }

  func testPicksTheBitmapClosestToThirtyTwoPixels() throws {
    let dir = try profile([
      ("https://calendar.test/", "https://calendar.test/i.png", [(16, png(16)), (64, png(64)), (32, png(32))]),
      ("https://small.test/", "https://small.test/i.png", [(16, png(16)), (24, png(24))]),
      ("https://big.test/", "https://big.test/i.png", [(128, png(128)), (48, png(48))]),
    ])
    let icons = ChromiumFavicons.read(profiles: [dir], pages: ["https://calendar.test/", "https://small.test/", "https://big.test/"])
    XCTAssertEqual(icons.map(\.page), ["https://calendar.test/", "https://small.test/", "https://big.test/"])
    XCTAssertEqual(icons.map(decoded), [png(32), png(24), png(48)])
    XCTAssertEqual(icons.first?.icon, "https://calendar.test/i.png")
  }

  func testFragmentsAndOtherPagesOfTheSameSite() throws {
    let dir = try profile([
      ("https://mail.test/u/0/#inbox", "https://mail.test/inbox.png", [(32, png(1))]),
      ("https://docs.test/a", "https://docs.test/a.png", [(32, png(2))]),
      ("https://docs.test/", "https://docs.test/home.png", [(32, png(3))]),
      ("https://docs.test.evil/", "https://docs.test.evil/x.png", [(32, png(4))]),
      ("https://nohome.test/x", "https://nohome.test/x.png", [(32, png(5))]),
    ])
    let icons = ChromiumFavicons.read(profiles: [dir], pages: [
      "https://mail.test/u/0/#inbox", "https://mail.test/u/0/#sent", "https://docs.test/b", "https://nohome.test/y",
      "https://unknown.test/",
    ])
    let byPage = Dictionary(uniqueKeysWithValues: icons.map { ($0.page, $0) })
    XCTAssertEqual(decoded(byPage["https://mail.test/u/0/#inbox"]), png(1))
    XCTAssertEqual(decoded(byPage["https://mail.test/u/0/#sent"]), png(1))
    XCTAssertEqual(byPage["https://docs.test/b"]?.icon, "https://docs.test/home.png")
    XCTAssertEqual(decoded(byPage["https://nohome.test/y"]), png(5))
    XCTAssertNil(byPage["https://unknown.test/"])
  }

  func testSkipsNonPNGOversizedAndNonWebPages() throws {
    let dir = try profile([
      ("https://bad.test/", "https://bad.test/i.ico", [(32, Data("not a png".utf8))]),
      ("https://huge.test/", "https://huge.test/i.png", [(32, png(0) + Data(count: ChromiumFavicons.maximumPNGBytes))]),
      ("file:///tmp/a.html", "file:///tmp/i.png", [(32, png(9))]),
    ])
    XCTAssertEqual(ChromiumFavicons.read(profiles: [dir], pages: ["https://bad.test/", "https://huge.test/", "file:///tmp/a.html"]), [])
  }

  func testLaterProfilesFillInAndAMissingDatabaseIsSilent() throws {
    let missing = FileManager.default.temporaryDirectory.appendingPathComponent("favicons-missing-\(UUID().uuidString)")
    let first = try profile([("https://a.test/", "https://a.test/i.png", [(32, png(1))])])
    let second = try profile([
      ("https://a.test/", "https://a.test/other.png", [(32, png(2))]),
      ("https://b.test/", "https://b.test/i.png", [(32, png(3))]),
    ])
    let icons = ChromiumFavicons.read(profiles: [missing, first, second], pages: ["https://b.test/", "https://a.test/", "https://a.test/"])
    XCTAssertEqual(icons.map(\.page), ["https://b.test/", "https://a.test/"])
    XCTAssertEqual(icons.map(decoded), [png(3), png(1)])
    XCTAssertEqual(ChromiumFavicons.read(profiles: [missing], pages: ["https://a.test/"]), [])
  }

  func testPagesComeFromTabsSpacesFavoritesAndTheBookmarksBar() {
    var result = ImportResult(browserId: "arc", profileId: "Default")
    result.favorites = [ImportedTab(url: "https://fav.test/", title: "Fav", pinned: true)]
    result.tabs = [ImportedTab(url: "https://tab.test/", title: "Tab")]
    result.spaces = [SpaceSuggestion(
      id: "s", name: "Space", profileId: "Default",
      pinned: [.link("Pinned", "https://pinned.test/"), .folder("Folder", [.folder("Inner", [.link("Deep", "https://deep.test/")])])],
      tabs: [ImportedTab(url: "https://open.test/", title: "Open")])]
    result.bookmarks = .folder("", [
      .folder("Bar", [.link("Bar", "https://bar.test/")], role: "toolbar"),
      .folder("Other", [.link("Other", "https://other.test/")], role: "other"),
    ])
    XCTAssertEqual(ChromiumFavicons.pages(of: result), [
      "https://fav.test/", "https://pinned.test/", "https://deep.test/", "https://open.test/", "https://tab.test/", "https://bar.test/",
    ])
  }
}
