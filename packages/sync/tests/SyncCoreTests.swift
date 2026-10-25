import Foundation
import XCTest
@testable import ArdiaSyncCore

final class RecoveryPhraseTests: XCTestCase {
  func testReferenceVectors() throws {
    let vectors: [(UInt8, String)] = [
      (0x00, Array(repeating: "abandon", count: 23).joined(separator: " ") + " art"),
      (0x7f, "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title"),
      (0x80, "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless"),
      (0xff, Array(repeating: "zoo", count: 23).joined(separator: " ") + " vote"),
    ]
    for (byte, phrase) in vectors {
      let entropy = Data(repeating: byte, count: 32)
      XCTAssertEqual(RecoveryPhrase.words(for: entropy).joined(separator: " "), phrase)
      XCTAssertEqual(try RecoveryPhrase.entropy(from: phrase), entropy)
    }
  }
}

final class SyncCryptoTests: XCTestCase {
  let keys = SyncKeys(entropy: RecoveryPhrase.generateEntropy())

  func testTamperingIsDetected() throws {
    let sealed = try keys.seal(Data("bookmark".utf8), scopeTag: "s", fileId: "f")
    for index in [4, 10, 16, 40, sealed.count - 1] {
      var bad = sealed
      bad[index] ^= 0x01
      XCTAssertThrowsError(try keys.open(bad, scopeTag: "s", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .authentication) }
    }
    XCTAssertThrowsError(try keys.open(sealed.prefix(sealed.count / 2), scopeTag: "s", fileId: "f"))
    XCTAssertThrowsError(try keys.open(sealed.prefix(10), scopeTag: "s", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .format) }
    XCTAssertThrowsError(try keys.open(Data(), scopeTag: "s", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .format) }
    XCTAssertThrowsError(try keys.open(sealed, scopeTag: "s", fileId: "g")) { XCTAssertEqual($0 as? SyncKeys.Failure, .authentication) }
    XCTAssertThrowsError(try keys.open(sealed, scopeTag: "t", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .authentication) }
  }

  func testWrongPhraseCantOpen() throws {
    let sealed = try keys.seal(Data("bookmark".utf8), scopeTag: "s", fileId: "f")
    let other = SyncKeys(entropy: RecoveryPhrase.generateEntropy())
    XCTAssertThrowsError(try other.open(sealed, scopeTag: "s", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .authentication) }
    XCTAssertNotEqual(other.chainTag, keys.chainTag)
  }
}

final class SyncPasswordsTests: XCTestCase {
  let passwords = SyncPasswords(entropy: RecoveryPhrase.generateEntropy())
  let password = "hunter2 \u{e9} \u{1F600} \\ / \n \"q\""

