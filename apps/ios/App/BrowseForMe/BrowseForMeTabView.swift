import ArdiaBrowser
import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct BrowseForMeTabView: View {
  let tabID: UUID

  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var browse: BrowseForMe?
  @State private var mode: BrowseMode = .browse
  @State private var showsResults = false
  @State private var insets = EdgeInsets()

  init(tabID: UUID) {
    self.tabID = tabID
  }

  var body: some View {
    ZStack(alignment: .bottomTrailing) {
      if let browse {
        BrowseForMePage(
          browse: browse,
          engineName: app.searchEngineName,
          actions: BrowseForMePage.Actions(
            open: { app.openFromBrowseForMe($0) },
            search: { _ in select(.search) },
            ask: { app.browseForMe($0) },
            editQuery: { app.browse.presentSearch(from: .page, text: $0, selectsAll: true) },
            finished: { app.saveBrowsePage($0, forTab: tabID) },
            openExperiments: { app.openSettings(at: .experiments) }))
        .opacity(mode == .browse ? 1 : 0)
        .allowsHitTesting(mode == .browse)
        if showsResults, let url = resultsURL(for: browse.query) {
          EngineResultsView(url: url, isPrivate: app.isIncognito) { app.openFromBrowseForMe($0) }
            .padding(.bottom, BrowseLayout.barHeight)
            .opacity(mode == .search ? 1 : 0)
            .allowsHitTesting(mode == .search)
        }
        SearchModePill(mode: $mode, engineName: app.searchEngineName, engineURL: engineHomeURL)
          .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
          .padding(.trailing, BrowseLayout.barSideInset)
          .padding(.bottom, max(BrowseLayout.barHeight - insets.bottom, 0) + BrowseLayout.barSideInset)
      } else {
        RisingGradient(isAnimating: false)
      }
    }
    .safeAreaPadding(.top, insets.top)
    .safeAreaPadding(.bottom, insets.bottom)
    .background { WindowInsetsReader { insets = $0 } }
    .onChange(of: mode) { _, mode in
      if mode == .search { showsResults = true }
    }
    .onAppear {
      browse = app.browseForMe(forTab: tabID)
      if app.isDemo, ProcessInfo.processInfo.arguments.contains("-BrowseForMeResults") { mode = .search }
    }
    .onChange(of: tabID) {
      mode = .browse
      showsResults = false
      browse = app.browseForMe(forTab: tabID)
    }
  }

  private func select(_ value: BrowseMode) {
    withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : IntelligenceMotion.modeSwitch) { mode = value }
  }

  private func resultsURL(for query: String) -> URL? {
    URL(string: BrowserURL.searchURL(template: app.tabs.searchTemplate, query: query))
  }

  private var engineHomeURL: String {
    guard let url = resultsURL(for: "q"), let host = url.host() else { return "https://www.google.com" }
    return "https://\(host)"
  }
}

struct WindowInsetsReader: UIViewRepresentable {
  var onChange: (EdgeInsets) -> Void

  func makeUIView(context: Context) -> Probe {
    let probe = Probe()
    probe.isUserInteractionEnabled = false
    probe.onChange = onChange
    return probe
  }

  func updateUIView(_ probe: Probe, context: Context) {
    probe.onChange = onChange
  }

  final class Probe: UIView {
    var onChange: ((EdgeInsets) -> Void)?
    private var reported: UIEdgeInsets?

    override func didMoveToWindow() {
      super.didMoveToWindow()
      report()
    }

    override func layoutSubviews() {
      super.layoutSubviews()
      report()
    }

    private func report() {
      guard let insets = window?.safeAreaInsets, insets != reported else { return }
      reported = insets
      let edges = EdgeInsets(top: insets.top, leading: insets.left, bottom: insets.bottom, trailing: insets.right)
      Task { @MainActor [onChange] in onChange?(edges) }
    }
  }
}
