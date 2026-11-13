import ArdiaDesign
import SwiftUI

struct AppearanceEnvironment: ViewModifier {
  @Environment(AppModel.self) private var app

  func body(content: Content) -> some View {
    let appearance = app.appearance
    content
      .environment(\.interfaceStyle, appearance.interfaceStyle)
      .environment(\.glassTintAmount, appearance.glassTintAmount)
      .preferredColorScheme(appearance.colorScheme)
  }
}

extension View {
  func appearanceEnvironment() -> some View {
    modifier(AppearanceEnvironment())
  }
}
