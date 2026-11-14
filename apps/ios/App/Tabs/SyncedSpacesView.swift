import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SyncedSpacesView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let profiles = app.spaces
    VStack(spacing: 0) {
      header
      SyncStatusBanner(phase: app.sync.phase, status: app.sync.statusText) { app.sheet = .settings }
      if profiles.isEmpty {
        SpacesUnavailable(isOff: app.sync.phase == .off) {
          app.sheet = app.sync.phase == .off ? .syncSetup : .settings
        }
        .frame(maxHeight: .infinity)
      } else {
        TabView(selection: selection) {
          ForEach(profiles) { profile in
            SpacePage(profile: profile)
              .tag(Optional(profile.syncId))
          }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .safeAreaInset(edge: .bottom, spacing: 0) {
          if profiles.count > 1 {
            SpaceDots(drawsBand: false)
              .padding(.horizontal, Tokens.Space.m)
              .glassControl(.capsule)
              .padding(.top, Tokens.Space.m)
              .frame(maxWidth: .infinity)
          }
        }
      }
    }
    .presentationBackground {
      ProfileBackdrop(look: ProfileLook(profile: app.currentSpace))
        .animation(reduceMotion ? nil : .easeOut(duration: Tokens.Duration.slow), value: app.currentSpace?.syncId)
        .ignoresSafeArea()
    }
    .presentationCornerRadius(MenuLayout.sheetRadius)
    .presentationDragIndicator(.hidden)
  }

  private var selection: Binding<String?> {
    Binding(
      get: { app.currentSpace?.syncId },
      set: { new in
        guard let new, new != app.currentSpace?.syncId else { return }
        app.selectSpace(new)
      }
    )
  }

  private var header: some View {
    HStack(alignment: .center, spacing: Tokens.Space.m) {
      SpaceHeader()
        .frame(maxWidth: .infinity, alignment: .leading)
      GlassBar {
        HStack(spacing: Tokens.Space.m) {
          headerButton("archivebox", label: "Archive") { app.openArchive() }
          headerButton("xmark", label: "Close") { dismiss() }
        }
      }
      .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
    .padding(.leading, Tokens.Space.xxl)
    .padding(.trailing, Tokens.Space.xl)
    .padding(.top, Tokens.Space.l)
    .padding(.bottom, Tokens.Space.s)
  }

  private func headerButton(_ symbol: String, label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(Typography.body.weight(Tokens.Weight.semibold))
        .foregroundStyle(Tokens.Role.textSecondary)
        .frame(width: GlassMetrics.hitTarget, height: GlassMetrics.hitTarget)
        .contentShape(.circle)
    }
    .buttonStyle(.glassControl(.circle))
    .accessibilityLabel(label)
  }
}

private struct SpacePage: View {
  let profile: SyncedProfile
  @Environment(AppModel.self) private var app
  @State private var expandedDevices: Set<String> = []
  @State private var width: CGFloat = 0

  private static let collapsedLimit = 8

  var body: some View {
    list
      .onGeometryChange(for: CGFloat.self, of: \.size.width) { width = $0 }
  }

  private var list: some View {
    List {
      if !profile.pinned.tiles.isEmpty {
        PinnedTileGrid(width: max(width - Spacing.medium * 2, SidebarMetrics.Tile.minWidth), space: profile)
          .spaceRow(insets: EdgeInsets(top: Spacing.tight, leading: Spacing.medium, bottom: Spacing.small, trailing: Spacing.medium))
      }
      ForEach(profile.pinned.sections) { section in
        PinnedSectionRow(section: section, open: open)
          .spaceRow()
      }
      ForEach(devicesWithTabs) { device in
        Section {
          let expanded = expandedDevices.contains(device.id) || device.tabs.count <= Self.collapsedLimit + 1
          ForEach(expanded ? device.tabs : Array(device.tabs.prefix(Self.collapsedLimit))) { tab in
            RemoteRow(title: tab.title, url: tab.url) { open(tab.url, tab.title) }
              .spaceRow()
          }
          if !expanded {
            Button {
              withAnimation(Motion.snappy) { _ = expandedDevices.insert(device.id) }
            } label: {
              Text("Show All")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .spaceRow()
          }
        } header: {
          Label {
            Text(device.deviceName)
          } icon: {
            Image(systemName: DeviceSymbol.name(forDeviceNamed: device.deviceName, kind: device.kind))
          }
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.secondary)
          .textCase(nil)
          .padding(.top, Spacing.small)
        }
      }
      if profile.pinned.isEmpty && devicesWithTabs.isEmpty {
        ContentUnavailableView {
          Label("Nothing Here Yet", systemImage: "square.stack")
        } description: {
          Text("Pinned and open tabs from \(profile.name) show up here.")
        }
        .spaceRow()
        .padding(.top, Spacing.section)
      }
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .environment(\.defaultMinListRowHeight, 48)
    .refreshable { await app.sync.syncNow() }
  }

  private var devicesWithTabs: [DeviceTabs] {
    profile.deviceTabs.filter { !$0.tabs.isEmpty }
  }

  private func open(_ url: String, _ title: String) {
    app.openRemote(url: url, title: title, profileSyncId: profile.syncId)
  }
}

private extension View {
  func spaceRow(insets: EdgeInsets = EdgeInsets(top: 0, leading: Spacing.medium, bottom: 0, trailing: Spacing.medium)) -> some View {
    listRowBackground(Color.clear)
      .listRowSeparator(.hidden)
      .listRowInsets(insets)
  }
}

private struct PinnedSectionRow: View {
  let section: PinnedSection
  let open: (String, String) -> Void

