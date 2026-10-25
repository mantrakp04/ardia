import AppKit
import ExpoModulesCore

public class FolderIconModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaFolderIcon")

    View(FolderIconView.self) {
      Prop("open") { (view: FolderIconView, open: Bool) in view.wantsOpen = open }
      Prop("stroke") { (view: FolderIconView, hex: String) in view.palette.stroke = NSColor(hex: hex) ?? view.palette.stroke }
      Prop("face") { (view: FolderIconView, hex: String) in view.palette.face = NSColor(hex: hex) ?? view.palette.face }
      Prop("insideTop") { (view: FolderIconView, hex: String) in view.palette.insideTop = NSColor(hex: hex) ?? view.palette.insideTop }
      Prop("insideBottom") { (view: FolderIconView, hex: String) in view.palette.insideBottom = NSColor(hex: hex) ?? view.palette.insideBottom }
      OnViewDidUpdateProps { (view: FolderIconView) in view.propsDidUpdate() }
    }
  }
}

enum FolderArt {
  typealias Polygon = [CGPoint]

  static let rearClosed = polygon([(26, 88), (26, 21), (30, 18), (54, 18), (66, 26), (92, 26), (96, 30), (96, 88)])
  static let rearOpen = polygon([(31, 88), (15, 31), (19, 28), (37, 28), (47, 34), (67, 34), (71, 38), (91, 88)])
  static let frontClosed = polygon([(26, 35), (96, 35), (96, 88), (26, 88)])
  static let frontOpen = polygon([(49, 42), (107, 42), (91, 88), (31, 88)])
  static let rearCornerRadius: CGFloat = 5
  static let frontCornerRadius: CGFloat = 6
  static let strokeWidth: CGFloat = 6
  static let hingeY: CGFloat = 88
  static let closedCenter = CGPoint(x: 61, y: 53)
  static let unitsPerSide: CGFloat = 81
  static let bleed: CGFloat = 0.25
  static let duration: CFTimeInterval = 0.3

  static func polygon(_ points: [(CGFloat, CGFloat)]) -> Polygon { points.map { CGPoint(x: $0.0, y: $0.1) } }

  static func smoothstep(_ p: Double) -> CGFloat { CGFloat(p * p * (3 - 2 * p)) }

  static func mix(_ a: Polygon, _ b: Polygon, _ u: CGFloat) -> Polygon {
    zip(a, b).map { CGPoint(x: $0.x + ($1.x - $0.x) * u, y: $0.y + ($1.y - $0.y) * u) }
  }

  static func roundedPath(_ points: Polygon, radius: CGFloat) -> CGPath {
    let path = CGMutablePath()
    for (i, v) in points.enumerated() {
      let prev = points[(i + points.count - 1) % points.count]
      let next = points[(i + 1) % points.count]
      let d1 = hypot(prev.x - v.x, prev.y - v.y)
      let d2 = hypot(next.x - v.x, next.y - v.y)
      let a = min(radius, d1 / 3) / d1
      let b = min(radius, d2 / 3) / d2
      let before = CGPoint(x: v.x + (prev.x - v.x) * a, y: v.y + (prev.y - v.y) * a)
      let after = CGPoint(x: v.x + (next.x - v.x) * b, y: v.y + (next.y - v.y) * b)
      if i == 0 { path.move(to: before) } else { path.addLine(to: before) }
      path.addQuadCurve(to: after, control: v)
    }
    path.closeSubpath()
    return path
  }
}

struct FolderPalette {
  var stroke = NSColor(hex: "#443aff")!
  var face = NSColor(hex: "#f4f3ff")!
  var insideTop = NSColor(hex: "#bfbcff")!
  var insideBottom = NSColor(hex: "#8781ff")!
}

final class FolderArtLayer: CALayer {
  var progress: Double = 0
  var palette = FolderPalette()

  override init() {
    super.init()
    needsDisplayOnBoundsChange = true
  }

