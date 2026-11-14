import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct TabGridView: View {
  let tabs: [BrowserTab]
  let selectedID: UUID?
  let cardAspect: CGFloat
  var topInset: CGFloat = 0
  var bottomInset: CGFloat = 0
  var sideInset: CGFloat = TabsLayout.headerSide
  let memoryImage: (UUID) -> UIImage?
  let snapshots: TabSnapshotStore
  let open: (UUID) -> Void
  let close: (UUID) -> Void

  static let fade: CGFloat = 14

  var body: some View {
    ScrollViewReader { reader in
      ScrollView {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 260), spacing: 14, alignment: .top)], spacing: 18) {
          ForEach(tabs) { tab in
            TabGridCell(
              tab: tab,
              isSelected: tab.id == selectedID,
              aspect: cardAspect,
              memoryImage: memoryImage(tab.id),
              snapshots: snapshots,
              open: { open(tab.id) },
              close: { close(tab.id) }
            )
            .id(tab.id)
          }
        }
        .padding(.horizontal, sideInset)
        .padding(.top, Self.fade)
        .padding(.bottom, bottomInset)
      }
      .scrollIndicators(.hidden)
      .mask {
        VStack(spacing: 0) {
          LinearGradient(colors: [.black.opacity(0), .black], startPoint: .top, endPoint: .bottom)
            .frame(height: Self.fade)
          Rectangle()
        }
      }
      .padding(.top, topInset - Self.fade)
      .onAppear {
        if let id = selectedID ?? tabs.last?.id { reader.scrollTo(id, anchor: .center) }
      }
    }
  }
}

private struct TabGridCell: View {
  let tab: BrowserTab
  let isSelected: Bool
  let aspect: CGFloat
  let memoryImage: UIImage?
  let snapshots: TabSnapshotStore
  let open: () -> Void
  let close: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        DeckCardIcon(tab: tab, isIncognito: tab.isPrivate)
        Text(tab.isPrivate ? String(localized: "Incognito") : TabText.title(for: tab))
          .font(.footnote.weight(.medium))
          .foregroundStyle(TabsPalette.headerText)
          .lineLimit(1)
          .frame(maxWidth: .infinity, alignment: .leading)
        Button(action: close) {
          Image(systemName: "xmark")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.secondary)
            .frame(width: 24, height: 24)
            .chromeSurface(in: .circle)
            .frame(width: 36, height: 30)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close Tab")
      }
      Button(action: open) {
        DeckCard(tab: tab, memoryImage: memoryImage, snapshots: snapshots) {
          CardMenu(tab: tab, close: close)
        }
        .aspectRatio(aspect, contentMode: .fit)
        .clipShape(.rect(cornerRadius: TabsLayout.cardRadius, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: TabsLayout.cardRadius, style: .continuous)
            .strokeBorder(isSelected ? AnyShapeStyle(Palette.formAccent) : AnyShapeStyle(TabsPalette.cardEdge), lineWidth: isSelected ? 2.5 : 0.5)
        }
        .shadow(color: TabsPalette.cardShadow.opacity(0.6), radius: 10, y: 3)
      }
      .buttonStyle(PressableStyle())
      .accessibilityLabel(TabText.title(for: tab))
      .accessibilityValue(tab.isPrivate ? String(localized: "Incognito, \(TabText.host(for: tab))") : TabText.host(for: tab))
      .accessibilityAddTraits(isSelected ? .isSelected : [])
      .accessibilityAction(named: "Close Tab", close)
    }
  }
}
