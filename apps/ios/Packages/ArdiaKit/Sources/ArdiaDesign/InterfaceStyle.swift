import SwiftUI

public enum InterfaceStyle: String, CaseIterable, Sendable {
  case matchMac
  case glass
  case classic
}

public enum SchemeChoice: String, CaseIterable, Sendable {
  case matchMac
  case system
  case light
  case dark

  public var colorScheme: ColorScheme? {
    switch self {
    case .matchMac, .system: nil
    case .light: .light
    case .dark: .dark
    }
  }
}

public extension EnvironmentValues {
  @Entry var usesGlass = true
}

public extension View {
  func chromeSurface(in shape: some Shape, interactive: Bool = true, tinted: Bool = false) -> some View {
    modifier(ChromeSurface(shape: shape, interactive: interactive, tinted: tinted))
  }
}

private struct ChromeSurface<S: Shape>: ViewModifier {
  let shape: S
  let interactive: Bool
  let tinted: Bool

  @Environment(\.usesGlass) private var usesGlass
  @Environment(\.profileLook) private var look

  func body(content: Content) -> some View {
    if usesGlass {
      content.glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
    } else {
      content
        .background(tinted ? AnyShapeStyle(look.surface) : AnyShapeStyle(.background), in: shape)
        .overlay(shape.stroke(.primary.opacity(0.12), lineWidth: 0.5))
    }
  }
}
