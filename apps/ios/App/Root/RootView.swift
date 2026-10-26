import SwiftUI

struct RootView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    @Bindable var app = app
    @Bindable var browse = app.browse
    ZStack {
      Group {
        if app.surface == .search {
          SearchHomeView()
        } else {
          BrowsingView(isFront: app.surface == .browsing)
        }
        if app.surface == .tabSwitcher {
          TabSwitcherView()
        }
      }
      .ignoresSafeArea(.keyboard, edges: browse.trayHoldsKeyboard ? .bottom : [])
      SearchTrayHost()
        .zIndex(10)
    }
    .sheet(item: $app.sheet) { sheet in
      switch sheet {
      case .settings: SettingsView()
      case .syncSetup: SyncSetupView()
      case .onboarding: OnboardingView()
      case .archive: ArchiveView()
      case .syncedSpaces: SyncedSpacesView()
      }
    }
    .fullScreenCover(isPresented: $browse.isVoicePresented) {
      VoiceSearchView()
    }
    .onboardingCover()
    .toastHost(app.toasts)
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
  }
}
