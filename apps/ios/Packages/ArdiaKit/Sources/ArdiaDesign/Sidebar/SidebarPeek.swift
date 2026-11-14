import SwiftUI

public enum SidebarPeek {
  public enum PointerZone: Equatable, Sendable {
    case reveal
    case hold
    case outside
  }

  public static let pointerStrip = SidebarMetrics.touch(8)
  public static let holdSlack = SidebarMetrics.touch(24)
  public static let dwell: Duration = .zero
  public static let leaveDelay: Duration = .milliseconds(120)
  public static let touchZone = SidebarMetrics.cardInset
  public static let dragSlop = Tokens.Space.m

  public enum Input: Sendable {
    case pointer
    case touch
  }

  public static func allowsPeek(placement: SidebarPlacement, isEnabled: Bool) -> Bool {
    isEnabled && placement == .hidden
  }

  public static func startsPeek(_ input: Input, at x: CGFloat, windowWidth: CGFloat, edge: HorizontalEdge, placement: SidebarPlacement, isEnabled: Bool) -> Bool {
    guard allowsPeek(placement: placement, isEnabled: isEnabled) else { return false }
    switch input {
    case .pointer: return pointerZone(x: x, windowWidth: windowWidth, edge: edge, sidebarWidth: 0, isPeeking: false) == .reveal
    case .touch: return startsEdgeSwipe(x: x, windowWidth: windowWidth, edge: edge)
    }
  }

  public static func offersEdgeSetting(layout: ChromeLayout, hinge: HingeState?, isTablet: Bool) -> Bool {
    isTablet || hinge != nil || layout.hasSidebar
  }

  public static func panelRadius(cardRadius: CGFloat) -> CGFloat {
    min(SidebarMetrics.touch(Tokens.Radius.panel), cardRadius)
  }

  static func distanceFromEdge(x: CGFloat, windowWidth: CGFloat, edge: HorizontalEdge) -> CGFloat {
    edge == .leading ? x : windowWidth - x
  }

  public static func pointerZone(x: CGFloat, windowWidth: CGFloat, edge: HorizontalEdge, sidebarWidth: CGFloat, isPeeking: Bool) -> PointerZone {
    let inward = distanceFromEdge(x: x, windowWidth: windowWidth, edge: edge)
    guard inward >= 0 else { return .outside }
    if isPeeking { return inward < SidebarMetrics.cardInset + sidebarWidth + holdSlack ? .hold : .outside }
    return inward < pointerStrip ? .reveal : .outside
  }

  public static func startsEdgeSwipe(x: CGFloat, windowWidth: CGFloat, edge: HorizontalEdge) -> Bool {
    let inward = distanceFromEdge(x: x, windowWidth: windowWidth, edge: edge)
    return inward >= 0 && inward < touchZone
  }

  public static func openProgress(from start: CGFloat, translation: CGFloat, width: CGFloat, edge: HorizontalEdge) -> CGFloat {
    guard width > 0 else { return start }
    let inward = edge == .leading ? translation : -translation
    return min(max(start + inward / width, 0), 1)
  }

  public static func settlesOpen(progress: CGFloat, velocity: CGFloat, width: CGFloat, edge: HorizontalEdge) -> Bool {
    let inward = edge == .leading ? velocity : -velocity
    if inward <= -PagerPhysics.opposingVelocity { return false }
    guard width > 0 else { return progress >= PagerPhysics.commitFraction }
    return progress + inward * PagerPhysics.projectionTime / width >= PagerPhysics.commitFraction
  }

  public static func isSwipeBack(translation: CGSize, edge: HorizontalEdge) -> Bool {
    let outward = edge == .leading ? -translation.width : translation.width
    return outward > 0 && abs(translation.width) > abs(translation.height)
  }
}
