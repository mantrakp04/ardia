import ArdiaBrowser
import ArdiaSync
import SwiftUI

struct ReceivedTabsAnnouncer: ViewModifier {
  let center: ToastCenter
  @Environment(AppModel.self) private var app

  func body(content: Content) -> some View {
    content
      .onChange(of: app.tabs.lastReceived.map(\.id)) { _, _ in announce() }
      .onChange(of: app.settings.isShowingOnboarding) { _, _ in announce() }
  }

  private func announce() {
    let received = app.tabs.lastReceived
    guard !received.isEmpty, !app.settings.isShowingOnboarding else { return }
    app.tabs.clearLastReceived()
    let sender = ReceivedTabsSender.name(devices: app.sync.snapshot.devices)
    let ids = received.map(\.id)
    center.show(.tabReceived(from: sender, count: ids.count) { [app] in
      if ids.count == 1, let id = ids.first {
        app.openTab(id)
      } else {
        app.showTabSwitcher()
      }
    })
  }
}

enum ReceivedTabsSender {
  static func name(devices: [SyncedDevice]) -> String {
    let others = devices.filter { !$0.isCurrent }
    let recent = others.max { ($0.lastSeen ?? .distantPast) < ($1.lastSeen ?? .distantPast) }
    return recent?.name ?? String(localized: "Your Mac")
  }
}
