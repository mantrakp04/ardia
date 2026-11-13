import SwiftUI

public struct ReservedArea: Equatable, Sendable {
  public enum Kind: Sendable {
    case occlusion
    case division
  }

  public let frame: CGRect
  public let margins: EdgeInsets
  public let isActive: Bool
}

public extension GeometryProxy {
  func reservedAreas(_ kind: ReservedArea.Kind, includeInactive: Bool = false) -> [ReservedArea] {
    guard #available(iOS 27.1, macOS 27.1, *) else { return [] }
    return reservedRegions(kind: kind.system, options: includeInactive ? .includeInactive : []).map {
      ReservedArea(frame: $0.frame, margins: $0.margins, isActive: $0.isActive)
    }
  }
}

public extension View {
  func onHingeStateChange(_ action: @escaping (HingeState?) -> Void) -> some View {
    modifier(HingeStateReader(action: action))
  }

  func onVerticalBarEdgeChange(_ action: @escaping (HorizontalEdge?) -> Void) -> some View {
    modifier(VerticalBarEdgeReader(action: action))
  }
}

public struct FoldSplit<Primary: View, Secondary: View>: View {
  private let primary: Primary
  private let secondary: Secondary

  public init(@ViewBuilder primary: () -> Primary, @ViewBuilder secondary: () -> Secondary) {
    self.primary = primary()
    self.secondary = secondary()
  }

  public var body: some View {
    if #available(iOS 27.1, macOS 27.1, *) {
      SystemFoldSplit(primary: primary, secondary: secondary)
    } else {
      VStack(spacing: 0) {
        primary.frame(maxWidth: .infinity, maxHeight: .infinity)
        secondary.frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
  }
}

@available(iOS 27.1, macOS 27.1, *)
private struct SystemFoldSplit<Primary: View, Secondary: View>: View {
  let primary: Primary
  let secondary: Secondary

  var body: some View {
    ArrangementView {
      primary
    } secondary: {
      secondary
    }
    .arrangementViewStyle(.split)
  }
}

@available(iOS 27.1, macOS 27.1, *)
extension ReservedArea.Kind {
  var system: ReservedRegion.Kind {
    switch self {
    case .occlusion: .occlusion
    case .division: .division
    }
  }
}

@available(iOS 27.1, macOS 27.1, *)
extension HingeState {
  init?(_ status: DeviceHinge.Status?) {
    if status == .closed {
      self = .closed
    } else if status == .partiallyOpen {
      self = .partial
    } else if status == .fullyOpen {
      self = .open
    } else {
      return nil
    }
  }
}

private struct HingeStateReader: ViewModifier {
  let action: (HingeState?) -> Void

  func body(content: Content) -> some View {
    if #available(iOS 27.1, macOS 27.1, *) {
      content.onHingeChange { _, context in action(HingeState(context.hinge?.status)) }
    } else {
      content
    }
  }
}

private struct VerticalBarEdgeReader: ViewModifier {
  let action: (HorizontalEdge?) -> Void

  func body(content: Content) -> some View {
    if #available(iOS 27.1, macOS 27.1, *) {
      content.background { VerticalBarEdgeProbe(action: action) }
    } else {
      content
    }
  }
}

@available(iOS 27.1, macOS 27.1, *)
private struct VerticalBarEdgeProbe: View {
  @Environment(\.toolbarVerticalEdge) private var edge
  let action: (HorizontalEdge?) -> Void

  var body: some View {
    Color.clear
      .allowsHitTesting(false)
      .onChange(of: edge, initial: true) { _, edge in action(edge) }
  }
}
