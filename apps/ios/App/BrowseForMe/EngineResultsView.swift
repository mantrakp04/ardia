import ArdiaDesign
import SwiftUI
import WebKit

struct EngineResultsView: View {
  let url: URL
  let isPrivate: Bool
  var onOpen: (URL) -> Void

  @State private var page: WebPage?
  @State private var failed = false

  var body: some View {
    ZStack {
      IntelligencePalette.pageBackground.ignoresSafeArea()
      if let page {
        WebView(page)
          .webViewBackForwardNavigationGestures(.enabled)
          .opacity(page.isLoading && page.url == nil ? 0 : 1)
      }
      if failed {
        ContentUnavailableView {
          Label("Couldn\u{2019}t Load Results", systemImage: "wifi.slash")
        } actions: {
          Button("Try Again") { Task { await load() } }
            .buttonStyle(.bordered)
        }
      }
    }
    .task { await load() }
  }

  private func load() async {
    failed = false
    let current = page ?? makePage()
    page = current
    do {
      for try await _ in current.load(URLRequest(url: url)) {}
    } catch {
      failed = current.url == nil
    }
  }

  private func makePage() -> WebPage {
    var configuration = WebPage.Configuration()
    configuration.websiteDataStore = isPrivate ? .nonPersistent() : .default()
    let engineHost = url.host()
    return WebPage(
      configuration: configuration,
      navigationDecider: ResultsNavigation(engineHost: engineHost, onOpen: onOpen))
  }
}

private struct ResultsNavigation: WebPage.NavigationDeciding {
  var engineHost: String?
  var onOpen: (URL) -> Void

  func decidePolicy(
    for action: WebPage.NavigationAction, preferences: inout WebPage.NavigationPreferences
  ) async -> WKNavigationActionPolicy {
    let isMainFrame = action.target?.isMainFrame ?? true
    guard let url = action.request.url, let scheme = url.scheme, ["http", "https"].contains(scheme) else {
      return isMainFrame ? .cancel : .allow
    }
    guard isMainFrame, action.target == nil || leavesEngine(url) else { return .allow }
    onOpen(Self.destination(of: url))
    return .cancel
  }

  private func leavesEngine(_ url: URL) -> Bool {
    guard let host = url.host(), let engineHost else { return true }
    if host == engineHost { return url.path() == "/url" }
    let root = engineHost.split(separator: ".").suffix(2).joined(separator: ".")
    return !(host == root || host.hasSuffix("." + root))
  }

  static func destination(of url: URL) -> URL {
    guard url.path() == "/url",
      let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
      let target = items.first(where: { $0.name == "q" || $0.name == "url" })?.value,
      let resolved = URL(string: target), resolved.scheme?.hasPrefix("http") == true
    else { return url }
    return resolved
  }
}
