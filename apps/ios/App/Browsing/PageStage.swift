import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UIKit

struct PageStage: View {
  var isFront = true
  var bottomInset: CGFloat = 0
  var topInset: CGFloat = 0
  var swipe: TabSwipe?
  var keepsSidesClear = false
  var drawsBackdrop = true

  @Environment(AppModel.self) private var app
  @Environment(\.profileLook) private var look
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var storedCover: StoredCover?

  var body: some View {
    @Bindable var browse = app.browse
    ZStack {
      if drawsBackdrop {
        backdrop.ignoresSafeArea()
      }
      if let tab = app.tabs.selectedTab {
        pageLayer(tab)
          .overlay(alignment: .top) { statusStrip }
          .opacity(isPaging ? 0 : 1)
          .ignoresSafeArea(.container, edges: keepsSidesClear ? .vertical : .all)
        if let swipe, swipe.pager.isActive {
          PagerStage(pager: swipe.pager, reduceMotion: reduceMotion)
        }
      }
    }
    .overlay(alignment: .top) {
      if let page = currentPage {
        LoadingLine(progress: MotionDemo.loadFreeze ?? page.progress, isLoading: MotionDemo.loadFreeze != nil || page.isLoading)
          .id(page.id)
          .ignoresSafeArea(edges: .horizontal)
      }
    }
    .modifier(PageRequestAlert(page: currentPage))
    .sheet(item: Binding(get: { app.web.shareRequest }, set: { app.web.shareRequest = $0 })) { url in
      ActivitySheet(url: url)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.hidden)
        .ignoresSafeArea()
    }
    .fullScreenCover(item: Binding(get: { browse.readerTabID.map(ReaderTarget.init) }, set: { browse.readerTabID = $0?.id })) { target in
      ReaderView(tabID: target.id)
    }
    .onChange(of: browse.stepRequest) { _, request in
      guard let request else { return }
      browse.stepRequest = nil
      app.stepTab(request.delta)
    }
    .onChange(of: app.tabs.selectedTabID, initial: true) { _, id in
      if let id { _ = app.web.webTab(for: id) }
      swipe?.warmNeighbors(app: app)
    }
    .task { await freezePagerForDemo() }
    .task { await runPagerScriptForDemo() }
    .onChange(of: findScope) { old, _ in
      endFindInPage(on: old.tabID)
    }
    .onDisappear {
      endFindInPage(on: app.tabs.selectedTabID)
    }
    .toolbarColorScheme(isFront ? statusScheme : nil, for: .statusBar)
    .accessibilityHidden(!isFront)
    .sensoryFeedback(.impact(weight: .light, intensity: 0.7), trigger: swipe?.switchTicks ?? 0)
  }

  private var isPaging: Bool { swipe?.pager.isActive ?? false }

  private var backdrop: Color {
    guard keepsSidesClear, let side = tone?.bottom ?? tone?.top else { return look.surface }
    return side.color
  }

  private var currentPage: WebTab? { app.currentPage }

  private var tone: PageTone? {
    guard let tab = app.tabs.selectedTab else { return nil }
    return app.browse.tone(for: tab, page: currentPage)
  }

  private var statusScheme: ColorScheme? {
    guard app.browse.search == nil else { return nil }
    return tone?.top?.scheme
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

  @ViewBuilder
  private var statusStrip: some View {
    if let top = tone?.top {
      Color.clear
        .frame(height: 0)
        .background(alignment: .top) {
          top.color
            .ignoresSafeArea(edges: .top)
            .animation(Motion.barTone, value: top)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
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
        bottomInset: bottomInset,
        topInset: topInset,
        onTone: { id, tone in browse.setTone(tone, for: id) }
      )
      if MotionDemo.loadFreeze != nil {
        PageLoadingPlaceholder(tab: tab, backdrop: look.surface, revealDelay: Motion.placeholderDelay)
      }
      if let failure = page?.failure, let page {
        PageFailureView(failure: failure) { page.reload() }
          .padding(.top, topInset)
          .padding(.bottom, bottomInset)
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

  private func freezePagerForDemo() async {
    guard let swipe, let fraction = MotionDemo.pagerFreeze else { return }
    try? await Task.sleep(for: .seconds(MotionDemo.delay))
    swipe.freeze(at: fraction, app: app)
  }

  private func runPagerScriptForDemo() async {
    guard let swipe, MotionDemo.pagerScript else { return }
    try? await Task.sleep(for: .seconds(MotionDemo.delay))
    let width = swipe.pageWidth
    let snap = { (velocity: CGFloat) in
      PagerPhysics.snapTarget(offset: swipe.pager.offset, velocity: velocity, width: width, hasLeft: swipe.pager.hasLeft, hasRight: swipe.pager.hasRight)
    }
    guard swipe.grab(app: app) else { return }
    await swipe.drag(to: 0.25, over: 0.3)
    swipe.settle(to: 0, velocity: 0, app: app, reduceMotion: reduceMotion)
    try? await Task.sleep(for: .seconds(1.2))
    guard swipe.grab(app: app) else { return }
    await swipe.drag(to: -0.3, over: 0.25)
    swipe.settle(to: snap(-1400), velocity: -1400, app: app, reduceMotion: reduceMotion)
    try? await Task.sleep(for: .seconds(1.5))
    guard swipe.grab(app: app) else { return }
    await swipe.drag(to: 0.3, over: 0.25)
    swipe.settle(to: 1, velocity: 1400, app: app, reduceMotion: reduceMotion)
    try? await Task.sleep(for: .milliseconds(120))
    guard swipe.grab(app: app) else { return }
    await swipe.drag(to: 0.1, over: 0.2)
    swipe.settle(to: 0, velocity: -300, app: app, reduceMotion: reduceMotion)
  }
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
