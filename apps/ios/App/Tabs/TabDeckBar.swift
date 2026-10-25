import ArdiaDesign
import SwiftUI

struct TabDeckBar: View {
  let geometry: TabsDeckGeometry
  let isIncognito: Bool
  let showsSyncedTabs: Bool
  let canReopen: Bool
  let hasTabs: Bool
  let newTab: () -> Void
  let newRegularTab: () -> Void
  let newIncognitoTab: () -> Void
  let reopen: () -> Void
  let closeAll: () -> Void
  let leading: () -> Void
  let settings: () -> Void

  var body: some View {
    HStack(spacing: 0) {
      DeckCircleButton(
        symbol: showsSyncedTabs ? "laptopcomputer" : "archivebox",
        label: showsSyncedTabs ? "Synced Tabs" : "Archive",
        action: leading
      )
      Spacer(minLength: 0)
      plusButton
      Spacer(minLength: 0)
      DeckCircleButton(symbol: "gearshape", label: "Settings", action: settings)
    }
    .padding(.horizontal, geometry.safeSide + TabsLayout.barSideInset - (BrowseLayout.hitTarget - TabsLayout.barCircle) / 2)
    .frame(width: geometry.container.width)
    .position(x: geometry.container.width / 2, y: geometry.barCenterY)
  }

  private var plusButton: some View {
    Button(action: newTab) {
      Image(systemName: "plus")
        .font(.system(size: 20, weight: .medium))
        .foregroundStyle(.primary)
        .frame(width: TabsLayout.barPlus.width, height: TabsLayout.barPlus.height)
        .contentShape(.capsule)
    }
    .buttonStyle(.plain)
    .glassEffect(.regular.interactive(), in: .capsule)
    .frame(minHeight: BrowseLayout.hitTarget)
    .contextMenu {
      if isIncognito {
        Button("New Tab", systemImage: "plus", action: newRegularTab)
        Button("New Incognito Tab", systemImage: "eyeglasses", action: newTab)
      } else {
        Button("New Incognito Tab", systemImage: "eyeglasses", action: newIncognitoTab)
        if canReopen {
          Button("Reopen Closed Tab", systemImage: "arrow.uturn.backward", action: reopen)
        }
      }
      if hasTabs {
        Divider()
        Button(isIncognito ? "Close Incognito Tabs" : "Close All Tabs", systemImage: "xmark", role: .destructive, action: closeAll)
      }
    }
    .accessibilityLabel(isIncognito ? "New Incognito Tab" : "New Tab")
    .accessibilityHint("Touch and hold for more options.")
  }
}

struct DeckCircleButton: View {
  let symbol: String
  let label: LocalizedStringKey
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(.secondary)
        .frame(width: TabsLayout.barCircle, height: TabsLayout.barCircle)
        .glassEffect(.regular.interactive(), in: .circle)
        .frame(width: BrowseLayout.hitTarget, height: BrowseLayout.hitTarget)
        .contentShape(.circle)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}
