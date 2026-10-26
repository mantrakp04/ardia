import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SettingsView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var path: [SettingsRoute] = []

  private func takePendingRoute() {
    guard let route = app.settings.pendingRoute else { return }
    app.settings.pendingRoute = nil
    path = [route]
  }

  var body: some View {
    NavigationStack(path: $path) {
      SettingsRootList()
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { dismiss() }
              .fontWeight(.semibold)
          }
        }
        .navigationDestination(for: SettingsRoute.self) { route in
          route.destination.settingsChrome()
        }
    }
    .tint(Color.ardiaAccentText)
    .toggleStyle(SettingsSwitchStyle())
    .onAppear {
      #if DEBUG
      if let route = SettingsRoute.launchRoute, path.isEmpty { path = [route] }
      #endif
      takePendingRoute()
      OnboardingView.dismissKeyboard()
    }
    .onChange(of: app.settings.pendingRoute) { _, _ in takePendingRoute() }
  }
}

enum SettingsRoute: String, Hashable {
  case sync
  case siteSettings
  case connect
  case searchEngine
  case experiments
  case filterLists
  case filterListDetail
  case myFilters
  case trustedSites
  case clearData
  case defaultBrowser
  case about
  case licenses

  @MainActor @ViewBuilder
  var destination: some View {
    switch self {
    case .sync: SyncSettingsPage()
    case .siteSettings: SiteSettingsPage()
    case .connect: SyncConnectPage()
    case .searchEngine: SearchEnginePage()
    case .experiments: ExperimentsPage()
    case .filterLists: FilterListsPage()
    case .filterListDetail: FilterListDetailPage(listID: "ublock-filters")
    case .myFilters: MyFiltersEditor()
    case .trustedSites: TrustedSitesPage()
    case .clearData: ClearBrowsingDataPage()
    case .defaultBrowser: DefaultBrowserPage()
    case .about: AboutPage()
    case .licenses: LicensesPage()
    }
  }

  static let bottomAnchor = "settings.bottom"

  static var launchScrollAnchor: UnitPoint? {
    #if DEBUG
    ProcessInfo.processInfo.arguments.contains("-ArdiaSettingsBottom") ? .bottom : nil
    #else
    nil
    #endif
  }

  static var launchRoute: SettingsRoute? {
    let arguments = ProcessInfo.processInfo.arguments
    guard let index = arguments.firstIndex(of: "-ArdiaSettingsPage"), arguments.indices.contains(index + 1) else { return nil }
    return SettingsRoute(rawValue: arguments[index + 1])
  }
}

