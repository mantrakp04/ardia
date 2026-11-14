import OSLog
import SwiftUI
import UIKit

nonisolated enum ScreenLayout: Equatable, Sendable {
  case phone
  case column(SideColumn)
  case wide
  case split(Fold)

  struct SideColumn: Equatable, Sendable {
    var edge: HorizontalEdge
    var inset: CGFloat

    var contentReserve: CGFloat { inset }

    func contentWidth(in width: CGFloat) -> CGFloat { max(width - contentReserve, 0) }

    func centerX(in width: CGFloat) -> CGFloat {
      let fromEdge = min(DuoLayout.columnAxis, inset - DuoLayout.columnButton / 2)
      return edge == .trailing ? width - fromEdge : fromEdge
    }

    var top: CGFloat { DuoLayout.columnTop }
  }

  struct Fold: Equatable, Sendable {
    var top: CGFloat
    var bottom: CGFloat
  }

  static let wideMinimum: CGFloat = 600
  static let columnMinimumInset: CGFloat = 60

  var column: SideColumn? {
    if case .column(let column) = self { return column }
    return nil
  }

  var isWide: Bool { self == .wide }

  var fold: Fold? {
    if case .split(let fold) = self { return fold }
    return nil
  }

  static func resolve(_ space: ScreenSpace) -> ScreenLayout {
    if space.hinge == .partiallyOpen, let fold = space.horizontalFold {
      return .split(fold)
    }
    if space.size.width >= wideMinimum, space.size.height >= wideMinimum {
      return .wide
    }
    if let edge = space.verticalBarEdge ?? space.oneSidedEdge {
      let inset = edge == .leading ? space.safeInsets.leading : space.safeInsets.trailing
      if inset >= columnMinimumInset { return .column(SideColumn(edge: edge, inset: columnInset(inset))) }
    }
    return .phone
  }

  static func columnInset(_ inset: CGFloat) -> CGFloat {
    (inset / columnInsetStep).rounded(.up) * columnInsetStep
  }

  static let columnInsetStep: CGFloat = 12
}

nonisolated struct ScreenSpace: Equatable, Sendable {
  enum Hinge: Equatable, Sendable {
    case none
    case closed
    case partiallyOpen
    case fullyOpen
  }

  var size: CGSize = .zero
  var safeInsets = EdgeInsets()
  var divisions: [CGRect] = []
  var hinge = Hinge.none
  var verticalBarEdge: HorizontalEdge?

  var oneSidedEdge: HorizontalEdge? {
    let leading = safeInsets.leading
    let trailing = safeInsets.trailing
    if trailing >= ScreenLayout.columnMinimumInset, leading == 0, safeInsets.top == 0 { return .trailing }
    if leading >= ScreenLayout.columnMinimumInset, trailing == 0, safeInsets.top == 0 { return .leading }
    return nil
  }

  var horizontalFold: ScreenLayout.Fold? {
    let band = divisions.first { $0.width > $0.height && $0.width >= size.width * 0.5 }
    return band.map { ScreenLayout.Fold(top: $0.minY + safeInsets.top, bottom: $0.maxY + safeInsets.top) }
  }
}

extension EnvironmentValues {
  @Entry var screenLayout = ScreenLayout.phone
}

extension View {
  func readsScreenLayout(_ layout: Binding<ScreenLayout>) -> some View {
    modifier(ScreenLayoutReader(layout: layout))
  }
}

private struct ScreenLayoutReader: ViewModifier {
  @Binding var layout: ScreenLayout
  @State private var space = ScreenSpace()

  func body(content: Content) -> some View {
    content
      .background {
        Color.clear
          .modifier(GeometryProbe(space: $space))
          .ignoresSafeArea(.keyboard)
          .background { VerticalBarProbe(edge: $space.verticalBarEdge) }
          .modifier(HingeProbe(hinge: $space.hinge))
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
      .onChange(of: space, initial: true) { _, space in
        let next = DuoCanvas.forcedLayout(for: space) ?? ScreenLayout.resolve(space)
        DuoLog.space(space, next)
        if next != layout { layout = next }
      }
  }
}

private struct GeometryProbe: ViewModifier {
  @Binding var space: ScreenSpace

