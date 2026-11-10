import Foundation
import Synchronization
import Testing
import WebKit
@testable import ArdiaBrowser

final class StubProtocol: URLProtocol {
  struct Reply: Sendable {
    var status: Int
    var body: String
  }

  static let replies = Mutex<[String: Reply]>([:])

  static func serve(_ url: String, status: Int = 200, _ body: String) {
    replies.withLock { $0[url] = Reply(status: status, body: body) }
  }

  override class func canInit(with request: URLRequest) -> Bool { request.url?.host()?.hasSuffix(".stub") == true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    guard let url = request.url, let reply = Self.replies.withLock({ $0[url.absoluteString] }) else {
      client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
      return
    }
    let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}

  static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubProtocol.self]
    return URLSession(configuration: configuration)
  }()
}

@MainActor
struct FilterListsFixture {
  let directory = URL.temporaryDirectory.appending(path: "ardia-filters-\(UUID().uuidString)", directoryHint: .isDirectory)
  let suite = "ardia.filters.\(UUID().uuidString)"
  let defaults: UserDefaults
  let lists: FilterLists
  let base: String

  init(catalog entries: [FilterListCatalog.Entry] = []) {
    defaults = UserDefaults(suiteName: suite)!
    let base = "https://\(UUID().uuidString.lowercased()).stub"
    self.base = base
    let catalog = FilterListCatalog(ubo: "test", lists: entries.map { entry in
      var entry = entry
      entry.urls = entry.urls.map { $0.replacingOccurrences(of: "https://lists.stub", with: base) }
      return entry
    })
    lists = FilterLists(directory: directory, defaults: defaults, session: StubProtocol.session, languages: ["en-US"], isMobile: true, catalog: catalog)
  }

  func cleanUp() {
    try? FileManager.default.removeItem(at: directory)
    defaults.removePersistentDomain(forName: suite)
  }

  static func entry(_ id: String, off: Bool = false) -> FilterListCatalog.Entry {
    FilterListCatalog.Entry(id: id, title: id, group: "ads", group2: nil, parent: nil, off: off, lang: nil, ua: nil, tags: nil, updateAfter: 5, urls: ["https://lists.stub/\(id).txt"], supportURL: nil, instructionURL: nil)
  }
}

@MainActor
@Suite(.serialized) struct FilterListsTests {
  @Test func defaultsMatchUBlockOriginPlusTheDevicesLanguageAndCookieNotices() {
    let catalog = FilterListCatalog.bundled
    #expect(catalog.ubo == "1.75.0")
    let ubo: Set<String> = ["ublock-filters", "ublock-badware", "ublock-privacy", "ublock-unbreak", "ublock-quick-fixes", "easylist", "easyprivacy", "urlhaus-1", "plowe-0"]
    #expect(Set(catalog.lists.filter { !$0.off }.map(\.id)) == ubo)
    #expect(catalog.defaultSelection(languages: ["en-US"], isMobile: false) == ubo.union(["fanboy-cookiemonster"]))
    let german = catalog.defaultSelection(languages: ["de-DE", "en-GB"], isMobile: true)
    #expect(german == ubo.union(["fanboy-cookiemonster", "DEU-0", "adguard-mobile"]))
    #expect(catalog.defaultSelection(languages: ["pt-BR"], isMobile: false).contains("spa-1"))
    #expect(catalog.lists.allSatisfy { $0.urls.allSatisfy { $0.hasPrefix("https://") } && !$0.urls.isEmpty })
    #expect(catalog.lists.first { $0.id == "fanboy-cookiemonster" }?.category == .cookieBanners)
    #expect(catalog.lists.first { $0.id == "easyprivacy" }?.category == .trackers)
    #expect(catalog.lists.first { $0.id == "easylist" }?.category == .ads)
  }

