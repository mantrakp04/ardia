import SwiftUI

public enum GlassControlShape: Sendable {
  case circle
  case capsule
  case pill
  case tile
  case row

  var outline: GlassOutline {
    switch self {
    case .circle: .circle
    case .capsule, .pill: .capsule
    case .tile: .rounded(GlassMetrics.tileRadius)
    case .row: .rounded(SidebarMetrics.Row.radius)
    }
  }

  public var minimumSize: CGSize {
    switch self {
    case .circle, .capsule: CGSize(width: GlassMetrics.hitTarget, height: GlassMetrics.hitTarget)
    case .pill: CGSize(width: GlassMetrics.hitTarget, height: GlassMetrics.pillHeight)
    case .tile: CGSize(width: SidebarMetrics.Tile.minWidth, height: SidebarMetrics.Tile.height)
    case .row: CGSize(width: GlassMetrics.hitTarget, height: SidebarMetrics.Row.height)
    }
  }
}

public enum GlassPanelShape: Sendable {
  case rounded
  case capsule
  case concentric

  var outline: GlassOutline {
    switch self {
    case .rounded: .rounded(GlassMetrics.panelRadius)
    case .capsule: .capsule
    case .concentric: .concentric
    }
  }
}

public enum GlassMetrics {
  public static let tileRadius = SidebarMetrics.Tile.radius
  public static let panelRadius = SidebarMetrics.touch(Tokens.Radius.sheet)
  public static let blendSpacing = Tokens.Space.xs
  public static let hitTarget = BrowseLayout.hitTarget
  public static let pillHeight = Tokens.Space.huge
}

struct GlassHitArea: Shape {
  let minimum: CGFloat

  func path(in rect: CGRect) -> Path {
    Path(rect.insetBy(dx: min(0, (rect.width - minimum) / 2), dy: min(0, (rect.height - minimum) / 2)))
  }
}

enum GlassOutline: Equatable, Sendable {
  case circle
  case capsule
  case rounded(CGFloat)
  case concentric
}

enum GlassFill: Equatable, Sendable {
  case control(GlassState)
  case band
  case panel
}

struct GlassEnvironment: DynamicProperty {
  @Environment(\.interfaceStyle) private var requestedStyle
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.profileLook) private var look
  @Environment(\.glassTintAmount) private var tintAmount
  @Environment(\.glassNamespace) var namespace
  @Environment(\.glassPlacement) var placement

  var style: InterfaceStyle { requestedStyle.resolved(reduceTransparency: reduceTransparency) }

  private var isDark: Bool { colorScheme == .dark }

  func glass(for fill: GlassFill) -> Glass {
    switch fill {
    case .control(let state):
      .regular.tint(GlassTint.control(state, dark: isDark, amount: tintAmount).color).interactive()
    case .band:
      .regular.tint(GlassTint.control(.rest, dark: isDark, amount: tintAmount).color)
    case .panel:
      .regular.tint(GlassTint.panel(dark: isDark, look: look, amount: tintAmount).color)
    }
  }
}

struct GlassSurface: ViewModifier {
  let outline: GlassOutline
  let fill: GlassFill
  let morphID: String?
  var glass = GlassEnvironment()

  func body(content: Content) -> some View {
    switch outline {
    case .circle: surface(content, in: Circle())
    case .capsule: surface(content, in: Capsule())
    case .rounded(let radius): surface(content, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
    case .concentric: surface(content, in: ConcentricRectangle())
    }
  }

  private func surface(_ content: Content, in shape: some Shape) -> some View {
    let isGlass = glass.style == .glass
    return content
      .background {
        if !isGlass { ClassicFill(shape: shape, fill: fill, placement: glass.placement) }
      }
      .glassEffect(isGlass ? glass.glass(for: fill) : .identity, in: shape)
      .glassMorph(morphID, in: glass.namespace)
  }
}

private struct ClassicFill<S: Shape>: View {
  let shape: S
  let fill: GlassFill
  let placement: GlassPlacement

  var body: some View {
    switch fill {
    case .control(let state) where placement == .overContent:
      shape
        .fill(state.classicFill(.overContent))
        .overlay { shape.stroke(Tokens.Role.controlBorder, lineWidth: Tokens.Hairline.panel) }
        .shadow(Tokens.Shadow.popover)
    case .control(let state):
      shape
        .fill(state.classicFill)
        .overlay {
          if state == .rest {
            shape.stroke(Tokens.Role.pinnedRestingStroke, lineWidth: Tokens.Hairline.ring)
          }
        }
    case .band:
      shape.fill(GlassState.rest.classicFill)
    case .panel:
      shape
        .fill(Tokens.Role.panel)
        .overlay { shape.stroke(Tokens.Role.panelBorder, lineWidth: Tokens.Hairline.panel) }
        .shadow(Tokens.Shadow.popover)
    }
  }
}

extension View {
  @ViewBuilder
  func glassMorph(_ id: String?, in namespace: Namespace.ID?) -> some View {
    if let id, let namespace {
      glassEffectID(id, in: namespace).glassEffectTransition(.matchedGeometry)
    } else {
      self
    }
  }
}
