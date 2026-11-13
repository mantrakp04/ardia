import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import QuickLook
import SwiftUI

struct DownloadsListView: View {
  @Environment(AppModel.self) private var app
  @State private var query = ""
  @State private var previewURL: URL?
  @State private var pendingDelete: DownloadItem?
  @State private var problem: String?
  @State private var deleteTicks = 0

  private var downloads: DownloadManager { app.web.downloads }

  var body: some View {
    content
      .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search Downloads")
      .toolbar {
        ToolbarItem(placement: .primaryAction) { optionsMenu }
      }
      .quickLookPreview($previewURL)
      .confirmationDialog(
        pendingDelete.map { String(localized: "Delete “\($0.fileName)”?") } ?? "",
        isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
        titleVisibility: .visible,
        presenting: pendingDelete
      ) { item in
        Button("Delete File", role: .destructive) { remove(item) }
      } message: { _ in
        Text("The file is removed from this \(ThisDevice.current.noun).")
      }
      .alert("Couldn’t Delete", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(problem ?? "")
      }
      .sensoryFeedback(.warning, trigger: deleteTicks)
  }

  @ViewBuilder private var content: some View {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let items = trimmed.isEmpty ? downloads.items : downloads.items.filter { $0.fileName.localizedStandardContains(trimmed) || ($0.sourceHost?.localizedStandardContains(trimmed) ?? false) }
    if downloads.items.isEmpty {
      ContentUnavailableView {
        Label("No Downloads", systemImage: "arrow.down.circle")
      } description: {
        Text("Files you download show up here and in the Files app.")
      }
    } else if items.isEmpty {
      ContentUnavailableView.search(text: trimmed)
    } else {
      let days = DownloadDays.group(items)
      List {
        ForEach(days, id: \.day) { day in
          Section {
            ForEach(day.items) { item in row(item) }
          } header: {
            Text(ArchiveDayTitle.title(for: day.day))
          } footer: {
            if day.day == days.last?.day {
              Text("Files stay in the Files app, in On My \(ThisDevice.current.noun) › Ardia › Downloads.")
                .typography(.caption)
                .foregroundStyle(Tokens.Role.textSecondary)
            }
          }
        }
      }
      .listStyle(.plain)
    }
  }

  private var optionsMenu: some View {
    Menu {
      Button("Clear List", systemImage: "list.bullet.rectangle") { downloads.clearInactive() }
        .disabled(!downloads.items.contains { !$0.isRunning })
    } label: {
      Label("Options", systemImage: "ellipsis")
    }
  }

  private func row(_ item: DownloadItem) -> some View {
    let file = downloads.fileURL(for: item)
    let exists = downloads.fileExists(item)
    return DownloadRow(
      item: item,
      fileExists: exists,
      open: { if exists { previewURL = file } },
      cancel: { downloads.cancel(item.id) },
      retry: { retry(item) }
    )
    .swipeActions(edge: .trailing, allowsFullSwipe: !exists) {
      Button(exists ? "Delete" : "Remove", systemImage: "trash", role: .destructive) { askToRemove(item, exists: exists) }
    }
    .contextMenu {
      if exists, let file {
        Button("Open", systemImage: "eye") { previewURL = file }
        ShareLink(item: file) { Label("Share", systemImage: "square.and.arrow.up") }
      }
      if item.canRetry {
        Button("Try Again", systemImage: "arrow.clockwise") { retry(item) }
      }
      if let source = item.sourceURL {
        Button("Copy Address", systemImage: "link") { app.copyLibraryLink(source.absoluteString) }
      }
      if item.isRunning {
        Button("Cancel Download", systemImage: "xmark.circle") { downloads.cancel(item.id) }
      }
      Divider()
      Button(exists ? "Delete File" : "Remove from List", systemImage: "trash", role: .destructive) { askToRemove(item, exists: exists) }
    }
  }

  private func askToRemove(_ item: DownloadItem, exists: Bool) {
    if exists {
      pendingDelete = item
    } else {
      remove(item)
    }
  }

  private func remove(_ item: DownloadItem) {
    do {
      try downloads.delete(item.id)
      deleteTicks += 1
    } catch {
      problem = String(localized: "Ardia couldn’t delete “\(item.fileName)”. Try again, or delete it in the Files app.")
    }
  }

  private func retry(_ item: DownloadItem) {
    do {
      try downloads.retry(item.id)
    } catch {
      app.toasts.show(Toast(String(localized: "Couldn’t Try Again"), symbol: "exclamationmark.triangle.fill"))
    }
  }
}

enum DownloadDays {
  struct Day {
    let day: Date
    let items: [DownloadItem]
  }

  static func group(_ items: [DownloadItem], calendar: Calendar = .current) -> [Day] {
    Dictionary(grouping: items) { calendar.startOfDay(for: $0.startedAt) }
      .map { Day(day: $0.key, items: $0.value.sorted { $0.startedAt > $1.startedAt }) }
      .sorted { $0.day > $1.day }
  }
}
