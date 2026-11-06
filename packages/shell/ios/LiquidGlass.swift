import AppKit

enum LiquidGlass {
  static let available: Bool = {
    guard #available(macOS 26.0, *) else { return false }
    return NSClassFromString("NSGlassEffectView") != nil
  }()

  static let groupsGlass: Bool = {
    guard #available(macOS 26.0, *), available, NSClassFromString("NSGlassEffectContainerView") != nil else { return false }
    return NSGlassEffectContainerView.instancesRespond(to: #selector(setter: NSGlassEffectContainerView.contentView))
  }()

  @available(macOS 26.0, *)
  static func apply(_ glass: NSGlassEffectView, cornerRadius: Double, tint: NSColor?, clear: Bool) {
    if glass.responds(to: #selector(setter: NSGlassEffectView.cornerRadius)) { glass.cornerRadius = cornerRadius }
    if glass.responds(to: #selector(setter: NSGlassEffectView.tintColor)) { glass.tintColor = tint }
    if glass.responds(to: #selector(setter: NSGlassEffectView.style)) { glass.style = clear ? .clear : .regular }
  }

  @available(macOS 26.0, *)
  static func hostsContent(_ glass: NSGlassEffectView) -> Bool {
    glass.responds(to: #selector(setter: NSGlassEffectView.contentView))
  }
}
