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
            Button("Done", role: .confirm) { dismiss() }
          }
        }
        .navigationDestination(for: SettingsRoute.self) { route in
          route.destination
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
    @Bindable var blocking = app.blocking
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
          NavigationLink(value: SettingsRoute.defaultBrowser) {
            SettingsRowLabel("Default Browser", systemImage: "safari.fill", tint: SettingsTint.defaultBrowser)
          }
        }

        Section {
          Toggle(isOn: $blocking.blocksAds) {
            SettingsRowLabel("Block Ads", systemImage: "hand.raised.fill", tint: SettingsTint.ads)
          }
          Toggle(isOn: $blocking.blocksTrackers) {
            SettingsRowLabel("Block Trackers", systemImage: "eyeglasses", tint: SettingsTint.trackers)
          }
          Toggle(isOn: $blocking.hidesCookieBanners) {
            SettingsRowLabel("Block Cookie Banners", systemImage: "list.bullet.rectangle.portrait.fill", tint: SettingsTint.cookies)
          }
          NavigationLink(value: SettingsRoute.filterLists) {
            LabeledContent {
              Text(FilterListWords.summary(lists: app.filterLists.enabledLists.count, rules: app.filterLists.enabledRuleCount))
                .lineLimit(1)
            } label: {
              SettingsRowLabel("Filter Lists", systemImage: "line.3.horizontal.decrease", tint: SettingsTint.neutral)
            }
          }
          NavigationLink(value: SettingsRoute.trustedSites) {
            LabeledContent {
              Text(blocking.exemptHosts.isEmpty ? String(localized: "None") : blocking.exemptHosts.count.formatted())
            } label: {
              SettingsRowLabel("Trusted Sites", systemImage: "checkmark.shield.fill", tint: SettingsTint.green)
            }
          }
        } header: {
          Text("Blocking")
        } footer: {
          Text(BlockingFooter.text(ads: blocking.blocksAds, trackers: blocking.blocksTrackers, cookies: blocking.hidesCookieBanners))
            .contentTransition(.opacity)
        }

        Section {
          NavigationLink(value: SettingsRoute.searchEngine) {
            LabeledContent {
              Text(SearchEngineNames.current(app))
            } label: {
              SettingsRowLabel("Search Engine", systemImage: "magnifyingglass", tint: SettingsTint.search)
            }
          }
          Picker(selection: $tabs.autoArchiveInterval) {
            ForEach(AutoArchiveInterval.allCases) { interval in
              Text(interval.title).tag(interval)
            }
          } label: {
            SettingsRowLabel("Archive Inactive Tabs", systemImage: "archivebox.fill", tint: SettingsTint.archive)
          }
          .tint(.secondary)
          Picker(selection: $preferences.swipeNavigation) {
            ForEach(SwipeNavigationMode.allCases) { mode in
              Text(mode.title).tag(mode)
            }
          } label: {
            SettingsRowLabel("Swipe to Navigate", systemImage: "hand.draw.fill", tint: SettingsTint.swipe)
          }
          .tint(.secondary)
          Picker(selection: $preferences.nightShade) {
            ForEach(NightShadeMode.allCases) { mode in
              Text(mode.title).tag(mode)
            }
          } label: {
            SettingsRowLabel("Night Shade", systemImage: "moon.fill", tint: SettingsTint.nightShade)
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
          Toggle(isOn: $settings.collapsesBottomBar) {
            SettingsRowLabel("Collapse Bottom Bar", systemImage: "platter.filled.bottom.and.arrow.down.iphone", tint: SettingsTint.bottomBar)
          }
          Toggle(isOn: $settings.autoOpensKeyboard) {
            SettingsRowLabel("Auto-Open Keyboard", systemImage: "keyboard.fill", tint: SettingsTint.keyboard)
          }
          Toggle(isOn: $preferences.searchSuggestions) {
            SettingsRowLabel("Search Suggestions", systemImage: "text.magnifyingglass", tint: SettingsTint.blue)
          }
        } header: {
          Text("Browsing")
        } footer: {
          Text(BrowsingFooter.text(archive: tabs.autoArchiveInterval, suggestions: preferences.searchSuggestions))
            .contentTransition(.opacity)
        }

        Section {
          NavigationLink(value: SettingsRoute.clearData) {
            SettingsRowLabel("Clear Browsing Data", systemImage: "eraser.fill", tint: SettingsTint.clearData)
          }
          ExportTabsRow()
        } header: {
          Text("Your Data")
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
        LabeledContent {
          Text(urls.count.formatted())
        } label: {
          SettingsRowLabel("Export Open Tabs", systemImage: "square.and.arrow.up.fill", tint: SettingsTint.export)
        }
      }
      .tint(.primary)
    }
  }
}

enum BlockingFooter {
  static func text(ads: Bool, trackers: Bool, cookies: Bool) -> String {
    switch (ads, trackers, cookies) {
    case (false, false, false):
      String(localized: "Pages load with everything on them, ads and trackers included.")
    default:
      String(localized: "Blocking runs on this iPhone, so pages load faster and nobody sees what you browse. Turn it off for one site from the page’s menu.")
    }
  }
}

enum BrowsingFooter {
  static func text(archive: AutoArchiveInterval, suggestions: Bool) -> String {
    let archiveLine = archive == .never
      ? String(localized: "Tabs stay open until you close them.")
      : String(localized: "Tabs you haven’t looked at in \(archive.span) move to the Archive, where you can reopen them.")
    let suggestionLine = suggestions
      ? String(localized: "Search Suggestions sends what you type to your search engine.")
      : String(localized: "Search Suggestions is off, so what you type stays on this iPhone until you search.")
    return archiveLine + " " + suggestionLine
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
