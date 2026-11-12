import ArdiaDesign
import SwiftUI

struct RootView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    @Bindable var app = app
    @Bindable var browse = app.browse
    let isHome = app.surface == .search
    ZStack {
      Group {
        if isHome {
          SearchHomeView()
            .transition(.opacity)
            .zIndex(2)
        } else {
          BrowsingView(isFront: app.surface == .browsing)
            .transition(CoveredTransition())
        }
        if app.surface == .tabSwitcher {
          TabSwitcherView()
            .transition(CoveredTransition())
            .zIndex(1)
        }
      }
      .animation(reduceMotion ? Motion.surfaceFade : Motion.surfaceSwap, value: isHome)
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
    .onChange(of: app.sync.lastSynced) { _, _ in app.drainSystemInbox(sendsOnly: true) }
    .environment(\.profileLook, app.look)
  }
}

struct CoveredTransition: Transition {
  func body(content: Content, phase: TransitionPhase) -> some View {
    content.opacity(phase == .didDisappear ? 0.99 : 1)
  }
}
