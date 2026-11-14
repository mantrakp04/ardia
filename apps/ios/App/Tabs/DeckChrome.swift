import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct DeckHeader: View {
  let geometry: TabsDeckGeometry
  let privateCount: Int
  let hasTabs: Bool
  let closeIncognito: () -> Void
  let closeAll: () -> Void
  @Environment(AppModel.self) private var app
  @Environment(\.screenLayout) private var screenLayout

  var body: some View {
    HStack(spacing: TabsLayout.barGap) {
      SpaceSwitcher(spaces: app.spaces, current: app.currentSpace) { app.switchSpace(to: $0) }
      Spacer(minLength: TabsLayout.barGap)
      if privateCount > 0 {
        IncognitoPill(count: privateCount, close: closeIncognito)
          .transition(.opacity.combined(with: .scale(scale: 0.9)))
      }
      if screenLayout.column == nil {
        DeckMoreMenu(hasTabs: hasTabs, closeAll: closeAll)
      }
    }
    .padding(.horizontal, geometry.safeSide + TabsLayout.headerSide)
    .frame(width: geometry.container.width)
    .position(x: geometry.container.width / 2, y: geometry.safeTop + TabsLayout.headerCenter)
    .animation(Motion.snappy, value: privateCount > 0)
  }
}

struct DeckMoreMenu: View {
  let hasTabs: Bool
  let closeAll: () -> Void
  @Environment(AppModel.self) private var app

  var body: some View {
    Menu {
      Section {
        Button("Archive") { app.openArchive() }
        if app.sync.isEnabled {
          Button("Spaces From Your Mac") { app.openSyncedSpaces() }
        }
      }
      Section {
        Button("New Incognito Tab") { app.newIncognitoTab() }
        if app.tabs.canReopenClosed {
          Button("Reopen Closed Tab") { app.reopenLastClosed() }
        }
        if hasTabs {
          Button("Close All Tabs", role: .destructive, action: closeAll)
        }
      }
      Button("Settings") { app.sheet = .settings }
    } label: {
      GlassCircleFace(symbol: "ellipsis", diameter: TabsLayout.headerCircle)
    }
    .menuOrder(.fixed)
    .buttonStyle(.plain)
    .accessibilityLabel("More")
  }
}

struct IncognitoPill: View {
  let count: Int
  let close: () -> Void

  var body: some View {
    Menu {
      Button("Close Incognito Tabs", role: .destructive, action: close)
    } label: {
      HStack(spacing: 8) {
        IncognitoGlyph(size: 16)
        Text(count, format: .number)
          .font(.subheadline.weight(.semibold).monospacedDigit())
      }
      .foregroundStyle(.white)
      .padding(.horizontal, 14)
      .frame(height: 38)
      .background(TabsPalette.incognitoCard, in: .capsule)
      .frame(minHeight: BrowseLayout.hitTarget)
      .contentShape(.capsule)
    }
    .buttonStyle(.plain)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Incognito, \(count) tabs")
    .accessibilityHint("Shows the option to close incognito tabs.")
  }
}

struct DeckEmptyState: View {
  let geometry: TabsDeckGeometry
  let isSearching: Bool
  let showsArchive: Bool
  let openArchive: () -> Void

  var body: some View {
    VStack(spacing: 6) {
      Text(isSearching ? "No Matching Tabs" : "No Open Tabs")
        .font(.title3.weight(.semibold))
        .foregroundStyle(TabsPalette.headerText)
      if !isSearching {
        Text("Tabs you open appear here. Inactive tabs move to the Archive.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
        if showsArchive {
          Button("Open Archive", action: openArchive)
            .font(.subheadline.weight(.semibold))
            .tint(Palette.formAccent)
            .padding(.top, 6)
            .frame(minHeight: 44)
        }
      }
    }
    .frame(maxWidth: 300)
    .padding(.horizontal, Spacing.large)
    .position(x: geometry.container.width / 2, y: geometry.cardCenterY)
  }
}

struct DeckCover: View {
  let image: Image

