import ArdiaSync
import Foundation
import Testing
@testable import ArdiaBrowser

@Suite struct OmniboxTests {
  let omnibox: Omnibox

  init() {
    omnibox = Omnibox(directory: nil)
  }

  @Test(arguments: [
    ("apple.com", OmniboxResolution.Kind.url, "https://apple.com"),
    ("  https://example.com/a b  ", .url, "https://example.com/a%20b"),
    ("localhost:3000", .url, "http://localhost:3000"),
    ("bücher.de", .url, "https://bücher.de"),
    ("how tall is everest", .search, "https://www.google.com/search?q=how%20tall%20is%20everest"),
    ("?apple.com", .search, "https://www.google.com/search?q=apple.com"),
    ("weather tomorrow !w", .bang, "https://wikipedia.org/w/index.php?search=weather+tomorrow"),
    ("!yt", .bang, "https://www.youtube.com/"),
  ])
  func resolvesTypedText(text: String, kind: OmniboxResolution.Kind, url: String) async throws {
    let resolution = try #require(await omnibox.resolve(text))
    #expect(resolution.kind == kind)
    #expect(resolution.url.absoluteString == (URL(string: url)?.absoluteString ?? url))
  }

  @Test func emptyInputResolvesToNothing() async {
    #expect(await omnibox.resolve("   ") == nil)
  }

  @Test func usesTheSyncedEngineAndItsCustomEngines() async throws {
    let synced = SyncedSearch(engineId: "duckduckgo", customURL: nil, customEngines: [.init(id: "c1", name: "Docs", keyword: "docs", url: "https://docs.example/?q=%s")])
    let info = await omnibox.setSearch(synced, localEngineID: "google")
    #expect(info?.name == "DuckDuckGo")
    #expect(await omnibox.engines().contains { $0.id == "c1" && $0.custom == true })
    #expect(try #require(await omnibox.resolve("rust book")).url.absoluteString == "https://duckduckgo.com/?q=rust%20book")
    await omnibox.setSearch(nil, localEngineID: "bing")
    #expect(try #require(await omnibox.resolve("rust book")).url.absoluteString == "https://www.bing.com/search?q=rust%20book")
    await omnibox.setSearch(SyncedSearch(engineId: "missing", customURL: nil, customEngines: []), localEngineID: "bing")
    #expect(try #require(await omnibox.resolve("x y")).engine == "Google")
  }

  @Test func ranksMacHistoryAndCompletesInline() async throws {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let snapshot = SyncSnapshot(profiles: [
      SyncedProfile(
        syncId: "p", name: "Personal", color: nil, icon: nil, isDefault: true, theme: nil,
        deviceTabs: [DeviceTabs(deviceId: "mac", deviceName: "MacBook Pro", kind: .mac, tabs: [RemoteTab(url: "https://linear.app/team/issue/ARD-1", title: "ARD-1 Sync")])],
        pinned: PinnedArea(),
        bookmarks: [BookmarkItem(key: "b", title: "Swift Forums", url: "https://forums.swift.org/", added: now, root: .bar, children: nil)],
        history: [
          HistoryItem(url: "https://github.com/apple/swift", title: "apple/swift", visits: 40, lastVisit: now.addingTimeInterval(-3600)),
          HistoryItem(url: "https://gist.github.com/x", title: "A gist", visits: 1, lastVisit: now.addingTimeInterval(-20 * 86400)),
        ]
      ),
    ], syncedAt: now)
    let local = [OmniboxCandidates.HistoryRow(url: "https://github.com/apple/swift", title: "", favicon: nil, visits: 3, lastVisit: now.timeIntervalSince1970 * 1000)]
    let candidates = OmniboxCandidates.merge(openTabs: [], localHistory: local, snapshot: snapshot, profileSyncId: nil)
    #expect(candidates.history.first { $0.url == "https://github.com/apple/swift" }?.visits == 40)
    #expect(candidates.history.first { $0.url == "https://github.com/apple/swift" }?.title == "apple/swift")
    await omnibox.setCandidates(candidates)

    let typed = await omnibox.suggest("git", now: now)
    #expect(typed.inlineCompletion == "hub.com")
    guard case .page(let url, _, _, _, _, _)? = typed.suggestions.first else {
      Issue.record("expected a page first, got \(typed.suggestions)")
      return
    }
    #expect(url == "https://github.com/")
    #expect(typed.suggestions.contains { if case .search(let query, _, _, _, _) = $0 { query == "git" } else { false } })

    let swift = await omnibox.suggest("swift forums", now: now)
    #expect(swift.suggestions.contains { if case .page(let url, _, _, _, let bookmarked, _) = $0 { url == "https://forums.swift.org/" && bookmarked } else { false } })
    let macTab = await omnibox.suggest("ARD-1", now: now)
    #expect(macTab.suggestions.contains { $0.url == "https://linear.app/team/issue/ARD-1" })
    let calc = await omnibox.suggest("12*(3+4)", now: now)
    #expect(calc.suggestions.contains { if case .calculation(_, let value, _) = $0 { value == "84" } else { false } })
  }

