import ArdiaSync
import Foundation

public enum BookmarkTree {
  public struct Root: Identifiable, Hashable, Sendable {
    public var kind: BookmarkItem.Root
    public var items: [BookmarkItem]

    public var id: String { kind.rawValue }
    public var title: String { BookmarkTree.title(of: kind) }
  }

  public struct Match: Identifiable, Hashable, Sendable {
    public var item: BookmarkItem
    public var path: [String]

    public var id: String { item.key }
  }

  public static func title(of root: BookmarkItem.Root) -> String {
    switch root {
    case .bar: String(localized: "Bookmarks Bar")
    case .other: String(localized: "Other Bookmarks")
    }
  }

  public static func roots(_ items: [BookmarkItem]) -> [Root] {
    let bar = items.filter { $0.root == .bar }
    let other = items.filter { $0.root != .bar }
    return [Root(kind: .bar, items: bar), Root(kind: .other, items: other)].filter { !$0.items.isEmpty }
  }

  public static func pageCount(_ item: BookmarkItem) -> Int {
    guard item.isFolder else { return 1 }
    return (item.children ?? []).reduce(0) { $0 + pageCount($1) }
  }

  public static func search(_ items: [BookmarkItem], query: String) -> [Match] {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return [] }
    return roots(items).flatMap { root in
      matches(in: root.items, path: [root.title], query: trimmed)
    }
  }

  private static func matches(in items: [BookmarkItem], path: [String], query: String) -> [Match] {
    items.flatMap { item -> [Match] in
      let found = item.title.localizedStandardContains(query) || (item.url?.localizedStandardContains(query) ?? false)
      let own = found ? [Match(item: item, path: path)] : []
      let inside = item.isFolder ? matches(in: item.children ?? [], path: path + [item.title], query: query) : []
      return own + inside
    }
  }
}
