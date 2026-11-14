import CoreGraphics
import Foundation
import XCTest
@testable import ArdiaSyncCore

final class WindowsInteropTests: XCTestCase {
  static let entropy = Data((1...32).map(UInt8.init))
  static let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("fixtures/windows-interop", isDirectory: true)
  static let documents: [(scope: String, json: String)] = [
    ("app", #"{"records":{"pw:1":{"k":"pw:1","v":{"o":"https://example.com","u":"ada","p":"correct horse"}}},"pw:2":{"v":{"o":"https://ardia.dev","u":"grace","p":"battery staple"}}}"#),
    ("profile-mac", #"{"title":"Ünïcode ✓","bookmarks":["https://ardia.dev/"]}"#),
  ]
  static let password = (origin: "https://example.com", username: "ada", password: "correct horse")
  static let local = #"{"state":1}"#

  struct Manifest: Codable {
    var entropy: String
    var words: [String]
    var chainTag: String
    var scopeTags: [String: String]
    var files: [FileEntry]
    var local: Sealed
    var password: PasswordEntry
  }

  struct FileEntry: Codable {
    var scope: String
    var id: String
    var payload: String
  }

  struct Sealed: Codable {
    var plain: String
    var sealed: String
  }

  struct PasswordEntry: Codable {
    var origin: String
    var username: String
    var password: String
    var sealed: String
  }

  func testWriteMacFixtures() throws {
    guard ProcessInfo.processInfo.environment["ARDIA_WRITE_SYNC_FIXTURES"] == "1" else { throw XCTSkip("set ARDIA_WRITE_SYNC_FIXTURES=1 to write the Mac fixture vault") }
    let keys = SyncKeys(entropy: Self.entropy)
    let folder = Self.fixtures.appendingPathComponent("mac", isDirectory: true)
    try? FileManager.default.removeItem(at: folder)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let vault = SyncVault(folder: folder, keys: keys)
    try vault.createChain()
    var files: [FileEntry] = []
    for document in Self.documents {
      let id = try vault.write(scope: document.scope, payload: Data(document.json.utf8))
      files.append(FileEntry(scope: document.scope, id: id, payload: document.json))
    }
    let manifest = Manifest(
      entropy: Self.entropy.map { String(format: "%02x", $0) }.joined(),
      words: RecoveryPhrase.words(for: Self.entropy),
      chainTag: keys.chainTag,
      scopeTags: Dictionary(uniqueKeysWithValues: Self.documents.map { ($0.scope, keys.scopeTag($0.scope)) }),
      files: files,
      local: Sealed(plain: Self.local, sealed: try keys.seal(Data(Self.local.utf8), scopeTag: "local", fileId: "state").base64EncodedString()),
      password: PasswordEntry(
        origin: Self.password.origin, username: Self.password.username, password: Self.password.password,
        sealed: try keys.sealPassword(Self.password.password, origin: Self.password.origin, username: Self.password.username))
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    try encoder.encode(manifest).write(to: Self.fixtures.appendingPathComponent("mac.json"))
    try Data(Self.qrMatrix(manifest.words).utf8).write(to: Self.fixtures.appendingPathComponent("qr.txt"))
  }

  static func qrMatrix(_ words: [String]) -> String {
    let image = RecoveryKit.qrCode(words: words, scale: 1)!
    var pixels = [UInt8](repeating: 0, count: image.width * image.height)
    let context = CGContext(data: &pixels, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: 0)!
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    return (0..<image.height).map { y in (0..<image.width).map { x in pixels[y * image.width + x] < 128 ? "1" : "0" }.joined() }.joined(separator: "\n") + "\n"
  }

  func testQrFixtureIsCoreImages() throws {
    let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: Self.fixtures.appendingPathComponent("mac.json")))
    XCTAssertEqual(try String(contentsOf: Self.fixtures.appendingPathComponent("qr.txt"), encoding: .utf8), Self.qrMatrix(manifest.words))
  }

  func testMacFixturesStillOpen() throws {
    try check(folder: "mac")
  }

  func testWindowsWrittenVaultOpensOnTheMac() throws {
    try check(folder: "windows")
  }

  private func check(folder name: String) throws {
    let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: Self.fixtures.appendingPathComponent("\(name).json")))
    let entropy = Data(stride(from: 0, to: manifest.entropy.count, by: 2).map { offset -> UInt8 in
      let start = manifest.entropy.index(manifest.entropy.startIndex, offsetBy: offset)
      return UInt8(manifest.entropy[start..<manifest.entropy.index(start, offsetBy: 2)], radix: 16)!
    })
    XCTAssertEqual(try RecoveryPhrase.entropy(from: manifest.words.joined(separator: " ")), entropy)
    let keys = SyncKeys(entropy: entropy)
    XCTAssertEqual(keys.chainTag, manifest.chainTag)
    let vault = SyncVault(folder: Self.fixtures.appendingPathComponent(name, isDirectory: true), keys: keys)
    XCTAssertTrue(vault.chainExists())
    for (scope, tag) in manifest.scopeTags { XCTAssertEqual(keys.scopeTag(scope), tag) }
    for file in manifest.files {
      let listing = try vault.read(scope: file.scope, skipping: [])
      XCTAssertEqual(listing.damaged.count, 0)
      let read = try XCTUnwrap(listing.files.first { $0.id == file.id })
      XCTAssertEqual(try JSONSerialization.jsonObject(with: read.payload) as? NSDictionary, try JSONSerialization.jsonObject(with: Data(file.payload.utf8)) as? NSDictionary)
    }
    let local = try XCTUnwrap(Data(base64Encoded: manifest.local.sealed))
    XCTAssertEqual(String(decoding: try keys.open(local, scopeTag: "local", fileId: "state"), as: UTF8.self), manifest.local.plain)
    let password = manifest.password
    XCTAssertEqual(try keys.openPassword(password.sealed, origin: password.origin, username: password.username), password.password)
    XCTAssertEqual(try keys.sealPassword(password.password, origin: password.origin, username: password.username), password.sealed)
  }
}
