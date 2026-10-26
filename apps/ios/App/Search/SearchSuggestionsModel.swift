import ArdiaBrowser
import ArdiaSync
import Foundation
import Observation

@MainActor
@Observable
final class SearchSuggestionsModel {
  static let rowLimit = 9

  private(set) var text = ""
  @ObservationIgnored private let omnibox: OmniboxModel
  @ObservationIgnored private let tabs: TabStore
  @ObservationIgnored private let sync: SyncService

  init(omnibox: Omnibox, tabs: TabStore, sync: SyncService, preferences: BrowsingPreferences, currentURL: String?, currentTabID: UUID?) {
    self.tabs = tabs
    self.sync = sync
    let model = OmniboxModel(omnibox: omnibox)
    model.context = OmniboxContext(currentURL: currentURL, currentTabID: currentTabID)
    model.fetchesNetworkSuggestions = preferences.searchSuggestions
    self.omnibox = model
  }

  func prepare() async {
    await omnibox.refreshCandidates(tabs: tabs, snapshot: sync.isEnabled ? sync.snapshot : nil)
  }

  func update(_ newText: String) {
    guard newText != text else { return }
    text = newText
    if newText.trimmingCharacters(in: .whitespaces).isEmpty {
      omnibox.clear()
    } else {
      omnibox.update(newText)
    }
  }

  func cancel() {
    omnibox.clear()
  }

  func resolve(_ submitted: String) async -> OmniboxResolution? {
    await omnibox.omnibox.resolve(submitted)
  }

  var completion: CompletionOffer? {
    let result = omnibox.result
    guard !result.query.isEmpty else { return nil }
    return CompletionOffer(query: result.query, completion: result.inlineCompletion.isEmpty ? nil : result.query + result.inlineCompletion)
  }

  var rows: [SearchSuggestion] {
    let trimmed = text.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty { return idleRows }
    let result = omnibox.result
    let isCurrent = result.query == text
    let devices = deviceTabIndex
    var rows: [SearchSuggestion] = []
    var seen: Set<String> = []
    for suggestion in result.suggestions {
      let row = Self.row(for: suggestion, devices: devices)
      guard !seen.contains(row.id) else { continue }
      if !isCurrent, !Self.row(row, stillMatches: trimmed) { continue }
      if !isCurrent, row.kind == .query, row.url == nil || row.title.caseInsensitiveCompare(trimmed) != .orderedSame { continue }
      seen.insert(row.id)
      rows.append(row)
      if rows.count == Self.rowLimit { break }
    }
    if !rows.contains(where: { $0.kind == .query && $0.title.caseInsensitiveCompare(trimmed) == .orderedSame }) {
      rows.removeAll { $0.id == SearchSuggestion.query(trimmed).id }
      rows.insert(.query(trimmed), at: min(isCurrent ? 1 : 0, rows.count))
      if rows.count > Self.rowLimit { rows.removeLast() }
    }
    return rows
  }

  static func row(_ row: SearchSuggestion, stillMatches typed: String) -> Bool {
    let needle = typed.lowercased()
    if row.title.lowercased().contains(needle) { return true }
    if let url = row.url, url.lowercased().contains(needle) { return true }
    return false
  }

  var idleDeviceName: String? {
    guard text.trimmingCharacters(in: .whitespaces).isEmpty, sync.isEnabled, let profile = sync.selectedProfile else { return nil }
    let current = Set(sync.snapshot.devices.filter(\.isCurrent).map(\.id))
    return profile.deviceTabs.first(where: { $0.kind == .mac && !current.contains($0.deviceId) && !$0.tabs.isEmpty })?.deviceName
  }

  private var idleRows: [SearchSuggestion] {
    guard sync.isEnabled, let profile = sync.selectedProfile else { return [] }
    let current = Set(sync.snapshot.devices.filter(\.isCurrent).map(\.id))
    guard let device = profile.deviceTabs.first(where: { $0.kind == .mac && !current.contains($0.deviceId) && !$0.tabs.isEmpty }) else { return [] }
    return device.tabs.filter { BrowserURL.isSyncable($0.url) }.prefix(3).map { tab in
      SearchSuggestion(id: "r:" + tab.url, kind: .remoteTab(deviceName: ""), title: tab.title.isEmpty ? tab.url : tab.title, detail: SearchInput.displayHost(tab.url), url: tab.url, query: tab.title)
    }
  }

  private var deviceTabIndex: [String: String] {
    guard sync.isEnabled, let profile = sync.selectedProfile else { return [:] }
    var index: [String: String] = [:]
    for device in profile.deviceTabs where device.kind == .mac {
      for tab in device.tabs where index[tab.url] == nil { index[tab.url] = device.deviceName }
    }
    return index
  }

  static func row(for suggestion: OmniboxSuggestion, devices: [String: String]) -> SearchSuggestion {
    switch suggestion {
    case .search(let query, let url, let engine, _, let isBang):
      var row = SearchSuggestion.query(query)
      row.url = url
      if isBang { row.detail = String(localized: "Search \(engine)") }
      row.id = "q:" + url
      return row
    case .page(let url, let title, let favicon, let tabID, let bookmarked, let visited):
      let shownTitle = title.isEmpty ? SearchInput.displayHost(url) : title
      let kind: SearchSuggestion.Kind
      if let tabID {
        kind = .openTab(tabID)
      } else if let device = devices[url] {
        kind = .remoteTab(deviceName: device)
      } else if bookmarked {
        kind = .bookmark
      } else if visited {
        kind = .history
      } else {
        kind = .url
      }
      var row = SearchSuggestion(id: "p:" + url, kind: kind, title: shownTitle, detail: SearchInput.displayHost(url), url: url, query: title)
      row.favicon = favicon
      return row
    case .calculation(let expression, let value, let url):
      var row = SearchSuggestion(id: "c:" + expression, kind: .calculation, title: "= " + value, detail: expression, url: url, query: expression)
      row.copyValue = value
      return row
    }
  }
}
