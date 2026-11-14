import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SearchHomeView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.profileLook) private var look

  var body: some View {
    let isTrayUp = app.browse.search != nil
    GeometryReader { proxy in
      ZStack {
        resting(in: proxy)
          .opacity(isTrayUp ? 0 : 1)
          .scaleEffect(isTrayUp && !reduceMotion ? StartMetrics.trayScale : 1)
          .allowsHitTesting(!isTrayUp)
        bar(in: proxy)
          .opacity(isTrayUp ? 0 : 1)
          .allowsHitTesting(!isTrayUp)
      }
      .lookInk()
      .environment(\.profileLook, app.isIncognito ? .incognito : look)
      .background {
        backdrop
          .ignoresSafeArea()
      }
    }
    .ignoresSafeArea(.keyboard)
    .animation(reduceMotion ? .easeOut(duration: 0.2) : Motion.searchRise, value: isTrayUp)
    .accessibilityHidden(isTrayUp)
    .preferredColorScheme(app.isIncognito ? .dark : nil)
    .task {
      await SearchSuggestionsModel.loadRecents(from: app.tabs)
      openTrayIfWanted()
    }
    .onChange(of: app.settings.isShowingOnboarding) { _, showing in
      if !showing { openTrayIfWanted() }
    }
  }

  private func openTrayIfWanted() {
    guard app.settings.autoOpensKeyboard, !app.settings.isShowingOnboarding, app.browse.search == nil, app.sheet == nil else { return }
    app.browse.presentSearch(from: .home, incognitoOnCancel: app.isIncognito)
  }

  @ViewBuilder
  private func resting(in proxy: GeometryProxy) -> some View {
    if showsSpace {
      spaceStart(in: proxy)
    } else {
      restingLogo
    }
  }

  private var showsSpace: Bool {
    !app.isIncognito && app.currentSpace != nil
  }

  private func spaceStart(in proxy: GeometryProxy) -> some View {
    let safe = proxy.safeAreaInsets
    let container = CGSize(width: proxy.size.width + safe.leading + safe.trailing, height: proxy.size.height + safe.top + safe.bottom)
    let layout = StartLayout(container: container, safeArea: safe)
    let stack = layout.isSideBySide
      ? AnyLayout(HStackLayout(alignment: .center, spacing: StartLayout.sectionGap))
      : AnyLayout(VStackLayout(alignment: .center, spacing: StartLayout.sectionGap))
    return ZStack(alignment: .bottom) {
      stack {
        SpaceHeader()
          .frame(maxWidth: layout.headerWidth)
        PinnedTileGrid(width: layout.gridWidth)
      }
      .frame(width: layout.contentWidth)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .padding(.bottom, TabsDeckGeometry.barReserve)
      SpaceDots()
        .padding(.bottom, StartMetrics.dotsLift(safeBottom: safe.bottom))
        .ignoresSafeArea(.container, edges: .bottom)
    }
  }

  private var restingLogo: some View {
    logo(size: BrowseLayout.logoSize)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .padding(.bottom, TabsDeckGeometry.barReserve * 0.5)
  }

  private func logo(size: CGFloat) -> some View {
    FidgetLogo()
      .frame(width: size, height: size * 0.82)
  }

  private func bar(in proxy: GeometryProxy) -> some View {
    let geometry = TabsDeckGeometry(
      container: CGSize(
        width: proxy.size.width + proxy.safeAreaInsets.leading + proxy.safeAreaInsets.trailing,
        height: proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom
      ),
      safeTop: proxy.safeAreaInsets.top,
      safeBottom: proxy.safeAreaInsets.bottom,
      safeSide: max(proxy.safeAreaInsets.leading, proxy.safeAreaInsets.trailing)
    )
    let opensTabs = !app.deckTabs.isEmpty
    return TabDeckBar(
      geometry: geometry,
      isIncognito: app.isIncognito,
      showsSyncedTabs: app.sync.isEnabled,
      canReopen: app.tabs.canReopenClosed,
      hasTabs: false,
      opensTabs: opensTabs,
      newTab: { app.newTab() },
      newRegularTab: { app.newRegularTab() },
      newIncognitoTab: { app.newIncognitoTab() },
      reopen: { app.reopenLastClosed() },
      closeAll: {},
      leading: {
        if opensTabs { app.showTabSwitcher() } else if app.sync.isEnabled { app.openSyncedSpaces() } else { app.openArchive() }
      },
      settings: { app.sheet = .settings }
    )
    .ignoresSafeArea()
  }

  @ViewBuilder
  private var backdrop: some View {
    if app.isIncognito {
      ProfileBackdrop(look: .incognito)
    } else {
      ProfileBackdrop(themed: true)
    }
  }
}

enum StartMetrics {
  static let trayScale: CGFloat = 0.92

  static func dotsLift(safeBottom: CGFloat) -> CGFloat {
    TabsDeckGeometry.barReserve + max(safeBottom, Tokens.Space.xxl) - Tokens.Space.m
  }
}

#Preview("Start") {
  SearchHomeView()
    .environment(AppModel(isDemo: true))
}