  var body: some View {
    switch section {
    case .tab(let tab):
      RemoteRow(title: tab.title, url: tab.url, mark: tab.mark) { open(tab.url, tab.title) }
    case .group(let group):
      DisclosureGroup {
        ForEach(group.items) { item in
          PinnedSectionRow(section: item, open: open)
        }
      } label: {
        HStack(spacing: Spacing.small) {
          GroupMark(mark: group.mark)
            .foregroundStyle(SpaceColors.color(named: group.color) ?? .secondary)
            .frame(minWidth: SidebarMetrics.Row.icon)
          Text(group.name)
            .font(.body.weight(.medium))
            .lineLimit(2)
        }
        .frame(minHeight: 48)
      }
      .tint(.secondary)
    }
  }
}

private struct GroupMark: View {
  let mark: SyncedIcon?

  var body: some View {
    switch mark {
    case .symbol(let name) where UIImage(systemName: name) != nil:
      Image(systemName: name).font(.body)
    case .emoji(let text):
      Text(text).font(.body)
    default:
      Image(systemName: "folder.fill").font(.body)
    }
  }
}

private struct RemoteRow: View {
  let title: String
  let url: String
  var mark: SyncedIcon?
  let open: () -> Void
  @Environment(\.dynamicTypeSize) private var typeSize
  @ScaledMetric(relativeTo: .body) private var iconSide: CGFloat = 24

  var body: some View {
    Button(action: open) {
      HStack(spacing: Spacing.small) {
        PinnedMark(mark: mark, url: url, size: min(iconSide, 40) - 2)
          .frame(width: iconSide, height: iconSide)
        Text(title.isEmpty ? (BrowserURL.host(of: url) ?? url) : title)
          .font(.body.weight(.medium))
          .foregroundStyle(.primary)
          .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .frame(minHeight: 48)
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .contextMenu {
      Button("Open", systemImage: "arrow.up.forward.square", action: open)
      if let link = URL(string: url) {
        Button("Copy Link", systemImage: "link") { UIPasteboard.general.url = link }
        ShareLink(item: link) { Label("Share", systemImage: "square.and.arrow.up") }
      }
    }
  }
}

private struct SyncStatusBanner: View {
  let phase: SyncPhase
  let status: String
  let openSettings: () -> Void

  var body: some View {
    if let symbol {
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        Image(systemName: symbol)
          .foregroundStyle(.orange)
        Text(status)
          .font(.subheadline)
          .fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 8)
        if needsAction {
          Button("Fix", action: openSettings)
            .font(.subheadline.weight(.semibold))
            .buttonStyle(.bordered)
        }
      }
      .padding(12)
      .background(.primary.opacity(0.08), in: .rect(cornerRadius: 14, style: .continuous))
      .padding(.horizontal, Spacing.page)
      .padding(.bottom, Spacing.tight)
    }
  }

  private var needsAction: Bool {
    switch phase {
    case .needsFolderAccess, .locked, .reset: true
    default: false
    }
  }

  private var symbol: String? {
    switch phase {
    case .needsFolderAccess: "folder.badge.questionmark"
    case .locked: "lock.fill"
    case .reset: "exclamationmark.arrow.triangle.2.circlepath"
    case .stalled: "exclamationmark.icloud"
    case .offline: "wifi.slash"
    default: nil
    }
  }
}

private struct SpacesUnavailable: View {
  let isOff: Bool
  let action: () -> Void

  var body: some View {
    ContentUnavailableView {
      Label("Your Mac’s Spaces", systemImage: ThisDevice.current.pairSymbol)
    } description: {
      Text(isOff ? "Every tab, anywhere." : "Waiting for your Mac.")
    } actions: {
      Button(isOff ? "Sync With Mac" : "Sync Settings", action: action)
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .primaryActionColors()
    }
  }
}

enum SpaceColors {
  static func color(named name: String?) -> Color? {
    guard let name = name?.lowercased(), !name.isEmpty else { return nil }
    if name.hasPrefix("#") { return Color(hexString: name) }
    switch name {
    case "red": return .red
    case "orange": return .orange
    case "yellow": return .yellow
    case "green": return .green
    case "mint": return .mint
    case "teal": return .teal
    case "cyan": return .cyan
    case "blue": return .blue
    case "indigo": return .indigo
    case "purple", "violet": return .purple
    case "pink": return .pink
    case "brown": return .brown
    case "gray", "grey": return .gray
    default: return nil
    }
  }

}
