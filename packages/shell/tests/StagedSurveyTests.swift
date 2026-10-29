import XCTest
@testable import ArdiaUpdaterCore

final class StagedSurveyTests: XCTestCase {
  let bundleId = "com.ardia.browser.surveytest"
  var caches: URL!

  override func setUpWithError() throws {
    caches = FileManager.default.temporaryDirectory.appendingPathComponent("staged-survey-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: caches, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    if let walk = FileManager.default.enumerator(atPath: caches.path) {
      for case let path as String in walk { chmod(caches.appendingPathComponent(path).path, 0o755) }
    }
    try? FileManager.default.removeItem(at: caches)
  }

  var root: URL { StagedSurvey.root(caches: caches, bundleId: bundleId) }

  @discardableResult
  func stage(_ folder: String = "abc123", bundleId: String? = nil, build: String = "91", channel: String? = "nightly",
             executable: Bool = true, plist: Bool = true) throws -> URL {
    let app = root.appendingPathComponent(folder).appendingPathComponent("Ardia.app")
    let contents = app.appendingPathComponent("Contents")
    try FileManager.default.createDirectory(at: contents.appendingPathComponent("MacOS"), withIntermediateDirectories: true)
    if executable {
      FileManager.default.createFile(atPath: contents.appendingPathComponent("MacOS/Ardia").path, contents: Data(), attributes: [.posixPermissions: 0o755])
    }
    if plist { try writeInfo(app, bundleId: bundleId ?? self.bundleId, build: build, channel: channel) }
    return app
  }

  func writeInfo(_ app: URL, bundleId: String? = nil, build: String = "91", channel: String? = "nightly") throws {
    var info: [String: Any] = ["CFBundleIdentifier": bundleId ?? self.bundleId, "CFBundleVersion": build, "CFBundleExecutable": "Ardia"]
    if let channel { info["ACUpdateChannel"] = channel }
    let data = try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
    try data.write(to: app.appendingPathComponent("Contents/Info.plist"))
  }

  func survey() -> StagedSurvey.Survey { StagedSurvey.survey(caches: caches, bundleId: bundleId) }

  func residue(_ folder: String = "abc123") -> ChannelSwitch.Residue {
    let url = root.appendingPathComponent(folder)
    var info = stat()
    lstat(url.path, &info)
    return ChannelSwitch.Residue(folder: url.path, device: UInt64(info.st_dev), inode: UInt64(info.st_ino))
  }

  func testNoSparkleCacheMeansNoCopies() {
    XCTAssertEqual(survey(), StagedSurvey.Survey())
  }

  func testAStagedNightlyIsFoundWithTheIdentityOfItsUpdateFolder() throws {
    let app = try stage()
    var info = stat()
    XCTAssertEqual(lstat(root.appendingPathComponent("abc123").path, &info), 0)
    let found = survey().found
    XCTAssertEqual(found.count, 1)
    XCTAssertEqual(found.first?.channel, "nightly")
    XCTAssertEqual(found.first?.bundle.standardizedFileURL, app.standardizedFileURL)
    XCTAssertEqual(found.first?.copy, ChannelSwitch.Copy(folder: root.appendingPathComponent("abc123").path,
                                                         device: UInt64(info.st_dev), inode: UInt64(info.st_ino), build: "91"))
  }

  func testAStableCopyIsFoundWithNoChannel() throws {
    try stage(channel: nil)
    XCTAssertEqual(survey().found.first?.channel, nil)
    XCTAssertEqual(survey().found.count, 1)
  }

  func testAnotherAppsCopyIsNotOurs() throws {
    try stage(bundleId: "com.example.other")
    XCTAssertEqual(survey(), StagedSurvey.Survey())
  }

  func testACopyWithoutAnExecutableStillCounts() throws {
    try stage(executable: false)
    XCTAssertEqual(survey().found.count, 1)
  }

  func testACopyStillBeingExtractedIsUnreadableNotAbsent() throws {
    let app = try stage(plist: false)
    XCTAssertEqual(survey(), StagedSurvey.Survey(residue: [residue()]))
    try writeInfo(app)
    XCTAssertEqual(survey().found.count, 1)
    XCTAssertEqual(survey().residue, [])
  }

  func testAnInfoPlistThatCantBeReadIsUnreadable() throws {
    let app = try stage()
    chmod(app.appendingPathComponent("Contents/Info.plist").path, 0o000)
    XCTAssertEqual(survey(), StagedSurvey.Survey(residue: [residue()]))
  }

