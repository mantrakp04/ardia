import ArdiaDesign
import SwiftUI

struct TabDeckBar: View {
  let geometry: TabsDeckGeometry
  let isIncognito: Bool
  let showsSyncedTabs: Bool
  let canReopen: Bool
  let hasTabs: Bool
  var opensTabs = false
  let newTab: () -> Void
  let newRegularTab: () -> Void
  let newIncognitoTab: () -> Void
  let reopen: () -> Void
  let closeAll: () -> Void
  let leading: () -> Void
  let settings: () -> Void

  var body: some View {
    GlassBar {
      HStack(spacing: 0) {
        circle(opensTabs ? "square.on.square" : showsSyncedTabs ? "square.grid.2x2" : "archivebox", label: opensTabs ? "Tabs" : showsSyncedTabs ? "Space" : "Archive", morphID: BarMorph.tabs, action: leading)
        Spacer(minLength: 0)
        Button(action: newTab) {
          Image(systemName: "plus")
            .font(Typography.title)
            .foregroundStyle(Tokens.Role.textPrimary)
            .frame(width: BarMetrics.pieceHeight * 1.6, height: BarMetrics.pieceHeight)
            .contentShape(.capsule)
        }
        .buttonStyle(.glassControl(.capsule, morphID: BarMorph.plus))
        .contextMenu {
          if isIncognito {
            Button("New Tab", systemImage: "plus", action: newRegularTab)
          } else {
            Button("New Incognito Tab", systemImage: "eyes", action: newIncognitoTab)
          }
          if canReopen {
            Button("Reopen Closed Tab", systemImage: "arrow.uturn.backward", action: reopen)
          }
        }
        .accessibilityLabel(isIncognito ? "New Incognito Tab" : "New Tab")
        Spacer(minLength: 0)
        circle("gearshape", label: "Settings", morphID: BarMorph.menu, action: settings)
      }
      .frame(width: TabsDeckGeometry.barWidth(container: geometry.container, safeSide: geometry.safeSide))
    }
    .position(x: geometry.container.width / 2, y: geometry.barCenterY)
  }

  private func circle(_ symbol: String, label: LocalizedStringKey, morphID: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(Typography.body.weight(Tokens.Weight.medium))
        .foregroundStyle(Tokens.Role.textPrimary)
        .frame(width: BarMetrics.pieceHeight, height: BarMetrics.pieceHeight)
        .contentShape(.circle)
    }
    .buttonStyle(.glassControl(.circle, morphID: morphID))
    .accessibilityLabel(label)
  }
}
