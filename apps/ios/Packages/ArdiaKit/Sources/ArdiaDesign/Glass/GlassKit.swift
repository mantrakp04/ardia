import SwiftUI

public struct GlassBar<Content: View>: View {
  @Namespace private var namespace
  private let content: Content

  public init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  public var body: some View {
    GlassEffectContainer(spacing: GlassMetrics.blendSpacing) {
      content
    }
    .environment(\.glassNamespace, namespace)
  }
}

public struct GlassControl: ViewModifier {
  let shape: GlassControlShape
  let state: GlassState
  let morphID: String?
  @State private var isHovering = false

  public func body(content: Content) -> some View {
    content
      .frame(minWidth: shape.minimumSize.width, minHeight: shape.minimumSize.height)
      .modifier(GlassSurface(outline: shape.outline, fill: .control(state == .rest && isHovering ? .lit : state), morphID: morphID))
      .contentShape(.interaction, GlassHitArea(minimum: GlassMetrics.hitTarget))
      .onHover { isHovering = $0 }
  }
}

public struct GlassPanel: ViewModifier {
  let shape: GlassPanelShape
  let morphID: String?

  public func body(content: Content) -> some View {
    content.modifier(GlassSurface(outline: shape.outline, fill: .panel, morphID: morphID))
  }
}

public extension View {
  func glassControl(_ shape: GlassControlShape, state: GlassState = .rest, morphID: String? = nil) -> some View {
    modifier(GlassControl(shape: shape, state: state, morphID: morphID))
  }

  func glassPanel(_ shape: GlassPanelShape = .rounded, morphID: String? = nil) -> some View {
    modifier(GlassPanel(shape: shape, morphID: morphID))
  }

  func glassBand(_ shape: GlassControlShape) -> some View {
    modifier(GlassSurface(outline: shape.outline, fill: .band, morphID: nil))
  }
}

public struct GlassControlButtonStyle: ButtonStyle {
  let shape: GlassControlShape
  let state: GlassState
  let morphID: String?

  public func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .glassControl(shape, state: configuration.isPressed ? .pressed : state, morphID: morphID)
  }
}

public extension ButtonStyle where Self == GlassControlButtonStyle {
  static func glassControl(_ shape: GlassControlShape, state: GlassState = .rest, morphID: String? = nil) -> Self {
    GlassControlButtonStyle(shape: shape, state: state, morphID: morphID)
  }
}

public struct GlassActionButtonStyle: PrimitiveButtonStyle {
  let isPrimary: Bool

  public func makeBody(configuration: Configuration) -> some View {
    GlassActionButton(configuration: configuration, isPrimary: isPrimary)
  }
}

public extension PrimitiveButtonStyle where Self == GlassActionButtonStyle {
  static var glassAction: Self { GlassActionButtonStyle(isPrimary: false) }
  static var glassPrimaryAction: Self { GlassActionButtonStyle(isPrimary: true) }
}

private struct GlassActionButton: View {
  let configuration: PrimitiveButtonStyleConfiguration
  let isPrimary: Bool
  var glass = GlassEnvironment()

  var body: some View {
    switch (glass.style, isPrimary) {
    case (.glass, false):
      Button(configuration).buttonStyle(.glass)
    case (.glass, true):
      Button(configuration).buttonStyle(.glassProminent).tint(Palette.primaryAction).foregroundStyle(Palette.onPrimaryAction)
    case (.classic, false):
      Button(configuration).buttonStyle(.bordered).buttonBorderShape(.capsule)
    case (.classic, true):
      Button(configuration).buttonStyle(.borderedProminent).buttonBorderShape(.capsule).tint(Palette.primaryAction).foregroundStyle(Palette.onPrimaryAction)
    }
  }
}