  @Test func keystrokesAnswerFastWithALargeHistory() async throws {
    let now = Date.now
    let history = (0..<5000).map { index in
      OmniboxCandidates.HistoryRow(url: "https://site\(index % 700).example.com/path/\(index)", title: "Page \(index) about topic \(index % 37)", favicon: nil, visits: index % 9 + 1, lastVisit: now.addingTimeInterval(Double(-index * 60)).timeIntervalSince1970 * 1000)
    }
    await omnibox.setCandidates(OmniboxCandidates(history: history))
    _ = await omnibox.suggest("s")
    let clock = ContinuousClock()
    var slowest = Duration.zero
    for prefix in ["si", "sit", "site", "site4", "site42", "topic", "topic 3", "page 49"] {
      let elapsed = await clock.measure { _ = await omnibox.suggest(prefix) }
      slowest = max(slowest, elapsed)
    }
    #expect(slowest < .milliseconds(16), "slowest keystroke took \(slowest)")
  }

  @Test func remoteSuggestionsAreOffForURLsAndBangs() async {
    #expect(await omnibox.remoteSuggestions(for: "https://example.com").isEmpty)
    #expect(await omnibox.remoteSuggestions(for: "cats !w").isEmpty)
  }

  @Test func cleansTrackersAndFormatsTheToolbarLabel() async {
    let cleaned = await omnibox.cleanURL(URL(string: "https://example.com/a?utm_source=x&id=7&fbclid=abc")!)
    #expect(cleaned.absoluteString == "https://example.com/a?id=7")
    let display = await omnibox.display("https://www.xn--bcher-kva.de/b", title: "Books | Bücher")
    #expect(display.host == "bücher.de")
    #expect(display.trail == ["Books", "Bücher"])
  }
}

@MainActor
final class FakePage: DiscardablePage {
  var isLive = false
  var savedState: String?
  var page = "blank"
  var restores = 0

  func makeLive() {
    isLive = true
    if let savedState {
      page = savedState
      restores += 1
    }
  }

  func discard() {
    savedState = page
    isLive = false
  }
}

@MainActor
@Suite struct LivePageRosterTests {
  @Test func keepsAtMostTheLimitLiveAndRestoresDiscardedPages() {
    let roster = LivePageRoster<FakePage>(limit: 3)
    let ids = (0..<5).map { _ in UUID() }
    let pages = ids.map { id in
      let page = FakePage()
      roster.register(page, for: id)
      return page
    }
    for (index, id) in ids.enumerated() {
      roster.activate(id)
      pages[index].page = "page \(index)"
    }
    #expect(roster.liveIDs == Array(ids[2...]))
    #expect(!pages[0].isLive && !pages[1].isLive)
    roster.activate(ids[0])
    #expect(pages[0].isLive)
    #expect(pages[0].page == "page 0")
    #expect(pages[0].restores == 1)
    #expect(roster.liveIDs == [ids[3], ids[4], ids[0]])
  }

  @Test func memoryWarningKeepsOnlyTheSelectedPage() {
    let roster = LivePageRoster<FakePage>(limit: 6)
    let ids = (0..<4).map { _ in UUID() }
    let pages = ids.map { id in
      let page = FakePage()
      roster.register(page, for: id)
      roster.activate(id)
      return page
    }
    roster.discardAll(except: ids[1])
    #expect(roster.liveIDs == [ids[1]])
    #expect(pages.map(\.isLive) == [false, true, false, false])
    roster.remove(ids[1])
    #expect(roster.liveIDs.isEmpty)
    #expect(roster.page(ids[1]) == nil)
  }
}

@Suite struct WebPolicyTests {
  @Test(arguments: [
    ("https://example.com", LinkRoute.web),
    ("tel:+15551234567", .external(.phone)),
    ("mailto:a@b.c", .external(.mail)),
    ("sms:123", .external(.messages)),
    ("maps://?q=cafe", .external(.maps)),
    ("itms-apps://apps.apple.com/app/id1", .external(.appStore)),
    ("https://apps.apple.com/us/app/id1", .external(.appStore)),
    ("javascript:alert(1)", .blocked),
    ("spotify:track:1", .external(.other)),
  ])
  func routesLinks(url: String, route: LinkRoute) throws {
    #expect(ExternalLinks.route(try #require(URL(string: url))) == route)
  }

  @Test func subframesNeverLaunchApps() throws {
    #expect(ExternalLinks.route(try #require(URL(string: "spotify:track:1")), isMainFrame: false) == .blocked)
  }

  @Test func progressPublishesWholePercentsAtMostTenTimesASecond() {
    var throttle = ProgressThrottle()
    let start = Date(timeIntervalSince1970: 0)
    #expect(throttle.offer(0.104, at: start) == 0.1)
    #expect(throttle.offer(0.109, at: start.addingTimeInterval(0.2)) == nil)
    #expect(throttle.offer(0.5, at: start.addingTimeInterval(0.05)) == nil)
    #expect(throttle.offer(0.5, at: start.addingTimeInterval(0.11)) == 0.5)
    #expect(throttle.offer(1, at: start.addingTimeInterval(0.12)) == 1)
  }

  @Test func scrollDirectionFlipsOnlyPastTheThreshold() {
    var tracker = ScrollDirectionTracker()
    #expect(tracker.offer(offset: 10, contentHeight: 3000, viewportHeight: 800) == nil)
    #expect(tracker.offer(offset: 30, contentHeight: 3000, viewportHeight: 800) == .down)
    #expect(tracker.offer(offset: 400, contentHeight: 3000, viewportHeight: 800) == nil)
    #expect(tracker.offer(offset: 390, contentHeight: 3000, viewportHeight: 800) == nil)
    #expect(tracker.offer(offset: 360, contentHeight: 3000, viewportHeight: 800) == .up)
    #expect(tracker.offer(offset: 0, contentHeight: 3000, viewportHeight: 800) == nil)
  }
}
