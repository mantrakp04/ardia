import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct SettingsRootList: View {
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
        .listSectionSpacing(Tokens.Space.l)

        Section {
          AppearanceRow()
        }

        Section {
          NavigationLink(value: SettingsRoute.siteSettings) {
            SettingsRowLabel("Site Settings", systemImage: "globe", tint: SettingsTint.neutral)
          }
          if DefaultBrowserStatus.isOffered {
            NavigationLink(value: SettingsRoute.defaultBrowser) {
              SettingsRowLabel("Default Browser", systemImage: "safari.fill", tint: SettingsTint.defaultBrowser)
            }
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
            .padding(.top, Tokens.Space.xl)
        }
        .id(SettingsRoute.bottomAnchor)
      }
      .contentMargins(.top, Tokens.Space.l, for: .scrollContent)
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
