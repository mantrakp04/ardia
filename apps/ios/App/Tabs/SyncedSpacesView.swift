import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SyncedSpacesView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var selection: String?
  @State private var switchTicks = 0

  var body: some View {
    let profiles = app.sync.snapshot.profiles
    NavigationStack {
      Group {
        if profiles.isEmpty {
          SpacesUnavailable(phase: app.sync.phase, status: app.sync.statusText) { app.sheet = .settings }
        } else {
          TabView(selection: $selection) {
            ForEach(profiles) { profile in
              SpacePage(profile: profile)
                .tag(Optional(profile.syncId))
            }
          }
          .tabViewStyle(.page(indexDisplayMode: .never))
          .ignoresSafeArea(.container, edges: .bottom)
        }
      }
      .navigationTitle(currentProfile?.name ?? String(localized: "Synced Tabs"))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Done") { dismiss() }
        }
        ToolbarItem(placement: .primaryAction) {
          Button("Archive", systemImage: "archivebox") { app.openArchive() }
        }
      }
      .safeAreaInset(edge: .top, spacing: 0) {
        SyncStatusBanner(phase: app.sync.phase, status: app.sync.statusText) { app.sheet = .settings }
      }
      .safeAreaInset(edge: .bottom, spacing: 0) {
        if profiles.count > 1 {
          SpaceSwitcher(profiles: profiles, selection: $selection)
        }
      }
    }
    .sensoryFeedback(.selection, trigger: switchTicks)
    .onAppear {
      selection = app.sync.selectedProfile?.syncId ?? profiles.first?.syncId
    }
    .onChange(of: selection) { old, new in
      guard let new, old != nil, new != app.tabs.profileSyncId else { return }
      switchTicks += 1
      app.switchProfile(to: new)
    }
  }

  private var currentProfile: SyncedProfile? {
    app.sync.snapshot.profiles.first { $0.syncId == selection }
  }
}

private struct SpacePage: View {
  let profile: SyncedProfile
  @Environment(AppModel.self) private var app
  @State private var expandedDevices: Set<String> = []

  private static let collapsedLimit = 8

  var body: some View {
    List {
      if !profile.pinned.tiles.isEmpty {
        Section {
          PinnedTileGrid(tiles: profile.pinned.tiles, open: open)
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            .listRowBackground(Color.clear)
        }
      }
      if !profile.pinned.sections.isEmpty {
        Section("Pinned") {
          ForEach(profile.pinned.sections) { section in
            PinnedSectionRow(section: section, open: open)
          }
        }
      }
      ForEach(devicesWithTabs) { device in
        Section {
          let expanded = expandedDevices.contains(device.id) || device.tabs.count <= Self.collapsedLimit + 1
          ForEach(expanded ? device.tabs : Array(device.tabs.prefix(Self.collapsedLimit))) { tab in
            RemoteRow(title: tab.title, url: tab.url) { open(tab.url, tab.title) }
          }
          if !expanded {
            Button("Show All \(device.tabs.count)") {
              withAnimation(Motion.snappy) { _ = expandedDevices.insert(device.id) }
            }
            .foregroundStyle(Palette.indigo)
          }
        } header: {
          Label {
            Text("On \(device.deviceName)")
          } icon: {
            Image(systemName: DeviceSymbol.name(forDeviceNamed: device.deviceName, kind: device.kind))
          }
        }
      }
      if profile.pinned.isEmpty && devicesWithTabs.isEmpty {
        Section {
          VStack(spacing: 8) {
            Text("Nothing in \(profile.name) Yet")
              .font(.headline)
            Text("Pinned tabs and open tabs from this Space on your Mac will show up here.")
              .font(.subheadline)
              .foregroundStyle(.secondary)
              .multilineTextAlignment(.center)
          }
          .frame(maxWidth: .infinity)
          .padding(.vertical, 24)
          .listRowBackground(Color.clear)
        }
      }
    }
    .listStyle(.insetGrouped)
    .refreshable { await app.sync.syncNow() }
  }

  private var devicesWithTabs: [DeviceTabs] {
    profile.deviceTabs.filter { !$0.tabs.isEmpty }
  }

  private func open(_ url: String, _ title: String) {
    app.openRemote(url: url, title: title, profileSyncId: profile.syncId)
  }
}

private struct PinnedTileGrid: View {
  let tiles: [PinnedTile]
  let open: (String, String) -> Void
  @ScaledMetric(relativeTo: .caption) private var tileSide = TabsLayout.tileSize

  var body: some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: tileSide + 8), spacing: 12, alignment: .top)], spacing: 14) {
      ForEach(tiles) { tile in
        if let folder = tile.folder, !folder.isEmpty {
          Menu {
            ForEach(folder) { tab in
              Button(tab.title.isEmpty ? (BrowserURL.host(of: tab.url) ?? tab.url) : tab.title) { open(tab.url, tab.title) }
            }
          } label: {
            PinnedTileView(title: tile.title, url: tile.url, isFolder: true, side: tileSide)
          }
          .buttonStyle(.plain)
        } else {
          Button { open(tile.url, tile.title) } label: {
            PinnedTileView(title: tile.title, url: tile.url, isFolder: false, side: tileSide)
          }
          .buttonStyle(PressableTileStyle())
        }
      }
    }
  }
}