  func parsed(_ json: String) throws -> NSDictionary {
    try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? NSDictionary)
  }

  func testLogWireHoldsThePasswordAndLocalStateOnlyItsDigestAndSecret() throws {
    let bookmark = #"{"k":"bm:x","h":"0","v":{"k":"u","p":"bar","t":"pw: \"bank\"","u":"https://bank.example/"}}"#
    let wire = #"{"v":1,"kind":"log","device":"devA","seq":3,"at":1729,"ops":["# + bookmark
      + #",{"k":"pw:https://bank.example\nalice","h":"1","v":{"o":"https://bank.example","u":"alice \"a\"","p":"hunter2 é 😀 \\ \/ \n \"q\""}},{"k":"pw:https://gone.example\nbob","h":"2","v":null}]}"#
    let local = try passwords.fromWire(wire)
    XCTAssertFalse(local.contains("hunter2"))
    XCTAssertTrue(local.contains(bookmark), "other records keep their bytes")
    let value = try XCTUnwrap(((try parsed(local))["ops"] as? [NSDictionary])?[1]["v"] as? [String: String])
    XCTAssertEqual(Set(value.keys), ["o", "u", "d", "s"])
    XCTAssertEqual(value["u"], "alice \"a\"")
    XCTAssertEqual(value["d"], passwords.digest(password))
    XCTAssertEqual(passwords.open(try XCTUnwrap(value["s"])), password)
    let back = try passwords.toWire(local)
    XCTAssertEqual(try parsed(back), try parsed(wire))
    XCTAssertTrue(back.contains(bookmark))
    XCTAssertTrue(back.contains(#"{"o":"https://bank.example","u":"alice \"a\"","p":"hunter2 é 😀 \\ / \n \"q\""}"#), "written as JSON.stringify writes it")
  }

  func testSnapshotRecordsRoundTrip() throws {
    let wire = #"{"v":1,"kind":"snapshot","device":"devB","at":5,"vv":{"devA":3},"seen":{"devA":4},"records":{"h:https://a.example/":{"h":"9","v":{"t":"A","n":1,"vt":[1.5e3,2]},"o":["devA",2]},"pw:https://a.example\nalice":{"h":"1","v":{"o":"https://a.example","u":"alice","p":"s3cret"},"o":["devA",1]},"pw:https://b.example\nbob":{"h":"2","v":null,"o":["devA",3]}}}"#
    let local = try passwords.fromWire(wire)
    XCTAssertFalse(local.contains("s3cret"))
    XCTAssertTrue(local.contains(#""h:https://a.example/":{"h":"9","v":{"t":"A","n":1,"vt":[1.5e3,2]},"o":["devA",2]}"#))
    XCTAssertEqual(try parsed(try passwords.toWire(local)), try parsed(wire))
  }

  func testPayloadsWithoutPasswordsAreUntouched() throws {
    let plain = #"{"v":1,"kind":"log","device":"d","seq":1,"at":1,"ops":[{"k":"bm:y","h":"3","v":{"t":"pw:x","u":"u","p":"bar"}}]}"#
    XCTAssertEqual(try passwords.fromWire(plain), plain)
    XCTAssertEqual(try passwords.toWire(plain), plain)
    let titled = #"{"ops":[{"k":"bm:z","h":"1","v":{"t":"\"pw:","p":"bar"}}]}"#
    XCTAssertEqual(try passwords.fromWire(titled), titled)
    let broken = #"{"ops":[{"k":"pw:a\nb","v":{"p":"x"}"#
    XCTAssertThrowsError(try passwords.fromWire(broken))
    XCTAssertThrowsError(try passwords.toWire(broken))
  }

  func testAPasswordWithALoneSurrogateIsRefusedNotChanged() throws {
    let lone = #"{"ops":[{"k":"pw:a\nb","h":"1","v":{"o":"a","u":"b","p":"x\ud800y"}}]}"#
    XCTAssertThrowsError(try passwords.fromWire(lone)) { XCTAssertEqual($0 as? SyncPasswords.Failure, .malformed) }
    let elsewhere = #"{"ops":[{"k":"pw:a\nb","h":"1","v":{"o":"a\udc00","u":"b","p":"ok"}}]}"#
    XCTAssertFalse(try passwords.fromWire(elsewhere).contains(#""p":"ok""#))
  }

  func testLegacyValuesPassThroughAndForeignSecretsRefuse() throws {
    let legacy = #"{"ops":[{"k":"pw:a\nb","h":"1","v":{"o":"a","u":"b","p":"old"}}]}"#
    XCTAssertEqual(try passwords.toWire(legacy), legacy)
    let foreign = try SyncPasswords(entropy: RecoveryPhrase.generateEntropy()).fromWire(legacy)
    XCTAssertThrowsError(try passwords.toWire(foreign)) { XCTAssertEqual($0 as? SyncPasswords.Failure, .unreadableSecret) }
    XCTAssertNotEqual(SyncPasswords(entropy: RecoveryPhrase.generateEntropy()).digest("old"), passwords.digest("old"))
    XCTAssertNotEqual(try passwords.seal("old"), try passwords.seal("old"))
  }
}

final class SyncVaultTests: XCTestCase {
  var folder: URL!
  let entropy = RecoveryPhrase.generateEntropy()
  var vault: SyncVault!

  override func setUpWithError() throws {
    folder = FileManager.default.temporaryDirectory.appendingPathComponent("ac-sync-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    vault = SyncVault(folder: folder, keys: SyncKeys(entropy: entropy))
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: folder)
  }

  func testFolderHoldsNoPlaintext() throws {
    try vault.createChain()
    let secrets = ["https://secret-bank.example/login", "Quarterly Plans", "hunter2-password", "alice@example.com"]
    try vault.write(scope: "p:default", payload: try JSONSerialization.data(withJSONObject: ["secrets": secrets]))
    let files = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: nil)!.compactMap { $0 as? URL }
    XCTAssertFalse(files.isEmpty)
    for url in files {
      let name = url.deletingPathExtension().lastPathComponent
      XCTAssertTrue(Base32.isTag(name), name)
      for secret in secrets + ["default", "app"] {
        XCTAssertFalse(url.path.dropFirst(folder.path.count).contains(secret))
      }
      guard let data = try? Data(contentsOf: url) else { continue }
      for secret in secrets { XCTAssertNil(data.range(of: Data(secret.utf8)), "\(secret) in \(url.lastPathComponent)") }
    }
  }

  func testDeleteChainLeavesOtherPhrases() throws {
    try vault.createChain()
    try vault.write(scope: "app", payload: Data("mine".utf8))
    let other = SyncVault(folder: folder, keys: SyncKeys(entropy: RecoveryPhrase.generateEntropy()))
    try other.createChain()
    try other.write(scope: "app", payload: Data("theirs".utf8))
    try vault.deleteChain()
    XCTAssertFalse(vault.chainExists())
    XCTAssertEqual(other.read(scope: "app", skipping: []).files.count, 1)
  }
}
