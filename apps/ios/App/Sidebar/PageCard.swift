import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct PageCard: View {
  let placement: SidebarPlacement
  let edge: HorizontalEdge
  let radius: CGFloat

  @Environment(AppModel.self) private var app

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
    ZStack(alignment: .top) {
      shape.fill(Tokens.Role.card)
      if showsPage {
        PageStage(isFront: app.browse.search == nil, bottomInset: 0, topInset: SidebarChrome.Card.controlBand, swipe: nil, drawsBackdrop: false)
      } else {
        EmptyPageCard()
      }
      PageCardControls(placement: placement, edge: edge, showsPageControls: showsPage)
    }
    .clipShape(shape)
    .contentShape(shape)
  }

  private var showsPage: Bool {
    app.surface != .search && app.tabs.selectedTab != nil
  }
}

private struct EmptyPageCard: View {
  @Environment(AppModel.self) private var app
  @Environment(SidebarState.self) private var sidebar

  var body: some View {
    VStack(spacing: Tokens.Space.xxl) {
      FidgetLogo()
        .frame(width: BrowseLayout.logoSize, height: BrowseLayout.logoSize * SidebarChrome.Card.logoAspect)
      Button {
        app.newTab()
      } label: {
        Text(String(localized: "Search or Enter Address"))
          .font(Typography.field)
          .padding(.horizontal, Tokens.Space.xl)
      }
      .buttonStyle(.glassControl(.capsule))
      .foregroundStyle(Tokens.Role.textSecondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .task { openSearchIfWanted() }
  }

  private func openSearchIfWanted() {
    guard sidebar.shouldAutoOpenSearch, app.settings.autoOpensKeyboard, !app.settings.isShowingOnboarding, app.browse.search == nil, app.sheet == nil else { return }
    sidebar.noteAutoOpenedSearch()
    app.browse.presentSearch(from: .home, incognitoOnCancel: app.isIncognito)
  }
}