  override init(layer: Any) {
    super.init(layer: layer)
    if let art = layer as? FolderArtLayer {
      progress = art.progress
      palette = art.palette
    }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func draw(in ctx: CGContext) {
    let side = min(bounds.width, bounds.height) / (1 + 2 * FolderArt.bleed)
    guard side > 0 else { return }
    let scale = side / FolderArt.unitsPerSide
    ctx.saveGState()
    if !contentsAreFlipped() {
      ctx.translateBy(x: 0, y: bounds.height)
      ctx.scaleBy(x: 1, y: -1)
    }
    ctx.translateBy(x: bounds.midX - FolderArt.closedCenter.x * scale, y: bounds.midY - FolderArt.closedCenter.y * scale)
    ctx.scaleBy(x: scale, y: scale)
    ctx.setLineWidth(FolderArt.strokeWidth)
    ctx.setLineJoin(.round)
    ctx.setLineCap(.round)
    ctx.setStrokeColor(palette.stroke.cgColor)

    let u = FolderArt.smoothstep(progress)
    let rearPoints = FolderArt.mix(FolderArt.rearClosed, FolderArt.rearOpen, u)
    let rear = FolderArt.roundedPath(rearPoints, radius: FolderArt.rearCornerRadius)
    let top = rearPoints.map(\.y).min() ?? 0
    if let interior = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [palette.insideTop.cgColor, palette.insideBottom.cgColor] as CFArray, locations: [0, 1]) {
      ctx.saveGState()
      ctx.addPath(rear)
      ctx.clip()
      ctx.drawLinearGradient(interior, start: CGPoint(x: 0, y: top), end: CGPoint(x: 0, y: FolderArt.hingeY), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
      ctx.restoreGState()
    }
    ctx.addPath(rear)
    ctx.strokePath()

    ctx.addPath(FolderArt.roundedPath(FolderArt.mix(FolderArt.frontClosed, FolderArt.frontOpen, u), radius: FolderArt.frontCornerRadius))
    ctx.setFillColor(palette.face.cgColor)
    ctx.drawPath(using: .fillStroke)
    ctx.restoreGState()
  }
}

final class FolderIconView: ExpoView {
  private struct Motion {
    let from: Double
    let to: Double
    let start: CFTimeInterval
    let duration: CFTimeInterval
  }

  var wantsOpen = false
  var palette = FolderPalette()

  private let art = FolderArtLayer()
  private var progress: Double = 0
  private var motion: Motion?
  private var link: CADisplayLink?
  private var shownOpen: Bool?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    redraw()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil { settle() }
    redraw()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    redraw()
  }

  func propsDidUpdate() {
    defer { shownOpen = wantsOpen }
    let to: Double = wantsOpen ? 1 : 0
    guard let shownOpen, shownOpen != wantsOpen else {
      if shownOpen == nil { progress = to }
      redraw()
      return
    }
    let from = currentProgress()
    let duration = FolderArt.duration * abs(to - from)
    progress = to
    motion = nil
    if window != nil, duration > 0, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
      motion = Motion(from: from, to: to, start: CACurrentMediaTime(), duration: duration)
      startLink()
    } else {
      stopLink()
    }
    redraw()
  }

  private func currentProgress() -> Double {
    guard let motion else { return progress }
    let t = min(1, max(0, (CACurrentMediaTime() - motion.start) / motion.duration))
    return motion.from + (motion.to - motion.from) * t
  }

  private func startLink() {
    guard link == nil else { return }
    let link = displayLink(target: self, selector: #selector(step))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  private func stopLink() {
    link?.invalidate()
    link = nil
  }

  private func settle() {
    motion = nil
    stopLink()
  }

  @objc private func step(_ link: CADisplayLink) {
    if motion.map({ CACurrentMediaTime() - $0.start >= $0.duration }) ?? true { settle() }
    redraw()
  }

  private func redraw() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if art.superlayer !== layer { layer.addSublayer(art) }
    let bleed = min(bounds.width, bounds.height) * FolderArt.bleed
    art.frame = bounds.insetBy(dx: -bleed, dy: -bleed)
    art.contentsScale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
    art.progress = currentProgress()
    art.palette = palette
    art.setNeedsDisplay()
    CATransaction.commit()
  }
}