  @Test func aFailedDownloadKeepsTheLastGoodBuild() async throws {
    let fixture = FilterListsFixture(catalog: [FilterListsFixture.entry("good"), FilterListsFixture.entry("spare", off: true)])
    defer { fixture.cleanUp() }
    StubProtocol.serve("\(fixture.base)/good.txt", "! Title: Good\n||ads.example^\n||tracker.example^$third-party\n##.ad\n##+js(nope)")
    await fixture.lists.updateNow()
    let first = try #require(fixture.lists.list("good"))
    #expect(first.ruleCount == 3)
    #expect(first.skippedCount == 1)
    #expect(first.state == .ready)
    #expect(first.updatedAt != nil)
    #expect(fixture.lists.compiled.map(\.identifier) == ["ardia.filters.good.0"])
    #expect(fixture.lists.blockedDomains.contains("ads.example"))

    StubProtocol.serve("\(fixture.base)/good.txt", status: 503, "")
    await fixture.lists.updateNow()
    #expect(fixture.lists.compiled.map(\.identifier) == ["ardia.filters.good.0"])
    #expect(fixture.lists.list("good")?.ruleCount == 3)
    guard case .failed = fixture.lists.list("good")?.state else {
      Issue.record("expected a failed state, got \(String(describing: fixture.lists.list("good")?.state))")
      return
    }

    StubProtocol.serve("\(fixture.base)/good.txt", "<!doctype html><html><body>Not found</body></html>")
    await fixture.lists.updateNow()
    #expect(fixture.lists.compiled.count == 1)
    #expect(fixture.lists.list("good")?.ruleCount == 3)
  }

  @Test func customListsAreValidatedAndMyFiltersApplyLast() async throws {
    let fixture = FilterListsFixture()
    defer { fixture.cleanUp() }
    StubProtocol.serve("\(fixture.base)/page.html", "<!doctype html><html><body>Hello</body></html>")
    StubProtocol.serve("\(fixture.base)/mine.txt", "! Title: Neighbourhood List\n||local-ads.example^\n@@||friend.example^")
    #expect(await fixture.lists.addList(URL(string: "http://\(UUID().uuidString).stub/x.txt")!) == FilterListError.invalidAddress.message)
    #expect(await fixture.lists.addList(URL(string: "\(fixture.base)/page.html")!) == FilterListError.notAFilterList.message)
    #expect(await fixture.lists.addList(URL(string: "\(fixture.base)/missing.txt")!) != nil)
    #expect(await fixture.lists.addList(URL(string: "\(fixture.base)/mine.txt")!) == nil)
    #expect(await fixture.lists.addList(URL(string: "\(fixture.base)/mine.txt")!) == FilterListError.alreadyAdded.message)
    let added = try #require(fixture.lists.lists.first { $0.isCustom })
    #expect(added.title == "Neighbourhood List")
    #expect(added.isEnabled && added.group == .custom)

    let result = await fixture.lists.applyMyFilters("||friend.example^\nnews.example##.paywall\n##+js(skip)")
    #expect(result == MyFiltersResult(ruleCount: 2, skippedCount: 1))
    #expect(fixture.lists.compiled.contains { $0.identifier == "ardia.filters.my-filters.0" && $0.category == nil })

    let reloaded = FilterLists(directory: fixture.directory, defaults: fixture.defaults, session: StubProtocol.session, languages: ["en-US"], catalog: fixture.lists.catalog)
    #expect(reloaded.myFilters.contains("news.example##.paywall"))
    #expect(reloaded.lists.contains { $0.isCustom && $0.title == "Neighbourhood List" })
    await reloaded.loadCompiled()
    #expect(reloaded.compiled.count == fixture.lists.compiled.count)

    fixture.lists.removeList(added.id)
    #expect(!fixture.lists.lists.contains { $0.isCustom })
  }

  @Test func demoListsLookRealAndNeverTouchTheNetwork() async {
    let fixture = FilterListsFixture()
    defer { fixture.cleanUp() }
    let demo = FilterLists.demo(directory: fixture.directory, defaults: fixture.defaults)
    #expect(demo.list("easylist")?.ruleCount == 84792)
    #expect(demo.lists.filter(\.isEnabled).allSatisfy { $0.ruleCount > 0 && $0.updatedAt != nil })
    demo.seedDemo(states: ["easylist": .downloading, "easyprivacy": .failed("The server didn’t respond."), "plowe-0": .offline])
    #expect(demo.list("easylist")?.state == .downloading)
    #expect(demo.isOffline && demo.isUpdating)
    await demo.updateNow()
    #expect(demo.list("easylist")?.state == .downloading)
    #expect(await demo.addList(URL(string: "https://lists.example/neighbourhood.txt")!) == nil)
    #expect(demo.lists.contains { $0.isCustom && $0.ruleCount == 1240 })
    #expect(!FileManager.default.fileExists(atPath: fixture.directory.appending(path: "Lists").path(percentEncoded: false)))
  }
}
