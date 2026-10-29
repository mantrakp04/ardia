import AppKit

struct MenuState {
  static var current = MenuState()

  private(set) static var sentBookmarks: (lists: MenuBookmarks, revision: Int)?

  var checked = Set<String>()
  var disabled = Set<String>()
  var titles: [String: String] = [:]
  var profiles: [MenuEntry] = []
  var windows: [MenuEntry] = []
  var bookmarks = MenuBookmarks()
  var bookmarksRevision: Int?
  var recentlyClosed: [MenuEntry] = []
  var recentlyClosedGroups: [MenuEntry] = []
  var warnBeforeQuitting = false
  var warnBeforeClosingWindow = false
  var undoReopensClosedTab = false
  var downloadsInProgress = 0
  var shortcuts: [String: [[String]]] = [:]
  var extensions: [MenuExtension] = []
  var fromApp = false

  init() {}

  init(_ update: MenuStateUpdate) {
    checked = Set(update.checked)
    disabled = Set(update.disabled)
    titles = update.titles
    profiles = update.profiles
    windows = update.windows
    if let sent = MenuState.sentBookmarks { (bookmarks, bookmarksRevision) = (sent.lists, sent.revision) }
    recentlyClosed = update.recentlyClosed
    recentlyClosedGroups = update.recentlyClosedGroups
    warnBeforeQuitting = update.warnBeforeQuitting
    warnBeforeClosingWindow = update.warnBeforeClosingWindow
    undoReopensClosedTab = update.undoReopensClosedTab
    downloadsInProgress = update.downloadsInProgress
    shortcuts = update.shortcuts
    extensions = update.extensions
    fromApp = true
  }

  static func setBookmarks(_ lists: MenuBookmarks) {
    let revision = (sentBookmarks?.revision ?? 0) + 1
    sentBookmarks = (lists, revision)
    current.bookmarks = lists
    current.bookmarksRevision = revision
  }
}
