import ArdiaBrowser
import Foundation
import UIKit

extension AppModel {
  func makeSuggestionsModel() -> SearchSuggestionsModel {
    let current = surface == .browsing ? tabs.selectedTab : nil
    return SearchSuggestionsModel(
      omnibox: omnibox,
      tabs: tabs,
      sync: sync,
      preferences: preferences,
      currentURL: current?.url,
      currentTabID: current?.id
    )
  }

  func submitSearch(_ text: String, resolution: OmniboxResolution?) {
    if let resolution {
      openPage(resolution.url, origin: resolution.kind == .url ? .typed : .search)
      return
    }
    guard let destination = SearchInput.resolve(text) else { return }
    switch destination {
    case .url(let url): openPage(url, origin: .typed)
    case .search(let query): openSearch(query)
    }
  }

  func activate(_ suggestion: SearchSuggestion, target: SuggestionTarget) {
    if target == .browseForMe, offersBrowseForMe, suggestion.offersBrowseForMe {
      startBrowseForMe(suggestion.query)
      return
    }
    let url = suggestion.url.flatMap(URL.init(string:))
    switch suggestion.kind {
    case .query:
      if let url { openPage(url, origin: .search) } else { openSearch(suggestion.query) }
    case .openTab(let id):
      browse.dismissSearch()
      openTab(id)
    case .remoteTab:
      if let url { openPage(url, origin: .sync) }
    case .url, .history, .bookmark:
      if let url { openPage(url, origin: .typed) }
    case .calculation:
      if let value = suggestion.copyValue {
        UIPasteboard.general.string = value
        toasts.show(Toast(String(localized: "Copied \(value)"), symbol: "equal.circle.fill"))
      }
    }
  }

  func openSearch(_ query: String) {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    let tab = tabs.open(.search(trimmed), isPrivate: isIncognito)
    finishOpening(tab.id)
  }

  func openPage(_ url: URL, origin: TabOrigin) {
    let tab = tabs.open(.url(url, origin: origin), isPrivate: isIncognito)
    finishOpening(tab.id)
  }

  func startBrowseForMe(_ query: String) {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    let tab = tabs.open(.browseForMe(query: trimmed, resultID: UUID()), isPrivate: isIncognito)
    finishOpening(tab.id)
  }

  func cancelSearch() {
    let request = browse.search
    browse.dismissSearch()
    if surface == .search, request?.origin != .start, let id = tabs.selectedTabID {
      openTab(id)
    } else if let restored = request?.incognitoOnCancel {
      isIncognito = restored
    }
  }

  private func finishOpening(_ id: UUID) {
    _ = web.webTab(for: id)
    browse.dismissSearch()
    surface = .browsing
  }

  func currentQuery(for tab: BrowserTab) -> String {
    if tab.origin == .browseForMe {
      return intelligence.existingBrowse(forTab: tab.id)?.query
        ?? tab.browseResultID.flatMap(savedBrowsePage)?.query
        ?? tab.title
    }
    return RecentSearches.query(in: tab.url) ?? tab.url
  }
}
