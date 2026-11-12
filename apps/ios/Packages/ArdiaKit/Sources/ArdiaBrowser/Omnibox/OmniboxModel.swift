import ArdiaSync
import Foundation
import Observation
import SwiftData

@ModelActor
public actor HistoryReader {
  public func summary(limit: Int = 5000) -> [OmniboxCandidates.HistoryRow] {
    var descriptor = FetchDescriptor<Visit>(sortBy: [SortDescriptor(\.visitedAt, order: .reverse)])
    descriptor.propertiesToFetch = [\.url, \.title, \.visitedAt]
    descriptor.fetchLimit = 20_000
    guard let visits = try? modelContext.fetch(descriptor) else { return [] }
    var order: [String] = []
    var rows: [String: OmniboxCandidates.HistoryRow] = [:]
    for visit in visits {
      if var row = rows[visit.url] {
        row.visits += 1
        if row.title.isEmpty { row.title = visit.title }
        rows[visit.url] = row
      } else {
        guard order.count < limit else { continue }
        order.append(visit.url)
        rows[visit.url] = .init(url: visit.url, title: visit.title, favicon: nil, visits: 1, lastVisit: visit.visitedAt.timeIntervalSince1970 * 1000)
      }
    }
    return order.compactMap { rows[$0] }
  }
}

extension OmniboxCandidates {
  public static func merge(
    openTabs: [Tab],
    localHistory: [HistoryRow],
    snapshot: SyncSnapshot?,
    profileSyncId: String?
  ) -> OmniboxCandidates {
    var history: [String: HistoryRow] = [:]
    var order: [String] = []
    func add(_ row: HistoryRow) {
      if var existing = history[row.url] {
        existing.visits = max(existing.visits, row.visits)
        existing.lastVisit = max(existing.lastVisit, row.lastVisit)
        if existing.title.isEmpty { existing.title = row.title }
        if existing.favicon == nil { existing.favicon = row.favicon }
        history[row.url] = existing
      } else {
        order.append(row.url)
        history[row.url] = row
      }
    }
    localHistory.forEach(add)
    var bookmarks: [Bookmark] = []
    if let profile = snapshot?.profile(profileSyncId) {
      for item in profile.history {
        add(HistoryRow(url: item.url, title: item.title, favicon: nil, visits: item.visits, lastVisit: item.lastVisit.timeIntervalSince1970 * 1000))
      }
      let seenAt = (snapshot?.syncedAt ?? .now).timeIntervalSince1970 * 1000
      for device in profile.deviceTabs where !(snapshot?.devices.first { $0.id == device.deviceId }?.isCurrent ?? false) {
        for tab in device.tabs where BrowserURL.isSyncable(tab.url) {
          add(HistoryRow(url: tab.url, title: tab.title, favicon: nil, visits: 1, lastVisit: seenAt))
        }
      }
      func walk(_ items: [BookmarkItem]) {
        for item in items {
          if let url = item.url { bookmarks.append(Bookmark(url: url, title: item.title, favicon: nil)) }
          if let children = item.children { walk(children) }
        }
      }
      walk(profile.bookmarks)
      for tile in profile.pinned.tiles {
        bookmarks.append(Bookmark(url: tile.url, title: tile.title, favicon: tile.icon))
        for tab in tile.folder ?? [] { bookmarks.append(Bookmark(url: tab.url, title: tab.title, favicon: tab.icon)) }
      }
    }
    return OmniboxCandidates(tabs: openTabs, history: order.compactMap { history[$0] }, bookmarks: bookmarks)
  }
}

@MainActor
@Observable
public final class OmniboxModel {
  public static let networkDelay: Duration = .milliseconds(120)

  public let omnibox: Omnibox
  public private(set) var text = ""
  public private(set) var result = OmniboxResult.empty
  public var context = OmniboxContext()
  public var fetchesNetworkSuggestions = true

  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var localTask: Task<Void, Never>?
  @ObservationIgnored private var remoteTask: Task<Void, Never>?
  @ObservationIgnored private var remote: (text: String, list: [String]) = ("", [])

  public init(omnibox: Omnibox) {
    self.omnibox = omnibox
  }

  public func refreshCandidates(tabs: TabStore, snapshot: SyncSnapshot?) async {
    let open = tabs.openTabs.map { OmniboxCandidates.Tab(id: $0.id.uuidString, url: $0.url, title: $0.title, favicon: $0.faviconURL) }
    let reader = HistoryReader(modelContainer: tabs.context.container)
    let local = await reader.summary()
    let candidates = OmniboxCandidates.merge(openTabs: open, localHistory: local, snapshot: snapshot, profileSyncId: tabs.profileSyncId)
    await omnibox.setCandidates(candidates)
    if !text.isEmpty { update(text) }
  }

  public func update(_ next: String) {
    text = next
    generation &+= 1
    let mine = generation
    localTask?.cancel()
    remoteTask?.cancel()
    let query = next.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else {
      result = .empty
      return
    }
    let carried = carriedRemote(for: query)
    let context = context
    let omnibox = omnibox
    localTask = Task { [weak self] in
      let local = await omnibox.suggest(next, context: context, remote: carried)
      guard let self, !Task.isCancelled, self.generation == mine else { return }
      self.result = local
    }
    guard fetchesNetworkSuggestions else { return }
    remoteTask = Task { [weak self] in
      try? await Task.sleep(for: Self.networkDelay)
      guard !Task.isCancelled else { return }
      let list = await omnibox.remoteSuggestions(for: next)
      guard !Task.isCancelled, !list.isEmpty else { return }
      let merged = await omnibox.suggest(next, context: context, remote: list)
      guard let self, !Task.isCancelled, self.generation == mine else { return }
      self.remote = (query, list)
      self.result = merged
    }
  }

  public func resolve() async -> OmniboxResolution? {
    await omnibox.resolve(text)
  }

  public func clear() {
    localTask?.cancel()
    remoteTask?.cancel()
    generation &+= 1
    text = ""
    result = .empty
  }

  private func carriedRemote(for query: String) -> [String] {
    if remote.text == query { return remote.list }
    let lower = query.lowercased()
    guard !remote.text.isEmpty, lower.hasPrefix(remote.text.lowercased()) else { return [] }
    return remote.list.filter { $0.lowercased().hasPrefix(lower) }
  }
}
