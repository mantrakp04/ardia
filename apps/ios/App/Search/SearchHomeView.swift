import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SearchHomeView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.screenLayout) private var screenLayout

  var body: some View {
    let isTrayUp = app.browse.search != nil
    GeometryReader { proxy in
      let geometry = TabsDeckGeometry(
        container: CGSize(
          width: proxy.size.width + proxy.safeAreaInsets.leading + proxy.safeAreaInsets.trailing,
          height: proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom
        ),
        safeTop: proxy.safeAreaInsets.top,
        safeBottom: proxy.safeAreaInsets.bottom,
        safeSide: max(proxy.safeAreaInsets.leading, proxy.safeAreaInsets.trailing)
      )
      ZStack {
        backdrop
          .ignoresSafeArea()
        StartSpaces(geometry: spacesGeometry(geometry))
          .frame(width: geometry.container.width, alignment: screenLayout.column?.edge == .leading ? .trailing : .leading)
          .opacity(isTrayUp ? 0 : 1)
          .scaleEffect(isTrayUp && !reduceMotion ? 0.96 : 1)
          .allowsHitTesting(!isTrayUp)
          .ignoresSafeArea()
        bar(geometry)
          .opacity(isTrayUp ? 0 : 1)
          .allowsHitTesting(!isTrayUp)
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

  private func spacesGeometry(_ geometry: TabsDeckGeometry) -> TabsDeckGeometry {
    guard let column = screenLayout.column else { return geometry }
    return TabsDeckGeometry(
      container: CGSize(width: column.contentWidth(in: geometry.container.width), height: geometry.container.height),
      safeTop: geometry.safeTop,
      safeBottom: geometry.safeBottom
    )
  }

  private func openTrayIfWanted() {
    guard app.settings.autoOpensKeyboard, !app.settings.isShowingOnboarding, app.browse.search == nil, app.sheet == nil else { return }
    app.browse.presentSearch(from: .home, incognitoOnCancel: app.isIncognito)
  }

  private func bar(_ geometry: TabsDeckGeometry) -> some View {
    StartBar(
      geometry: geometry,
      plus: PlusActions(
        isIncognito: app.isIncognito,
        canReopen: app.tabs.canReopenClosed,
        newTab: { app.newTab() },
        newRegularTab: { app.newRegularTab() },
        newIncognitoTab: { app.newIncognitoTab() },
        reopen: { app.reopenLastClosed() }
      ),
      tabs: { app.showTabSwitcher() },
      settings: { app.sheet = .settings }
    )
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

struct StartSpaces: View {
  let geometry: TabsDeckGeometry
  @Environment(AppModel.self) private var app
  @Environment(\.screenLayout) private var screenLayout
  @State private var page: String?

  var body: some View {
    let spaces = app.spaces
    ZStack {
      if spaces.count > 1 {
        TabView(selection: $page) {
          ForEach(spaces) { space in
            StartSpacePage(geometry: geometry, space: space, spaces: spaces)
              .ignoresSafeArea()
              .tag(Optional(space.syncId))
          }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        SpacePageDots(count: spaces.count, index: spaces.firstIndex { $0.syncId == app.currentSpace?.syncId } ?? 0)
          .position(x: geometry.container.width / 2, y: screenLayout.column == nil ? geometry.barCenterY - TabsLayout.pageDotsAboveBar : geometry.barCenterY)
      } else if let space = spaces.first {
        StartSpacePage(geometry: geometry, space: space, spaces: spaces)
      } else if app.sync.phase == .off {
        SyncInvitation { app.sheet = .syncSetup }
          .position(x: geometry.container.width / 2, y: geometry.container.height * TabsLayout.startSwitcherRatio)
      }
    }
    .frame(width: geometry.container.width, height: geometry.container.height)
    .onAppear { page = app.currentSpace?.syncId }
    .onChange(of: app.currentSpace?.syncId) { _, id in
      if page != id { page = id }
    }
    .onChange(of: page) { _, id in
      if let id { app.switchSpace(to: id) }
    }
    .sensoryFeedback(.selection, trigger: app.currentSpace?.syncId)
  }
}

struct StartSpacePage: View {
  let geometry: TabsDeckGeometry
  let space: SyncedProfile
  let spaces: [SyncedProfile]
  @Environment(AppModel.self) private var app

  var body: some View {
    let switcherY = geometry.container.height * TabsLayout.startSwitcherRatio
    ZStack(alignment: .top) {
      Color.clear
      SpaceSwitcher(spaces: spaces, current: space) { app.switchSpace(to: $0) }
        .position(x: geometry.container.width / 2, y: switcherY)
      if !space.pinned.tiles.isEmpty {
        PinnedTiles(tiles: space.pinned.tiles) { url, title in app.openPinned(url: url, title: title) }
          .padding(.horizontal, geometry.safeSide + TabsLayout.tileSide)
          .frame(width: geometry.container.width)
          .offset(y: switcherY + TabsLayout.startTilesGap)
      }
    }
    .frame(width: geometry.container.width, height: geometry.container.height)
    .contentShape(.rect)
  }
}

private struct SyncInvitation: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Text("Sync With Your Mac")
        .font(.headline)
        .foregroundStyle(TabsPalette.headerText)
        .padding(.horizontal, 20)
        .frame(minHeight: TabsLayout.barCircle)
        .contentShape(.capsule)
        .chromeSurface(in: .capsule)
    }
    .buttonStyle(.plain)
    .accessibilityHint("Brings your Mac’s spaces, tabs and pinned sites.")
  }
}

#Preview("Start") {
  SearchHomeView()
    .environment(AppModel(isDemo: true))
}
