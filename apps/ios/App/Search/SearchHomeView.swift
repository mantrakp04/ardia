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
    return TabDeckBar(
      geometry: geometry,
      isIncognito: app.isIncognito,
      showsSyncedTabs: app.sync.isEnabled,
      canReopen: app.tabs.canReopenClosed,
      hasTabs: false,
      newTab: { app.newTab() },
      newRegularTab: { app.newRegularTab() },
      newIncognitoTab: { app.newIncognitoTab() },
      reopen: { app.reopenLastClosed() },
      closeAll: {},
      leading: { app.sync.isEnabled ? app.openSyncedSpaces() : app.openArchive() },
      settings: { app.sheet = .settings }
    )
    .ignoresSafeArea()
  }

  @ViewBuilder
  private var backdrop: some View {
    if app.isIncognito {
      LaunchGradient(colors: BrowsePalette.incognitoGradient)
    } else {
      LaunchGradient(colors: themeColors)
    }
  }

  private var themeColors: [Color] {
    let fallback = colorScheme == .dark ? BrowsePalette.launchGradientDark : BrowsePalette.launchGradientLight
    guard app.sync.isEnabled, let theme = app.sync.selectedProfile?.theme else { return fallback }
    let source = colorScheme == .dark ? (theme.darkColors ?? theme.colors) : theme.colors
    let colors = source.compactMap(Color.init(hexString:))
    return colors.count >= 2 ? colors : fallback
  }
}

#Preview("Start") {
  SearchHomeView()
    .environment(AppModel(isDemo: true))
}
