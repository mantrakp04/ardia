import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct ReceivedTabsAnnouncer: ViewModifier {
  let center: ToastCenter
  @Environment(AppModel.self) private var app
  @Environment(\.usesGlass) private var usesGlass
  @Environment(\.profileLook) private var look

  func body(content: Content) -> some View {
    content
      .onAppear { center.usesGlass = usesGlass; center.look = look; center.scheme = app.preferredScheme }
      .onChange(of: app.preferredScheme) { _, value in center.scheme = value }
      .onChange(of: usesGlass) { _, value in center.usesGlass = value }
      .onChange(of: look) { _, value in center.look = value }
      .onChange(of: app.tabs.lastReceived.map(\.id)) { _, _ in announce() }
      .onChange(of: app.settings.isShowingOnboarding) { _, _ in announce() }
  }

  private func announce() {
    let received = app.tabs.lastReceived
    guard !received.isEmpty, !app.settings.isShowingOnboarding else { return }
    app.tabs.clearLastReceived()
    let sender = ReceivedTabsSender.name(senders: received.map(\.receivedFromDevice))
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
  static func name(senders: [String?]) -> String {
    let names = Set(senders.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
    if names.count == 1, let only = names.first { return only }
    return String(localized: "Your Mac")
  }
}
