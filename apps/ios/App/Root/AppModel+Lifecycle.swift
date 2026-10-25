import ArdiaBrowser
import ArdiaSync
import Foundation
import Observation
import UIKit

extension AppModel {
  func connectServices() {
    sync.source = tabs
    web.omnibox = omnibox
    tabs.onLocalChange = { [weak self] in self?.sync.localDidChange() }
    let removed = tabs.onTabsRemoved
    tabs.onTabsRemoved = { [weak self] tabs in
      removed?(tabs)
      for tab in tabs { self?.intelligence.forget(tab: tab.id) }
    }
    let archived = tabs.onTabsArchived
    tabs.onTabsArchived = { [weak self] ids in
      archived?(ids)
      for id in ids { self?.intelligence.forget(tab: id) }
    }
    web.openExternalURL = { url in UIApplication.shared.open(url) }
    web.openUniversalLink = { url in
      await UIApplication.shared.open(url, options: [.universalLinksOnly: true])
    }
    let omnibox = omnibox
    Task {
      await omnibox.warmUp()
      await omnibox.loadBangs()
    }
    observeAIFeatures()
    applySyncedSearch()
    if isDemo {
      DemoSeed.seed(self)
    } else {
      sync.start()
      Task { await blocker.prepare() }
    }
    surface = .search
    if isDemo { DemoScenario.apply(to: self) }
  }

  func observeAIFeatures() {
    intelligence.isEnabled = settings.aiFeaturesEnabled
    withObservationTracking {
      _ = settings.aiFeaturesEnabled
    } onChange: { [weak self] in
      Task { @MainActor in self?.observeAIFeatures() }
    }
  }

  func applySyncedSearch() {
    tabs.searchTemplate = SearchTemplates.template(for: sync.snapshot.search, localEngineID: preferences.searchEngineID)
    tabs.profileSyncId = sync.isEnabled ? sync.selectedProfile?.syncId : nil
    let search = sync.snapshot.search
    let local = preferences.searchEngineID
    let omnibox = omnibox
    Task { [weak self] in
      guard let info = await omnibox.setSearch(search, localEngineID: local), info.url.contains("%s") else { return }
      self?.tabs.searchTemplate = info.url
    }
  }

  func sceneBecameActive() {
    tabs.appBecameActive()
    sync.appBecameActive()
    applySyncedSearch()
    guard !isDemo else { return }
    Task { await blocker.refreshIfDue() }
    let omnibox = omnibox
    Task { await omnibox.refreshBangsIfDue() }
  }

  func sceneWillResignActive() {
    sync.appWillResignActive()
    tabs.appWillResignActive()
    web.saveAll()
  }

  func sceneEnteredBackground() {
    web.saveAll()
    sync.scheduleBackgroundRefresh()
  }
}

enum SearchTemplates {
  static let known: [String: String] = [
    "google": "https://www.google.com/search?q=%s",
    "bing": "https://www.bing.com/search?q=%s",
    "duckduckgo": "https://duckduckgo.com/?q=%s",
    "perplexity": "https://www.perplexity.ai/search?q=%s",
    "chatgpt": "https://chatgpt.com/?q=%s",
    "ecosia": "https://www.ecosia.org/search?q=%s",
    "brave": "https://search.brave.com/search?q=%s",
    "kagi": "https://kagi.com/search?q=%s",
    "startpage": "https://www.startpage.com/do/search?q=%s",
    "yahoo": "https://search.yahoo.com/search?p=%s",
    "baidu": "https://www.baidu.com/s?wd=%s",
    "yandex": "https://yandex.com/search/?text=%s",
  ]

  static func template(for synced: SyncedSearch?, localEngineID: String) -> String {
    if let synced {
      if let custom = synced.customEngines.first(where: { $0.id == synced.engineId }), custom.url.contains("%s") {
        return custom.url
      }
      if synced.engineId == "custom", let url = synced.customURL, url.contains("%s") {
        return url
      }
      if let template = known[synced.engineId] { return template }
    }
    return known[localEngineID] ?? known["google"]!
  }
}
