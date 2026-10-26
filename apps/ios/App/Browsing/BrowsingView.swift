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
  @State private var pager = PagerModel()
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
          .opacity(pager.isActive ? 0 : 1)
          .ignoresSafeArea()
        if pager.isActive {
          PagerStage(pager: pager, reduceMotion: reduceMotion)
        }
      }
      if browse.summaryTabID == nil {
        bar
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
        LoadingLine(progress: MotionDemo.loadFreeze ?? page.progress, isLoading: MotionDemo.loadFreeze != nil || page.isLoading)
          .id(page.id)
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
      warmPagerNeighbors()
    }
    .task { await freezePagerForDemo() }
    .task { await runPagerScriptForDemo() }
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
      if MotionDemo.loadFreeze != nil, tab.origin != .browseForMe {
        PageLoadingPlaceholder(tab: tab, revealDelay: Motion.placeholderDelay)
      }
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
    app.newTab()
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

  private var pagerGesture: some Gesture {
    DragGesture(minimumDistance: 14)
      .onChanged { value in
        if !pager.isTracking {
          guard abs(value.translation.width) > abs(value.translation.height) else { return }
          if pager.isActive {
            pager.catchSettle()
          } else {
            guard pager.begin(order: swipeOrder, currentID: app.tabs.selectedTabID) else { return }
            rememberCurrentCover()
          }
          pager.isTracking = true
          pager.trackingBase = rawOffset(for: pager.offset)
          pager.activationTranslation = value.translation.width
        }
        let raw = pager.trackingBase + value.translation.width - pager.activationTranslation
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
          pager.offset = PagerPhysics.resolvedOffset(raw, hasLeft: pager.hasLeft, hasRight: pager.hasRight, width: pageWidth)
        }
      }
      .onEnded { value in
        guard pager.isTracking else { return }
        pager.isTracking = false
        let width = pageWidth
        let velocity = value.velocity.width
        let target = PagerPhysics.snapTarget(offset: pager.offset, velocity: velocity, width: width, hasLeft: pager.hasLeft, hasRight: pager.hasRight)
        settlePager(to: target, velocity: velocity, width: width)
      }
  }

  private func rawOffset(for offset: CGFloat) -> CGFloat {
    if offset > 0, !pager.hasLeft { return offset / max(1 - offset / PagerPhysics.rubberLimit, 0.05) }
    if offset < 0, !pager.hasRight { return offset / max(1 + offset / PagerPhysics.rubberLimit, 0.05) }
    return offset
  }

  private func settlePager(to target: Int, velocity: CGFloat, width: CGFloat) {
    let destination = CGFloat(target) * width
    let neighbor = target > 0 ? pager.left : target < 0 ? pager.right : nil
    let from = pager.offset
    let distance = destination - from
    pager.generation += 1
    let generation = pager.generation
    if neighbor != nil { tabSwitchTicks += 1 }
    let animation: Animation
    if reduceMotion {
      animation = Motion.pagerFade
      pager.settle = nil
    } else {
      let releaseVelocity = min(max(velocity, -4000), 4000)
      animation = .interpolatingSpring(Motion.pagerSettle, initialVelocity: abs(distance) > 0.5 ? Double(releaseVelocity / distance) : 0)
      pager.settle = PagerModel.Settle(from: from, to: destination, velocity: releaseVelocity, start: CACurrentMediaTime())
    }
    withAnimation(animation) {
      pager.offset = destination
    } completion: {
      guard pager.generation == generation, !pager.isTracking else { return }
      guard let neighbor else {
        pager.reset()
        return
      }
      var transaction = Transaction()
      transaction.disablesAnimations = true
      withTransaction(transaction) {
        app.browse.freezeOrder(pager.order.map(\.id))
        app.openTab(neighbor.id)
        pager.reset()
      }
    }
  }

  private func warmPagerNeighbors() {
    let order = swipeOrder
    guard let index = order.firstIndex(where: { $0.id == app.tabs.selectedTabID }) else { return }
    let neighbors = [index - 1, index + 1].filter(order.indices.contains).map { order[$0] }
    let keep = Set(neighbors.map(\.id))
    pager.images = pager.images.filter { keep.contains($0.key) }
    for tab in neighbors where pager.images[tab.id] == nil && app.browse.covers.image(for: tab.id) == nil && app.deck.memoryImage(for: tab.id) == nil {
      guard let name = tab.snapshotFileName else { continue }
      let id = tab.id
      Task {
        guard let image = await app.web.snapshots.image(named: name) else { return }
        pager.images[id] = UIImage(cgImage: image)
      }
    }
  }

  private func runPagerScriptForDemo() async {
    guard MotionDemo.pagerScript else { return }
    try? await Task.sleep(for: .seconds(MotionDemo.delay))
    func drag(to fraction: CGFloat, over seconds: Double) async {
      let start = pager.offset
      let steps = max(Int(seconds * 120), 1)
      for step in 1...steps {
        let t = CGFloat(step) / CGFloat(steps)
        let raw = rawOffset(for: start) + (fraction * pageWidth - rawOffset(for: start)) * t
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
          pager.offset = PagerPhysics.resolvedOffset(raw, hasLeft: pager.hasLeft, hasRight: pager.hasRight, width: pageWidth)
        }
        try? await Task.sleep(for: .milliseconds(8))
      }
    }
    func grab() -> Bool {
      if pager.isActive {
        pager.catchSettle()
        return true
      }
      rememberCurrentCover()
      return pager.begin(order: swipeOrder, currentID: app.tabs.selectedTabID)
    }
    guard grab() else { return }
    await drag(to: 0.25, over: 0.3)
    settlePager(to: 0, velocity: 0, width: pageWidth)
    try? await Task.sleep(for: .seconds(1.2))
    guard grab() else { return }
    await drag(to: -0.3, over: 0.25)
    settlePager(to: PagerPhysics.snapTarget(offset: pager.offset, velocity: -1400, width: pageWidth, hasLeft: pager.hasLeft, hasRight: pager.hasRight), velocity: -1400, width: pageWidth)
    try? await Task.sleep(for: .seconds(1.5))
    guard grab() else { return }
    await drag(to: 0.3, over: 0.25)
    settlePager(to: 1, velocity: 1400, width: pageWidth)
    try? await Task.sleep(for: .milliseconds(120))
    guard grab() else { return }
    await drag(to: 0.1, over: 0.2)
    settlePager(to: 0, velocity: -300, width: pageWidth)
  }

  private func freezePagerForDemo() async {
    guard let fraction = MotionDemo.pagerFreeze else { return }
    try? await Task.sleep(for: .seconds(MotionDemo.delay))
    rememberCurrentCover()
    guard pager.begin(order: swipeOrder, currentID: app.tabs.selectedTabID) else { return }
    pager.offset = PagerPhysics.resolvedOffset(-fraction * pageWidth, hasLeft: pager.hasLeft, hasRight: pager.hasRight, width: pageWidth)
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
}

struct StoredCover {
  let id: UUID
  let image: UIImage
}

struct ReaderTarget: Identifiable {
  let id: UUID
}