  func body(content: Content) -> some View {
    if #available(iOS 27.1, *) {
      content.onGeometryChange(for: ProbedGeometry.self) { proxy in
        ProbedGeometry(
          size: proxy.size,
          safeInsets: proxy.safeAreaInsets,
          divisions: proxy.reservedRegions(kind: .division, layoutDirectionBehavior: .fixed).filter(\.isActive).map(\.frame)
        )
      } action: { apply($0) }
    } else {
      content.onGeometryChange(for: ProbedGeometry.self) { proxy in
        ProbedGeometry(size: proxy.size, safeInsets: proxy.safeAreaInsets, divisions: [])
      } action: { apply($0) }
    }
  }

  private func apply(_ geometry: ProbedGeometry) {
    space.size = geometry.size
    space.safeInsets = geometry.safeInsets
    space.divisions = geometry.divisions
  }
}

nonisolated private struct ProbedGeometry: Equatable {
  var size: CGSize
  var safeInsets: EdgeInsets
  var divisions: [CGRect]
}

private struct HingeProbe: ViewModifier {
  @Binding var hinge: ScreenSpace.Hinge

  func body(content: Content) -> some View {
    if #available(iOS 27.1, *) {
      content.onHingeChange { _, context in
        hinge = Self.hinge(context.hinge)
      }
    } else {
      content
    }
  }

  @available(iOS 27.1, *)
  private static func hinge(_ hinge: DeviceHinge?) -> ScreenSpace.Hinge {
    guard let status = hinge?.status else { return .none }
    switch status {
    case .closed: return .closed
    case .partiallyOpen: return .partiallyOpen
    case .fullyOpen: return .fullyOpen
    default: return .none
    }
  }
}

private struct VerticalBarProbe: UIViewRepresentable {
  @Binding var edge: HorizontalEdge?

  func makeUIView(context: Context) -> VerticalBarProbeView {
    let view = VerticalBarProbeView()
    view.onChange = { edge = $0 }
    return view
  }

  func updateUIView(_ view: VerticalBarProbeView, context: Context) {
    view.onChange = { edge = $0 }
  }
}

final class VerticalBarProbeView: UIView {
  var onChange: ((HorizontalEdge?) -> Void)?
  private var reported: HorizontalEdge??

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    if #available(iOS 27.1, *) {
      registerForTraitChanges(UITraitCollection.systemTraitsAffectingVerticalBarEdge) { (view: VerticalBarProbeView, _: UITraitCollection) in
        view.report()
      }
    }
  }

  required init?(coder: NSCoder) { nil }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    report()
  }

  private func report() {
    let edge = currentEdge
    guard reported != .some(edge) else { return }
    reported = .some(edge)
    let onChange = onChange
    Task { @MainActor in onChange?(edge) }
  }

  private var currentEdge: HorizontalEdge? {
    guard #available(iOS 27.1, *) else { return nil }
    switch traitCollection.verticalBarEdge {
    case .leading: return .leading
    case .trailing: return .trailing
    default: return nil
    }
  }
}

enum DuoLog {
  private static let logger = Logger(subsystem: "com.ardia.browser.ios", category: "duo")

  static func space(_ space: ScreenSpace, _ layout: ScreenLayout) {
    #if DEBUG
    let insets = space.safeInsets
    logger.notice("space size=\(space.size.width, privacy: .public)x\(space.size.height, privacy: .public) insets t\(insets.top, privacy: .public) l\(insets.leading, privacy: .public) b\(insets.bottom, privacy: .public) r\(insets.trailing, privacy: .public) hinge=\(String(describing: space.hinge), privacy: .public) bar=\(String(describing: space.verticalBarEdge), privacy: .public) divisions=\(String(describing: space.divisions), privacy: .public) layout=\(String(describing: layout), privacy: .public)")
    #endif
  }
}
