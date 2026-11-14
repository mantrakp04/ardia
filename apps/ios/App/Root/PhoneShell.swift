import ArdiaDesign
import SwiftUI

struct PhoneShell: View {
  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
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
      .ignoresSafeArea(.keyboard, edges: app.browse.trayHoldsKeyboard ? .bottom : [])
      SearchTrayHost()
        .zIndex(10)
    }
  }
}

struct CoveredTransition: Transition {
  func body(content: Content, phase: TransitionPhase) -> some View {
    content.opacity(phase == .didDisappear ? 0.99 : 1)
  }
}
