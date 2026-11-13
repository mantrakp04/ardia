import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct BrowsingBar: View {
  let geometry: BottomBarGeometry
  let safeArea: EdgeInsets
  let presence: BarPresence
  let swipe: TabSwipe
  let actions: BottomBarActions

  @Environment(AppModel.self) private var app
  @Environment(\.profileLook) private var spaceLook
  @Environment(\.colorScheme) private var systemScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let frame = geometry.barFrame
    let isHidden = presence == .hidden
    BottomBar(geometry: geometry, presence: presence, actions: actions)
      .frame(width: frame.width, height: frame.height, alignment: .bottom)
      .tabSwipeGesture(swipe, isEnabled: geometry.axis == .horizontal && presence == .full)
      .environment(\.profileLook, barLook)
      .environment(\.colorScheme, barScheme)
      .environment(\.glassPlacement, .overContent)
      .position(x: frame.midX - safeArea.leading, y: frame.midY - safeArea.top)
      .offset(hiddenOffset(isHidden))
      .opacity(isHidden ? 0 : 1)
      .allowsHitTesting(presence.isInteractive)
      .animation(reduceMotion ? Motion.surfaceFade : Motion.barCollapse, value: isHidden)
  }

  private var tone: PageTone? {
    guard let tab = app.tabs.selectedTab else { return nil }
    return app.browse.tone(for: tab, page: app.currentPage)
  }

  private var isPrivate: Bool { app.tabs.selectedTab?.isPrivate ?? false }

  private var barLook: ProfileLook {
    if isPrivate { return .incognito }
    guard let bottom = tone?.bottom else { return spaceLook }
    return ProfileLook(colorName: bottom.hexString)
  }

  private var barScheme: ColorScheme {
    BarInk.scheme(pageIsDark: tone?.bottom?.isDark, systemIsDark: systemScheme == .dark)
  }

  private func hiddenOffset(_ isHidden: Bool) -> CGSize {
    guard isHidden else { return .zero }
    switch geometry.axis {
    case .horizontal: return CGSize(width: 0, height: BrowseLayout.barCollapseTravel)
    case .vertical(.leading): return CGSize(width: -BrowseLayout.barCollapseTravel, height: 0)
    case .vertical: return CGSize(width: BrowseLayout.barCollapseTravel, height: 0)
    }
  }
}
