import ArdiaBrowser
import ArdiaIntelligence
import Foundation
import SwiftData

extension AppModel {
  func browseForMe(forTab tabID: UUID) -> BrowseForMe? {
    if let existing = intelligence.existingBrowse(forTab: tabID) { return existing }
    guard let tab = tabs.tab(tabID) else { return nil }
    let saved = tab.browseResultID.flatMap(savedBrowsePage)
    let query = saved?.query ?? tab.title
    let browse = intelligence.browse(forTab: tabID, query: query, restoring: saved)
    if saved == nil { browse.start() }
    return browse
  }

  func savedBrowsePage(_ resultID: UUID) -> BrowsePage? {
    var descriptor = FetchDescriptor<BrowseResult>(predicate: #Predicate { $0.id == resultID })
    descriptor.fetchLimit = 1
    guard let result = try? container.mainContext.fetch(descriptor).first,
      result.payloadVersion <= BrowsePage.schemaVersion
    else { return nil }
    return try? BrowsePage(payload: result.payload)
  }

  func saveBrowsePage(_ page: BrowsePage, forTab tabID: UUID) {
    guard let tab = tabs.tab(tabID), let resultID = tab.browseResultID, !isIncognito,
      let payload = try? page.payload()
    else { return }
    let context = container.mainContext
    var descriptor = FetchDescriptor<BrowseResult>(predicate: #Predicate { $0.id == resultID })
    descriptor.fetchLimit = 1
    if let existing = try? context.fetch(descriptor).first {
      existing.payload = payload
      existing.payloadVersion = BrowsePage.schemaVersion
    } else {
      context.insert(
        BrowseResult(
          id: resultID, query: page.query, created: page.created, payload: payload,
          payloadVersion: BrowsePage.schemaVersion))
    }
    try? context.save()
    if !page.title.isEmpty { tabs.update(tabID, title: page.title) }
  }

  func openFromBrowseForMe(_ url: URL) {
    _ = tabs.open(.url(url, origin: .link))
    surface = .browsing
  }

  func browseForMe(_ question: String) {
    _ = tabs.open(.browseForMe(query: question, resultID: UUID()))
    surface = .browsing
  }

  func searchTheWeb(_ query: String) {
    _ = tabs.open(.search(query))
    surface = .browsing
  }

  var searchEngineName: String {
    let host = URL(string: tabs.searchTemplate.replacingOccurrences(of: "%s", with: "q"))?.host() ?? ""
    let names = [
      "google": "Google", "bing": "Bing", "duckduckgo": "DuckDuckGo", "perplexity": "Perplexity", "chatgpt": "ChatGPT",
      "ecosia": "Ecosia", "brave": "Brave", "kagi": "Kagi", "startpage": "Startpage", "yahoo": "Yahoo",
      "baidu": "Baidu", "yandex": "Yandex",
    ]
    return names.first { host.contains($0.key) }?.value ?? String(localized: "the Web")
  }
}
