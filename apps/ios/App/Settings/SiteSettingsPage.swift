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

      AllowedSitesSection(permissions: app.preferences.sitePermissions)
    }
    .navigationTitle("Site Settings")
    .navigationBarTitleDisplayMode(.inline)
  }
}

private struct AllowedSitesSection: View {
  let permissions: SitePermissions
  @Environment(AppModel.self) private var app
  @State private var revoking: SitePermissionGrant?

  var body: some View {
    Section {
      if permissions.grants.isEmpty {
        Text("None")
          .foregroundStyle(.secondary)
      }
      ForEach(permissions.grants) { grant in
        Button {
          revoking = grant
        } label: {
          AllowedSiteRow(grant: grant)
        }
        .tint(.primary)
        .swipeActions {
          Button("Revoke", role: .destructive) {
            app.web.revokeCapture(grant.permissions, origin: grant.origin)
          }
        }
      }
    } header: {
      Text("Camera, Microphone and Location")
    } footer: {
      Text("Sites you allowed keep access on this iPhone until you revoke it. Private tabs always ask.")
    }
    .confirmationDialog(revoking?.host ?? "", isPresented: isRevoking, titleVisibility: .visible, presenting: revoking) { grant in
      if grant.permissions.count > 1 {
        ForEach(grant.permissions.sorted(), id: \.self) { permission in
          Button("Revoke \(permission.name)", role: .destructive) {
            app.web.revokeCapture([permission], origin: grant.origin)
          }
        }
      }
      Button(grant.permissions.count > 1 ? "Revoke All" : "Revoke \(grant.summary)", role: .destructive) {
        app.web.revokeCapture(grant.permissions, origin: grant.origin)
      }
    } message: { grant in
      Text("Allowed: \(grant.summary)")
    }
  }

  private var isRevoking: Binding<Bool> {
    Binding { revoking != nil } set: { if !$0 { revoking = nil } }
  }
}

private struct AllowedSiteRow: View {
  let grant: SitePermissionGrant

  var body: some View {
    HStack(spacing: Spacing.small) {
      FaviconImage(iconURL: nil, pageURL: grant.origin, size: SiteRow.favicon)
      VStack(alignment: .leading, spacing: 2) {
        Text(verbatim: grant.host)
          .foregroundStyle(.primary)
        Text(grant.summary)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .accessibilityElement(children: .combine)
    .accessibilityHint("Revoke access")
  }
}

#Preview {
  NavigationStack {
    SiteSettingsPage()
  }
  .environment(AppModel(isDemo: true))
}
