import Foundation
import XCTest
@testable import ArdiaImportCore

final class ChromiumChannelTests: XCTestCase {
  let beta = Fixtures.support("BraveSoftware/Brave-Browser-Beta/Default")
  let encryptedOnly = Fixtures.support("BraveSoftware/Brave-Browser-Beta/Profile 1")

  func fixtureSecret(_ service: String, _ account: String) throws -> Data { Fixtures.chromiumSecret }

  func testBraveBetaIsItsOwnSourceAndUsesBravesKeychainItem() throws {
    let list = Fixtures.discovery().list()
    let source = try XCTUnwrap(list.first { $0.id == "braveBeta" })
    XCTAssertEqual(source.name, "Brave Beta")
    XCTAssertEqual(source.keychainService, "Brave Safe Storage")
    XCTAssertTrue(source.needsKeychain)
    XCTAssertEqual(source.profiles.map(\.id), ["Default", "Profile 1"])
    let main = source.profiles[0]
    XCTAssertEqual(main.path, beta.path)
    XCTAssertTrue(Set([ImportKind.history, .passwords, .cookies, .tabs]).isSubset(of: main.available))
    XCTAssertFalse(main.tabsNeedKey)
    XCTAssertTrue(source.profiles[1].tabsNeedKey)
    XCTAssertEqual(list.first { $0.id == "brave" }?.profiles.first?.path,
                   Fixtures.support("BraveSoftware/Brave-Browser/Default").path)
  }

  func testUnlockTriesTheChannelsOwnItemOnlyWhenTheVendorItemIsMissing() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    var asked: [String] = []
    try importer.unlock(browserId: "braveBeta") { service, account in
      asked.append("\(service)|\(account)")
      return Fixtures.chromiumSecret
    }
    XCTAssertEqual(asked, ["Brave Safe Storage|Brave"])

    asked = []
    try importer.unlock(browserId: "edgeBeta") { service, account in
      asked.append(service)
      guard service == "Microsoft Edge Beta Safe Storage" else { throw ImportError.notFound("No \(service)") }
      return Fixtures.chromiumSecret
    }
    XCTAssertEqual(asked, ["Microsoft Edge Safe Storage", "Microsoft Edge Beta Safe Storage"])
    XCTAssertTrue(importer.isUnlocked("edgeBeta"))

