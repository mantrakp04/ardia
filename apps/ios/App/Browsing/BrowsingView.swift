import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UIKit

struct BrowsingView: View {
  var isFront = true

  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var swipe = TabSwipe()
  @State private var collapse = BarCollapse(isCompact: BarDemo.startsCompact)
  @State private var visibility = BottomBarVisibility()
  @State private var systemVerticalEdge: HorizontalEdge?
  @State private var isLandscape = false

  var body: some View {
    @Bindable var browse = app.browse
    GeometryReader { proxy in
      let geometry = barGeometry(in: proxy)
      ZStack(alignment: .topLeading) {
        PageStage(
          isFront: isFront,
          bottomInset: geometry.pageBottomInset,
          swipe: swipe,
          keepsSidesClear: geometry.isLandscape && geometry.axis == .horizontal
        )
          .padding(.leading, max(0, geometry.pageLeadingInset - proxy.safeAreaInsets.leading))
          .padding(.trailing, max(0, geometry.pageTrailingInset - proxy.safeAreaInsets.trailing))
        BrowsingBar(
          geometry: geometry,
          safeArea: proxy.safeAreaInsets,
          presence: presence,
          swipe: swipe,
          actions: barActions
        )
      }
      .onChange(of: geometry.isLandscape, initial: true) { _, landscape in isLandscape = landscape }
      .onChange(of: geometry.pagerWidth, initial: true) { _, width in swipe.pageWidth = width }
    }
    .ignoresSafeArea(.keyboard)
    .onVerticalBarEdgeChange { systemVerticalEdge = $0 }
    .sheet(isPresented: $browse.isToolbarPresented, onDismiss: { app.browse.runMenuFollowUp() }) {
      if let id = app.tabs.selectedTabID {
        PageMenuSheet(tabID: id)
      }
    }
    .onChange(of: browse.deckRequested) { _, requested in
      guard requested else { return }
      browse.deckRequested = false
      app.openDeckFromPage()
    }
    .onChange(of: app.currentPage?.scrollDirection) { _, direction in
      apply(direction == .down ? .scrolledDown : .scrolledUp)
    }
    .onChange(of: app.currentPage?.isScrolledToTop) { _, atTop in
      if atTop == true { apply(.reachedTop) }
    }
    .onChange(of: app.currentPage?.isFindingInPage ?? false) { _, active in
      visibility.findSessionChanged(isActive: active)
    }
    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
      visibility.keyboardWillShow()
    }
    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in
      visibility.keyboardDidHide()
    }
    .onChange(of: app.tabs.selectedTabID, initial: true) { _, _ in
      apply(.pageChanged)
      app.goBackToSearchIfEmpty()
    }
    .onChange(of: isFront) { _, front in
      if front { apply(.pageChanged) }
    }
    .task { await presentFindForDemo() }
  }

  private var verticalEdge: HorizontalEdge? { BarDemo.verticalEdge ?? systemVerticalEdge }

  private var axis: BottomBarGeometry.Axis {
    verticalEdge.map { .vertical($0) } ?? .horizontal
  }

  private var presence: BarPresence {
    BarPresence.resolve(collapse: collapse, isShown: visibility.isShown(searchTrayPresented: app.browse.isSearchTrayOnScreen))
  }

  private func barGeometry(in proxy: GeometryProxy) -> BottomBarGeometry {
    let safe = proxy.safeAreaInsets
    let container = CGSize(width: proxy.size.width + safe.leading + safe.trailing, height: proxy.size.height + safe.top + safe.bottom)
    let occlusions = proxy.reservedAreas(.occlusion).map { $0.frame.offsetBy(dx: safe.leading, dy: safe.top) }
    return BottomBarGeometry(container: container, safeArea: safe, corners: corners, occlusions: occlusions, verticalEdge: verticalEdge)
  }

  @Environment(\.windowCornerRadii) private var corners

  private func apply(_ event: BarCollapse.Event) {
    guard !BarDemo.startsCompact else { return }
    let allows = BarCollapse.allowsCompact(settingIsOn: app.settings.collapsesBottomBar, isLandscape: isLandscape, axis: axis)
    let next = collapse.applying(event, allowsCompact: allows)
    guard next != collapse else { return }
    withAnimation(reduceMotion ? Motion.surfaceFade : Motion.barCollapse) { collapse = next }
  }

  private var barActions: BottomBarActions {
    BottomBarActions(
      openTabs: app.openDeckFromPage,
      newTab: app.newTab,
      newRegularTab: app.newRegularTab,
      newIncognitoTab: app.newIncognitoTab,
      reopenClosed: app.reopenLastClosed,
      openSearch: editAddress,
      openMenu: { app.browse.isToolbarPresented = true },
      expand: { apply(.tapped) },
      step: app.stepTab,
      selectTab: { id in app.switchTab(to: id, order: app.swipeOrder) },
      closeTab: app.closeCurrentTab
    )
  }

  private func editAddress() {
    guard let tab = app.tabs.selectedTab else {
      app.browse.presentSearch(from: .page)
      return
    }
    app.browse.presentSearch(from: .page, text: app.currentQuery(for: tab), selectsAll: true)
  }

  private func presentFindForDemo() async {
    guard BarDemo.showsFind else { return }
    try? await Task.sleep(for: .seconds(MotionDemo.delay + 2))
    app.currentPage?.presentFindInPage()
  }
}
