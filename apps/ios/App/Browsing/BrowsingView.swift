import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UIKit

struct BrowsingView: View {
  var isFront = true

  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Namespace private var omnibox
  @State private var pinchScale: CGFloat = 1
  @State private var foldTicks = 0
  @State private var summarySnapshot: UIImage?
  @State private var pinchSnapshot: UIImage?
  @State private var pager = PagerState()
  @State private var barHidden = false
  @State private var tabSwitchTicks = 0
  @State private var pageWidth: CGFloat = 402
  @State private var storedCover: StoredCover?

  var body: some View {
    @Bindable var browse = app.browse
    let tab = app.tabs.selectedTab
    ZStack(alignment: .bottom) {
      BrowsePalette.pageBackdrop.ignoresSafeArea()
      if let tab {
        pageLayer(tab)
          .overlay(alignment: .top) { statusStrip(tab) }
          .scaleEffect(pinchScale)
          .offset(x: pager.offset)
          .ignoresSafeArea()
        pagerNeighbors
      }
      if browse.summaryTabID == nil {
        bar
      }
      if let request = browse.search {
        searchOverlay(request)
      }
      if let id = browse.summaryTabID, let tab = app.tabs.tab(id) {
        SummaryStage(tabID: id, snapshot: summarySnapshot, title: tab.title, pageURL: tab.url, faviconURL: tab.faviconURL) {
          browse.summaryTabID = nil
          summarySnapshot = nil
        }
        .zIndex(2)
      }
    }
    .overlay(alignment: .top) {
      if let page = currentWebPage, browse.summaryTabID == nil {
        LoadingLine(progress: page.progress, isLoading: page.isLoading)
          .ignoresSafeArea(edges: .horizontal)
      }
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { pageWidth = $0 }
    .modifier(PageRequestAlert(page: currentWebPage))
    .sheet(isPresented: $browse.isToolbarPresented) {
      if let id = app.tabs.selectedTabID {
        ToolbarSheet(tabID: id)
      }
    }
    .sheet(item: Binding(get: { app.web.shareRequest }, set: { app.web.shareRequest = $0 })) { url in
      ActivitySheet(url: url)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.hidden)
        .ignoresSafeArea()
    }
    .fullScreenCover(item: Binding(get: { browse.readerTabID.map(ReaderTarget.init) }, set: { browse.readerTabID = $0?.id })) { target in
      ReaderView(tabID: target.id)
    }
    .onChange(of: browse.deckRequested) { _, requested in
      guard requested else { return }
      browse.deckRequested = false
      openDeck()
    }
    .onChange(of: browse.stepRequest) { _, request in
      guard let request else { return }
      browse.stepRequest = nil
      stepTab(request.delta)
    }
    .onChange(of: browse.summaryRequestID) { _, id in
      guard let id else { return }
      browse.summaryRequestID = nil
      beginSummary(for: id)
    }
    .onChange(of: currentWebPage?.scrollDirection) { _, direction in
      guard app.settings.collapsesBottomBar else { return }
      withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Motion.barCollapse) { barHidden = direction == .down }
    }
    .onChange(of: app.tabs.selectedTabID, initial: true) { _, id in
      barHidden = false
      app.goBackToSearchIfEmpty()
      if let id, app.tabs.tab(id)?.origin != .browseForMe { _ = app.web.webTab(for: id) }
    }
    .onChange(of: isFront) { _, front in
      if front { barHidden = false }
    }
    .toolbarColorScheme(isFront ? statusScheme : nil, for: .statusBar)
    .accessibilityHidden(!isFront)
    .sensoryFeedback(.impact(flexibility: .soft, intensity: 0.8), trigger: foldTicks)
    .sensoryFeedback(.impact(weight: .light, intensity: 0.7), trigger: tabSwitchTicks)
  }

  private var tone: PageTone? {
    guard let tab = app.tabs.selectedTab, tab.origin != .browseForMe else { return nil }
    return app.browse.tone(for: tab, page: currentWebPage)
  }

  private var statusScheme: ColorScheme? {
    guard browseSummaryHidden, app.browse.search == nil else { return nil }
    return tone?.top?.scheme
  }

  private var browseSummaryHidden: Bool { app.browse.summaryTabID == nil }

  @ViewBuilder
  private func statusStrip(_ tab: BrowserTab) -> some View {
    if tab.origin != .browseForMe, let top = tone?.top {
      Color.clear
        .frame(height: 0)
        .background(alignment: .top) {
          top.color
            .ignoresSafeArea(edges: .top)
            .animation(.easeOut(duration: 0.25), value: top)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
  }

  private var currentWebPage: WebTab? {
    app.currentPage
  }

  @ViewBuilder
  private func pageLayer(_ tab: BrowserTab) -> some View {
    let page = tab.origin == .browseForMe ? nil : app.web.existingWebTab(tab.id)
    let browse = app.browse
    ZStack {
      WebPageView(
        page: page,
        tab: tab,
        cover: cover(for: tab),
        swipeMode: app.preferences.swipeNavigation,
        bottomInset: BrowseLayout.barHeight - 26,
        pinchEnabled: app.offersPinchToSummarize && app.browse.summaryTabID == nil,
        onPinch: handlePinch,
        onTone: { id, tone in browse.setTone(tone, for: id) }
      )
      if let failure = page?.failure, let page {
        PageFailureView(failure: failure) { page.reload() }
          .transition(.opacity)
      }
      if tab.origin == .browseForMe {
        BrowseForMeTabView(tabID: tab.id)
          .id(tab.id)
      }
    }
    .task(id: tab.id) { await loadStoredCover(for: tab) }
  }

  private func cover(for tab: BrowserTab) -> UIImage? {
    app.browse.covers.image(for: tab.id) ?? app.deck.memoryImage(for: tab.id) ?? (storedCover?.id == tab.id ? storedCover?.image : nil)
  }

  private func loadStoredCover(for tab: BrowserTab) async {
    guard app.browse.covers.image(for: tab.id) == nil, app.deck.memoryImage(for: tab.id) == nil,
          let name = tab.snapshotFileName, let image = await app.web.snapshots.image(named: name) else { return }
    storedCover = StoredCover(id: tab.id, image: UIImage(cgImage: image))
  }

  private func openDeck() {
    app.browse.thawOrder()
    saveCurrentSnapshot()
    app.showTabSwitcher()
  }

  private func saveCurrentSnapshot() {
    rememberCurrentCover()
    guard let id = app.tabs.selectedTabID, let image = app.browse.covers.image(for: id), let cgImage = image.cgImage else { return }
    let snapshots = app.web.snapshots
    let tabs = app.tabs
    let scale = image.scale
    Task {
      if let name = await snapshots.save(cgImage, scale: scale, for: id) {
        tabs.update(id, snapshotFileName: name)
      }
    }
  }

  private func rememberCurrentCover() {
    guard let id = app.tabs.selectedTabID, let page = app.web.existingWebTab(id), !page.isLoading, page.failure == nil,
          let webView = page.webView, let image = PageCoverCache.capture(webView) else { return }
    app.browse.covers.store(image, for: id)
  }

  private var bar: some View {
    BottomBar(
      plusNamespace: omnibox,
      isSearchPresented: app.browse.search != nil,
      onTabs: openDeck,
      onPlus: openSearch,
      onMore: { app.browse.isToolbarPresented = true },
      onStep: stepTab,
      onSelectTab: { id in switchTab(to: id, order: swipeOrder) },
      onCloseTab: closeCurrentTab
    )
    .frame(height: BrowseLayout.hitTarget)
    .padding(.top, BrowseLayout.barHeight - BrowseLayout.barCenterFromBottom - BrowseLayout.hitTarget / 2)
    .frame(maxWidth: .infinity)
    .frame(height: BrowseLayout.barHeight, alignment: .top)
    .background { BarBacking(tone: tone?.bottom, solid: reduceTransparency) }
    .environment(\.colorScheme, barScheme)
    .contentShape(.rect)
    .highPriorityGesture(pagerGesture)
    .offset(y: barHidden ? BrowseLayout.barCollapseTravel : 0)
    .opacity(barHidden ? 0 : 1)
    .allowsHitTesting(!barHidden)
    .ignoresSafeArea(.container, edges: .bottom)
    .ignoresSafeArea(.keyboard)
  }

  @Environment(\.colorScheme) private var systemScheme

  private var barScheme: ColorScheme {
    tone?.bottom?.scheme ?? systemScheme
  }

  private func openSearch() {
    let text = app.tabs.selectedTab.map { app.currentQuery(for: $0) } ?? ""
    withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Motion.searchRise) {
      app.browse.presentSearch(from: .page, text: text, selectsAll: true)
    }
  }

  private func searchOverlay(_ request: BrowseSession.SearchRequest) -> some View {
    ZStack {
      Rectangle()
        .fill(.ultraThinMaterial)
        .overlay { Color.black.opacity(0.12) }
        .ignoresSafeArea()
        .onTapGesture {
          withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Motion.searchRise) { app.cancelSearch() }
        }
        .accessibilityLabel("Close Search")
        .accessibilityAddTraits(.isButton)
        .transition(.opacity)
      SearchSheet(style: .overlay, initialText: request.initialText, selectsAll: request.selectsAll, fieldNamespace: omnibox) {
        Color.clear
      }
      .transition(.asymmetric(insertion: .opacity.animation(Motion.resultsIn), removal: .opacity.animation(Motion.resultsOut)))
    }
    .zIndex(1)
  }

  private func handlePinch(_ event: PagePinch) {
    guard app.offersPinchToSummarize else {
      pinchSnapshot = nil
      if pinchScale != 1 { withAnimation(Motion.snappy) { pinchScale = 1 } }
      return
    }
    switch event {
    case .began:
      if let id = app.tabs.selectedTabID { pinchSnapshot = captureSnapshot(of: id) }
    case .changed(let scale):
      if pinchScale == 1, app.offersSummaries { app.intelligence.summaryWillOpen() }
      let visual = max(BrowseLayout.pinchFollowFloor - 0.07, 1 - (1 - scale) * 0.3)
      var transaction = Transaction()
      transaction.disablesAnimations = true
      withTransaction(transaction) { pinchScale = visual }
    case .ended(let scale, let velocity):
      if scale < BrowseLayout.pinchCommitScale || (velocity < -1.5 && scale < 0.93), let id = app.tabs.selectedTabID {
        if app.offersSummaries { foldTicks += 1 }
        beginSummary(for: id)
      } else {
        pinchSnapshot = nil
        withAnimation(Motion.snappy) { pinchScale = 1 }
      }
    case .cancelled:
      pinchSnapshot = nil
      withAnimation(Motion.snappy) { pinchScale = 1 }
    }
  }

  private func beginSummary(for id: UUID) {
    guard app.offersSummaries else {
      pinchSnapshot = nil
      withAnimation(Motion.snappy) { pinchScale = 1 }
      return
    }
    app.intelligence.summaryWillOpen()
    summarySnapshot = pinchSnapshot ?? captureSnapshot(of: id)
    pinchSnapshot = nil
    var transaction = Transaction()
    transaction.disablesAnimations = true
    withTransaction(transaction) {
      app.browse.summaryTabID = id
      pinchScale = 1
    }
  }

  private func captureSnapshot(of id: UUID) -> UIImage? {
    guard let webView = app.web.existingWebTab(id)?.webView else { return nil }
    return PageCoverCache.capture(webView, croppingTop: webView.safeAreaInsets.top)
  }

  @ViewBuilder
  private var pagerNeighbors: some View {
    if pager.offset != 0 {
      GeometryReader { proxy in
        let width = proxy.size.width + proxy.safeAreaInsets.leading + proxy.safeAreaInsets.trailing
        ZStack {
          if let left = pager.left {
            PagerSnapshot(tab: left)
              .offset(x: pager.offset - width - 12)
          }
          if let right = pager.right {
            PagerSnapshot(tab: right)
              .offset(x: pager.offset + width + 12)
          }
        }
      }
      .ignoresSafeArea()
      .allowsHitTesting(false)
    }
  }

  private var pagerGesture: some Gesture {
    DragGesture(minimumDistance: 14)
      .onChanged { value in
        guard abs(value.translation.width) > abs(value.translation.height) else { return }
        if !pager.isActive {
          let order = swipeOrder
          guard let index = order.firstIndex(where: { $0.id == app.tabs.selectedTabID }) else { return }
          pager.isActive = true
          pager.order = order
          rememberCurrentCover()
          pager.left = index > 0 ? order[index - 1] : nil
          pager.right = index + 1 < order.count ? order[index + 1] : nil
        }
        var translation = value.translation.width
        if translation > 0, pager.left == nil { translation = rubberBand(translation) }
        if translation < 0, pager.right == nil { translation = -rubberBand(-translation) }
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { pager.offset = translation }
      }
      .onEnded { value in
        guard pager.isActive else { return }
        let width = pageWidth
        let projected = value.predictedEndTranslation.width
        let target: BrowserTab?
        let direction: CGFloat
        if (value.translation.width > width / 3 || projected > width / 2), let left = pager.left {
          target = left
          direction = 1
        } else if (value.translation.width < -width / 3 || projected < -width / 2), let right = pager.right {
          target = right
          direction = -1
        } else {
          target = nil
          direction = 0
        }
        guard let target else {
          withAnimation(Motion.pager) { pager.offset = 0 } completion: { pager = PagerState() }
          return
        }
        tabSwitchTicks += 1
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : Motion.pager) {
          pager.offset = direction * (width + 12)
        } completion: {
          var transaction = Transaction()
          transaction.disablesAnimations = true
          withTransaction(transaction) {
            app.browse.freezeOrder(pager.order.map(\.id))
            app.openTab(target.id)
            pager = PagerState()
          }
        }
      }
  }

  private var swipeOrder: [BrowserTab] {
    let current = app.deckOrder
    guard let frozen = app.browse.frozenOrder else { return current }
    let byID = Dictionary(uniqueKeysWithValues: current.map { ($0.id, $0) })
    let kept = frozen.compactMap { byID[$0] }
    let added = current.filter { !frozen.contains($0.id) }
    return kept + added
  }

  private func switchTab(to id: UUID, order: [BrowserTab]) {
    rememberCurrentCover()
    app.browse.freezeOrder(order.map(\.id))
    app.openTab(id)
  }

  private func closeCurrentTab() {
    guard let id = app.tabs.selectedTabID else { return }
    app.closeTab(id)
  }

  private func stepTab(_ delta: Int) {
    let order = swipeOrder
    guard let index = order.firstIndex(where: { $0.id == app.tabs.selectedTabID }), order.indices.contains(index + delta) else { return }
    switchTab(to: order[index + delta].id, order: order)
  }

  private func rubberBand(_ distance: CGFloat) -> CGFloat {
    let limit: CGFloat = 60
    return limit * (1 - 1 / (distance / limit + 1))
  }
}

struct StoredCover {
  let id: UUID
  let image: UIImage
}

struct PagerState {
  var order: [BrowserTab] = []
  var isActive = false
  var offset: CGFloat = 0
  var left: BrowserTab?
  var right: BrowserTab?
}

struct ReaderTarget: Identifiable {
  let id: UUID
}

struct PagerSnapshot: View {
  let tab: BrowserTab

  @Environment(AppModel.self) private var app
  @State private var image: CGImage?

  var body: some View {
    ZStack(alignment: .top) {
      BrowsePalette.pageBackdrop
      if let memory = app.browse.covers.image(for: tab.id) ?? app.deck.memoryImage(for: tab.id) {
        Image(uiImage: memory).resizable().scaledToFill()
      } else if let image {
        Image(decorative: image, scale: 1).resizable().scaledToFill()
      } else {
        PageLoadingPlaceholder(tab: tab)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .clipped()
    .task(id: tab.snapshotFileName) {
      guard let name = tab.snapshotFileName else { return }
      image = await app.web.snapshots.image(named: name)
    }
  }
}
