import ExpoModulesCore
import MetalKit

final class WindowBackdropView: MetalSurface {
  struct Uniforms {
    var labA = SIMD4<Float>(0.27, 0.02, 0.0, 1)
    var labB = SIMD4<Float>(0.23, 0.02, 0.0, 1)
    var viewSize = SIMD2<Float>(0, 0)
    var direction = SIMD2<Float>(0, 1)
    var grainOpacity: Float = 0.1
    var grainScale: Float = 1
    var pad = SIMD2<Float>(0, 0)
  }

  private static let keepsHiddenDrawables = ProcessInfo.processInfo.environment["ARDIA_BACKDROP_DRAWABLES"] == "keep"

  private var uniforms = Uniforms()
  private var treatment: WindowTreatmentView?
  private var tint = WindowTreatmentView.Tint()
  private var custom = ThemeGradient()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    metalView.isPaused = true
    metalView.enableSetNeedsDisplay = true
  }

  func setColors(_ hex: [String]) {
    let rgba = hex.compactMap { SIMD4<Float>(hex: $0) }
    guard let first = rgba.first else { return }
    uniforms.labA = Self.oklab(first)
    uniforms.labB = Self.oklab(rgba.last ?? first)
    metalView.needsDisplay = true
  }

  func setVibrancy(_ on: Bool) {
    guard on != (treatment != nil) else { return }
    if on {
      let view = WindowTreatmentView(frame: bounds)
      view.tint = tint
      view.custom = custom.isEmpty ? nil : custom
      addSubview(view, positioned: .below, relativeTo: metalView)
      treatment = view
    } else {
      treatment?.removeFromSuperview()
      treatment = nil
    }
    if Self.keepsHiddenDrawables {
      metalView.isHidden = on
      if !on { metalView.needsDisplay = true }
    } else if on {
      metalView.isHidden = true
      metalView.autoResizeDrawable = false
      metalView.drawableSize = CGSize(width: 1, height: 1)
    } else {
      revealAtFullSize()
    }
  }

  private func revealAtFullSize() {
    metalView.drawableSize = convertToBacking(bounds).size
    metalView.autoResizeDrawable = true
    let layer = metalView.layer as? CAMetalLayer
    layer?.presentsWithTransaction = true
    metalView.draw()
    layer?.presentsWithTransaction = false
    metalView.isHidden = false
  }

  func setTint(_ update: (inout WindowTreatmentView.Tint) -> Void) {
    update(&tint)
    treatment?.tint = tint
  }

  func setCustom(_ update: (inout ThemeGradient) -> Void) {
    update(&custom)
    treatment?.custom = custom.isEmpty ? nil : custom
  }

  func setAngle(_ degrees: Double) {
    let r = Float(degrees) * .pi / 180
    uniforms.direction = SIMD2(sin(r), -cos(r))
    metalView.needsDisplay = true
  }

  func set(_ key: WritableKeyPath<Uniforms, Float>, _ value: Float) {
    uniforms[keyPath: key] = value
    metalView.needsDisplay = true
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    treatment?.frame = bounds
    if treatment == nil { metalView.needsDisplay = true }
  }

  override class var fragmentName: String { "backdropFragment" }

  override func encode(_ encoder: MTLRenderCommandEncoder, size: SIMD2<Float>) {
    uniforms.viewSize = size
    encoder.setFragmentBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 0)
  }

  static func oklab(_ c: SIMD4<Float>) -> SIMD4<Float> {
    func lin(_ x: Float) -> Float { x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4) }
    let r = lin(c.x), g = lin(c.y), b = lin(c.z)
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return SIMD4(
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
      c.w)
  }

  override class var shaderSource: String { backdropSource }
}