private struct PinnedTileView: View {
  let title: String
  let url: String
  let isFolder: Bool
  let side: CGFloat

  var body: some View {
    VStack(spacing: 6) {
      ZStack {
        RoundedRectangle(cornerRadius: TabsLayout.tileRadius, style: .continuous)
          .fill(.background.secondary)
        if isFolder {
          Image(systemName: "folder.fill")
            .font(.system(size: side * 0.36))
            .foregroundStyle(Palette.indigo.opacity(0.8))
        } else {
          FaviconImage(iconURL: nil, pageURL: url, size: side * 0.42)
        }
      }
      .frame(width: side, height: side)
      Text(title.isEmpty ? (BrowserURL.host(of: url) ?? "") : title)
        .font(.caption)
        .foregroundStyle(.primary)
        .lineLimit(1)
        .frame(maxWidth: side + 8)
    }
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isButton)
  }
}

private struct PressableTileStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.95 : 1)
      .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
  }
}

private struct PinnedSectionRow: View {
  let section: PinnedSection
  let open: (String, String) -> Void

  var body: some View {
    switch section {
    case .tab(let tab):
      RemoteRow(title: tab.title, url: tab.url, symbol: tab.icon) { open(tab.url, tab.title) }
    case .group(let group):
      DisclosureGroup {
        ForEach(group.items) { item in
          PinnedSectionRow(section: item, open: open)
        }
      } label: {
        Label {
          Text(group.name)
            .lineLimit(2)
        } icon: {
          Image(systemName: SpaceColors.symbol(group.icon) ?? "folder.fill")
            .foregroundStyle(SpaceColors.color(named: group.color) ?? Palette.indigo)
        }
      }
    }
  }
}

private struct RemoteRow: View {
  let title: String
  let url: String
  var symbol: String?
  let open: () -> Void
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    Button(action: open) {
      HStack(spacing: 12) {
        if let name = SpaceColors.symbol(symbol) {
          Image(systemName: name)
            .frame(width: 20, height: 20)
            .foregroundStyle(.secondary)
        } else {
          FaviconImage(iconURL: nil, pageURL: url, size: 20)
        }
        VStack(alignment: .leading, spacing: 1) {
          Text(title.isEmpty ? (BrowserURL.host(of: url) ?? url) : title)
            .font(.body)
            .foregroundStyle(.primary)
            .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
          if let host = BrowserURL.host(of: url) {
            Text(host)
              .font(.subheadline)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
        Spacer(minLength: 0)
      }
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

private struct SpaceSwitcher: View {
  let profiles: [SyncedProfile]
  @Binding var selection: String?

  var body: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 8) {
        ForEach(profiles) { profile in
          let isSelected = selection == profile.syncId
          Button {
            withAnimation(Motion.snappy) { selection = profile.syncId }
          } label: {
            HStack(spacing: 6) {
              SpaceBadge(profile: profile, size: 18)
              Text(profile.name)
                .font(.subheadline.weight(isSelected ? .semibold : .regular))
                .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background {
              Capsule().fill(isSelected ? AnyShapeStyle((SpaceColors.color(named: profile.color) ?? Palette.indigo).opacity(0.16)) : AnyShapeStyle(.clear))
            }
            .contentShape(.capsule)
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(isSelected ? .isSelected : [])
        }
      }
      .padding(.horizontal, Spacing.page)
      .padding(.vertical, 8)
    }
    .scrollIndicators(.hidden)
    .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    .glassEffect(.regular, in: .capsule)
    .padding(.horizontal, Spacing.page)
    .padding(.bottom, 4)
  }
}

private struct SpaceBadge: View {
  let profile: SyncedProfile
  let size: CGFloat

  var body: some View {
    let tint = SpaceColors.color(named: profile.color) ?? Palette.indigo
    ZStack {
      Circle().fill(tint.gradient)
      if let symbol = SpaceColors.symbol(profile.icon) {
        Image(systemName: symbol)
          .font(.system(size: size * 0.5, weight: .semibold))
          .foregroundStyle(.white)
      } else {
        Text(String(profile.name.prefix(1)).uppercased())
          .font(.system(size: size * 0.55, weight: .bold, design: .rounded))
          .foregroundStyle(.white)
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
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
            .tint(Palette.indigo)
        }
      }
      .padding(12)
      .background(.background.secondary, in: .rect(cornerRadius: 14, style: .continuous))
      .padding(.horizontal, Spacing.page)
      .padding(.vertical, 8)
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
  let phase: SyncPhase
  let status: String
  let openSettings: () -> Void

  var body: some View {
    ContentUnavailableView {
      Label("No Synced Tabs Yet", systemImage: "laptopcomputer.and.iphone")
    } description: {
      Text(phase == .off ? "Sync with Ardia on your Mac to see your Spaces, pinned tabs and open tabs here." : status)
    } actions: {
      Button(phase == .off ? "Sync With Mac" : "Open Sync Settings", action: openSettings)
        .buttonStyle(.bordered)
        .tint(Palette.indigo)
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
    case "indigo": return Palette.indigo
    case "purple", "violet": return .purple
    case "pink": return .pink
    case "brown": return .brown
    case "gray", "grey": return .gray
    default: return nil
    }
  }

  static func symbol(_ name: String?) -> String? {
    guard let name, !name.isEmpty, UIImage(systemName: name) != nil else { return nil }
    return name
  }
}
