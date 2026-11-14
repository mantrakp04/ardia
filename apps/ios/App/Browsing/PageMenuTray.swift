import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct PageMenuTray: View {
  let tabID: UUID
  let link: TrayContentLink
  let onEditQuery: () -> Void
  let close: () -> Void

  @Environment(AppModel.self) private var app
  @Environment(\.colorScheme) private var colorScheme
  @ScaledMetric(relativeTo: .title3) private var fieldHeight = BrowseLayout.searchFieldHeight
  @State private var fieldFrame = CGRect.zero
  @State private var headerHeight: CGFloat = 0

  private static let space = "pageMenuTray"

  static var chevronReserve: CGFloat {
    BrowseLayout.barSideInset - 4 + BrowseLayout.hitTarget / 2 + BrowseLayout.chevronCircle / 2 + Spacing.tight
  }

  private var tab: BrowserTab? { app.tabs.tab(tabID) }

  var body: some View {
    VStack(spacing: 0) {
      header
        .contentShape(.rect)
        .highPriorityGesture(link.dismissDrag)
      PageMenuContent(tabID: tabID, progress: link.progress, close: close)
        .contentShape(.rect)
        .simultaneousGesture(link.dismissDrag)
    }
    .frame(maxWidth: .infinity, alignment: .top)
    .coordinateSpace(.named(Self.space))
    .environment(\.colorScheme, tab?.isPrivate == true ? .dark : colorScheme)
  }

  private var header: some View {
    addressField
      .padding(.leading, BrowseLayout.searchFieldInset)
      .padding(.trailing, Self.chevronReserve)
      .padding(.top, BrowseLayout.trayFieldTop)
      .padding(.bottom, Spacing.tight)
      .frame(maxWidth: .infinity)
      .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
        headerHeight = height
        link.report(field: fieldFrame, contentTop: headerHeight)
      }
  }

  private var addressField: some View {
    Button(action: onEditQuery) {
      ZStack(alignment: .leading) {
        if let feedback = app.browse.titleFeedback {
          Text(feedback)
            .fontWeight(.semibold)
            .foregroundStyle(Color.ardiaAccentText)
            .transition(.opacity)
        } else {
          Text(titleText)
            .foregroundStyle(BrowsePalette.foregroundPrimary)
            .transition(.opacity)
        }
      }
      .font(.body)
      .lineLimit(1)
      .padding(.leading, BrowseLayout.plusGlyphInsetInField + Spacing.medium)
      .padding(.trailing, Spacing.page)
      .frame(maxWidth: .infinity, alignment: .leading)
      .frame(height: fieldHeight)
      .animation(.easeOut(duration: 0.15), value: app.browse.titleFeedback)
      .overlay(alignment: .leading) {
        Image(systemName: "magnifyingglass")
          .font(.body.weight(.medium))
          .foregroundStyle(BrowsePalette.foregroundSecondary)
          .frame(width: BrowseLayout.plusGlyphInsetInField * 2)
      }
      .contentShape(.capsule)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(app.browse.titleFeedback ?? titleText)
    .accessibilityHint("Edits the search")
    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(Self.space)) } action: { frame in
      fieldFrame = frame
      link.report(field: fieldFrame, contentTop: headerHeight)
    }
  }

  private var titleText: String {
    guard let tab else { return "" }
    let query = app.currentQuery(for: tab)
    if query != tab.url { return query }
    return tab.title.isEmpty ? (BrowserURL.host(of: tab.url) ?? tab.url) : tab.title
  }
}