let backdropSource = """
struct BackdropUniforms {
  float4 labA;       // OKLab + alpha at the gradient start
  float4 labB;       // OKLab + alpha at the gradient end
  float2 viewSize;
  float2 direction;  // unit vector, uv space
  float grainOpacity;
  float grainScale;  // points per grain cell
  float2 pad;
};

// OKLab -> linear sRGB -> gamma sRGB. Same constants as Dia's gradientFragment.
static float3 oklabToSRGB(float3 lab) {
  float3 lms = float3(dot(lab, float3(1.0f, 0.3963377774f, 0.2158037573f)),
                      dot(lab, float3(1.0f, -0.1055613458f, -0.0638541728f)),
                      dot(lab, float3(1.0f, -0.0894841775f, -1.2914855480f)));
  lms = lms * lms * lms;
  float3 lin = float3(dot(lms, float3(4.0767416621f, -3.3077115913f, 0.2309699292f)),
                      dot(lms, float3(-1.2684380046f, 2.6097574011f, -0.3413193965f)),
                      dot(lms, float3(-0.0041960863f, -0.7034186147f, 1.7076147010f)));
  float3 a = abs(lin);
  float3 encoded = sign(lin) * (1.055f * pow(a, 1.0f / 2.4f) - 0.055f);
  return select(encoded, lin * 12.92f, a <= 0.0031308f);
}

static inline float grainHash(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031f);
  p3 += dot(p3, p3.yzx + 33.33f);
  return fract((p3.x + p3.y) * p3.z);
}

fragment float4 backdropFragment(FullscreenOut in [[stage_in]],
                                 constant BackdropUniforms &u [[buffer(0)]]) {
  float t = saturate(dot(in.uv - 0.5f, u.direction) + 0.5f);
  float4 lab = mix(u.labA, u.labB, t);
  float3 base = oklabToSRGB(lab.xyz);

  // Multiply-blend a grey grain tile: base * (1 - a * (1 - g)).
  float2 cell = floor(in.uv * u.viewSize / max(u.grainScale, 0.25f));
  float g = grainHash(cell);
  float3 rgb = base * (1.0f - u.grainOpacity * (1.0f - g));
  return float4(saturate(rgb), lab.w);
}
"""

struct ThemeGradient: Equatable {
  var colors: [SIMD4<Float>] = []
  var opacity: CGFloat = 1
  var baseAlpha: CGFloat = 0
  var grain: CGFloat = 0
  var texture = "grain"
  var appearance = "auto"
  var angle: CGFloat = ArcGradientLayer.defaultAngle

  var isEmpty: Bool { colors.isEmpty }

  static func parse(_ flat: [Double]) -> [SIMD4<Float>] {
    stride(from: 0, to: flat.count - 3, by: 4).prefix(3).map {
      SIMD4(Float(flat[$0]), Float(flat[$0 + 1]), Float(flat[$0 + 2]), Float(flat[$0 + 3]))
    }
  }

  var forcedAppearance: NSAppearance? {
    switch appearance {
    case "dark": return NSAppearance(named: .darkAqua)
    case "light": return NSAppearance(named: .aqua)
    default: return nil
    }
  }
}

final class ArcGradientLayer: CALayer {
  static let samples = 16
  static let reach: CGFloat = 0.75
  static let defaultAngle: CGFloat = 135
  private static let space = CGColorSpace(name: CGColorSpace.extendedSRGB)!
  private static let still: [String: CAAction] = [
    "bounds": NSNull(), "position": NSNull(), "colors": NSNull(), "locations": NSNull(), "startPoint": NSNull(),
    "endPoint": NSNull(), "opacity": NSNull(), "hidden": NSNull(),
  ]

  private let base = CAGradientLayer()
  private let overlay = CAGradientLayer()
  var flipped = false { didSet { setNeedsLayout() } }
  var angle = ArcGradientLayer.defaultAngle { didSet { if angle != oldValue { setNeedsLayout() } } }

  override init() {
    super.init()
    actions = Self.still
    for layer in [base, overlay] {
      layer.actions = Self.still
      addSublayer(layer)
    }
    overlay.isHidden = true
  }

  override init(layer: Any) { super.init(layer: layer) }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  func setColors(_ colors: [SIMD4<Float>]) {
    guard let first = colors.first else {
      base.colors = nil
      overlay.isHidden = true
      return
    }
    let second = colors.count > 1 ? colors[1] : first
    let a = Self.oklab(first), b = Self.oklab(second)
    let steps = colors.count > 1 ? Self.samples : 1
    base.colors = (0...steps).map { i -> CGColor in
      let t = Float(i) / Float(steps)
      return Self.cgColor(Self.srgb(a + (b - a) * t))
    }
    base.locations = (0...steps).map { NSNumber(value: Double($0) / Double(steps)) }
    if colors.count > 2 {
      let top = SIMD4(colors[2].x, colors[2].y, colors[2].z, 0)
      overlay.colors = [Self.cgColor(top), Self.cgColor(colors[2])]
      overlay.isHidden = false
    } else {
      overlay.isHidden = true
    }
  }

