import ArdiaSyncCore
import Foundation
import Testing
@testable import ArdiaSync

@MainActor
@Suite struct PinToMacTests {
  static let scope = SyncEndToEndTests.scope

  func bookmarks(of url: String, on mac: FakeMac) throws -> Int {
    try mac.store(Self.scope).values.filter { ($0 as? [String: Any])?["u"] as? String == url }.count
  }

  @Test func pinningThreeTimesLeavesOneBookmarkOnTheMac() async throws {
    let j = try await SyncHardeningTests().joined()
    defer { j.sandbox.remove() }
    let page = URL(string: "https://tromso.example/")!
    #expect(!j.service.isPinned(page))
    var outcomes: [PinOutcome] = []
    for _ in 0..<3 {
      outcomes.append(await j.service.addBookmark(url: page, title: "Tromsø"))
      #expect(j.service.isPinned(page))
      await j.service.syncNow()
    }
    #expect(outcomes == [.pinned, .alreadyPinned, .alreadyPinned])
    try j.mac.sync([Self.scope])
    let onMac = try bookmarks(of: page.absoluteString, on: j.mac)
    #expect(onMac == 1)
    #expect(j.service.isPinned(page))
    await j.service.stopSyncing()
  }

  @Test func aPageTheMacAlreadyBookmarkedShowsAsPinnedAndAddsNothing() async throws {
    let j = try await SyncHardeningTests().joined()
    defer { j.sandbox.remove() }
    try j.mac.put(Self.scope, "bm:fromMac", #"{"k":"u","p":"bar","t":"Fjord","u":"https://fjord.example/","a":1,"pos":"1"}"#)
    try j.mac.sync([Self.scope])
    j.clock.advance(15)
    await j.service.syncNow()
    let page = URL(string: "https://fjord.example/")!
    #expect(j.service.isPinned(page))
    #expect(await j.service.addBookmark(url: page, title: "Fjord") == .alreadyPinned)
    await j.service.syncNow()
    try j.mac.sync([Self.scope])
    #expect(try bookmarks(of: page.absoluteString, on: j.mac) == 1)
    await j.service.stopSyncing()
  }
}
