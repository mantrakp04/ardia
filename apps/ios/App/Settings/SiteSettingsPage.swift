import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct SiteSettingsPage: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    @Bindable var blocking = app.blocking
    @Bindable var preferences = app.preferences
    @Bindable var settings = app.settings
    Form {
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
            Text(app.filterLists.enabledLists.count, format: .number)
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
      }

      Section {
        Picker(selection: $preferences.nightShade) {
          ForEach(NightShadeMode.allCases) { mode in
            Text(mode.title).tag(mode)
          }
        } label: {
          SettingsRowLabel("Night Shade", systemImage: "moon.fill", tint: SettingsTint.nightShade)
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
        Toggle(isOn: $settings.collapsesBottomBar) {
          SettingsRowLabel("Collapse Bottom Bar", systemImage: "platter.filled.bottom.and.arrow.down.iphone", tint: SettingsTint.bottomBar)
        }
      } footer: {
        Text("Change one site from its page menu.")
      }
    }
    .navigationTitle("Site Settings")
    .navigationBarTitleDisplayMode(.inline)
  }
}

#Preview {
  NavigationStack {
    SiteSettingsPage()
  }
  .environment(AppModel(isDemo: true))
}