  override func layoutSublayers() {
    super.layoutSublayers()
    base.frame = bounds
    overlay.frame = bounds
    let w = max(bounds.width, 1), h = max(bounds.height, 1)
    let unit = { (u: CGFloat, v: CGFloat) in CGPoint(x: u, y: self.flipped ? v : 1 - v) }
    func place(_ layer: CAGradientLayer, degrees: CGFloat, reach: CGFloat, half: (CGFloat, CGFloat) -> CGFloat) {
      let r = degrees * .pi / 180, dx = sin(r), dy = -cos(r)
      let length = half(dx, dy)
      let ax = w * dx, ay = h * dy
      let scale = 2 * length * reach / (ax * ax + ay * ay)
      let u = 0.5 - length * dx / w, v = 0.5 - length * dy / h
      layer.startPoint = unit(u, v)
      layer.endPoint = unit(u + ax * scale, v + ay * scale)
    }
    place(base, degrees: angle, reach: Self.reach) { dx, dy in hypot(w * dx, h * dy) * hypot(w, h) / (2 * max(w, h)) }
    place(overlay, degrees: angle + 45, reach: 1) { dx, dy in (w * abs(dx) + h * abs(dy)) / 2 }
  }

  private static func cgColor(_ c: SIMD4<Float>) -> CGColor {
    CGColor(colorSpace: space, components: [CGFloat(c.x), CGFloat(c.y), CGFloat(c.z), CGFloat(min(max(c.w, 0), 1))])
      ?? CGColor(gray: 0.5, alpha: 1)
  }

  static func oklab(_ c: SIMD4<Float>) -> SIMD4<Float> {
    func lin(_ x: Float) -> Float { abs(x) <= 0.04045 ? x / 12.92 : (x < 0 ? -1 : 1) * pow((abs(x) + 0.055) / 1.055, 2.4) }
    let r = lin(c.x), g = lin(c.y), b = lin(c.z)
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return SIMD4(
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
      c.w)
  }

  static func srgb(_ lab: SIMD4<Float>) -> SIMD4<Float> {
    var l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z
    var m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z
    var s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z
    l = l * l * l
    m = m * m * m
    s = s * s * s
    let lin = SIMD3<Float>(
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    func encode(_ x: Float) -> Float { abs(x) <= 0.0031308 ? x * 12.92 : (x < 0 ? -1 : 1) * (1.055 * pow(abs(x), 1 / 2.4) - 0.055) }
    return SIMD4(encode(lin.x), encode(lin.y), encode(lin.z), lab.w)
  }
}

final class GrainLayer: CALayer {
  static let side = 128
  private static var patterns: [String: CGColor] = [:]

  var texture = "grain" { didSet { if texture != oldValue { backgroundColor = Self.pattern(texture) } } }

  override init() {
    super.init()
    actions = ["bounds": NSNull(), "position": NSNull(), "opacity": NSNull(), "backgroundColor": NSNull()]
    backgroundColor = Self.pattern(texture)
  }

  override init(layer: Any) { super.init(layer: layer) }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  static func pattern(_ texture: String) -> CGColor? {
    if let cached = patterns[texture] { return cached }
    guard let tile = tile(texture) else { return nil }
    let image = NSImage(cgImage: tile, size: NSSize(width: side / 2, height: side / 2))
    let color = NSColor(patternImage: image).cgColor
    patterns[texture] = color
    return color
  }

