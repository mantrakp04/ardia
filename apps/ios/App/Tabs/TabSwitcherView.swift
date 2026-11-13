import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct TabSwitcherView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.profileLook) private var look
  @Environment(\.windowCornerRadii) private var corners
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  @State private var query = ""
  @FocusState private var isSearching: Bool
  @State private var forcesBanner = false
  @State private var isConfirmingCloseAll = false
  @State private var isConfirmingCloseIncognito = false
  @State private var clearTicks = 0
  @State private var isExpanding = false
  @State private var systemVerticalEdge: HorizontalEdge?
  @State private var railSearchOpen = false

  var body: some View {
    GeometryReader { proxy in
      let scene = sceneLayout(proxy)
      let visible = TabFilter.matching(app.deckOrder, query: query)
      ZStack(alignment: .top) {
        TabsBackdrop(look: look)
          .contentShape(.rect)
          .onTapGesture { isSearching = false }
        deck(scene: scene, visible: visible)
        if visible.isEmpty {
          DeckEmptyState(isFiltering: !query.isEmpty, showsArchive: app.hasArchivedTabs) { app.openArchive() }
            .position(x: scene.content.midX, y: scene.strip.cardCenterY)
            .transition(.opacity)
        }
        chrome(scene: scene)
          .opacity(isExpanding ? 0 : 1)
        if scene.isRail {
          railBar(scene: scene)
            .opacity(isExpanding ? 0 : 1)
        }
      }
      .ignoresSafeArea()
      .overlay(alignment: .bottom) {
        if !scene.isRail {
          bottomBar(scene: scene)
            .opacity(isExpanding ? 0 : 1)
        }
      }
    }
    .ignoresSafeArea(.keyboard)
    .onVerticalBarEdgeChange { systemVerticalEdge = $0 }
    .onChange(of: isSearching) { _, searching in
      if !searching { railSearchOpen = false }
    }
    .animation(reduceMotion ? nil : TabsMotion.fade, value: isExpanding)
    .sensoryFeedback(.impact(weight: .medium), trigger: clearTicks)
    .confirmationDialog(closeAllTitle, isPresented: $isConfirmingCloseAll, titleVisibility: .visible) {
      Button(closeAllButton, role: .destructive) {
        clearTicks += 1
        app.closeAllTabs()
      }
    } message: {
      Text(app.tabs.privateTabs.isEmpty ? "They’ll stay in your Archive." : "Incognito tabs aren’t saved. Other tabs stay in your Archive.")
    }
    .confirmationDialog("Close Incognito Tabs?", isPresented: $isConfirmingCloseIncognito, titleVisibility: .visible) {
      Button("Close Incognito Tabs", role: .destructive) {
        clearTicks += 1
        app.leaveIncognito()
      }
    } message: {
      Text("Their pages, cookies and history are cleared.")
    }
    .onChange(of: app.deck.command) { _, command in
      guard command?.kind == .showArchiveCard else { return }
      withAnimation(TabsMotion.fade) { forcesBanner = true }
    }
    .onChange(of: app.currentSpace?.syncId) { query = "" }
    .onAppear {
      if app.isDemo, let demoQuery = SpacesDemo.deckQuery { query = demoQuery }
    }
  }

  private func sceneLayout(_ proxy: GeometryProxy) -> DeckSceneLayout {
    let safe = proxy.safeAreaInsets
    let size = CGSize(width: proxy.size.width + safe.leading + safe.trailing, height: proxy.size.height + safe.top + safe.bottom)
    let occlusions = proxy.reservedAreas(.occlusion).map { $0.frame.offsetBy(dx: safe.leading, dy: safe.top) }
    return DeckSceneLayout(
      container: size,
      safeArea: safe,
      corners: corners,
      occlusions: occlusions,
      verticalEdge: BarDemo.verticalEdge ?? systemVerticalEdge,
      showsBanner: showsBanner
    )
  }

  @ViewBuilder
  private func deck(scene: DeckSceneLayout, visible: [BrowserTab]) -> some View {
    switch scene.style {
    case .strip:
      DeckStrip(geometry: scene.strip, tabs: visible, isExpanding: $isExpanding, onInteraction: { isSearching = false })
        .id(app.currentSpace?.syncId)
        .frame(width: scene.content.width, height: scene.content.height)
        .clipped()
        .position(x: scene.content.midX, y: scene.content.midY)
    case .grid:
      DeckGrid(
        metrics: scene.grid,
        tabs: visible,
        topInset: scene.gridTopInset,
        bottomInset: scene.gridBottomInset,
        onInteraction: { isSearching = false }
      )
      .id(app.currentSpace?.syncId)
      .frame(width: scene.gridViewport.width, height: scene.gridViewport.height)
      .clipped()
      .position(x: scene.gridViewport.midX, y: scene.gridViewport.midY)
    }
  }

  private func bottomBar(scene: DeckSceneLayout) -> some View {
    let frame = scene.bar.barFrame
    return deckBar(width: frame.width, isRail: false)
      .offset(x: frame.midX - scene.size.width / 2)
      .padding(.bottom, isSearching ? Tokens.Space.m : scene.size.height - frame.maxY)
      .ignoresSafeArea(.container, edges: .bottom)
  }

  @ViewBuilder
  private func railBar(scene: DeckSceneLayout) -> some View {
    let frame = scene.bar.barFrame
    deckBar(width: frame.width, isRail: true)
      .frame(width: frame.width, height: frame.height, alignment: .top)
      .position(x: frame.midX, y: frame.midY)
    if let field = scene.railSearch, railSearchOpen || !query.isEmpty {
      GlassBar {
        DeckSearchField(query: $query, searchFocus: $isSearching)
      }
      .frame(width: field.width, height: field.height)
      .position(x: field.midX, y: field.midY)
      .onAppear { if railSearchOpen { isSearching = true } }
      .transition(.opacity)
    }
  }

  private func deckBar(width: CGFloat, isRail: Bool) -> DeckBar {
    DeckBar(
      width: width,
      isRail: isRail,
      isIncognito: app.isIncognito,
      showsSpaces: app.sync.isEnabled,
      canReopen: app.tabs.canReopenClosed,
      hasTabs: !app.deckTabs.isEmpty,
      query: $query,
      searchFocus: $isSearching,
      actions: barActions,
      openSearch: {
        withAnimation(reduceMotion ? nil : TabsMotion.fade) { railSearchOpen = true }
        isSearching = true
      }
    )
  }

  private func chrome(scene: DeckSceneLayout) -> some View {
    ZStack(alignment: .topLeading) {
      DeckHeader(
        privateCount: app.tabs.privateTabs.count,
        canClose: !app.deckTabs.isEmpty,
        showsMore: !scene.isRail,
        closeIncognito: { isConfirmingCloseIncognito = true },
        closeAll: { isConfirmingCloseAll = true }
      )
      .placed(in: scene.chrome.header)
      if let banner = scene.chrome.banner {
        ArchiveBanner(interval: Bindable(app.tabs).autoArchiveInterval, answer: answerBanner)
          .placed(in: banner)
          .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .animation(reduceMotion ? nil : TabsMotion.fade, value: showsBanner)
  }

  private var showsBanner: Bool {
    forcesBanner || app.deck.shouldOfferArchiveCard(openTabs: app.spaceTabs.count)
  }

  private func answerBanner() {
    withAnimation(TabsMotion.fade) {
      forcesBanner = false
      app.deck.hasShownArchiveCard = true
    }
  }

  private var barActions: DeckBar.Actions {
    DeckBar.Actions(
      newTab: { app.newTab() },
      newRegularTab: { app.newRegularTab() },
      newIncognitoTab: { app.newIncognitoTab() },
      reopen: { app.reopenLastClosed() },
      closeAll: {
        if app.isIncognito {
          isConfirmingCloseIncognito = true
        } else {
          isConfirmingCloseAll = true
        }
      },
      leading: { app.sync.isEnabled ? app.openSyncedSpaces() : app.openArchive() }
    )
  }

  private var closeAllTitle: String {
    let count = app.deckTabs.count
    return count == 1 ? String(localized: "Close 1 Tab?") : String(localized: "Close \(count) Tabs?")
  }

  private var closeAllButton: String {
    app.deckTabs.count == 1 ? String(localized: "Close Tab") : String(localized: "Close All Tabs")
  }
}

private extension View {
  func placed(in frame: CGRect) -> some View {
    self.frame(width: frame.width, height: frame.height).offset(x: frame.minX, y: frame.minY)
  }
}