private struct SettingsRootList: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    @Bindable var preferences = app.preferences
    @Bindable var settings = app.settings
    @Bindable var tabs = app.tabs
    ScrollViewReader { proxy in
      Form {
        Section {
          NavigationLink(value: SettingsRoute.sync) {
            SyncAccountRow(sync: app.sync)
          }
        }

        Section {
          SettingsShortcuts()
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
        .listSectionSpacing(Spacing.small)

        Section {
          NavigationLink(value: SettingsRoute.siteSettings) {
            SettingsRowLabel("Site Settings", systemImage: "globe", tint: SettingsTint.neutral)
          }
          NavigationLink(value: SettingsRoute.defaultBrowser) {
            SettingsRowLabel("Default Browser", systemImage: "safari.fill", tint: SettingsTint.defaultBrowser)
          }
        }

        Section {
          NavigationLink(value: SettingsRoute.searchEngine) {
            LabeledContent {
              Text(SearchEngineNames.current(app))
            } label: {
              SettingsRowLabel("Search Engine", systemImage: "magnifyingglass", tint: SettingsTint.search)
            }
          }
          Toggle(isOn: $preferences.searchSuggestions) {
            SettingsRowLabel("Search Suggestions", systemImage: "text.magnifyingglass", tint: SettingsTint.blue)
          }
          Toggle(isOn: $settings.autoOpensKeyboard) {
            SettingsRowLabel("Auto-Open Keyboard", systemImage: "keyboard.fill", tint: SettingsTint.keyboard)
          }
        }

        Section {
          Picker(selection: $tabs.autoArchiveInterval) {
            ForEach(AutoArchiveInterval.allCases) { interval in
              Text(interval.title).tag(interval)
            }
          } label: {
            SettingsRowLabel("Archive Inactive Tabs", systemImage: "archivebox.fill", tint: SettingsTint.archive)
          }
          .tint(.secondary)
          Picker(selection: $preferences.appLinks) {
            ForEach(AppLinkPreference.allCases) { preference in
              Text(preference.title).tag(preference)
            }
          } label: {
            SettingsRowLabel("Open App Links In", systemImage: "arrow.up.forward.app.fill", tint: SettingsTint.appLinks)
          }
          .tint(.secondary)
          NavigationLink(value: SettingsRoute.clearData) {
            SettingsRowLabel("Clear Browsing Data", systemImage: "eraser.fill", tint: SettingsTint.clearData)
          }
          ExportTabsRow()
        }

        Section {
          NavigationLink(value: SettingsRoute.experiments) {
            LabeledContent {
              Text(settings.aiFeaturesEnabled ? "On" : "Off")
            } label: {
              SettingsRowLabel("Experiments", systemImage: "flask.fill", tint: SettingsTint.experiments)
            }
          }
        }

        Section {
          Button {
            app.sheet = nil
            app.settings.showOnboarding()
          } label: {
            SettingsRowLabel("Show Onboarding", systemImage: "hand.wave.fill", tint: SettingsTint.onboarding)
          }
          .tint(.primary)
          NavigationLink(value: SettingsRoute.about) {
            SettingsRowLabel("About Ardia", systemImage: "info", tint: SettingsTint.neutral)
          }
        } footer: {
          Text(AppVersion.footer)
            .frame(maxWidth: .infinity)
            .padding(.top, Spacing.page)
        }
        .id(SettingsRoute.bottomAnchor)
      }
      .contentMargins(.top, Spacing.small, for: .scrollContent)
      .settingsChrome()
      #if DEBUG
      .task {
        guard SettingsRoute.launchScrollAnchor != nil else { return }
        try? await Task.sleep(for: .milliseconds(400))
        proxy.scrollTo(SettingsRoute.bottomAnchor, anchor: .bottom)
      }
      #endif
    }
  }
}

private struct SettingsShortcuts: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let layout = dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(spacing: Spacing.small))
      : AnyLayout(HStackLayout(spacing: Spacing.small))
    layout {
      shortcut("Archive", systemImage: "archivebox") { app.openArchive() }
      shortcut("Spaces", systemImage: "square.stack") { app.openSyncedSpaces() }
    }
  }

  private func shortcut(_ title: LocalizedStringKey, systemImage: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Label(title, systemImage: systemImage)
        .font(.body.weight(.medium))
        .frame(maxWidth: .infinity, minHeight: 48)
        .background(Color(.secondarySystemGroupedBackground), in: .capsule)
        .contentShape(.capsule)
    }
    .buttonStyle(PressableStyle())
    .foregroundStyle(.primary)
  }
}

private struct SyncAccountRow: View {
  let sync: SyncService
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let status = SyncStatusWords(sync: sync)
    let layout = dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.small))
      : AnyLayout(HStackLayout(spacing: Spacing.small + 2))
    layout {
      SettingsIconTile(systemImage: "macbook.and.iphone", color: SettingsTint.sync, baseSide: dynamicTypeSize.isAccessibilitySize ? 44 : 56)
      VStack(alignment: .leading, spacing: 2) {
        Text(status.rowTitle)
          .font(.title3.weight(.semibold))
          .foregroundStyle(.primary)
        status.rowSubtitle
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .contentTransition(.opacity)
      }
    }
    .padding(.vertical, 6)
    .accessibilityElement(children: .combine)
  }
}

private struct ExportTabsRow: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    let urls = app.tabs.openTabs.compactMap { URL(string: $0.url) }.filter { $0.scheme == "http" || $0.scheme == "https" }
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

extension AutoArchiveInterval {
  var span: String {
    guard let duration else { return "" }
    let units: Set<Duration.UnitsFormatStyle.Unit> = duration >= 24 * 3600 ? [.days] : [.hours]
    return Duration.seconds(duration).formatted(.units(allowed: units, width: .wide))
  }
}

enum AppVersion {
  static var footer: String {
    let info = Bundle.main.infoDictionary
    let version = info?["CFBundleShortVersionString"] as? String ?? "1.0"
    let build = info?["CFBundleVersion"] as? String ?? "1"
    return String(localized: "Ardia \(version) (\(build))")
  }
}

#Preview("Settings") {
  SettingsView()
    .environment(AppModel(isDemo: true))
}