  static func tile(_ texture: String) -> CGImage? {
    let n = side
    var alpha = [Float](repeating: 0, count: n * n)
    var state: UInt32 = 0x9E3779B9
    func random() -> Float {
      state ^= state << 13
      state ^= state >> 17
      state ^= state << 5
      return Float(state % 10_000) / 10_000
    }
    func add(_ x: Int, _ y: Int, _ v: Float) {
      let i = ((y % n + n) % n) * n + (x % n + n) % n
      alpha[i] = min(1, alpha[i] + v)
    }
    switch texture {
    case "sand":
      for i in 0..<(n * n) { alpha[i] = random() * 0.25 }
      for _ in 0..<(n * n / 18) {
        let x = Int(random() * Float(n)), y = Int(random() * Float(n)), v = 0.5 + random() * 0.5
        add(x, y, v)
        add(x + 1, y, v * 0.6)
        add(x, y + 1, v * 0.6)
        add(x + 1, y + 1, v * 0.4)
      }
    case "denim":
      for y in 0..<n {
        for x in 0..<n {
          let twill: Float = (x + y) % 4 < 2 ? 0.75 : 0.15
          alpha[y * n + x] = min(1, twill * (0.6 + random() * 0.4) + (y % 2 == 0 ? 0.08 : 0))
        }
      }
    case "tweed":
      for i in 0..<(n * n) { alpha[i] = random() * 0.15 }
      for _ in 0..<(n * n / 40) {
        let x = Int(random() * Float(n)), y = Int(random() * Float(n)), v = 0.4 + random() * 0.6
        let horizontal = random() < 0.5
        for k in 0..<(3 + Int(random() * 4)) { horizontal ? add(x + k, y, v) : add(x, y + k, v) }
      }
    default:
      for i in 0..<(n * n) {
        let u = random()
        alpha[i] = u * u
      }
    }
    var bytes = [UInt8](repeating: 0, count: n * n * 4)
    for i in 0..<(n * n) { bytes[i * 4 + 3] = UInt8(min(255, alpha[i] * 255)) }
    guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
    return CGImage(width: n, height: n, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: n * 4,
                   space: CGColorSpace(name: CGColorSpace.sRGB)!,
                   bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                   provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
  }
}

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

final class ThemeSwatchView: ExpoView {
  private let themeLayer = ArcGradientLayer()
  private let grain = GrainLayer()
  private let pad = CALayer()
  private var padLightness: Double = -1

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    pad.actions = ["bounds": NSNull(), "position": NSNull(), "contents": NSNull(), "hidden": NSNull()]
    for sub in [themeLayer, pad, grain] as [CALayer] { layer?.addSublayer(sub) }
    pad.contentsGravity = .resize
    pad.isHidden = true
    grain.opacity = 0
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func setColors(_ flat: [Double]) {
    themeLayer.setColors(ThemeGradient.parse(flat))
  }

  func setGrain(_ value: Double) {
    grain.opacity = Float(min(max(value, 0), 1))
  }

  func setTexture(_ value: String) {
    grain.texture = value
  }

  func setAngle(_ degrees: Double) {
    themeLayer.angle = CGFloat(degrees)
  }

  func setPadLightness(_ value: Double) {
    guard value != padLightness else { return }
    padLightness = value
    pad.contents = value < 0 ? nil : Self.padImage(lightness: value)
    pad.isHidden = value < 0
  }

  override func layout() {
    super.layout()
    for sub in [themeLayer, pad, grain] as [CALayer] { sub.frame = bounds }
    themeLayer.flipped = isFlipped
  }

  static func hsl(_ h: Double, _ s: Double, _ l: Double) -> (Double, Double, Double) {
    if s == 0 { return (l, l, l) }
    let q = l < 0.5 ? l * (1 + s) : l + s - l * s
    let p = 2 * l - q
    func channel(_ t0: Double) -> Double {
      var t = t0
      if t < 0 { t += 1 }
      if t > 1 { t -= 1 }
      if t < 1.0 / 6 { return p + (q - p) * 6 * t }
      if t < 0.5 { return q }
      if t < 2.0 / 3 { return p + (q - p) * (2.0 / 3 - t) * 6 }
      return p
    }
    return (channel(h + 1.0 / 3), channel(h), channel(h - 1.0 / 3))
  }

  static func padImage(lightness: Double, side: Int = 192) -> CGImage? {
    var bytes = [UInt8](repeating: 255, count: side * side * 4)
    for y in 0..<side {
      for x in 0..<side {
        let dx = (Double(x) + 0.5) / Double(side) - 0.5
        let dy = (Double(y) + 0.5) / Double(side) - 0.5
        var hue = atan2(dy, dx) / (2 * .pi)
        if hue < 0 { hue += 1 }
        let sat = min(1, (dx * dx + dy * dy).squareRoot() / 0.5)
        let (r, g, b) = hsl(hue, sat, lightness)
        let i = (y * side + x) * 4
        bytes[i] = UInt8(max(0, min(255, (r * 255).rounded())))
        bytes[i + 1] = UInt8(max(0, min(255, (g * 255).rounded())))
        bytes[i + 2] = UInt8(max(0, min(255, (b * 255).rounded())))
      }
    }
    guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
    return CGImage(width: side, height: side, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: side * 4,
                   space: CGColorSpace(name: CGColorSpace.sRGB)!,
                   bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                   provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
  }
}
