import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct DeckGrid: View {
  let metrics: DeckGridMetrics
  let tabs: [BrowserTab]
  let topInset: CGFloat
  let bottomInset: CGFloat
  let onInteraction: () -> Void

  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var copyTicks = 0
  @State private var closeTicks = 0

  var body: some View {
    ScrollViewReader { reader in
      ScrollView(.vertical) {
        LazyVGrid(columns: columns, spacing: DeckGridMetrics.rowGap) {
          ForEach(tabs, id: \.id) { tab in
            DeckGridCell(tab: tab, size: metrics.cardSize, isSelected: tab.id == app.tabs.selectedTabID, open: { open(tab.id) }, close: { close(tab.id) }, copied: { copyTicks += 1 })
              .id(tab.id)
              .transition(reduceMotion ? .opacity : .scale(scale: 0.9).combined(with: .opacity))
          }
        }
        .padding(.horizontal, metrics.sideInset)
        .padding(.top, topInset)
        .padding(.bottom, bottomInset)
        .animation(reduceMotion ? nil : TabsMotion.gapClose, value: tabs.map(\.id))
      }
      .scrollIndicators(.hidden)
      .scrollDismissesKeyboard(.immediately)
      .mask {
        VStack(spacing: 0) {
          LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
            .frame(height: TabsLayout.deckScrollFade)
          Rectangle()
        }
      }
      .onAppear {
        if let id = app.tabs.selectedTabID, tabs.contains(where: { $0.id == id }) { reader.scrollTo(id, anchor: .center) }
      }
    }
    .sensoryFeedback(.success, trigger: copyTicks)
    .sensoryFeedback(.impact(weight: .light, intensity: 0.7), trigger: closeTicks)
  }

  private var columns: [GridItem] {
    Array(repeating: GridItem(.fixed(metrics.cardSize.width), spacing: DeckGridMetrics.gap), count: metrics.columns)
  }

  private func open(_ id: UUID) {
    onInteraction()
    app.prepareToOpen(id)
    Task { @MainActor in
      await app.primeCover(for: id)
      if reduceMotion {
        app.openTab(id)
      } else {
        withAnimation(TabsMotion.expand) { app.openTab(id) }
      }
    }
  }

  private func close(_ id: UUID) {
    onInteraction()
    closeTicks += 1
    withAnimation(reduceMotion ? TabsMotion.fade : TabsMotion.gapClose) { app.closeTab(id) }
  }
}

private struct DeckGridCell: View {
  let tab: BrowserTab
  let size: CGSize
  let isSelected: Bool
  let open: () -> Void
  let close: () -> Void
  let copied: () -> Void

  @Environment(AppModel.self) private var app

  var body: some View {
    VStack(alignment: .leading, spacing: TabsLayout.headerGap) {
      header
      DeckCard(tab: tab, memoryImage: app.deck.memoryImage(for: tab.id), snapshots: app.web.snapshots, fillsCard: true) {
        CardMenu(tab: tab, close: close, copied: copied)
      }
      .frame(width: size.width, height: size.height)
      .clipShape(.rect(cornerRadius: TabsLayout.cardRadius, style: .continuous))
      .contentShape(.rect(cornerRadius: TabsLayout.cardRadius, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: TabsLayout.cardRadius, style: .continuous)
          .strokeBorder(isSelected ? AnyShapeStyle(Tokens.Role.accent) : AnyShapeStyle(TabsPalette.cardEdge), lineWidth: isSelected ? 2 : 0.5)
      }
      .shadow(Tokens.Shadow.card)
      .onTapGesture(perform: open)
    }
    .frame(width: size.width)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(TabText.title(for: tab))
    .accessibilityValue(tab.isPrivate ? String(localized: "Incognito, \(TabText.host(for: tab))") : TabText.host(for: tab))
    .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    .accessibilityAction(.default, open)
    .accessibilityAction(named: "Close Tab", close)
  }

  private var header: some View {
    HStack(spacing: TabsLayout.headerSpacing) {
      DeckTabIcon(tab: tab)
      Text(tab.isPrivate ? String(localized: "Incognito") : TabText.title(for: tab))
        .font(Typography.caption.weight(Tokens.Weight.medium))
        .foregroundStyle(TabsPalette.headerText)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
      Button(action: close) {
        Image(systemName: "xmark")
          .font(Typography.badge.weight(Tokens.Weight.bold))
          .foregroundStyle(.secondary)
          .frame(width: TabsLayout.closeGlyph, height: TabsLayout.closeGlyph)
          .background(Tokens.Role.tabHover, in: .circle)
          .frame(width: GlassMetrics.hitTarget, height: TabsDeckGeometry.headerHeight)
          .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Close Tab")
    }
    .frame(height: TabsDeckGeometry.headerHeight)
  }
}
