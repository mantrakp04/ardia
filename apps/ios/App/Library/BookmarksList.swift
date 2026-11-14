import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct BookmarksList: View {
  var query: String

  @Environment(AppModel.self) private var app

  var body: some View {
    let bookmarks = currentBookmarks
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    if bookmarks.isEmpty {
      ContentUnavailableView("No Bookmarks", systemImage: "book", description: Text(app.sync.isEnabled ? "Bookmarks you save on your Mac show up here." : "Sync with your Mac to see its bookmarks here."))
    } else if !trimmed.isEmpty {
      let matches = BookmarkSearch.matches(in: bookmarks, query: trimmed)
      if matches.isEmpty {
        ContentUnavailableView.search(text: trimmed)
      } else {
        LibraryList {
          ForEach(matches) { bookmark in BookmarkRow(bookmark: bookmark) }
        }
      }
    } else {
      BookmarkFolderList(sections: BookmarkSearch.sections(bookmarks))
    }
  }

  private var currentBookmarks: [BookmarkItem] {
    guard app.sync.isEnabled else { return [] }
    return app.sync.snapshot.profile(app.tabs.profileSyncId)?.bookmarks ?? []
  }
}

private struct BookmarkFolderList: View {
  var sections: [BookmarkSearch.Section]

  var body: some View {
    LibraryList {
      ForEach(sections) { section in
        if let title = section.title { LibrarySectionHeader(title: title) }
        ForEach(section.items) { bookmark in BookmarkRow(bookmark: bookmark) }
      }
    }
  }
}

private struct BookmarkFolderPage: View {
  var folder: BookmarkItem

  var body: some View {
    Group {
      if (folder.children ?? []).isEmpty {
        ContentUnavailableView("Empty Folder", systemImage: "folder")
      } else {
        BookmarkFolderList(sections: [BookmarkSearch.Section(id: folder.key, title: nil, items: folder.children ?? [])])
      }
    }
    .lookBackdrop()
    .navigationTitle(Text(verbatim: folder.title))
    .navigationBarTitleDisplayMode(.inline)
    .toolbarVisibility(.visible, for: .navigationBar)
  }
}

private struct BookmarkRow: View {
  var bookmark: BookmarkItem

  @Environment(AppModel.self) private var app

  var body: some View {
    Group {
      if bookmark.isFolder {
        NavigationLink {
          BookmarkFolderPage(folder: bookmark)
        } label: {
          HStack(spacing: Spacing.small) {
            Text(verbatim: bookmark.title.isEmpty ? String(localized: "Untitled Folder") : bookmark.title)
              .foregroundStyle(.primary)
            Spacer()
            Text((bookmark.children ?? []).count, format: .number)
              .foregroundStyle(.secondary)
          }
          .padding(.vertical, Spacing.small)
        }
      } else if let url = bookmark.url {
        Button {
          app.openFromLibrary(url: url, title: bookmark.title)
        } label: {
          LibraryRow(title: bookmark.title, url: url, subtitle: Text(verbatim: HistoryEntry(url: url, title: "", visitedAt: .now, source: .otherDevice).host))
        }
        .buttonStyle(.plain)
        .contextMenu {
          if let link = URL(string: url) {
            ShareLink(item: link)
            Button("Copy Link", systemImage: "doc.on.doc") { UIPasteboard.general.url = link }
          }
        }
      }
    }
    .libraryRowChrome()
  }
}

enum BookmarkSearch {
  struct Section: Identifiable {
    var id: String
    var title: String?
    var items: [BookmarkItem]
  }

  static func sections(_ bookmarks: [BookmarkItem]) -> [Section] {
    let bar = bookmarks.filter { $0.root == .bar }
    let other = bookmarks.filter { $0.root != .bar }
    var sections: [Section] = []
    if !bar.isEmpty { sections.append(Section(id: "bar", title: String(localized: "Bookmarks Bar"), items: bar)) }
    if !other.isEmpty { sections.append(Section(id: "other", title: String(localized: "Other Bookmarks"), items: other)) }
    return sections
  }

  static func matches(in bookmarks: [BookmarkItem], query: String) -> [BookmarkItem] {
    let words = query.lowercased().split(whereSeparator: \.isWhitespace)
    var found: [BookmarkItem] = []
    func visit(_ items: [BookmarkItem]) {
      for item in items {
        if let url = item.url {
          let haystack = "\(item.title) \(url)".lowercased()
          if words.allSatisfy({ haystack.contains($0) }) { found.append(item) }
        }
        if let children = item.children { visit(children) }
      }
    }
    visit(bookmarks)
    return found
  }
}
