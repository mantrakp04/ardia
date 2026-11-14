import ArdiaDesign
import SwiftUI

struct RootView: View {
  @Environment(AppModel.self) private var app
  private let launch = DemoLaunch.current

  var body: some View {
    @Bindable var app = app
    @Bindable var browse = app.browse
    RootShell(launch: launch)
      .sheet(item: $app.sheet) { sheet in
        switch sheet {
        case .settings: SettingsView().presentationSizing(.page)
        case .syncSetup: SyncSetupView()
        case .onboarding: OnboardingView()
        case .archive: ArchiveView().presentationSizing(.page)
        case .syncedSpaces: SyncedSpacesView().presentationSizing(.page)
        case .library(let section): LibraryView(section: section).presentationSizing(.page)
        }
      }
      .fullScreenCover(isPresented: $browse.isVoicePresented) {
        VoiceSearchView()
      }
      .onboardingCover()
      .toastHost(app.toasts)
      .rootLifecycle()
      .chromeEnvironment(launch)
      .environment(\.profileLook, app.look)
      .appearanceEnvironment()
  }
}

private struct RootShell: View {
  let launch: DemoLaunch
  @Environment(\.chromeLayout) private var layout
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    Group {
      if let style = launch.glassGallery {
        GlassGallery()
          .environment(\.interfaceStyle, style)
      } else {
        switch layout {
        case .bar: PhoneShell()
        case .sidebarOverlay, .sidebarDocked: SidebarShell()
        }
      }
    }
    .animation(reduceMotion ? nil : Tokens.Spring.sidebarDock.animation, value: layout)
  }
}
