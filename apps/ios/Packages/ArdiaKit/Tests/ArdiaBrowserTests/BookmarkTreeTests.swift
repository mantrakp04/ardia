import ArdiaSync
import Foundation
import Testing
@testable import ArdiaBrowser

@Suite struct BookmarkTreeTests {
  static let added = Date(timeIntervalSinceReferenceDate: 800_000_000)

  static func page(_ key: String, _ title: String, _ url: String, root: BookmarkItem.Root? = nil) -> BookmarkItem {
    BookmarkItem(key: key, title: title, url: url, added: added, root: root, children: nil)
  }

  static func folder(_ key: String, _ title: String, root: BookmarkItem.Root? = nil, _ children: [BookmarkItem]) -> BookmarkItem {
    BookmarkItem(key: key, title: title, url: nil, added: added, root: root, children: children)
  }

  static let tree: [BookmarkItem] = [
    page("apple", "Apple", "https://www.apple.com/", root: .bar),
    folder("reading", "Reading", root: .bar, [
      page("swift", "The Swift Programming Language", "https://docs.swift.org/swift-book/"),
      folder("design", "Design", [
        page("hig", "Human Interface Guidelines", "https://developer.apple.com/design/human-interface-guidelines/"),
      ]),
    ]),
    page("weather", "Weather", "https://weather.com/", root: .other),
    page("loose", "Loose", "https://loose.example/"),
  ]

  @Test func rootsFollowTheMacsBarThenOtherOrderAndSkipEmptyOnes() {
    let roots = BookmarkTree.roots(Self.tree)
    #expect(roots.map(\.kind) == [.bar, .other])
    #expect(roots[0].items.map(\.key) == ["apple", "reading"])
    #expect(roots[1].items.map(\.key) == ["weather", "loose"])
    #expect(BookmarkTree.roots([Self.page("only", "Only", "https://only.example/", root: .other)]).map(\.kind) == [.other])
    #expect(BookmarkTree.roots([]).isEmpty)
  }

  @Test func folderCountsEveryPageInside() {
    #expect(BookmarkTree.pageCount(Self.tree[1]) == 2)
    #expect(BookmarkTree.pageCount(Self.tree[0]) == 1)
    #expect(BookmarkTree.pageCount(Self.folder("empty", "Empty", [])) == 0)
  }

  @Test func searchFindsPagesAndFoldersWithTheirPath() {
    let pages = BookmarkTree.search(Self.tree, query: "interface")
    #expect(pages.map(\.item.key) == ["hig"])
    #expect(pages.first?.path == ["Bookmarks Bar", "Reading", "Design"])
    let folders = BookmarkTree.search(Self.tree, query: "design")
    #expect(folders.map(\.item.key) == ["design", "hig"])
    #expect(BookmarkTree.search(Self.tree, query: "weather.com").first?.path == ["Other Bookmarks"])
    #expect(BookmarkTree.search(Self.tree, query: "  ").isEmpty)
  }

  @Test func searchIgnoresCaseAndAccents() {
    let tree = [Self.page("cafe", "Café Lisboa", "https://cafe.example/", root: .bar)]
    #expect(BookmarkTree.search(tree, query: "CAFE").map(\.item.key) == ["cafe"])
  }
}
