import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftData
import SwiftUI

struct HistoryList: View {
  var query: String

  @Environment(AppModel.self) private var app
  @State private var entries: [HistoryEntry] = []
  @State private var hidden: [String: Date] = [:]
  @State private var hasLoaded = false

  var body: some View {
    let shown = HistoryTimeline.filter(entries, query: query)
    Group {
      if hasLoaded, entries.isEmpty {
        ContentUnavailableView("No History", systemImage: "clock", description: Text("Pages you visit here and on your Mac show up here."))
      } else if hasLoaded, shown.isEmpty {
        ContentUnavailableView.search(text: query)
      } else {
        LibraryList {
          ForEach(HistoryTimeline.days(shown)) { day in
            LibrarySectionHeader(title: HistoryDayTitle.title(for: day.day))
            ForEach(day.entries) { entry in
              Button {
                app.openFromLibrary(url: entry.url, title: entry.title)
              } label: {
                LibraryRow(title: entry.title, url: entry.url, subtitle: subtitle(for: entry))
              }
              .buttonStyle(.plain)
              .libraryRowChrome()
              .swipeActions {
                Button("Delete", role: .destructive) { delete(entry) }
              }
              .contextMenu {
                if let url = URL(string: entry.url) {
                  ShareLink(item: url)
                  Button("Copy Link", systemImage: "doc.on.doc") { UIPasteboard.general.url = url }
                }
                Button("Delete", systemImage: "trash", role: .destructive) { delete(entry) }
              }
            }
          }
        }
      }
    }
    .task(id: reloadKey) { reload() }
  }

  private var reloadKey: [Int] {
    [app.tabs.historyRevision, app.sync.snapshot.syncedAt.map { Int($0.timeIntervalSince1970) } ?? 0, app.tabs.profileSyncId?.hashValue ?? 0]
  }

  private func subtitle(for entry: HistoryEntry) -> Text {
    let isThisDevice = entry.source == .thisDevice
    let device = Text(Image(systemName: isThisDevice ? "iphone" : "laptopcomputer"))
      .font(.system(size: SiteRow.deviceGlyph * 1.3))
    let time = entry.visitedAt.formatted(date: .omitted, time: .shortened)
    let deviceName = isThisDevice ? String(localized: "This iPhone") : String(localized: "Another device")
    return Text("\(device) \(entry.host) · \(time)")
      .accessibilityLabel(Text(verbatim: "\(entry.host), \(time), \(deviceName)"))
  }

  private var syncedSpace: SyncedProfile? {
    app.sync.isEnabled ? app.sync.snapshot.profile(app.tabs.profileSyncId) : nil
  }

  private func reload() {
    let space = syncedSpace
    let synced = syncedVisits(in: space)
    let stored = HiddenHistory.load(space: space?.syncId, isDemo: app.isDemo)
    hidden = settled(stored, in: synced)
    if hidden != stored { HiddenHistory.save(hidden, space: space?.syncId, isDemo: app.isDemo) }
    entries = HistoryTimeline.entries(local: localVisits(), synced: synced, hidden: hidden)
    hasLoaded = true
  }

  private func localVisits() -> [HistoryVisitInput] {
    let visits = app.tabs.visitsInCurrentSpace(limit: HiddenHistory.fetchLimit)
    return visits.map { HistoryVisitInput(url: $0.url, title: $0.title, visitedAt: $0.visitedAt) }
  }

  private func syncedVisits(in space: SyncedProfile?) -> [HistoryVisitInput] {
    (space?.history ?? []).map { HistoryVisitInput(url: $0.url, title: $0.title, visitedAt: $0.lastVisit) }
  }

  private func settled(_ hidden: [String: Date], in synced: [HistoryVisitInput]) -> [String: Date] {
    app.sync.isCycleRunning ? hidden : HistoryTimeline.keeping(hidden, stillIn: synced)
  }

  private func delete(_ entry: HistoryEntry) {
    let space = syncedSpace
    hidden = settled(HistoryTimeline.hiding(entry, in: hidden), in: syncedVisits(in: space))
    HiddenHistory.save(hidden, space: space?.syncId, isDemo: app.isDemo)
    withAnimation(Motion.snappy) {
      entries.removeAll { $0.url == entry.url }
    }
    app.tabs.removeVisitsInCurrentSpace(urls: [entry.url])
  }
}

enum HistoryDayTitle {
  static func title(for day: Date, now: Date = .now) -> String {
    switch HistoryTimeline.label(for: day, now: now) {
    case .today: String(localized: "Today")
    case .yesterday: String(localized: "Yesterday")
    case .weekday(let date): date.formatted(.dateTime.weekday(.wide))
    case .date(let date): date.formatted(.dateTime.weekday(.wide).month(.wide).day())
    }
  }
}

enum HiddenHistory {
  static let key = "library.hiddenHistory"
  static let fetchLimit = 5_000

  static func defaults(isDemo: Bool) -> UserDefaults {
    isDemo ? (UserDefaults(suiteName: AppSettings.demoSuite) ?? .standard) : .standard
  }

  static func load(space: String?, isDemo: Bool) -> [String: Date] {
    space.flatMap { stored(isDemo: isDemo)[$0] } ?? [:]
  }

  static func save(_ hidden: [String: Date], space: String?, isDemo: Bool) {
    guard let space else { return }
    var spaces = stored(isDemo: isDemo)
    spaces[space] = hidden.isEmpty ? nil : hidden
    write(spaces, isDemo: isDemo)
  }

  static func clear(since date: Date?, isDemo: Bool) {
    let spaces = stored(isDemo: isDemo).mapValues { HistoryTimeline.forgetting($0, since: date) }
    write(spaces.filter { !$0.value.isEmpty }, isDemo: isDemo)
  }

  private static func stored(isDemo: Bool) -> [String: [String: Date]] {
    let spaces = defaults(isDemo: isDemo).dictionary(forKey: key) as? [String: [String: Double]] ?? [:]
    return spaces.mapValues { $0.mapValues { Date(timeIntervalSince1970: $0) } }
  }

  private static func write(_ spaces: [String: [String: Date]], isDemo: Bool) {
    guard !spaces.isEmpty else {
      defaults(isDemo: isDemo).removeObject(forKey: key)
      return
    }
    defaults(isDemo: isDemo).set(spaces.mapValues { $0.mapValues(\.timeIntervalSince1970) }, forKey: key)
  }
}
