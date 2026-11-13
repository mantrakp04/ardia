import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct DeckCard<Menu: View>: View {
  let tab: BrowserTab
  let memoryImage: UIImage?
  let snapshots: TabSnapshotStore
  var fillsCard = false
  @ViewBuilder let menu: () -> Menu

  var body: some View {
    TabCardContent(tab: tab, isIncognito: tab.isPrivate, memoryImage: memoryImage, snapshots: snapshots, fillsCard: fillsCard)
      .overlay(alignment: .topLeading) {
        if TabText.isUnseenReceived(tab) {
          ReceivedBadge().padding(Tokens.Space.ml)
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
      DeckTabIcon(tab: tab)
      Text(isIncognito ? String(localized: "Incognito") : TabText.title(for: tab))
        .font(Typography.caption.weight(Tokens.Weight.medium))
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

struct DeckTabIcon: View {
  let tab: BrowserTab

  var body: some View {
    if tab.isPrivate {
      IncognitoGlyph(size: TabsLayout.faviconSize)
        .padding(Tokens.Space.xxs)
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
      Button("Copy Link", systemImage: "link") {
        app.copyLink(of: tab)
        copied()
      }
      ShareLink(item: url, subject: Text(TabText.title(for: tab))) {
        Label("Share", systemImage: "square.and.arrow.up")
      }
      sendMenu
      if !tab.isPrivate, app.sync.isEnabled {
        if app.isPinnedToMac(tab) {
          Button("Pinned to Mac", systemImage: "star.fill") {}
            .disabled(true)
        } else {
          Button("Pin to Mac", systemImage: "star") { app.pinToMac(tab) }
        }
      }
    }
    moveMenu
    Divider()
    Button("Close Tab", systemImage: "xmark", role: .destructive, action: close)
  }

  @ViewBuilder private var sendMenu: some View {
    let devices = app.sendTargets(for: tab)
    if devices.count == 1, let device = devices.first {
      Button("Send to \(device.name)", systemImage: DeviceSymbol.name(for: device)) { app.send(tab, to: device) }
    } else if !devices.isEmpty {
      Menu("Send to Device", systemImage: "laptopcomputer.and.arrow.down") {
        ForEach(devices) { device in
          Button(device.name, systemImage: DeviceSymbol.name(for: device)) { app.send(tab, to: device) }
        }
      }
    }
  }

  @ViewBuilder private var moveMenu: some View {
    let targets = app.spacesToMove(tab)
    if !targets.isEmpty {
      Menu("Move to Space", systemImage: "rectangle.portrait.and.arrow.right") {
        ForEach(targets) { space in
          Button {
            app.moveTab(tab.id, toSpace: space.syncId)
          } label: {
            SpaceMenuLabel(space: space)
          }
        }
      }
    }
  }
}

struct SpaceMenuLabel: View {
  let space: SyncedProfile

  var body: some View {
    switch space.badge {
    case .symbol(let name) where UIImage(systemName: name) != nil:
      Label(space.name, systemImage: name)
    case .emoji(let emoji):
      Text(verbatim: "\(emoji) \(space.name)")
    default:
      Text(space.name)
    }
  }
}

enum DeviceSymbol {
  static func name(for device: SyncedDevice) -> String {
    name(forDeviceNamed: device.name, kind: device.kind)
  }

  static func name(forDeviceNamed name: String, kind: SyncedDevice.Kind) -> String {
    switch kind {
    case .phone: "iphone"
    case .tablet: "ipad"
    case .mac: name.localizedCaseInsensitiveContains("book") ? "laptopcomputer" : "desktopcomputer"
    }
  }
}

struct IncognitoChip: View {
  let count: Int
  let close: () -> Void

  var body: some View {
    Menu {
      Button("Close Incognito Tabs", systemImage: "xmark", role: .destructive, action: close)
    } label: {
      HStack(spacing: Tokens.Space.s) {
        IncognitoGlyph(size: Tokens.FontSize.large)
        Text(count, format: .number)
          .font(Typography.caption.weight(Tokens.Weight.semibold).monospacedDigit())
      }
      .foregroundStyle(.white)
      .padding(.horizontal, Tokens.Space.l)
      .frame(minHeight: Tokens.Space.huge)
      .background(TabsPalette.incognitoCard, in: .capsule)
      .frame(minHeight: GlassMetrics.hitTarget)
      .contentShape(.capsule)
    }
    .help("Incognito Tabs")
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Incognito, \(count) tabs")
    .accessibilityHint("Shows the option to close incognito tabs.")
  }
}

struct DeckEmptyState: View {
  let isFiltering: Bool
  let showsArchive: Bool
  let openArchive: () -> Void

  var body: some View {
    VStack(spacing: Tokens.Space.s) {
      Text(isFiltering ? "No Matching Tabs" : "No Open Tabs")
        .font(Typography.title)
        .foregroundStyle(TabsPalette.headerText)
      Text(isFiltering ? "Try another word or address." : "Tabs you open appear here. Inactive tabs move to the Archive.")
        .font(Typography.caption)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      if showsArchive, !isFiltering {
        Button("Open Archive", action: openArchive)
          .font(Typography.caption.weight(Tokens.Weight.semibold))
          .tint(Palette.formAccent)
          .padding(.top, Tokens.Space.s)
          .frame(minHeight: GlassMetrics.hitTarget)
      }
    }
    .frame(maxWidth: 300)
    .padding(.horizontal, Tokens.Space.xl)
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
