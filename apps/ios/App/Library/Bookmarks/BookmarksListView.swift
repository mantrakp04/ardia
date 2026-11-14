import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct BookmarksListView: View {
  @Environment(AppModel.self) private var app
  @State private var query = ""

  private var bookmarks: [BookmarkItem] {
    app.sync.isEnabled ? app.sync.selectedProfile?.bookmarks ?? [] : []
  }

  var body: some View {
    content
      .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search Bookmarks")
      .toolbar {
        ToolbarItem(placement: .primaryAction) { BookmarkPinButton() }
      }
      .navigationDestination(for: BookmarkFolderRoute.self) { route in
        BookmarkFolderView(folder: route.folder)
          .lookBackdrop()
      }
  }

  @ViewBuilder private var content: some View {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    if !app.sync.isEnabled {
      ContentUnavailableView {
        Label("Bookmarks Live on Your Mac", systemImage: "book")
      } description: {
        Text("Sync with your Mac to see its bookmarks here.")
      } actions: {
        Button("Sync With Your Mac") { app.sheet = .syncSetup }
          .buttonStyle(.glassProminent)
          .primaryActionColors()
      }
    } else if bookmarks.isEmpty {
      ContentUnavailableView("No Bookmarks", systemImage: "book", description: Text("Bookmarks you add on your Mac show up here."))
    } else if !trimmed.isEmpty {
      let matches = BookmarkTree.search(bookmarks, query: trimmed)
      if matches.isEmpty {
        ContentUnavailableView.search(text: trimmed)
      } else {
        List(matches) { match in
          BookmarkLink(item: match.item, path: match.path)
        }
        .listStyle(.plain)
      }
    } else {
      List {
        ForEach(BookmarkTree.roots(bookmarks)) { root in
          Section(root.title) {
            ForEach(root.items) { item in BookmarkLink(item: item) }
          }
        }
      }
      .listStyle(.plain)
    }
  }
}

struct BookmarkFolderRoute: Hashable {
  let folder: BookmarkItem
}

struct BookmarkFolderView: View {
  let folder: BookmarkItem

  var body: some View {
    let children = folder.children ?? []
    Group {
      if children.isEmpty {
        ContentUnavailableView("Empty Folder", systemImage: "folder", description: Text("Bookmarks you add to this folder on your Mac show up here."))
      } else {
        List(children) { item in BookmarkLink(item: item) }
          .listStyle(.plain)
      }
    }
    .navigationTitle(folder.title)
    .navigationBarTitleDisplayMode(.inline)
  }
}

struct BookmarkLink: View {
  @Environment(AppModel.self) private var app
  let item: BookmarkItem
  var path: [String] = []

  var body: some View {
    if item.isFolder {
      NavigationLink(value: BookmarkFolderRoute(folder: item)) {
        BookmarkRow(item: item, path: path)
      }
    } else if let url = item.url {
      Button {
        app.openFromLibrary(url)
      } label: {
        BookmarkRow(item: item, path: path)
      }
      .buttonStyle(.plain)
      .contextMenu {
        Button("Open", systemImage: "arrow.up.forward.square") { app.openFromLibrary(url) }
        Button("Copy Link", systemImage: "link") { app.copyLibraryLink(url) }
        if let link = URL(string: url) {
          ShareLink(item: link) { Label("Share", systemImage: "square.and.arrow.up") }
        }
      }
      .accessibilityHint("Opens the page in a new tab.")
    }
  }
}

struct BookmarkRow: View {
  let item: BookmarkItem
  var path: [String] = []
  @ScaledMetric(relativeTo: .body) private var iconSize = 20
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    HStack(alignment: .center, spacing: Tokens.Space.l) {
      icon
      VStack(alignment: .leading, spacing: Tokens.Space.xxs) {
        Text(title)
          .typography(.body)
          .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
        if let detail {
          Text(detail)
            .typography(.caption)
            .foregroundStyle(Tokens.Role.textSecondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, Tokens.Space.xs)
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private var icon: some View {
    if item.isFolder {
      Image(systemName: "folder")
        .font(.system(size: iconSize * 0.9))
        .foregroundStyle(Tokens.Role.icon)
        .frame(width: iconSize, height: iconSize)
    } else {
      FaviconImage(iconURL: nil, pageURL: item.url, size: iconSize)
    }
  }

  private var title: String {
    let trimmed = item.title.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty { return trimmed }
    return item.url.flatMap { BrowserURL.host(of: $0) } ?? String(localized: "Untitled")
  }

  private var detail: String? {
    if !path.isEmpty { return path.joined(separator: " › ") }
    if item.isFolder {
      let count = BookmarkTree.pageCount(item)
      return count == 1 ? String(localized: "1 bookmark") : String(localized: "\(count) bookmarks")
    }
    return item.url.flatMap { BrowserURL.host(of: $0) }
  }
}

private struct BookmarkPinButton: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    if let tab = app.pageToPinFromLibrary {
      let pinned = app.isPinnedToMac(tab)
      Button {
        app.pinToMac(tab)
      } label: {
        Label(pinned ? "Pinned to Mac" : "Pin This Page to Mac", systemImage: pinned ? "pin.fill" : "pin")
      }
      .disabled(pinned)
      .accessibilityHint(TabText.title(for: tab))
    }
  }
}
