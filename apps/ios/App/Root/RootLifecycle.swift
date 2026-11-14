import SwiftUI

struct RootLifecycle: ViewModifier {
  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase

  func body(content: Content) -> some View {
    content
      .task { await app.runDeckDemoScript() }
      .onChange(of: scenePhase) { old, phase in
        switch phase {
        case .active: app.sceneBecameActive()
        case .inactive where old == .active: app.sceneWillResignActive()
        case .background: app.sceneEnteredBackground()
        default: break
        }
      }
      .onChange(of: app.sync.snapshot.search) { _, _ in app.applySyncedSearch() }
      .onChange(of: app.sync.selectedProfileId) { _, _ in app.applySyncedSearch() }
      .onChange(of: app.sync.isEnabled) { _, _ in app.applySyncedSearch() }
      .onChange(of: app.sync.lastSynced) { _, _ in app.drainSystemInbox(sendsOnly: true) }
  }
}

extension View {
  func rootLifecycle() -> some View {
    modifier(RootLifecycle())
  }
}
