import SwiftUI

public enum InterfaceStyle: String, CaseIterable, Sendable {
  case glass
  case classic

  public func resolved(reduceTransparency: Bool) -> InterfaceStyle {
    reduceTransparency ? .classic : self
  }
}

public enum GlassState: String, CaseIterable, Sendable {
  case rest
  case lit
  case pressed
  case active

  var gain: Double {
    switch self {
    case .rest: 1
    case .lit: 2
    case .pressed: 3
    case .active: 6
    }
  }

  public var classicFill: SchemeColor {
    switch self {
    case .rest: Tokens.Role.pinnedResting
    case .lit: Tokens.Role.tabHover
    case .pressed: Tokens.Role.tabPressed
    case .active: Tokens.Role.pinnedSelectedFill
    }
  }

  public func classicFill(_ placement: GlassPlacement) -> SchemeColor {
    switch placement {
    case .backdrop: classicFill
    case .overContent: overContentRole.composited(over: Tokens.Role.panel)
    }
  }

  private var overContentRole: SchemeColor {
    switch self {
    case .rest: Tokens.Role.control
    case .lit: Tokens.Role.controlHover
    case .pressed, .active: Tokens.Role.controlPressed
    }
  }
}

public enum GlassPlacement: String, CaseIterable, Sendable {
  case backdrop
  case overContent
}

public enum GlassTint {
  public static let defaultAmount = 0.15
  static let panelProfileShare = 0.15
  static let liftPerShare = 0.25
  static let controlFillShare = 0.15
  static let panelTintShare = 0.85
  static let panelGlassStrength = 0.5

  public static func control(_ state: GlassState, dark: Bool, amount: Double) -> TokenColor {
    let share = min(max(amount, 0), 1)
    let resting = Tokens.Role.pinnedResting.resolved(dark: dark)
    let fill = resting.withOpacity(min(1, resting.opacity * controlFillShare * state.gain + share * liftPerShare))
    return share > 0 ? fill.mixed(toward: Tokens.Role.accent.resolved(dark: dark), by: share) : fill
  }

  public static func panel(dark: Bool, look: ProfileLook, amount: Double) -> TokenColor {
    let base = Tokens.Role.panel.resolved(dark: dark)
    let glassy = 1 - min(1, base.opacity * panelTintShare)
    let fill = base.withOpacity(1 - glassy * panelGlassStrength)
    return amount > 0 ? fill.mixed(toward: look.glassTarget, by: panelProfileShare) : fill
  }
}

extension ProfileLook {
  var glassTarget: TokenColor { TokenColor(red: tint.red, green: tint.green, blue: tint.blue) }
}

public extension EnvironmentValues {
  @Entry var interfaceStyle: InterfaceStyle = .glass
  @Entry var glassTintAmount: Double = GlassTint.defaultAmount
  @Entry var glassPlacement: GlassPlacement = .backdrop
}

extension EnvironmentValues {
  @Entry var glassNamespace: Namespace.ID? = nil
}
