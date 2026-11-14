import ArdiaBrowser
import ArdiaDesign
import SwiftUI

enum LibrarySection: String, CaseIterable, Identifiable {
  case history
  case bookmarks
  case downloads

  var id: String { rawValue }

  var systemImage: String {
    switch self {
    case .history: "clock"
    case .bookmarks: "book"
    case .downloads: "arrow.down.circle"
    }
  }

  var name: String {
    switch self {
    case .history: String(localized: "History")
    case .bookmarks: String(localized: "Bookmarks")
    case .downloads: String(localized: "Downloads")
    }
  }

  var searchPrompt: String? {
    switch self {
    case .history: String(localized: "Search History")
    case .bookmarks: String(localized: "Search Bookmarks")
    case .downloads: nil
    }
  }
}

struct HistoryView: View {
  var body: some View { LibraryView(initial: .history) }
}

struct BookmarksView: View {
  var body: some View { LibraryView(initial: .bookmarks) }
}

struct DownloadsView: View {
  var body: some View { LibraryView(initial: .downloads) }
}

struct LibraryView: View {
  @Environment(\.dismiss) private var dismiss
  @State private var section: LibrarySection
  @State private var query = ""
  @State private var showsClearData = false
  @State private var isConfirmingDeleteDownloads = false
  @State private var downloads = DownloadsModel()
  @FocusState private var isSearching: Bool

  init(initial: LibrarySection) {
    _section = State(initialValue: initial)
  }

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        header
        content
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      .lookBackdrop()
      .toolbarVisibility(.hidden, for: .navigationBar)
      .navigationDestination(isPresented: $showsClearData) {
        ClearBrowsingDataPage()
          .settingsChrome()
          .toggleStyle(SettingsSwitchStyle())
          .toolbarVisibility(.visible, for: .navigationBar)
      }
      .confirmationDialog("Delete All Downloads?", isPresented: $isConfirmingDeleteDownloads, titleVisibility: .visible) {
        Button("Delete All", role: .destructive) { downloads.deleteAll() }
      } message: {
        Text("The files are removed from this iPhone.")
      }
    }
    .tint(Palette.formAccent)
    .onAppear { OnboardingView.dismissKeyboard() }
    .onChange(of: section) { _, _ in
      query = ""
      isSearching = false
    }
  }

  private var header: some View {
    VStack(spacing: Spacing.small) {
      ZStack {
        HStack {
          Button {
            dismiss()
          } label: {
            Text("Done")
              .foregroundStyle(.primary)
              .padding(.horizontal, Spacing.page)
              .frame(height: SiteRow.barButton)
              .contentShape(.capsule)
          }
          .buttonStyle(.plain)
          .chromeSurface(in: .capsule)
          Spacer()
          optionsMenu
        }
        LibrarySwitcher(section: $section)
      }
      if let prompt = section.searchPrompt {
        LibrarySearchField(prompt: prompt, text: $query, isFocused: $isSearching)
      }
    }
    .padding(.horizontal, Spacing.page)
    .padding(.top, Spacing.page)
    .padding(.bottom, Spacing.tight)
  }

  private var optionsMenu: some View {
    Menu {
      if section == .downloads {
        Button("Delete All Downloads", role: .destructive) { isConfirmingDeleteDownloads = true }
          .disabled(downloads.files.isEmpty)
      }
      Button("Clear Browsing Data") { showsClearData = true }
    } label: {
      Image(systemName: "ellipsis")
        .font(.body.weight(.semibold))
        .foregroundStyle(.primary)
        .frame(width: SiteRow.barButton, height: SiteRow.barButton)
        .contentShape(.circle)
    }
    .tint(.primary)
    .chromeSurface(in: .circle)
    .accessibilityLabel("More")
  }

  @ViewBuilder private var content: some View {
    switch section {
    case .history: HistoryList(query: query)
    case .bookmarks: BookmarksList(query: query)
    case .downloads: DownloadsList(model: downloads)
    }
  }
}

