import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class GlassEffect: ExpoView {
  private let effect: NSView
  private let tintLayer = CALayer()
  private let content = GlassEffectContent()
  var cornerRadius: Double = 0 { didSet { apply() } }
  var tint: NSColor? { didSet { apply() } }
  var clear = false { didSet { apply() } }

  required init(appContext: AppContext? = nil) {
    if #available(macOS 26.0, *) {
      effect = NSGlassEffectView()
    } else {
      let material = NSVisualEffectView()
      material.material = .sidebar
      material.blendingMode = .behindWindow
      material.state = .followsWindowActiveState
      material.wantsLayer = true
      tintLayer.actions = ["backgroundColor": NSNull(), "bounds": NSNull(), "position": NSNull()]
      material.layer?.addSublayer(tintLayer)
      effect = material
    }
    super.init(appContext: appContext)
    addSubview(effect)
    apply()
  }

  private func apply() {
    if #available(macOS 26.0, *), let glass = effect as? NSGlassEffectView {
      glass.cornerRadius = cornerRadius
      glass.tintColor = tint
      glass.style = clear ? .clear : .regular
      return
    }
    effect.layer?.cornerRadius = cornerRadius
    effect.layer?.cornerCurve = .continuous
    effect.layer?.masksToBounds = cornerRadius > 0
    tintLayer.frame = effect.bounds
    tintLayer.backgroundColor = tint?.cgColor
  }

  override func didUpdateReactSubviews() {
    guard #available(macOS 26.0, *), let glass = effect as? NSGlassEffectView else { return super.didUpdateReactSubviews() }
    let wanted: [NSView] = reactSubviews() ?? []
    if !wanted.isEmpty && glass.contentView !== content {
      content.frame = glass.bounds
      glass.contentView = content
    }
    if content.subviews != wanted { content.subviews = wanted }
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    effect.frame = bounds
    if content.superview != nil { content.frame = effect.bounds }
    if tintLayer.superlayer != nil { tintLayer.frame = effect.bounds }
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

private final class GlassEffectContent: NSView {
  override var isFlipped: Bool { true }
}
