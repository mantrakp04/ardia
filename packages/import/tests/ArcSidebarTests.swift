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

  func testSplitMarksReachJavaScript() throws {
    let home = try space("Home")
    let json = String(decoding: try JSONEncoder().encode(home), as: UTF8.self)
    XCTAssertTrue(json.contains(#""role":"split""#))
    XCTAssertTrue(json.contains(#""splitId":"H-USV""#))
  }
}