private struct LibrarySwitcher: View {
  @Binding var section: LibrarySection

  var body: some View {
    HStack(spacing: 0) {
      ForEach(LibrarySection.allCases) { item in
        Button {
          withAnimation(Motion.snappy) { section = item }
        } label: {
          Image(systemName: item.systemImage)
            .font(.system(size: SiteRow.switcherIcon, weight: .regular))
            .foregroundStyle(.primary)
            .frame(width: SiteRow.switcherSegment, height: SiteRow.barButton - Spacing.tight)
            .background {
              if section == item {
                Capsule().fill(.fill.quaternary)
              }
            }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.name)
        .accessibilityAddTraits(section == item ? .isSelected : [])
      }
    }
    .padding(.horizontal, Spacing.hairline)
    .frame(height: SiteRow.barButton)
    .chromeSurface(in: .capsule)
  }
}

private struct LibrarySearchField: View {
  var prompt: String
  @Binding var text: String
  var isFocused: FocusState<Bool>.Binding

  var body: some View {
    HStack(spacing: Spacing.tight) {
      Image(systemName: "magnifyingglass")
        .foregroundStyle(.primary)
        .accessibilityHidden(true)
      TextField("", text: $text)
        .accessibilityLabel(prompt)
        .overlay(alignment: .leading) {
          if text.isEmpty {
            Text(prompt)
              .foregroundStyle(.secondary)
              .allowsHitTesting(false)
              .accessibilityHidden(true)
          }
        }
        .focused(isFocused)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .submitLabel(.search)
      if !text.isEmpty {
        Button {
          text = ""
        } label: {
          Image(systemName: "xmark.circle.fill")
            .foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear")
      }
    }
    .padding(.horizontal, Spacing.page)
    .frame(height: SiteRow.barButton)
    .chromeSurface(in: .capsule, interactive: false)
  }
}

struct LibraryRow: View {
  var title: String
  var url: String
  var subtitle: Text

  var body: some View {
    HStack(alignment: .top, spacing: Spacing.small) {
      FaviconImage(iconURL: nil, pageURL: url, size: SiteRow.libraryFavicon)
        .padding(.top, 2)
      VStack(alignment: .leading, spacing: 2) {
        Text(verbatim: title.isEmpty ? url : title)
          .lineLimit(1)
          .foregroundStyle(.primary)
        subtitle
          .font(.footnote)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, SiteRow.libraryRowPadding)
    .contentShape(.rect)
  }
}

struct LibraryList<Content: View>: View {
  @ViewBuilder var content: Content

  var body: some View {
    List {
      content
    }
    .listStyle(.plain)
    .contentMargins(.top, Spacing.tight, for: .scrollContent)
    .scrollContentBackground(.hidden)
    .scrollDismissesKeyboard(.immediately)
  }
}

extension View {
  func libraryRowChrome() -> some View {
    listRowBackground(Color(.secondarySystemGroupedBackground))
      .listRowInsets(EdgeInsets(top: 0, leading: Spacing.page, bottom: 0, trailing: Spacing.page))
      .alignmentGuide(.listRowSeparatorLeading) { _ in SiteRow.libraryFavicon + Spacing.small }
  }
}

struct LibrarySectionHeader: View {
  var title: String

  var body: some View {
    Text(verbatim: title)
      .font(.headline)
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, Spacing.large)
      .padding(.bottom, Spacing.tight)
      .listRowBackground(Color.clear)
      .listRowSeparator(.hidden)
      .listRowInsets(EdgeInsets(top: 0, leading: Spacing.page, bottom: 0, trailing: Spacing.page))
      .accessibilityAddTraits(.isHeader)
  }
}

extension AppModel {
  func openFromLibrary(url: String, title: String) {
    browse.dismissSearch()
    openRemote(url: url, title: title, profileSyncId: nil)
  }
}