  func testACorruptInfoPlistIsUnreadable() throws {
    let app = try stage()
    try Data("<plist".utf8).write(to: app.appendingPathComponent("Contents/Info.plist"))
    XCTAssertEqual(survey(), StagedSurvey.Survey(residue: [residue()]))
  }

  func testAnUpdateFolderThatCantBeListedIsUnreadable() throws {
    try stage()
    chmod(root.appendingPathComponent("abc123").path, 0o000)
    XCTAssertEqual(survey(), StagedSurvey.Survey(residue: [residue()]))
  }

  func testASymlinkInSparklesCachePathIsUnreadable() throws {
    let elsewhere = caches.appendingPathComponent("elsewhere/org.sparkle-project.Sparkle/Installation", isDirectory: true)
    try FileManager.default.createDirectory(at: elsewhere, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: caches.appendingPathComponent(bundleId), withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: caches.appendingPathComponent(bundleId).appendingPathComponent("org.sparkle-project.Sparkle"),
                                               withDestinationURL: elsewhere.deletingLastPathComponent())
    XCTAssertEqual(survey(), StagedSurvey.Survey(blind: true))
  }

  func listing() -> [String: String] {
    var entries: [String: String] = [:]
    guard let walk = FileManager.default.enumerator(atPath: caches.path) else { return entries }
    for case let path as String in walk {
      var info = stat()
      lstat(caches.appendingPathComponent(path).path, &info)
      entries[path] = "\(info.st_mode)-\(info.st_ino)-\(info.st_size)-\(info.st_mtimespec.tv_sec)"
    }
    return entries
  }

  func testASurveyNeverMovesOrDeletesAnything() throws {
    try stage("live")
    try stage("other", channel: nil)
    try stage("abandoned", plist: false)
    let corrupt = try stage("corrupt")
    try Data("<plist".utf8).write(to: corrupt.appendingPathComponent("Contents/Info.plist"))
    let before = listing()
    XCTAssertEqual(survey().found.count, 2)
    XCTAssertEqual(survey().residue.count, 2)
    XCTAssertEqual(listing(), before)
  }

  func testAReplacedUpdateFolderReadsAsADifferentCopy() throws {
    try stage()
    let update = root.appendingPathComponent("abc123")
    let found = survey().found
    XCTAssertEqual(found.count, 1)
    let swapped = caches.appendingPathComponent("swapped")
    try FileManager.default.moveItem(at: update, to: swapped)
    try FileManager.default.createDirectory(at: update, withIntermediateDirectories: true)
    try FileManager.default.moveItem(at: swapped.appendingPathComponent("Ardia.app"), to: update.appendingPathComponent("Ardia.app"))
    XCTAssertNotEqual(survey().found.first?.copy, found.first?.copy)
  }

  func testAnAbandonedCopyDoesntHideAStagedNightlyBesideIt() throws {
    try stage("live")
    try stage("abandoned", plist: false)
    let found = survey()
    XCTAssertEqual(found.found.map(\.copy.folder), [root.appendingPathComponent("live").path])
    XCTAssertEqual(found.residue, [residue("abandoned")])
    XCTAssertFalse(found.blind)
  }

  func testAnInfoPlistThatIsntARegularFileIsResidueAndDoesntBlock() throws {
    let app = try stage(plist: false)
    XCTAssertEqual(mkfifo(app.appendingPathComponent("Contents/Info.plist").path, 0o644), 0)
    let finished = expectation(description: "survey finished")
    var result: StagedSurvey.Survey?
    DispatchQueue.global().async {
      result = self.survey()
      finished.fulfill()
    }
    wait(for: [finished], timeout: 3)
    XCTAssertEqual(result, StagedSurvey.Survey(residue: [residue()]))
  }

  func testASymlinkedInfoPlistIsResidue() throws {
    let app = try stage(plist: false)
    let elsewhere = caches.appendingPathComponent("Info.plist")
    try PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": bundleId, "CFBundleVersion": "91"], format: .xml, options: 0)
      .write(to: elsewhere)
    try FileManager.default.createSymbolicLink(at: app.appendingPathComponent("Contents/Info.plist"), withDestinationURL: elsewhere)
    XCTAssertEqual(survey(), StagedSurvey.Survey(residue: [residue()]))
  }

  func testCopiesInTwoFoldersAreBothFound() throws {
    try stage("first")
    try stage("second", build: "92")
    XCTAssertEqual(Set(survey().found.map(\.copy.build)), ["91", "92"])
  }
}
