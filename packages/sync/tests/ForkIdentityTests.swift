import Foundation
import XCTest
@testable import ArdiaSyncCore

final class ForkIdentityTests: XCTestCase {
  let forkId = "com.example.name"
  var root: URL!
  var legacyHome: URL { root.appendingPathComponent("legacy-home", isDirectory: true) }
  var dataDir: URL { root.appendingPathComponent("data", isDirectory: true) }
  var legacyData: URL { legacyHome.appendingPathComponent("Library/Application Support/\(LegacyName.bundleId)", isDirectory: true) }
  var legacyKeychain: URL { legacyHome.appendingPathComponent("keychain.json") }

  override func setUpWithError() throws {
    root = FileManager.default.temporaryDirectory.appendingPathComponent("fork-identity-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: legacyData, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
    try Data(#"{"windows":[]}"#.utf8).write(to: legacyData.appendingPathComponent("session.json"))
    let secret = Data("upstream's safe storage key".utf8).base64EncodedString()
    let keychain = [Renamed.safeStorage.oldService: [Renamed.safeStorage.account!.old: secret]]
    try JSONSerialization.data(withJSONObject: keychain, options: [.sortedKeys]).write(to: legacyKeychain)
    setenv("ARDIA_DATA_DIR", dataDir.path, 1)
    setenv("ARDIA_LEGACY_SOURCE", legacyHome.path, 1)
  }

  override func tearDownWithError() throws {
    unsetenv("ARDIA_DATA_DIR")
    unsetenv("ARDIA_LEGACY_SOURCE")
    try? FileManager.default.removeItem(at: root)
  }

  func dataDirContents() -> [String] { ((try? FileManager.default.contentsOfDirectory(atPath: dataDir.path)) ?? []).sorted() }

  func testOnlyUpstreamsOwnBundleIdIsTheLegacySuccessor() {
    XCTAssertTrue(LegacyName.isSuccessor("com.ardia.browser"))
    XCTAssertFalse(LegacyName.isSuccessor(forkId))
    XCTAssertFalse(LegacyName.isSuccessor(LegacyName.bundleId))
    XCTAssertFalse(LegacyName.isSuccessor(nil))
  }

  func testAForkBundleIdNeverTakesUpstreamsLegacyData() throws {
    let keychainBefore = try Data(contentsOf: legacyKeychain)
    XCTAssertTrue(LegacyMigration.runAtLaunch(bundleId: forkId))
    XCTAssertEqual(dataDirContents(), [], "a fork copies nothing and writes no journal")
    XCTAssertEqual(try Data(contentsOf: legacyKeychain), keychainBefore)
    XCTAssertTrue(FileManager.default.fileExists(atPath: legacyData.appendingPathComponent("session.json").path))
  }

  func testNoBundleIdTakesNothingEither() {
    XCTAssertTrue(LegacyMigration.runAtLaunch(bundleId: nil))
    XCTAssertEqual(dataDirContents(), [])
  }

  func testUpstreamsBundleIdStillMigratesTheSameFixture() throws {
    XCTAssertTrue(LegacyMigration.runAtLaunch(bundleId: LegacyName.successorBundleId))
    XCTAssertTrue(FileManager.default.fileExists(atPath: dataDir.appendingPathComponent("session.json").path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: dataDir.appendingPathComponent(LegacyMigrator.journalName).path))
  }

  func legacyAppBundle() throws -> (folder: URL, app: URL, launched: String, running: String) {
    let folder = root.appendingPathComponent("Applications", isDirectory: true)
    let app = folder.appendingPathComponent(LegacyName.appFileName, isDirectory: true)
    let executable = app.appendingPathComponent("Contents/MacOS/Ardia")
    try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data().write(to: executable)
    let real = try XCTUnwrap(realpath(folder.path, nil))
    defer { free(real) }
    return (folder, app, executable.path, "\(String(cString: real))/\(LegacyName.appFileName)/Contents/MacOS/Ardia")
  }

  func testAForkNeverRenamesALegacyAppBundle() throws {
    let bundle = try legacyAppBundle()
    LegacyMigration.moveToNewName(bundleId: forkId, launched: bundle.launched, running: { bundle.running })
    XCTAssertTrue(FileManager.default.fileExists(atPath: bundle.app.path))
    XCTAssertFalse(FileManager.default.fileExists(atPath: bundle.folder.appendingPathComponent("Ardia.app").path))
  }

  func testUpstreamsBundleIdStillRenamesTheSameBundle() throws {
    let bundle = try legacyAppBundle()
    LegacyMigration.moveToNewName(bundleId: LegacyName.successorBundleId, launched: bundle.launched, running: { bundle.running })
    XCTAssertFalse(FileManager.default.fileExists(atPath: bundle.app.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: bundle.folder.appendingPathComponent("Ardia.app").path))
  }
}
