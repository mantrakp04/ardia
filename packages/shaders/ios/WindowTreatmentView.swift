import AppKit

final class WindowTreatmentView: NSView {
  struct Tint: Equatable {
    var color = NSColor(displayP3Red: 0.5, green: 0.5, blue: 0.5, alpha: 1)
    var alpha: CGFloat = 0.36
    var lightness: CGFloat = 0.25
  }

  static let inactiveGrain: CGFloat = 0.25
  static var holdsKeyLook = false {
    didSet { if holdsKeyLook != oldValue { NotificationCenter.default.post(name: WindowActivity.changed, object: nil) } }
  }

  var tint = Tint() { didSet { if tint != oldValue { updateTint() } } }
  var custom: ThemeGradient? {
    didSet {
      guard custom != oldValue else { return }
      if custom?.appearance != oldValue?.appearance { appearance = custom?.forcedAppearance }
      if custom?.colors != oldValue?.colors { themeLayer.setColors(custom?.colors ?? []) }
      themeLayer.angle = custom?.angle ?? ArcGradientLayer.defaultAngle
      updateState()
      updateAppearance()
      updateTint()
    }
  }

  private let blur = NSVisualEffectView()
  private let overlay = NSView()
  private let baseTint = CALayer()
  private let gradient = CAGradientLayer()
  private let themeLayer = ArcGradientLayer()
  private let grain = GrainLayer()
  private lazy var activity = WindowActivity { [weak self] in self?.updateGrain() }

  override init(frame: NSRect) {
    super.init(frame: frame)
    blur.blendingMode = .behindWindow
    blur.isEmphasized = true
    updateState()
    NotificationCenter.default.addObserver(self, selector: #selector(updateState), name: WindowActivity.changed, object: nil)
    overlay.wantsLayer = true
    for layer in [baseTint, gradient, themeLayer, grain] as [CALayer] { overlay.layer?.addSublayer(layer) }
    themeLayer.isHidden = true
    grain.opacity = 0
    gradient.startPoint = CGPoint(x: 0.5, y: 0)
    gradient.endPoint = CGPoint(x: 0.5, y: 1)
    for layer in [baseTint, gradient] as [CALayer] {
      layer.actions = ["bounds": NSNull(), "position": NSNull(), "backgroundColor": NSNull(), "colors": NSNull(), "opacity": NSNull(), "hidden": NSNull()]
    }
    addSubview(blur)
    addSubview(overlay)
    updateAppearance()
    updateTint()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func layout() {
    super.layout()
    blur.frame = bounds
    overlay.frame = bounds
    for layer in [baseTint, gradient, themeLayer, grain] as [CALayer] { layer.frame = overlay.bounds }
    themeLayer.flipped = overlay.isFlipped
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    activity.attach(to: window)
    updateGrain()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    needsLayout = true
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    updateAppearance()
  }

  private var showsKeyLook: Bool { WindowActivity.override == true || (Self.holdsKeyLook && custom != nil) }

  @objc private func updateState() {
    blur.state = showsKeyLook ? .active : .followsWindowActiveState
  }

  private var isDark: Bool { effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }

  private func updateAppearance() {
    let dark = isDark
    blur.material = NSVisualEffectView.Material(rawValue: dark ? 29 : 13) ?? .hudWindow
    gradient.opacity = dark ? 0.5 : 0.75
    let base = dark ? NSColor(white: 0, alpha: 0.4) : NSColor(white: 1, alpha: 0.8)
    baseTint.backgroundColor = (custom.map { (dark ? NSColor.black : NSColor.white).withAlphaComponent($0.baseAlpha) } ?? base).cgColor
  }

  private func updateGrain() {
    guard let custom else { return grain.opacity = 0 }
    let active = activity.isActive || showsKeyLook
    grain.texture = custom.texture
    grain.opacity = Float(min(max(custom.grain, 0), 1) * (active ? 1 : Self.inactiveGrain))
  }

  private func updateTint() {
    gradient.isHidden = custom != nil
    themeLayer.isHidden = custom == nil
    updateGrain()
    if let custom {
      themeLayer.opacity = Float(custom.opacity)
      return
    }
    let color = tint.color.usingColorSpace(.displayP3) ?? tint.color
    let lighter = Self.adjustingLightness(color, by: tint.lightness)
    gradient.colors = [lighter, color].map { $0.withAlphaComponent(tint.alpha).cgColor }
  }

  static func adjustingLightness(_ c: NSColor, by delta: CGFloat) -> NSColor {
    let r = c.redComponent, g = c.greenComponent, b = c.blueComponent
    let maxC = max(r, g, b), minC = min(r, g, b)
    var h: CGFloat = 0, s: CGFloat = 0
    let l = (maxC + minC) / 2
    if maxC != minC {
      let d = maxC - minC
      s = l > 0.5 ? d / (2 - maxC - minC) : d / (maxC + minC)
      h = maxC == r ? (g - b) / d + (g < b ? 6 : 0) : maxC == g ? (b - r) / d + 2 : (r - g) / d + 4
      h /= 6
    }
    let l2 = min(max(l + delta, 0), 1)
    func channel(_ p: CGFloat, _ q: CGFloat, _ t0: CGFloat) -> CGFloat {
      var t = t0
      if t < 0 { t += 1 }
      if t > 1 { t -= 1 }
      if t < 1.0 / 6 { return p + (q - p) * 6 * t }
      if t < 0.5 { return q }
      if t < 2.0 / 3 { return p + (q - p) * (2.0 / 3 - t) * 6 }
      return p
    }
    if s == 0 { return NSColor(displayP3Red: l2, green: l2, blue: l2, alpha: c.alphaComponent) }
    let q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s
    let p = 2 * l2 - q
    return NSColor(displayP3Red: channel(p, q, h + 1.0 / 3), green: channel(p, q, h), blue: channel(p, q, h - 1.0 / 3), alpha: c.alphaComponent)
  }
}
