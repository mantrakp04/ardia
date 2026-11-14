import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftData
import SwiftUI

struct HistoryListView: View {
  @Environment(AppModel.self) private var app
  @State private var history: HistoryLibrary
  @State private var query = ""
  @State private var scope: HistoryScope = .all
  @State private var pendingClear: ClearRange?
  @State private var problem: String?
  @State private var deleteTicks = 0

  init(context: ModelContext) {
    _history = State(initialValue: HistoryLibrary(context: context))
  }

  private var syncedOrigin: SyncedOrigin { SyncedOrigin(devices: app.sync.snapshot.devices) }

  private var syncedHistory: [HistoryItem] {
    app.sync.isEnabled ? app.sync.selectedProfile?.history ?? [] : []
  }

  private var reloadKey: HistoryReloadKey {
    HistoryReloadKey(synced: syncedHistory, spaces: HistorySpaceFilter(roster: app.tabs.spaceRoster, current: app.tabs.profileSyncId))
  }

  private var clearsEverySpace: Bool { app.tabs.spaceRoster.ids.count > 1 }

  var body: some View {
    content
      .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search History")
      .toolbar {
        ToolbarItem(placement: .primaryAction) { optionsMenu }
      }
      .task(id: reloadKey) { await history.reload(synced: reloadKey.synced, spaces: reloadKey.spaces) }
      .confirmationDialog(
        pendingClear.map { String(localized: "Clear history \($0.phrase)?") } ?? "",
        isPresented: Binding(get: { pendingClear != nil }, set: { if !$0 { pendingClear = nil } }),
        titleVisibility: .visible,
        presenting: pendingClear
      ) { range in
        Button("Clear History", role: .destructive) { clear(range) }
      } message: { _ in
        Text(HistoryWords.clearMessage(everySpace: clearsEverySpace, synced: app.sync.isEnabled))
      }
      .alert("Couldn’t Change History", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(problem ?? "")
      }
      .sensoryFeedback(.warning, trigger: deleteTicks)
  }

  @ViewBuilder private var content: some View {
    let days = history.days(matching: query, scope: scope)
    if !history.isLoaded {
      Color.clear
    } else if let loadProblem = history.loadProblem {
      ContentUnavailableView("Couldn’t Load History", systemImage: "exclamationmark.triangle", description: Text(loadProblem))
    } else if days.isEmpty {
      if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        ContentUnavailableView.search(text: query)
      } else {
        HistoryEmptyState(scope: scope, synced: syncedOrigin)
      }
    } else {
      List {
        ForEach(days) { day in
          Section {
            ForEach(day.entries) { entry in row(entry) }
          } header: {
            Text(ArchiveDayTitle.title(for: day.day))
          }
        }
      }
      .listStyle(.plain)
    }
  }

  private var optionsMenu: some View {
    Menu {
      if app.sync.isEnabled {
        Picker(selection: $scope) {
          ForEach(HistoryScope.allCases) { scope in
            Label(HistoryWords.scopeTitle(scope, synced: syncedOrigin), systemImage: HistoryWords.scopeSymbol(scope, synced: syncedOrigin)).tag(scope)
          }
        } label: {
          Label("Show", systemImage: "line.3.horizontal.decrease")
        }
        .pickerStyle(.inline)
      }
      Menu {
        ForEach(ClearRange.allCases) { range in
          Button(range.title) { pendingClear = range }
        }
      } label: {
        Label("Clear History…", systemImage: "trash")
      }
      .disabled(!history.entries.contains { $0.source == .thisDevice })
    } label: {
      Label("Options", systemImage: "ellipsis")
    }
  }

  private func row(_ entry: HistoryEntry) -> some View {
    Button {
      app.openFromLibrary(entry.url)
    } label: {
      HistoryRow(entry: entry, synced: syncedOrigin)
    }
    .buttonStyle(.plain)
    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
      if entry.source == .thisDevice {
        Button("Delete", systemImage: "trash", role: .destructive) { delete(entry) }
      }
    }
    .contextMenu {
      Button("Open", systemImage: "arrow.up.forward.square") { app.openFromLibrary(entry.url) }
      Button("Copy Link", systemImage: "link") { app.copyLibraryLink(entry.url) }
      if let url = URL(string: entry.url) {
        ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }
      }
      if entry.source == .thisDevice {
        Divider()
        Button("Delete", systemImage: "trash", role: .destructive) { delete(entry) }
      }
    }
    .accessibilityHint("Opens the page in a new tab.")
  }

  private func delete(_ entry: HistoryEntry) {
    do {
      try history.delete(entry)
      deleteTicks += 1
    } catch {
      problem = String(localized: "Ardia couldn’t delete this visit. Try again.")
    }
  }

  private func clear(_ range: ClearRange) {
    do {
      try history.clear(since: range.since(now: .now))
      deleteTicks += 1
    } catch {
      problem = String(localized: "Ardia couldn’t clear history. Try again.")
    }
    Task { await history.reload(synced: reloadKey.synced, spaces: reloadKey.spaces) }
  }
}

private struct HistoryEmptyState: View {
  let scope: HistoryScope
  let synced: SyncedOrigin

  var body: some View {
    ContentUnavailableView {
      Label("No History", systemImage: "clock")
    } description: {
      switch scope {
      case .all: Text("Pages you visit show up here, with your Mac’s when you sync.")
      case .thisDevice: Text("Pages you visit on this \(ThisDevice.current.noun) show up here.")
      case .synced: Text("Pages you visit on \(synced.name) show up here.")
      }
    }
  }
}

struct HistoryReloadKey: Equatable {
  let synced: [HistoryItem]
  let spaces: HistorySpaceFilter
}
