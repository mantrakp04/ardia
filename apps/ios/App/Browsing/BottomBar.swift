import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct BottomBarActions {
  var openTabs: () -> Void
  var newTab: () -> Void
  var newRegularTab: () -> Void
  var newIncognitoTab: () -> Void
  var reopenClosed: () -> Void
  var openSearch: () -> Void
  var openMenu: () -> Void
  var expand: () -> Void
  var step: (Int) -> Void
  var selectTab: (UUID) -> Void
  var closeTab: () -> Void
}

struct BottomBar: View {
  let geometry: BottomBarGeometry
  let presence: BarPresence
  let actions: BottomBarActions

  @Environment(AppModel.self) private var app

  var body: some View {
    GlassBar {
      switch geometry.axis {
      case .horizontal:
        if presence == .compact {
          compact
        } else {
          row
        }
      case .vertical:
        rail
      }
    }
  }

  private var row: some View {
    HStack(spacing: BarMetrics.pieceGap) {
      tabsButton
      AddressCapsule(tab: app.tabs.selectedTab, page: app.currentPage, onSearch: actions.openSearch, onMenu: actions.openMenu)
      plusButton
    }
    .frame(width: geometry.barFrame.width, height: BarMetrics.pieceHeight)
  }

  private var compact: some View {
    let summary = AddressSummary(tab: app.tabs.selectedTab, page: app.currentPage)
    return Button(action: actions.expand) {
      AddressLabel(summary: summary, tab: app.tabs.selectedTab, isCompact: true)
        .padding(.horizontal, Tokens.Space.l)
        .frame(height: GlassMetrics.pillHeight)
        .contentShape(.capsule)
    }
    .buttonStyle(GlassBarPieceStyle(shape: BarMetrics.compactShape, morphID: BarMorph.address))
    .frame(width: geometry.compactFrame.width)
    .accessibilityLabel(Text("Address, \(summary.accessibilityText)"))
    .accessibilityHint("Shows the toolbar.")
  }

  private var rail: some View {
    let summary = AddressSummary(tab: app.tabs.selectedTab, page: app.currentPage)
    return VStack(spacing: BarMetrics.pieceGap) {
      tabsButton
      Button(action: actions.openSearch) {
        AddressGlyphView(glyph: summary.railGlyph, tab: app.tabs.selectedTab, size: BarMetrics.addressGlyph)
          .overlay(alignment: .topTrailing) {
            if let badge = summary.railBadge {
              AddressGlyphView(glyph: badge, tab: nil, size: BarMetrics.compactGlyph)
                .offset(x: BarMetrics.railBadgeOffset, y: -BarMetrics.railBadgeOffset)
            }
          }
          .frame(width: BarMetrics.pieceHeight, height: BarMetrics.pieceHeight)
          .contentShape(.circle)
      }
      .buttonStyle(GlassBarPieceStyle(shape: .circle, morphID: BarMorph.address))
      .contextMenu { AddressMenu() }
      .accessibilityLabel(Text("Address, \(summary.accessibilityText)"))
      Button(action: actions.openMenu) {
        Image(systemName: "ellipsis")
          .font(Typography.body.weight(Tokens.Weight.semibold))
          .foregroundStyle(Tokens.Role.textPrimary)
          .frame(width: BarMetrics.pieceHeight, height: BarMetrics.pieceHeight)
          .contentShape(.circle)
      }
      .buttonStyle(GlassBarPieceStyle(shape: .circle, morphID: BarMorph.menu))
      .accessibilityLabel("Page Menu")
      plusButton
    }
  }

  private var tabsButton: some View {
    let order = app.deckOrder
    return Button(action: actions.openTabs) {
      TabStackGlyph(tabs: TabStackGlyph.shown(order: order, selectedID: app.tabs.selectedTabID))
        .frame(width: BarMetrics.pieceHeight, height: BarMetrics.pieceHeight)
        .contentShape(.circle)
    }
    .buttonStyle(GlassBarPieceStyle(shape: .circle, morphID: BarMorph.tabs))
    .contextMenu { recentTabsMenu(order) }
    .accessibilityLabel("Tabs")
    .accessibilityValue(Text("^[\(order.count) tab](inflect: true)"))
    .accessibilityHint("Touch and hold for recent tabs.")
    .accessibilityActions {
      Button("Previous Tab") { actions.step(-1) }
      Button("Next Tab") { actions.step(1) }
    }
  }

  private var plusButton: some View {
    let isIncognito = app.tabs.selectedTab?.isPrivate ?? app.isIncognito
    return Button(action: actions.newTab) {
      Image(systemName: "plus")
        .font(Typography.title)
        .foregroundStyle(Tokens.Role.textPrimary)
        .frame(width: BarMetrics.pieceHeight, height: BarMetrics.pieceHeight)
        .contentShape(.circle)
    }
    .buttonStyle(GlassBarPieceStyle(shape: .circle, morphID: BarMorph.plus))
    .contextMenu {
      if isIncognito {
        Button("New Tab", systemImage: "plus", action: actions.newRegularTab)
      } else {
        Button("New Incognito Tab", systemImage: "eyes", action: actions.newIncognitoTab)
      }
      if app.tabs.canReopenClosed {
        Button("Reopen Closed Tab", systemImage: "arrow.uturn.backward", action: actions.reopenClosed)
      }
    }
    .accessibilityLabel("New Search")
    .accessibilityHint("Touch and hold to reopen a closed tab.")
  }

  @ViewBuilder
  private func recentTabsMenu(_ order: [BrowserTab]) -> some View {
    let recent = TabStackGlyph.recent(order: order, selectedID: app.tabs.selectedTabID)
    ForEach(recent) { tab in
      Button(TabText.title(for: tab)) { actions.selectTab(tab.id) }
    }
    if !recent.isEmpty { Divider() }
    Button("Close Tab", systemImage: "xmark", role: .destructive, action: actions.closeTab)
  }
}
