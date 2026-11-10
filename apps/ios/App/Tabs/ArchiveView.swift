import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct ArchiveView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  @State private var isConfirmingClear = false
  @State private var restoreTicks = 0
  @State private var deleteAllTicks = 0
  @State private var copyTicks = 0

  var body: some View {
    NavigationStack {
      content
        .navigationTitle("Archive")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search Archive")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Done") { dismiss() }
          }
          ToolbarItem(placement: .primaryAction) { optionsMenu }
        }
        .confirmationDialog("Delete All Archived Tabs?", isPresented: $isConfirmingClear, titleVisibility: .visible) {
          Button("Delete All", role: .destructive) {
            deleteAllTicks += 1
            app.tabs.clearArchive()
          }
        } message: {
          Text("This can’t be undone.")
        }
    }
    .sensoryFeedback(.selection, trigger: restoreTicks)
    .sensoryFeedback(.warning, trigger: deleteAllTicks)
    .sensoryFeedback(.success, trigger: copyTicks)
    .onAppear { app.tabs.loadArchive() }
  }

  @ViewBuilder private var content: some View {
    let days = app.tabs.archive
    if days.isEmpty {
      ArchiveEmptyState()
    } else if !trimmedQuery.isEmpty {
      let results = app.tabs.searchArchive(trimmedQuery)
      if results.isEmpty {
        ContentUnavailableView.search(text: trimmedQuery)
      } else {
        List {
          ForEach(results, id: \.id) { tab in row(tab) }
        }
        .listStyle(.plain)
      }
    } else {
      List {
        ForEach(days) { day in
          Section {
            ForEach(day.tabs, id: \.id) { tab in row(tab) }
          } header: {
            Text(ArchiveDayTitle.title(for: day.day))
          }
        }
      }
      .listStyle(.plain)
    }
  }

  private var trimmedQuery: String {
    query.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var optionsMenu: some View {
    Menu {
      Picker(selection: Bindable(app.tabs).autoArchiveInterval) {
        ForEach(AutoArchiveInterval.allCases) { option in
          Text(option.title).tag(option)
        }
      } label: {
        Label("Archive Inactive Tabs", systemImage: "archivebox")
      }
      .pickerStyle(.menu)
      Divider()
      Button("Delete All…", systemImage: "trash", role: .destructive) { isConfirmingClear = true }
        .disabled(app.tabs.archive.isEmpty)
    } label: {
      Label("Options", systemImage: "ellipsis")
    }
  }

  private func row(_ tab: BrowserTab) -> some View {
    Button {
      restoreTicks += 1
      app.restoreArchived(tab.id)
    } label: {
      ArchiveRow(tab: tab)
    }
    .buttonStyle(.plain)
    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
      Button("Delete", systemImage: "trash", role: .destructive) { app.tabs.delete([tab.id]) }
    }
    .contextMenu {
      Button("Open", systemImage: "arrow.up.forward.square") { app.restoreArchived(tab.id) }
      if let url = app.shareURL(of: tab) {
        Button("Copy Link", systemImage: "link") {
          app.copyLink(of: tab)
          copyTicks += 1
        }
        ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }
      }
      Divider()
      Button("Delete", systemImage: "trash", role: .destructive) { app.tabs.delete([tab.id]) }
    }
    .accessibilityHint("Reopens the tab.")
  }
}

struct ArchiveRow: View {
  let tab: BrowserTab
  @ScaledMetric(relativeTo: .body) private var iconSize = 20
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      FaviconImage(iconURL: tab.faviconURL, pageURL: tab.url, size: iconSize)
        .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + iconSize * 0.25 }
      VStack(alignment: .leading, spacing: 2) {
        Text(TabText.title(for: tab))
          .font(.body)
          .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
        Text(facts)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, 4)
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
  }

  private var facts: String {
    let host = TabText.host(for: tab)
    guard let archived = tab.archivedAt else { return host }
    return String(localized: "\(host) · \(archived.formatted(date: .omitted, time: .shortened))")
  }
}

enum ArchiveDayTitle {
  static func title(for day: Date, now: Date = .now, calendar: Calendar = .current) -> String {
    if calendar.isDate(day, inSameDayAs: now) { return String(localized: "Today") }
    if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(day, inSameDayAs: yesterday) {
      return String(localized: "Yesterday")
    }
    if let weekAgo = calendar.date(byAdding: .day, value: -6, to: calendar.startOfDay(for: now)), day >= weekAgo {
      return day.formatted(.dateTime.weekday(.wide))
    }
    let sameYear = calendar.component(.year, from: day) == calendar.component(.year, from: now)
    return sameYear ? day.formatted(.dateTime.month(.wide).day()) : day.formatted(.dateTime.month(.wide).day().year())
  }
}

struct ArchiveEmptyState: View {
  var body: some View {
    ContentUnavailableView {
      Label {
        Text("No Archived Tabs")
      } icon: {
        Image(systemName: "archivebox.fill")
          .foregroundStyle(.white)
          .font(.system(size: 30, weight: .semibold))
          .frame(width: 64, height: 64)
          .background(TabsPalette.archiveTile.gradient, in: .rect(cornerRadius: 16, style: .continuous))
      }
    } description: {
      Text("Closed and inactive tabs show up here.")
    }
  }
}
