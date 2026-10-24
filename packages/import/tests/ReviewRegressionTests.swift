import XCTest
@testable import ArdiaImportCore

final class ReviewRegressionTests: XCTestCase {
  func testMalformedFirefoxOriginAttributesDoNotTrap() {
    XCTAssertTrue(Firefox.originAttributes("^=").isolated)
    XCTAssertTrue(Firefox.originAttributes("^=1&userContextId=0").isolated)
    XCTAssertFalse(Firefox.originAttributes("").isolated)
  }

  func testNonV10EncryptedValuesAreUndecryptable() {
    let key = Fixtures.chromiumKey
    XCTAssertNil(ChromiumCrypto.decryptSecret(Data("v11garbage-but-printable".utf8), key: key))
    XCTAssertNil(ChromiumCrypto.decryptSecret(Data("v10".utf8) + Data([1, 2, 3]), key: key))
    XCTAssertNil(ChromiumCrypto.decryptSecret(Data("plain".utf8), key: key, hostKey: "example.com"))
  }

  private func record() -> [UInt8] {
    func le32(_ v: Int) -> [UInt8] { (0..<4).map { UInt8((v >> (8 * $0)) & 0xFF) } }
    let strings: [[UInt8]] = ["a.example", "n", "/", "v"].map { Array($0.utf8) + [0] }
    var offsets: [Int] = []
    var at = 56
    for s in strings {
      offsets.append(at)
      at += s.count
    }
    var r = le32(at) + le32(0) + le32(1) + le32(0)
    for o in offsets { r += le32(o) }
    r += [UInt8](repeating: 0, count: 8)
    r += withUnsafeBytes(of: (4_102_444_800.0 - 978_307_200).bitPattern.littleEndian, Array.init)
    r += withUnsafeBytes(of: (1_700_000_000.0 - 978_307_200).bitPattern.littleEndian, Array.init)
    return r + strings.flatMap { $0 }
  }

  private func file(offsets: (Int) -> [Int], records: Int) -> SecretBytes {
    func le32(_ v: Int) -> [UInt8] { (0..<4).map { UInt8((v >> (8 * $0)) & 0xFF) } }
    let rec = record()
    let table = 8 + 4 * offsets(0).count + 4
    var page: [UInt8] = [0, 0, 1, 0] + le32(offsets(0).count)
    for o in offsets(table) { page += le32(o) }
    page += [0, 0, 0, 0]
    for _ in 0..<records { page += rec }
    let size = page.count
    let header: [UInt8] = Array("cook".utf8) + [0, 0, 0, 1] + [UInt8(size >> 24 & 0xFF), UInt8(size >> 16 & 0xFF), UInt8(size >> 8 & 0xFF), UInt8(size & 0xFF)]
    return SecretBytes(header + page + [UInt8](repeating: 0, count: 8))
  }

  func testSafariRecordsMayNotOverlap() throws {
    let len = record().count
    let good = file(offsets: { t in [t, t + len] }, records: 2)
    XCTAssertEqual(try SafariCookies.parse(good).count, 2)
    let repeated = file(offsets: { t in [t, t] }, records: 1)
    XCTAssertThrowsError(try SafariCookies.parse(repeated))
  }

  func testEscapedSafariCardNumberIsMaskedAndSkipped() throws {
    var data = Data(#"{"payment_cards":[{"card_number":"4111\u0031111111111111","cardholder_name":"A"},{"card_number":"4111111111111111"}]}"#.utf8)
    let cards = try SafariExport.paymentCards(&data)
    XCTAssertEqual(cards.count, 1)
    XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("4111"))
    var hidden = Data(#"{"payment_cards":[{"card\u005fnumber":"4111111111111111"}]}"#.utf8)
    XCTAssertThrowsError(try SafariExport.paymentCards(&hidden))
  }

  private func arcSidebar(littleFirst: Bool) throws -> ArcSidebar {
    let little = """
    {"littleBrowser": {"_0": "temporary-space"}},
    {"spaces": ["temporary-space", {"id": "temporary-space", "profile": {"default": true}, "containerIDs": ["unpinned", "temporary-tabs"]}],
     "topAppsContainerIDs": [],
     "items": ["temporary-tabs", {"id": "temporary-tabs", "data": {"itemContainer": {}}, "childrenIds": [], "title": null}]}
    """
    let main = """
    {"global": {}},
    {"spaces": ["real-space", {"id": "real-space", "title": "Work", "profile": {"default": true}, "containerIDs": ["pinned", "pins"], "newContainerIDs": [{"pinned": {}}, "pins"]}],
     "topAppsContainerIDs": [{"default": true}, "favorites"],
     "items": [
       "pins", {"id": "pins", "data": {"itemContainer": {}}, "childrenIds": ["pinned-tab", "folder", "live", "bitbucket"], "title": null},
       "pinned-tab", {"id": "pinned-tab", "data": {"tab": {"savedURL": "https://example.com/pinned", "savedTitle": "Pinned page"}}, "childrenIds": [], "title": null},
       "folder", {"id": "folder", "data": {"list": {}}, "childrenIds": ["nested-tab"], "title": "Docs"},
       "nested-tab", {"id": "nested-tab", "data": {"tab": {"savedURL": "https://example.com/docs", "savedTitle": "Documentation"}}, "childrenIds": [], "title": null},
       "live", {"id": "live", "data": {"list": {"automaticLiveFolderData": {"source": {"github": {}}}}}, "childrenIds": ["pr"], "title": "Pull Requests"},
       "bitbucket", {"id": "bitbucket", "data": {"list": {"automaticLiveFolderData": {"source": {"bitbucket": {}}}}}, "childrenIds": [], "title": "Reviews"},
       "pr", {"id": "pr", "data": {"tab": {"savedURL": "https://github.com/o/r/pull/1", "savedTitle": "PR"}}, "childrenIds": [], "title": null},
       "favorites", {"id": "favorites", "data": {"itemContainer": {}}, "childrenIds": ["favorite-tab"], "title": null},
       "favorite-tab", {"id": "favorite-tab", "data": {"tab": {"savedURL": "https://example.com/favorite", "savedTitle": "Favorite"}}, "childrenIds": [], "title": null}
     ]}
    """
    let containers = littleFirst ? "\(little),\n\(main)" : "\(main),\n\(little)"
    return try ArcSidebar.parse(Data("{\"version\": 1, \"sidebar\": {\"containers\": [\(containers)]}}".utf8))
  }

  func testArcSidebarReadsTheMainContainerWhateverItsPlace() throws {
    for littleFirst in [true, false] {
      let sidebar = try arcSidebar(littleFirst: littleFirst)
      XCTAssertEqual(sidebar.spaces.map(\.name), ["Work"], "Little Arc first: \(littleFirst)")
      XCTAssertEqual(sidebar.spaces.first?.pinned.reduce(0) { $0 + $1.linkCount }, 2)
      XCTAssertEqual(sidebar.favorites["Default"]?.map(\.url), ["https://example.com/favorite"])
      let live = sidebar.spaces.first?.pinned.filter { $0.role?.hasPrefix("live") == true }
      XCTAssertEqual(live?.map(\.role), ["liveGitHubPullRequests", "liveBitbucketPullRequests"])
      XCTAssertEqual(live?.map(\.title), ["Pull Requests", "Reviews"])
      XCTAssertEqual(live?.flatMap { $0.children ?? [] }, [])
    }
  }
}
