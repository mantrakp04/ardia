import Foundation
import XCTest
@testable import ArdiaImportCore

final class ArcSidebarTests: XCTestCase {
  private func sidebar() throws -> ArcSidebar {
    try ArcSidebar.parse(Data(contentsOf: Fixtures.url("arc-sidebar/StorableSidebar.json")))
  }

  private func space(_ name: String) throws -> SpaceSuggestion {
    try XCTUnwrap(sidebar().spaces.first { $0.name == name })
  }

  func testTopLevelPinnedTabsAndFoldersKeepTheirPlace() throws {
    let home = try space("Home")
    XCTAssertEqual(home.pinned.map(\.type), [.url, .folder, .folder, .url, .url])
    XCTAssertEqual(home.pinned.map(\.title), ["Mail", "Docs pair", "Projects", "Cal", "Pinned, missing from childrenIds"])
    XCTAssertEqual(home.pinned[3].pageTitle, "Calendar")
    XCTAssertEqual(home.pinned.reduce(0) { $0 + $1.linkCount }, 8)
  }

  func testPinnedSplitViewsComeOverAsSplitsWithEveryPane() throws {
    let home = try space("Home")
    let top = home.pinned[1]
    XCTAssertEqual(top.role, ArcSidebar.splitRole)
    XCTAssertEqual(top.children?.map(\.url), ["https://docs.example/a", "https://mail.example/"])
    let projects = home.pinned[2]
    XCTAssertNil(projects.role)
    XCTAssertEqual(projects.children?.map(\.type), [.url, .folder])
    let inner = try XCTUnwrap(projects.children?.last)
    XCTAssertEqual(inner.role, ArcSidebar.splitRole)
    XCTAssertEqual(inner.children?.map(\.url), ["https://spec.example/", "https://figma.example/"])
  }

  func testUnpinnedSplitViewsMarkTheirTabsAndArchivedTabsStayOut() throws {
    let home = try space("Home")
    XCTAssertEqual(home.tabs.map(\.url), ["https://news.example/", "https://one.example/", "https://two.example/", "https://three.example/"])
    XCTAssertEqual(home.tabs.map(\.splitId), [nil, "H-USV", "H-USV", "H-USV"])
    XCTAssertTrue(home.tabs.allSatisfy { !$0.pinned })
  }

  func testEverySpaceAndEveryPinnedContainerIsRead() throws {
    let all = try sidebar()
    XCTAssertEqual(all.spaces.map(\.name), ["Home", "Work"])
    let work = try space("Work")
    XCTAssertEqual(work.pinned.map(\.title), ["Board", "", "Wiki"])
    XCTAssertEqual(work.pinned[1].role, ArcSidebar.splitRole)
    XCTAssertEqual(work.pinned[1].children?.count, 4)
  }

  func testFavoritesKeepEveryPaneOfASplitAsATile() throws {
    let favorites = try XCTUnwrap(sidebar().favorites["Default"])
    XCTAssertEqual(favorites.map(\.url), ["https://music.example/", "https://chat.example/", "https://video.example/"])
    XCTAssertTrue(favorites.allSatisfy { $0.splitId == nil && $0.pinned })
  }

