import ArdiaBrowser
import Foundation

enum DemoSeed {
  struct Page {
    var url: String
    var title: String
    var minutesAgo: Double
  }

  static let openPages: [Page] = [
    Page(url: "https://en.wikipedia.org/wiki/Lisbon", title: "Lisbon - Wikipedia", minutesAgo: 600),
    Page(url: "https://www.nytimes.com/section/arts", title: "Arts - The New York Times", minutesAgo: 420),
    Page(url: "https://www.apple.com/iphone/", title: "iPhone - Apple", minutesAgo: 240),
    Page(url: "https://www.allrecipes.com/recipe/21014/good-old-fashioned-pancakes/", title: "Good Old-Fashioned Pancakes Recipe", minutesAgo: 180),
    Page(url: "https://www.bbc.com/news/science_and_environment", title: "Science - BBC News", minutesAgo: 95),
    Page(url: "https://www.swift.org/blog/", title: "Blog | Swift.org", minutesAgo: 40),
    Page(url: "https://www.theverge.com/", title: "The Verge", minutesAgo: 12),
    Page(url: "https://en.wikipedia.org/wiki/Sintra", title: "Sintra - Wikipedia", minutesAgo: 3),
  ]

  static let archivedPages: [Page] = [
    Page(url: "https://www.timeout.com/lisbon", title: "Time Out Lisbon", minutesAgo: 60 * 5),
    Page(url: "https://www.metmuseum.org/", title: "The Metropolitan Museum of Art", minutesAgo: 60 * 26),
    Page(url: "https://news.ycombinator.com/", title: "Hacker News", minutesAgo: 60 * 30),
    Page(url: "https://www.npr.org/sections/music/", title: "Music : NPR", minutesAgo: 60 * 60),
  ]

  static let history: [Page] = [
    Page(url: "https://www.apple.com/", title: "Apple", minutesAgo: 30),
    Page(url: "https://www.apple.com/iphone/", title: "iPhone - Apple", minutesAgo: 240),
    Page(url: "https://en.wikipedia.org/wiki/Lisbon", title: "Lisbon - Wikipedia", minutesAgo: 600),
    Page(url: "https://www.allrecipes.com/", title: "Allrecipes | Recipes, How-Tos, Videos and More", minutesAgo: 900),
  ]

  @MainActor
  static func seed(_ app: AppModel) {
    let tabs = app.tabs
    guard tabs.openTabs.isEmpty else { return }
    let now = Date.now
    for page in history {
      if let visit = tabs.recordVisit(url: page.url, title: page.title, transition: .typed) {
        visit.visitedAt = now.addingTimeInterval(-page.minutesAgo * 60)
      }
    }
    for page in archivedPages {
      guard let url = URL(string: page.url) else { continue }
      let tab = tabs.open(.url(url, origin: .typed), selecting: false)
      tabs.update(tab.id, title: page.title)
      tabs.archive(tab.id)
      tab.archivedAt = now.addingTimeInterval(-page.minutesAgo * 60)
      tab.lastActive = now.addingTimeInterval(-page.minutesAgo * 60 - 600)
    }
    let browse = tabs.open(.browseForMe(query: "Things to do in Lisbon", resultID: UUID()), selecting: false)
    browse.lastActive = now.addingTimeInterval(-70 * 60)
    for page in openPages {
      guard let url = URL(string: page.url) else { continue }
      let tab = tabs.open(.url(url, origin: .typed), selecting: false)
      tabs.update(tab.id, title: page.title)
      tab.lastActive = now.addingTimeInterval(-page.minutesAgo * 60)
    }
    if let latest = tabs.openTabs.max(by: { $0.lastActive < $1.lastActive }) {
      tabs.select(latest.id)
    }
    try? tabs.context.save()
  }
}

enum DemoScenario {
  @MainActor
  static func apply(to app: AppModel, arguments: [String] = ProcessInfo.processInfo.arguments) {
    func value(_ key: String) -> String? {
      guard let index = arguments.firstIndex(of: key), index + 1 < arguments.count else { return nil }
      return arguments[index + 1]
    }
    if arguments.contains("-BrowseIncognito") { app.isIncognito = true }
    if let link = value("-BrowseOpen").flatMap(URL.init(string:)) {
      app.openPage(link, origin: .typed)
    }
    if let query = value("-BrowseQuery") {
      app.browse.presentSearch(from: .home, text: query)
    }
    if let surface = value("-BrowseSurface"), surface == "browsing", let selected = app.tabs.selectedTabID {
      if let index = value("-BrowseTab").flatMap(Int.init), app.tabs.openTabs.indices.contains(index) {
        app.openTab(app.tabs.openTabs[index].id)
      } else {
        app.openTab(selected)
      }
    }
    let delay = value("-BrowseDelay").flatMap(Double.init) ?? 6
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(delay))
      if arguments.contains("-BrowseToolbar") { app.browse.isToolbarPresented = true }
      if let text = value("-BrowseOverlay") { app.browse.presentSearch(from: .page, text: text, selectsAll: false) }
      if arguments.contains("-BrowseSummary"), let id = app.tabs.selectedTabID { app.browse.requestSummary(for: id) }
      if arguments.contains("-BrowseReader"), let id = app.tabs.selectedTabID { app.browse.readerTabID = id }
      if let query = value("-BrowseForMe") { app.startBrowseForMe(query) }
      if arguments.contains("-BrowseDeck") {
        app.browse.deckRequested = true
        if let index = value("-BrowseDeckOpen").flatMap(Int.init), app.tabs.openTabs.indices.contains(index) {
          try? await Task.sleep(for: .seconds(3))
          app.openTab(app.tabs.openTabs[index].id)
        }
      }
      if arguments.contains("-BrowsePlus") {
        try? await Task.sleep(for: .seconds(delay))
        app.newTab()
      }
      for step in (value("-BrowseSteps") ?? "").split(separator: ",").compactMap({ Int($0) }) {
        app.browse.stepRequest = BrowseSession.StepRequest(delta: step)
        try? await Task.sleep(for: .seconds(value("-BrowseStepGap").flatMap(Double.init) ?? 1.5))
      }
    }
  }
}
