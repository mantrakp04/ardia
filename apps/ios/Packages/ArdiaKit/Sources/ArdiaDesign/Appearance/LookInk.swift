import SwiftUI

public extension ProfileLook {
  func inkScheme(appDark: Bool) -> ColorScheme {
    inkIsLight(dark: appDark) ? .dark : .light
  }
}

private struct LookInk: ViewModifier {
  let isOn: Bool
  @Environment(\.colorScheme) private var scheme
  @Environment(\.lookBackdropScheme) private var outerBase
  @Environment(\.profileLook) private var look

  func body(content: Content) -> some View {
    let base = outerBase ?? scheme
    let ink = isOn ? look.inkScheme(appDark: base == .dark) : base
    content
      .environment(\.lookBackdropScheme, base)
      .environment(\.colorScheme, ink)
      .navigationBarInk(ink == scheme ? nil : ink)
  }
}

public extension EnvironmentValues {
  @Entry var lookBackdropScheme: ColorScheme? = nil
}

private extension View {
  @ViewBuilder
  func navigationBarInk(_ scheme: ColorScheme?) -> some View {
    #if os(iOS)
    toolbarColorScheme(scheme, for: .navigationBar)
    #else
    self
    #endif
  }
}

public extension View {
  func lookInk(_ isOn: Bool = true) -> some View {
    modifier(LookInk(isOn: isOn))
  }
}
