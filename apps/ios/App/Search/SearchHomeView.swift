import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SearchHomeView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Namespace private var logoSpace
  @State private var isResting = false
  @State private var focusesOnReturn = false

  var body: some View {
    GeometryReader { proxy in
      ZStack {
        backdrop
          .ignoresSafeArea()
        if isResting {
          restingLogo
            .transition(.identity)
          bar(in: proxy)
            .transition(.opacity.animation(.easeOut(duration: 0.18)))
        } else {
          SearchSheet(
            style: .home,
            initialText: app.browse.search?.initialText ?? "",
            selectsAll: false,
            focusesOnAppear: focusesOnReturn,
            onDismiss: rest
          ) {
            logo(size: BrowseLayout.logoSize * 0.8)
              .padding(.bottom, Spacing.large)
          }
          .transition(.move(edge: .bottom))
        }
      }
    }
    .ignoresSafeArea(.keyboard, edges: isResting ? .bottom : [])
    .preferredColorScheme(app.isIncognito ? .dark : nil)
    .onAppear {
      isResting = !app.settings.autoOpensKeyboard && app.browse.search == nil && !app.settings.isShowingOnboarding
    }
    .onChange(of: app.browse.search) { _, request in
      if request != nil, isResting { present() }
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
      .matchedGeometryEffect(id: "logo", in: logoSpace)
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
      newTab: present,
      newRegularTab: {
        app.isIncognito = false
        present()
      },
      newIncognitoTab: {
        app.isIncognito = true
        present()
      },
      reopen: { app.reopenLastClosed() },
      closeAll: {},
      leading: { app.sync.isEnabled ? app.openSyncedSpaces() : app.openArchive() },
      settings: { app.sheet = .settings }
    )
    .ignoresSafeArea()
  }

  private var transitionAnimation: Animation {
    reduceMotion ? .easeOut(duration: 0.2) : Motion.searchRise
  }

  private func present() {
    focusesOnReturn = true
    withAnimation(transitionAnimation) { isResting = false }
  }

  private func rest() {
    withAnimation(transitionAnimation) { isResting = true }
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
