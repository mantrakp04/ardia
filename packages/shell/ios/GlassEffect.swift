import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class GlassEffect: ExpoView {
  private let effect: NSView
  private let tintLayer = CALayer()
  private let content = GlassEffectContent()
  private weak var group: GlassGroup?
  var cornerRadius: Double = 0 { didSet { apply() } }
  var tint: NSColor? { didSet { apply() } }
  var clear = false { didSet { apply() } }

  required init(appContext: AppContext? = nil) {
    if #available(macOS 26.0, *), LiquidGlass.available {
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

  var hostedGlass: NSView? { group == nil ? nil : effect }

  private func apply() {
    if #available(macOS 26.0, *), let glass = effect as? NSGlassEffectView {
      LiquidGlass.apply(glass, cornerRadius: cornerRadius, tint: tint, clear: clear)
      return
    }
    effect.layer?.cornerRadius = cornerRadius
    effect.layer?.cornerCurve = .continuous
    effect.layer?.masksToBounds = cornerRadius > 0
    tintLayer.frame = effect.bounds
    tintLayer.backgroundColor = tint?.cgColor
  }

  private var enclosingGroup: GlassGroup? {
    guard window != nil else { return nil }
    var view = superview
    while let next = view {
      if let found = next as? GlassGroup { return found.hostsGlass ? found : nil }
      view = next.superview
    }
    return nil
  }

  private func joinGroup() {
    let next = enclosingGroup
    guard next !== group else { return }
    group?.release(self, glass: effect)
    group = next
    if let next {
      next.adopt(self, glass: effect)
      effect.appearance = effectiveAppearance
    } else if effect.superview !== self {
      effect.frame = bounds
      effect.isHidden = false
      effect.appearance = nil
      addSubview(effect, positioned: .below, relativeTo: subviews.first)
    }
    rehost()
  }

  private func rehost() {
    let wanted: [NSView] = reactSubviews() ?? []
    guard #available(macOS 26.0, *), let glass = effect as? NSGlassEffectView, LiquidGlass.hostsContent(glass), group == nil, !wanted.isEmpty else {
      if !content.subviews.isEmpty { content.subviews = [] }
      for view in wanted where view.superview !== self { addSubview(view) }
      return
    }
    if glass.contentView !== content {
      content.frame = glass.bounds
      glass.contentView = content
    }
    if content.subviews != wanted { content.subviews = wanted }
  }

  override func didUpdateReactSubviews() {
    if group == nil, effect is NSVisualEffectView { return super.didUpdateReactSubviews() }
    rehost()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    joinGroup()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    if group != nil { effect.appearance = effectiveAppearance }
  }

  override func setFrameOrigin(_ newOrigin: NSPoint) {
    super.setFrameOrigin(newOrigin)
    group?.place(self)
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    if group == nil {
      effect.frame = bounds
    } else {
      group?.place(self)
    }
    if content.superview != nil { content.frame = effect.bounds }
    if tintLayer.superlayer != nil { tintLayer.frame = effect.bounds }
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

private final class GlassEffectContent: NSView {
  override var isFlipped: Bool { true }
}
