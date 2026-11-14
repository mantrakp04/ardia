import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UIKit

struct BrowsingView: View {
  var isFront = true

  @Environment(AppModel.self) private var app
  @Environment(\.profileLook) private var look
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var pager = PagerModel()
  @State private var barVisibility = BottomBarVisibility()
  @State private var tabSwitchTicks = 0
  @State private var pageSpan = PageSpan(width: 402, safeSide: 0)
  @State private var storedCover: StoredCover?

  var body: some View {
    @Bindable var browse = app.browse
    let tab = app.tabs.selectedTab
    ZStack(alignment: .bottom) {
      look.surface.ignoresSafeArea()
      if let tab {
        pageLayer(tab)
          .overlay(alignment: .top) { statusStrip(tab) }
          .opacity(pager.isActive ? 0 : 1)
          .ignoresSafeArea()
        if pager.isActive {
          PagerStage(pager: pager, reduceMotion: reduceMotion)
        }
      }
      bar
    }
    .overlay(alignment: .top) {
      if let page = currentWebPage {
        LoadingLine(progress: MotionDemo.loadFreeze ?? page.progress, isLoading: MotionDemo.loadFreeze != nil || page.isLoading)
          .id(page.id)
          .ignoresSafeArea(edges: .horizontal)
      }
    }
    .onGeometryChange(for: PageSpan.self) { proxy in
      let insets = proxy.safeAreaInsets
      return PageSpan(width: proxy.size.width + insets.leading + insets.trailing, safeSide: max(insets.leading, insets.trailing))
    } action: { pageSpan = $0 }
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
    .onChange(of: currentWebPage?.scrollDirection) { _, direction in
      guard app.settings.collapsesBottomBar else { return }
      barVisibility.scrollCollapsed = direction == .down
    }
    .onChange(of: isFindingInPage) { _, active in
      barVisibility.findSessionChanged(isActive: active)
    }
    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
      barVisibility.keyboardWillShow()
    }
    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in
      barVisibility.keyboardDidHide()
    }
    .onChange(of: app.tabs.selectedTabID, initial: true) { _, id in
      barVisibility.scrollCollapsed = false
      app.goBackToSearchIfEmpty()
      if let id { _ = app.web.webTab(for: id) }
      warmPagerNeighbors()
    }
    .task { await freezePagerForDemo() }
    .task { await runPagerScriptForDemo() }
    .onChange(of: isFront) { _, front in
      if front { barVisibility.scrollCollapsed = false }
    }
    .onChange(of: findScope) { old, _ in
      endFindInPage(on: old.tabID)
    }
    .onDisappear {
      endFindInPage(on: app.tabs.selectedTabID)
    }
    .toolbarColorScheme(isFront ? statusScheme : nil, for: .statusBar)
    .accessibilityHidden(!isFront)
    .sensoryFeedback(.impact(weight: .light, intensity: 0.7), trigger: tabSwitchTicks)
  }

  private var pageWidth: CGFloat { pageSpan.width }

  private var isFindingInPage: Bool {
    currentWebPage?.isFindingInPage ?? false
  }

  private var findScope: FindScope {
    FindScope(
      tabID: app.tabs.selectedTabID,
      pageIsFront: isFront && app.browse.readerTabID == nil && app.browse.search == nil && !app.browse.isVoicePresented
    )
  }

  private func endFindInPage(on id: UUID?) {
    guard let id else { return }
    app.web.existingWebTab(id)?.dismissFindInPage()
  }

  private var tone: PageTone? {
    guard let tab = app.tabs.selectedTab else { return nil }
    return app.browse.tone(for: tab, page: currentWebPage)
  }

  private var statusScheme: ColorScheme? {
    guard app.browse.search == nil else { return nil }
    return tone?.top?.scheme
  }

  @ViewBuilder
  private func statusStrip(_ tab: BrowserTab) -> some View {
    if let top = tone?.top {
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
    let page = app.web.existingWebTab(tab.id)
    let browse = app.browse
    ZStack {
      WebPageView(
        page: page,
        tab: tab,
        cover: cover(for: tab),
        swipeMode: app.preferences.swipeNavigation,
        bottomInset: BrowseLayout.barHeight,
        onTone: { id, tone in browse.setTone(tone, for: id) }
      )
      if MotionDemo.loadFreeze != nil {
        PageLoadingPlaceholder(tab: tab, backdrop: look.surface, revealDelay: Motion.placeholderDelay)
      }
      if let failure = page?.failure, let page {
        PageFailureView(failure: failure) { page.reload() }
          .transition(.opacity)
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
    if tabs.isPrivate(id) {
      tabs.update(id, snapshotFileName: snapshots.keepInMemory(cgImage, for: id))
      return
    }
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
      isSearchPresented: app.browse.search != nil,
      sideInset: pageSpan.safeSide,
      onTabs: openDeck,
      onPlus: openSearch,
      onMore: { app.browse.isToolbarPresented = true },
      onStep: stepTab,
      onSelectTab: { id in switchTab(to: id, order: swipeOrder) },
      onCloseTab: closeCurrentTab
    )
    .frame(height: BrowseLayout.barPillHeight)
    .padding(.top, BrowseLayout.barHeight - BrowseLayout.barCenterFromBottom - BrowseLayout.barPillHeight / 2)
    .frame(maxWidth: .infinity)
    .frame(height: BrowseLayout.barHeight, alignment: .top)
    .environment(\.colorScheme, barScheme)
    .highPriorityGesture(pagerGesture)
    .offset(y: isBarShown ? 0 : BrowseLayout.barCollapseTravel)
    .opacity(isBarShown ? 1 : 0)
    .allowsHitTesting(isBarShown)
    .animation(reduceMotion ? .easeOut(duration: 0.2) : Motion.barCollapse, value: isBarShown)
    .frame(maxHeight: .infinity, alignment: .bottom)
    .ignoresSafeArea(.container, edges: [.bottom, .horizontal])
    .ignoresSafeArea(.keyboard)
  }

  private var isBarShown: Bool {
    barVisibility.isShown(searchTrayPresented: app.browse.isSearchTrayOnScreen)
  }

  @Environment(\.colorScheme) private var systemScheme

  private var barScheme: ColorScheme {
    tone?.bottom?.scheme ?? systemScheme
  }

  private func openSearch() {
    app.newTab()
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
    withAnimation(animation, completionCriteria: .removed) {
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

nonisolated struct PageSpan: Equatable {
  let width: CGFloat
  let safeSide: CGFloat
}

struct StoredCover {
  let id: UUID
  let image: UIImage
}

struct FindScope: Equatable {
  let tabID: UUID?
  let pageIsFront: Bool
}

struct ReaderTarget: Identifiable {
  let id: UUID
}
