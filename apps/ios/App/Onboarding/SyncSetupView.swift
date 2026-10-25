import SwiftUI

struct SyncSetupView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Group {
        if SyncStatusWords(sync: app.sync).isConnected {
          SyncSettingsPage()
        } else {
          SyncConnectPage(onConnected: { dismiss() })
        }
      }
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close", role: .close) { dismiss() }
        }
      }
      .navigationDestination(for: SettingsRoute.self) { $0.destination }
    }
    .tint(Color.ardiaAccentText)
  }
}

#Preview("Sync Setup") {
  SyncSetupView()
    .environment(AppModel(isDemo: true))
}