  private let foldedSidebar = Data(#"""
  {"sidebar": {"containers": [{"global": {}}, {
    "spaces": ["S1", {"id": "S1", "title": "One", "profile": {"default": true}, "containerIDs": ["pinned", "P1"]},
               "S2", {"id": "S2", "title": "Two", "profile": {"default": true}, "containerIDs": ["pinned", "P2"]}],
    "items": [
      "P1", {"id": "P1", "childrenIds": ["F-OPEN", "F-SHUT", "F-PEEK"], "data": {"itemContainer": {}}},
      "F-OPEN", {"id": "F-OPEN", "parentID": "P1", "title": "Open", "childrenIds": ["T1", "F-INNER"], "data": {"list": {}}},
      "T1", {"id": "T1", "parentID": "F-OPEN", "data": {"tab": {"savedURL": "https://one.example/", "savedTitle": "One"}}},
      "F-INNER", {"id": "F-INNER", "parentID": "F-OPEN", "title": "Inner", "childrenIds": ["T2"], "data": {"list": {}}},
      "T2", {"id": "T2", "parentID": "F-INNER", "data": {"tab": {"savedURL": "https://two.example/", "savedTitle": "Two"}}},
      "F-SHUT", {"id": "F-SHUT", "parentID": "P1", "title": "Shut", "childrenIds": ["T3"], "data": {"list": {}}},
      "T3", {"id": "T3", "parentID": "F-SHUT", "data": {"tab": {"savedURL": "https://three.example/", "savedTitle": "Three"}}},
      "F-PEEK", {"id": "F-PEEK", "parentID": "P1", "title": "Peeked", "childrenIds": ["T4"], "data": {"list": {}}},
      "T4", {"id": "T4", "parentID": "F-PEEK", "data": {"tab": {"savedURL": "https://four.example/", "savedTitle": "Four"}}},
      "P2", {"id": "P2", "childrenIds": ["T5"], "data": {"itemContainer": {}}},
      "T5", {"id": "T5", "parentID": "P2", "data": {"tab": {"savedURL": "https://five.example/", "savedTitle": "Five"}}}
    ]}]}}
  """#.utf8)

  private let foldedWindows = Data(#"""
  {"version": 1, "windows": [{"id": "W1", "expandedItems": ["F-OPEN", {"expanded": {}}, "F-PEEK", {"peeked": {}}],
                              "spacesWithCollapsedPinnedSections": ["S2"]}]}
  """#.utf8)

  func testFoldersKeepArcsOpenOrClosedStateAndPeekedOnesComeOverClosed() throws {
    let one = try XCTUnwrap(ArcSidebar.parse(foldedSidebar, windows: foldedWindows).spaces.first { $0.name == "One" })
    XCTAssertEqual(one.pinned.map(\.title), ["Open", "Shut", "Peeked"])
    XCTAssertEqual(one.pinned.map(\.collapsed), [false, true, true])
    XCTAssertEqual(one.pinned[0].children?.last?.title, "Inner")
    XCTAssertEqual(one.pinned[0].children?.last?.collapsed, true)
  }

  func testASpaceWhosePinnedSectionArcCollapsedSaysSo() throws {
    let spaces = try ArcSidebar.parse(foldedSidebar, windows: foldedWindows).spaces
    XCTAssertEqual(spaces.map(\.name), ["One", "Two"])
    XCTAssertEqual(spaces.map(\.pinnedCollapsed), [false, true])
  }

  func testWithoutArcsWindowStateFoldersAndSpacesCarryNoFoldState() throws {
    for windows in [nil, Data("{}".utf8), Data(#"{"windows": [{"id": "W1"}]}"#.utf8)] {
      let spaces = try ArcSidebar.parse(foldedSidebar, windows: windows).spaces
      XCTAssertEqual(spaces.flatMap(\.pinned).map(\.collapsed), [nil, nil, nil, nil])
      XCTAssertEqual(spaces.map(\.pinnedCollapsed), [nil, nil])
    }
  }

  func testFoldStateReachesJavaScript() throws {
    let one = try XCTUnwrap(ArcSidebar.parse(foldedSidebar, windows: foldedWindows).spaces.first)
    let json = String(decoding: try JSONEncoder().encode(one), as: UTF8.self)
    XCTAssertTrue(json.contains(#""collapsed":true"#))
    XCTAssertTrue(json.contains(#""pinnedCollapsed":false"#))
  }

  func testSplitMarksReachJavaScript() throws {
    let home = try space("Home")
    let json = String(decoding: try JSONEncoder().encode(home), as: UTF8.self)
    XCTAssertTrue(json.contains(#""role":"split""#))
    XCTAssertTrue(json.contains(#""splitId":"H-USV""#))
  }
}
