import Foundation
import XCTest
@testable import ArdiaImportCore

final class SQLiteSnapshotTests: XCTestCase {
  private var folder: URL!
  private let fm = FileManager.default

  override func setUpWithError() throws {
    folder = fm.temporaryDirectory.appendingPathComponent("snapshot-tests-\(UUID().uuidString)", isDirectory: true)
    try fm.createDirectory(at: folder, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? fm.removeItem(at: folder)
  }

  private func copyFolder(_ name: String, modified: Date = Date()) throws -> URL {
    let url = folder.appendingPathComponent(name, isDirectory: true)
    try fm.createDirectory(at: url, withIntermediateDirectories: true)
    try Data("logins".utf8).write(to: url.appendingPathComponent("db.sqlite"))
    try fm.setAttributes([.modificationDate: modified], ofItemAtPath: url.path)
    return url
  }

  private func exitedPid() throws -> pid_t {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/true")
    try process.run()
    process.waitUntilExit()
    return process.processIdentifier
  }

  func testCopiesLeftByAnImportThatNeverFinishedAreRemovedAndLiveOnesStay() throws {
    let now = Date()
    let dead = try copyFolder("ardia-import-\(try exitedPid())-\(UUID().uuidString)")
    let live = try copyFolder("ardia-import-\(getpid())-\(UUID().uuidString)")
    let oldUnnamed = try copyFolder("ardia-import-\(UUID().uuidString)", modified: now.addingTimeInterval(-7200))
    let freshUnnamed = try copyFolder("ardia-import-\(UUID().uuidString)", modified: now.addingTimeInterval(-60))
    let unrelated = try copyFolder("ardia-import-swiftpm", modified: now.addingTimeInterval(-86_400))

    SQLiteSnapshot.removeLeftovers(in: folder, now: now)

    XCTAssertFalse(fm.fileExists(atPath: dead.path))
    XCTAssertFalse(fm.fileExists(atPath: oldUnnamed.path))
    XCTAssertTrue(fm.fileExists(atPath: live.path))
    XCTAssertTrue(fm.fileExists(atPath: freshUnnamed.path))
    XCTAssertTrue(fm.fileExists(atPath: unrelated.path))
  }

  func testACopyIsNamedForItsProcessAndGoesWithIt() throws {
    let before = Set(try fm.contentsOfDirectory(atPath: fm.temporaryDirectory.path).filter { $0.hasPrefix("ardia-import-\(getpid())-") })
    var snapshot: SQLiteSnapshot? = try SQLiteSnapshot(copying: Fixtures.support("Google/Chrome/Default/History"))
    let during = Set(try fm.contentsOfDirectory(atPath: fm.temporaryDirectory.path).filter { $0.hasPrefix("ardia-import-\(getpid())-") })
    XCTAssertEqual(during.subtracting(before).count, 1)
    XCTAssertTrue(snapshot?.tableExists("urls") ?? false)
    snapshot = nil
    let after = Set(try fm.contentsOfDirectory(atPath: fm.temporaryDirectory.path).filter { $0.hasPrefix("ardia-import-\(getpid())-") })
    XCTAssertEqual(after, before)
  }

  func testOneImportCopiesEachSourceFileOnce() throws {
    let places = Fixtures.support("Firefox/Profiles/abcd1234.default-release/places.sqlite")
    let snapshots = SQLiteSnapshots()
    let first = try snapshots.snapshot(copying: places)
    let again = try snapshots.snapshot(copying: URL(fileURLWithPath: places.path + "/../places.sqlite").standardizedFileURL)
    XCTAssertTrue(first === again)
    let bookmarks = try Firefox.bookmarks(places: places, snapshots: snapshots)
    let history = try HistoryReader.read(places, flavor: .firefox, snapshots: snapshots)
    XCTAssertEqual(bookmarks.linkCount, try Firefox.bookmarks(places: places).linkCount)
    XCTAssertEqual(history.count, try HistoryReader.read(places, flavor: .firefox).count)
  }
}
