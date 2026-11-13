import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SettingsShortcuts: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let layout = dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(spacing: Tokens.Space.l))
      : AnyLayout(HStackLayout(spacing: Tokens.Space.l))
    layout {
      shortcut("Archive") { app.openArchive() }
      shortcut("Spaces") { app.openSyncedSpaces() }
    }
  }

  private func shortcut(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title)
        .font(Typography.body.weight(.medium))
        .frame(maxWidth: .infinity, minHeight: SettingsLayout.shortcutHeight)
        .background(Color(.secondarySystemGroupedBackground), in: .capsule)
        .contentShape(.capsule)
    }
    .buttonStyle(PressableStyle())
    .foregroundStyle(.primary)
  }
}

struct SyncAccountRow: View {
  let sync: SyncService
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let status = SyncStatusWords(sync: sync)
    let isLarge = dynamicTypeSize.isAccessibilitySize
    let layout = isLarge
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: Tokens.Space.l))
      : AnyLayout(HStackLayout(spacing: Tokens.Space.l))
    layout {
      SettingsIconTile(systemImage: ThisDevice.current.pairSymbol, color: SettingsTint.sync, baseSide: isLarge ? SettingsTile.accountSideLarge : SettingsTile.accountSide)
      VStack(alignment: .leading, spacing: Tokens.Space.xxs) {
        Text(status.rowTitle)
          .font(Typography.title)
          .foregroundStyle(.primary)
        status.rowSubtitle
          .font(Typography.row)
          .foregroundStyle(.secondary)
          .contentTransition(.opacity)
      }
    }
    .padding(.vertical, Tokens.Space.s)
    .accessibilityElement(children: .combine)
  }
}

struct ExportTabsRow: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    let urls = app.tabs.allOpenTabs.compactMap { URL(string: $0.url) }.filter { $0.scheme == "http" || $0.scheme == "https" }
    if urls.isEmpty {
      Button {
        app.toasts.show(.noOpenTabsToExport)
      } label: {
        SettingsRowLabel("Export Open Tabs", systemImage: "square.and.arrow.up.fill", tint: SettingsTint.export)
      }
      .tint(.primary)
    } else {
      ShareLink(item: urls.map(\.absoluteString).joined(separator: "\n"), subject: Text("Open Tabs from Ardia"), preview: SharePreview("Open Tabs from Ardia")) {
        SettingsRowLabel("Export Open Tabs", systemImage: "square.and.arrow.up.fill", tint: SettingsTint.export)
      }
      .tint(.primary)
    }
  }
}

struct AppearanceRow: View {
  @Environment(AppModel.self) private var app
  @Environment(\.profileLook) private var look

  var body: some View {
    NavigationLink(value: SettingsRoute.appearance) {
      LabeledContent {
        value
      } label: {
        SettingsRowLabel("Appearance", systemImage: "paintpalette.fill", tint: look.swatchColor)
      }
    }
  }

  @ViewBuilder
  private var value: some View {
    if app.settings.colorChoice == nil, app.sync.isEnabled {
      Text("Match My Mac")
    } else if let preset = look.preset {
      Text(preset.title)
    }
  }
}
