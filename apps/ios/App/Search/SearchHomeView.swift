import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SearchHomeView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let isTrayUp = app.browse.search != nil
    GeometryReader { proxy in
      ZStack {
        backdrop
          .ignoresSafeArea()
        restingLogo
          .opacity(isTrayUp ? 0 : 1)
          .scaleEffect(isTrayUp && !reduceMotion ? 0.92 : 1)
        bar(in: proxy)
          .opacity(isTrayUp ? 0 : 1)
          .allowsHitTesting(!isTrayUp)
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

#Preview("Start") {
  SearchHomeView()
    .environment(AppModel(isDemo: true))
}