    asked = []
    XCTAssertThrowsError(try importer.unlock(browserId: "braveNightly") { service, _ in
      asked.append(service)
      throw ImportError.locked("Access to \(service) was denied")
    }) { XCTAssertEqual(($0 as? ImportError)?.code, "locked") }
    XCTAssertEqual(asked, ["Brave Safe Storage"])
  }

  func testChromium156ProfileImportsCookiesAndTheNewestEncryptedSession() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    try importer.unlock(browserId: "braveBeta", secret: fixtureSecret)
    let result = try importer.importData(browserId: "braveBeta", profileId: "Default",
                                         kinds: [.history, .passwords, .cookies, .tabs])
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(result.historyCount, 1)
    XCTAssertEqual(result.credentials.map(\.password), ["beta-pass"])
    XCTAssertEqual(result.cookieCount, 2)
    XCTAssertEqual(result.cookies.first { $0.name == "sid" }?.value, SecretBytes(Array("beta-session".utf8)))
    XCTAssertEqual(result.tabs.map(\.url), ["https://search.brave.example/", "https://work.brave.example/",
                                            "https://later.brave.example/"])
    XCTAssertEqual(result.tabs.map(\.active), [true, false, false])
  }

  func testTabsWithoutTheKeyReadTheCleartextCopy() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    let result = try importer.importData(browserId: "braveBeta", profileId: "Default", kinds: [.tabs])
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(result.tabs.map(\.url), ["https://search.brave.example/", "https://work.brave.example/"])
  }

  func testAnEncryptedOnlySessionNeedsTheKey() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    let locked = try importer.importData(browserId: "braveBeta", profileId: "Profile 1", kinds: [.tabs])
    XCTAssertEqual(locked.failed, [.tabs])
    XCTAssertEqual(locked.warnings.first?.code, "locked")

    try importer.unlock(browserId: "braveBeta", secret: fixtureSecret)
    let open = try importer.importData(browserId: "braveBeta", profileId: "Profile 1", kinds: [.tabs])
    XCTAssertEqual(open.failed, [])
    XCTAssertEqual(open.tabs.count, 2)
  }

  func testAWrongKeyFailsCookiesButTabsFallBackToCleartext() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    importer.setKey(ChromiumCrypto.deriveKey(secret: Data("wrong".utf8)), for: "braveBeta")
    let result = try importer.importData(browserId: "braveBeta", profileId: "Default", kinds: [.cookies, .tabs])
    XCTAssertEqual(result.failed, [.cookies])
    XCTAssertTrue(result.warnings.contains { $0.kind == .cookies && $0.code == "locked" })
    XCTAssertEqual(result.tabs.count, 2)
  }

  func testAnIncompleteCleartextSessionStillAsksForTheKey() throws {
    let profile = FileManager.default.temporaryDirectory.appendingPathComponent("ardia-sessions-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: profile) }
    let fm = FileManager.default
    try fm.createDirectory(at: profile.appendingPathComponent("Sessions"), withIntermediateDirectories: true)
    try fm.createDirectory(at: profile.appendingPathComponent("Sessions_Encrypted"), withIntermediateDirectories: true)
    var header = Data("SNSS".utf8)
    header.append(contentsOf: [3, 0, 0, 0])
    try header.write(to: profile.appendingPathComponent("Sessions/Session_13432694400000000"))
    try fm.copyItem(at: encryptedOnly.appendingPathComponent("Sessions_Encrypted/Session_13432694400000000"),
                    to: profile.appendingPathComponent("Sessions_Encrypted/Session_13432694401000000"))

    XCTAssertTrue(ChromiumSessions.needsKey(profile: profile))
    XCTAssertFalse(ChromiumSessions.needsKey(profile: beta))
    XCTAssertThrowsError(try ChromiumSessions.load(profile: profile, key: nil))
    XCTAssertEqual(try ChromiumSessions.load(profile: profile, key: Fixtures.chromiumKey).tabs.count, 2)
  }

  func testOneProfileLookupMatchesTheFullListing() throws {
    let d = Fixtures.discovery()
    for (id, profileId) in [("braveBeta", "Default"), ("braveBeta", "Profile 1"), ("chrome", "Default"), ("chrome", "Profile 1")] {
      let def = try XCTUnwrap(BrowserDefinition.find(id))
      let listed = try XCTUnwrap(d.source(def)?.profiles.first { $0.id == profileId })
      XCTAssertEqual(d.profile(def, profileId), listed)
    }
    XCTAssertNil(d.profile(BrowserDefinition.find("braveBeta")!, "Nope"))
  }

  func testCompletenessProbeAgreesWithTheParser() throws {
    let chrome = Fixtures.support("Google/Chrome/Default/Sessions")
    XCTAssertTrue(ChromiumSessions.isComplete(cleartext: chrome.appendingPathComponent("Session_13432694400000000")))
    XCTAssertFalse(ChromiumSessions.isComplete(cleartext: chrome.appendingPathComponent("Session_13432608000000000")))
    XCTAssertFalse(ChromiumSessions.isComplete(cleartext: encryptedOnly.appendingPathComponent("Sessions_Encrypted/Session_13432694400000000")))
  }

  func testSessionFilesWithoutTheMarkerAreSkipped() throws {
    var header = Data("SNSS".utf8)
    header.append(contentsOf: [3, 0, 0, 0])
    XCTAssertThrowsError(try ChromiumSessions.parse(header, key: nil))
    let chrome = Fixtures.support("Google/Chrome/Default")
    XCTAssertEqual(try ChromiumSessions.load(profile: chrome, key: nil).tabs.count, 5)
  }

  func testEncryptedSessionFileDecryptsWithTheSafeStorageKey() throws {
    let data = try Data(contentsOf: Fixtures.url("misc/Session_v5_encrypted"))
    XCTAssertEqual(try ChromiumSessions.parse(data, key: Fixtures.chromiumKey).tabs.count, 5)
    XCTAssertThrowsError(try ChromiumSessions.parse(data, key: nil))
  }

  func testContainerPrefixIsDropped() {
    XCTAssertEqual(ChromiumSessions.withoutContainerPrefix("containers+abc:https://a.example/x?y=1"), "https://a.example/x?y=1")
    XCTAssertEqual(ChromiumSessions.withoutContainerPrefix("https://a.example/"), "https://a.example/")
    XCTAssertEqual(ChromiumSessions.withoutContainerPrefix("containers+abc:nothing"), "containers+abc:nothing")
  }
}
