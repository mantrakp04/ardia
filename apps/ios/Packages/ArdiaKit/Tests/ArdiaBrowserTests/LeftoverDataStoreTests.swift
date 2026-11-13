import Foundation
import Testing
import WebKit
@testable import ArdiaBrowser

@MainActor
@Suite(.serialized) struct LeftoverDataStoreTests {
  let base = "https://leftover-\(UUID().uuidString.prefix(8).lowercased()).ardia.test/"

  func cookies(in store: WKWebsiteDataStore, setting cookie: String? = nil) async throws -> String {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = store
    let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), configuration: configuration)
    let script = cookie.map { "document.cookie = '\($0); path=/; max-age=3600';" } ?? ""
    try await PageLoader().load(into: webView, "<!doctype html><html><body><script>\(script)</script>Left</body></html>", base: base)
    return try await webView.evaluateJavaScript("document.cookie") as? String ?? ""
  }

  @Test func clearingCookiesReachesStoresAnEarlierBuildMadeForSpaces() async throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let identifier = UUID()
    #expect(try await cookies(in: WKWebsiteDataStore(forIdentifier: identifier), setting: "left=over").contains("left=over"))
    await BrowsingDataCleaner.clear([.cookiesAndSiteData], tabs: fixture.store)
    #expect(try await !cookies(in: WKWebsiteDataStore(forIdentifier: identifier)).contains("left=over"))
    try? await WKWebsiteDataStore.remove(forIdentifier: identifier)
  }

  @Test func clearingEverythingRemovesThoseStores() async throws {
    let fixture = try StoreFixture()
    defer { fixture.cleanUp() }
    let identifier = UUID()
    #expect(try await cookies(in: WKWebsiteDataStore(forIdentifier: identifier), setting: "left=over").contains("left=over"))
    #expect(await WKWebsiteDataStore.allDataStoreIdentifiers.contains(identifier))
    await BrowsingDataCleaner.clear([.cache, .cookiesAndSiteData], tabs: fixture.store)
    #expect(await !WKWebsiteDataStore.allDataStoreIdentifiers.contains(identifier))
  }
}