  var body: some View {
    image
      .resizable()
      .scaledToFit()
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .background(Color(.systemBackground))
      .ignoresSafeArea()
      .accessibilityHidden(true)
  }
}

struct DeckCard<Menu: View>: View {
  let tab: BrowserTab
  let memoryImage: UIImage?
  let snapshots: TabSnapshotStore
  @ViewBuilder let menu: () -> Menu

  var body: some View {
    TabCardContent(tab: tab, isIncognito: tab.isPrivate, memoryImage: memoryImage, snapshots: snapshots)
      .overlay(alignment: .topLeading) {
        if TabText.isUnseenReceived(tab) {
          ReceivedBadge().padding(10)
        }
      }
      .contextMenu { menu() }
  }
}

struct DeckCardHeader: View {
  let tab: BrowserTab
  let isIncognito: Bool

  @Environment(\.deckHeaderWidth) private var width

  var body: some View {
    let reveal = DeckHeaderMetrics.titleReveal(width: width)
    DeckHeaderLayout(titleReveal: reveal) {
      DeckCardIcon(tab: tab, isIncognito: isIncognito)
      Text(isIncognito ? String(localized: "Incognito") : TabText.title(for: tab))
        .font(.footnote.weight(.medium))
        .foregroundStyle(TabsPalette.headerText)
        .lineLimit(1)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .opacity(reveal)
    }
    .frame(maxWidth: .infinity)
    .mask {
      HStack(spacing: 0) {
        Rectangle()
        LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .leading, endPoint: .trailing)
          .frame(width: DeckHeaderMetrics.trailingFade)
      }
    }
  }
}

struct DeckCardIcon: View {
  let tab: BrowserTab
  let isIncognito: Bool

  var body: some View {
    if isIncognito {
      IncognitoGlyph(size: TabsLayout.faviconSize)
        .padding(2)
        .background(TabsPalette.incognitoCardRaised, in: .rect(cornerRadius: TabsLayout.faviconRadius))
    } else {
      FaviconImage(iconURL: tab.faviconURL, pageURL: tab.url, size: TabsLayout.faviconSize)
    }
  }
}

struct CardMenu: View {
  let tab: BrowserTab
  let close: () -> Void
  var copied: () -> Void = {}
  @Environment(AppModel.self) private var app

  var body: some View {
    if let url = app.shareURL(of: tab) {
      Button("Copy Link") {
        app.copyLink(of: tab)
        copied()
      }
      ShareLink(item: url, subject: Text(TabText.title(for: tab))) {
        Text("Share")
      }
      let devices = app.sendTargets(for: tab)
      if !devices.isEmpty {
        if devices.count == 1, let device = devices.first {
          Button("Send to \(device.name)", systemImage: DeviceSymbol.name(for: device)) { app.send(tab, to: device) }
        } else {
          Menu("Send to Device") {
            ForEach(devices) { device in
              Button(device.name, systemImage: DeviceSymbol.name(for: device)) { app.send(tab, to: device) }
            }
          }
        }
      }
      if !tab.isPrivate, app.sync.isEnabled {
        if app.isPinnedToMac(tab) {
          Button("Pinned to Mac") {}
            .disabled(true)
        } else {
          Button("Pin to Mac") { app.pinToMac(tab) }
        }
      }
      let others = tab.isPrivate ? [] : app.spaces.filter { $0.syncId != app.currentSpace?.syncId }
      if !others.isEmpty {
        Menu("Move to Space") {
          ForEach(others) { space in
            Button(space.name, systemImage: SpaceGlyph.menuSymbol(for: space)) { app.moveTab(tab.id, toSpace: space.syncId) }
          }
        }
      }
      Divider()
    }
    Button("Close Tab", role: .destructive, action: close)
  }
}

enum DeviceSymbol {
  static func name(for device: SyncedDevice) -> String {
    name(forDeviceNamed: device.name, kind: device.kind)
  }

  static func name(forDeviceNamed name: String, kind: SyncedDevice.Kind) -> String {
    switch kind {
    case .phone: "iphone"
    case .mac: name.localizedCaseInsensitiveContains("book") ? "laptopcomputer" : "desktopcomputer"
    }
  }
}
