import AppKit

struct MenuState {
  struct Entry: Equatable {
    let id: String
    let title: String
    let current: Bool
  }

  struct Bookmark {
    let id: String
    let title: String
    let url: String?
    let children: [Bookmark]?
  }

  static var current = MenuState()

  var checked = Set<String>()
  var disabled = Set<String>()
  var titles: [String: String] = [:]
  var profiles: [Entry] = []
  var windows: [Entry] = []
  var bookmarkFolders: [Entry] = []
  var recentBookmarks: [Bookmark] = []
  var bookmarksBar: [Bookmark] = []
  var otherBookmarks: [Bookmark] = []
  var bookmarksRevision: Int?
  var recentlyClosed: [Entry] = []
  var recentlyClosedGroups: [Entry] = []
  var warnBeforeQuitting = false
  var warnBeforeClosingWindow = false
  var undoReopensClosedTab = false
  var downloadsInProgress = 0
  var shortcuts: [String: [String]] = [:]
  var extensions: [(id: String, title: String, icon: String?)] = []
  var fromApp = false

  init() {}

  static func bookmarks(_ list: Any?) -> [Bookmark] {
    (list as? [[String: Any]] ?? []).map {
      Bookmark(
        id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "", url: $0["url"] as? String,
        children: $0["children"] == nil ? nil : bookmarks($0["children"]))
    }
  }

  private(set) static var sentBookmarks: (state: MenuState, revision: Int)?

  static func setBookmarks(_ d: [String: Any]) {
    var state = MenuState()
    state.bookmarkFolders = (d["bookmarkFolders"] as? [[String: Any]] ?? []).map {
      Entry(id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "", current: $0["current"] as? Bool ?? false)
    }
    state.recentBookmarks = bookmarks(d["recentBookmarks"])
    state.bookmarksBar = bookmarks(d["bookmarksBar"])
    state.otherBookmarks = bookmarks(d["otherBookmarks"])
    let revision = (sentBookmarks?.revision ?? 0) + 1
    sentBookmarks = (state, revision)
    current.bookmarkFolders = state.bookmarkFolders
    current.recentBookmarks = state.recentBookmarks
    current.bookmarksBar = state.bookmarksBar
    current.otherBookmarks = state.otherBookmarks
    current.bookmarksRevision = revision
  }

  init(_ d: [String: Any]) {
    func strings(_ key: String) -> [String] { d[key] as? [String] ?? [] }
    func entries(_ key: String) -> [Entry] {
      (d[key] as? [[String: Any]] ?? []).map {
        Entry(id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "", current: $0["current"] as? Bool ?? false)
      }
    }
    checked = Set(strings("checked"))
    disabled = Set(strings("disabled"))
    titles = d["titles"] as? [String: String] ?? [:]
    profiles = entries("profiles")
    windows = entries("windows")
    if d["bookmarksBar"] == nil, let sent = MenuState.sentBookmarks {
      (bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks) =
        (sent.state.bookmarkFolders, sent.state.recentBookmarks, sent.state.bookmarksBar, sent.state.otherBookmarks)
      bookmarksRevision = sent.revision
    } else {
      bookmarkFolders = entries("bookmarkFolders")
      recentBookmarks = Self.bookmarks(d["recentBookmarks"])
      bookmarksBar = Self.bookmarks(d["bookmarksBar"])
      otherBookmarks = Self.bookmarks(d["otherBookmarks"])
    }
    recentlyClosed = entries("recentlyClosed")
    recentlyClosedGroups = entries("recentlyClosedGroups")
    warnBeforeQuitting = d["warnBeforeQuitting"] as? Bool ?? false
    warnBeforeClosingWindow = d["warnBeforeClosingWindow"] as? Bool ?? false
    undoReopensClosedTab = d["undoReopensClosedTab"] as? Bool ?? false
    downloadsInProgress = d["downloadsInProgress"] as? Int ?? 0
    shortcuts = d["shortcuts"] as? [String: [String]] ?? [:]
    fromApp = true
    extensions = (d["extensions"] as? [[String: Any]] ?? []).map {
      (id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "", icon: $0["icon"] as? String)
    }
  }
}
