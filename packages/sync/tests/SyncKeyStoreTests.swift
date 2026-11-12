import Foundation
import Security
import XCTest
@testable import ArdiaSyncCore

private final class FakeKeychainCalls: KeychainCalls {
  var items: [String: Data] = [:]
  var refuseWrites = false

  private func key(_ query: [String: Any]) -> String {
    "\(query[kSecAttrService as String] ?? "")/\(query[kSecAttrAccount as String] ?? "")"
  }

  func copy(_ query: [String: Any]) -> (status: OSStatus, data: Data?) {
    items[key(query)].map { (errSecSuccess, $0) } ?? (errSecItemNotFound, nil)
  }

  func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus {
    guard items[key(query)] != nil else { return errSecItemNotFound }
    guard !refuseWrites else { return errSecInteractionNotAllowed }
    items[key(query)] = attributes[kSecValueData as String] as? Data
    return errSecSuccess
  }

  func add(_ attributes: [String: Any]) -> OSStatus {
    guard !refuseWrites else { return errSecInteractionNotAllowed }
    guard items[key(attributes)] == nil else { return errSecDuplicateItem }
    items[key(attributes)] = attributes[kSecValueData as String] as? Data
    return errSecSuccess
  }

  func delete(_ query: [String: Any]) -> OSStatus {
    items.removeValue(forKey: key(query)) == nil ? errSecItemNotFound : errSecSuccess
  }
}

final class SyncKeyStoreTests: XCTestCase {
  func testSavingAgainReplacesTheKey() {
    let keychain = FakeKeychainCalls()
    let store = KeychainKeyStore(service: "Ardia Sync Key", calls: keychain)
    XCTAssertTrue(store.save(Data("first".utf8), account: "device"))
    XCTAssertTrue(store.save(Data("second".utf8), account: "device"))
    XCTAssertEqual(store.load(account: "device"), Data("second".utf8))
    store.delete(account: "device")
    XCTAssertNil(store.load(account: "device"))
  }

  func testASaveThatFailsKeepsTheKeyItReplaces() {
    let keychain = FakeKeychainCalls()
    let store = KeychainKeyStore(service: "Ardia Sync Key", calls: keychain)
    let kept = Data("the key in use".utf8)
    XCTAssertTrue(store.save(kept, account: "device"))
    keychain.refuseWrites = true
    XCTAssertFalse(store.save(Data("a phrase typed again".utf8), account: "device"))
    XCTAssertEqual(store.load(account: "device"), kept)
  }

  func testTheKeyFileIsOnlyEverTheOwnersAndNothingIsLeftBeside() throws {
    let fm = FileManager.default
    let folder = fm.temporaryDirectory.appendingPathComponent("sync-key-store-\(UUID().uuidString)", isDirectory: true)
    defer { try? fm.removeItem(at: folder) }
    let store = FileKeyStore(directory: folder)
    let previous = umask(0)
    defer { umask(previous) }
    XCTAssertTrue(store.save(Data("first".utf8), account: "device"))
    let file = folder.appendingPathComponent("sync-key-device")
    XCTAssertEqual(try fm.attributesOfItem(atPath: file.path)[.posixPermissions] as? Int, 0o600)

    try fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
    XCTAssertTrue(store.save(Data("second".utf8), account: "device"))
    XCTAssertEqual(try fm.attributesOfItem(atPath: file.path)[.posixPermissions] as? Int, 0o600)
    XCTAssertEqual(store.load(account: "device"), Data("second".utf8))
    XCTAssertEqual(try fm.contentsOfDirectory(atPath: folder.path), ["sync-key-device"])
  }
}
