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
  static let frontClosed = polygon([(26, 36), (96, 36), (96, 88), (26, 88)])
  static let frontOpen = polygon([(48.61, 43), (106.65, 43), (91, 88), (31, 88)])
  static let rearCornerRadius: CGFloat = 8
  static let frontCornerRadius: CGFloat = 9
  static let strokeWidth: CGFloat = 8
  static let hingeY: CGFloat = 88
  static let closedCenter = CGPoint(x: 61, y: 53)
  static let unitsPerSide: CGFloat = 81
  static let bleed: CGFloat = 0.25
  static let duration: CFTimeInterval = 0.2
  static let framesPerSecond: Double = 240

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

  static func image(_ progress: Double, size: CGSize, center: CGPoint, side: CGFloat, scale: CGFloat, palette: FolderPalette) -> CGImage? {
    guard side > 0, let space = CGColorSpace(name: CGColorSpace.sRGB),
      let ctx = CGContext(
        data: nil, width: Int((size.width * scale).rounded(.up)), height: Int((size.height * scale).rounded(.up)), bitsPerComponent: 8,
        bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
    else { return nil }
    let unit = side / unitsPerSide
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: 0, y: size.height)
    ctx.scaleBy(x: 1, y: -1)
    ctx.translateBy(x: center.x - closedCenter.x * unit, y: center.y - closedCenter.y * unit)
    ctx.scaleBy(x: unit, y: unit)
    ctx.setLineWidth(strokeWidth)
    ctx.setLineJoin(.round)
    ctx.setLineCap(.round)
    ctx.setStrokeColor(palette.stroke.cgColor)

    let u = smoothstep(progress)
    let rearPoints = mix(rearClosed, rearOpen, u)
    let rear = roundedPath(rearPoints, radius: rearCornerRadius)
    let top = rearPoints.map(\.y).min() ?? 0
    if let interior = CGGradient(colorsSpace: space, colors: [palette.insideTop.cgColor, palette.insideBottom.cgColor] as CFArray, locations: [0, 1]) {
      ctx.saveGState()
      ctx.addPath(rear)
      ctx.clip()
      ctx.drawLinearGradient(interior, start: CGPoint(x: 0, y: top), end: CGPoint(x: 0, y: hingeY), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
      ctx.restoreGState()
    }
    ctx.addPath(rear)
    ctx.strokePath()

    ctx.addPath(roundedPath(mix(frontClosed, frontOpen, u), radius: frontCornerRadius))
    ctx.setFillColor(palette.face.cgColor)
    ctx.drawPath(using: .fillStroke)
    return ctx.makeImage()
  }
}

struct FolderPalette {
  var stroke = NSColor(hex: "#443aff")!
  var face = NSColor(hex: "#f4f3ff")!
  var insideTop = NSColor(hex: "#bfbcff")!
  var insideBottom = NSColor(hex: "#8781ff")!
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

  private let art = CALayer()
  private var progress: Double = 0
  private var motion: Motion?
  private var shownOpen: Bool?
  private var artCenter = CGPoint.zero

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    art.contentsGravity = .resize
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    redraw()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil { motion = nil }
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
    }
    redraw()
  }

  private func currentProgress() -> Double {
    guard let motion else { return progress }
    let t = min(1, max(0, (CACurrentMediaTime() - motion.start) / motion.duration))
    return motion.from + (motion.to - motion.from) * t
  }

  private func redraw() {
    guard let layer, bounds.width > 0, bounds.height > 0 else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if art.superlayer !== layer { layer.addSublayer(art) }
    let side = min(bounds.width, bounds.height)
    let frame = backingAlignedRect(bounds.insetBy(dx: -side * FolderArt.bleed, dy: -side * FolderArt.bleed), options: .alignAllEdgesNearest)
    art.frame = frame
    artCenter = CGPoint(x: bounds.midX - frame.minX, y: isFlipped ? bounds.midY - frame.minY : frame.maxY - bounds.midY)
    let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
    art.contentsScale = scale
    art.contents = image(progress, scale: scale)
    art.removeAnimation(forKey: "folder")
    if let motion {
      let elapsed = CACurrentMediaTime() - motion.start
      if elapsed < motion.duration { play(motion, elapsed: elapsed, scale: scale) } else { self.motion = nil }
    }
    CATransaction.commit()
  }

  private func image(_ progress: Double, scale: CGFloat) -> CGImage? {
    FolderArt.image(progress, size: art.bounds.size, center: artCenter, side: min(bounds.width, bounds.height), scale: scale, palette: palette)
  }

  private func play(_ motion: Motion, elapsed: CFTimeInterval, scale: CGFloat) {
    let count = max(2, Int((motion.duration * FolderArt.framesPerSecond).rounded(.up)))
    let frames = (0..<count).compactMap { i in image(motion.from + (motion.to - motion.from) * (Double(i) + 0.5) / Double(count), scale: scale) }
    let animation = CAKeyframeAnimation(keyPath: "contents")
    animation.values = frames
    animation.calculationMode = .discrete
    animation.duration = motion.duration
    animation.beginTime = art.convertTime(CACurrentMediaTime(), from: nil) - elapsed
    art.add(animation, forKey: "folder")
  }
}
