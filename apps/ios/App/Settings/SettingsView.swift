import ArdiaBrowser
import ArdiaDesign
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
