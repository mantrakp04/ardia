import Foundation

public struct BarCollapse: Sendable, Equatable {
  public enum Event: Sendable, Equatable {
    case scrolledDown
    case scrolledUp
    case reachedTop
    case tapped
    case pageChanged
  }

  public private(set) var isCompact: Bool

  public init(isCompact: Bool = false) {
    self.isCompact = isCompact
  }

  public func applying(_ event: Event, allowsCompact: Bool) -> BarCollapse {
    guard allowsCompact else { return BarCollapse(isCompact: false) }
    switch event {
    case .scrolledDown: return BarCollapse(isCompact: true)
    case .scrolledUp, .reachedTop, .tapped, .pageChanged: return BarCollapse(isCompact: false)
    }
  }

  public static func allowsCompact(settingIsOn: Bool, isLandscape: Bool, axis: BottomBarGeometry.Axis) -> Bool {
    guard axis == .horizontal else { return false }
    return settingIsOn || isLandscape
  }
}

public enum BarPresence: Sendable, Equatable {
  case full
  case compact
  case hidden

  public static func resolve(collapse: BarCollapse, isShown: Bool) -> BarPresence {
    guard isShown else { return .hidden }
    return collapse.isCompact ? .compact : .full
  }

  public var isInteractive: Bool { self != .hidden }
}
