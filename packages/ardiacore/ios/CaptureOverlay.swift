import AppKit
import QuartzCore

final class CaptureOverlay: NSView {
  struct Shot {
    let png: Data
    let kind: String
    let width: Int
    let height: Int
  }

  enum Ending {
    case copied(Shot)
    case cancelled
    case failed
  }

  private enum Lookup {
    case idle
    case busy
    case busyAgain
  }

  private static let dragThreshold: CGFloat = 4
  private static let smallestArea: CGFloat = 4
  private static let wheelStep: CGFloat = 12
  private static let lensMotion: CFTimeInterval = 0.12
  private static let fadeOut: TimeInterval = 0.15
  private static let dimAlpha: CGFloat = 0.45
  private static let hintGap: CGFloat = 12
  private static let badgeGap: CGFloat = 6

  private static let script: String = {
    let bundle = Bundle(for: CaptureOverlay.self)
    guard let path = bundle.path(forResource: "capture_target", ofType: "js") else { return "" }
    return (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
  }()

  private weak var page: PageTab?
  private let picture: CGImage
  private let ended: (Ending) -> Void
  private let pictureLayer = CALayer()
  private let dimLayer = CAShapeLayer()
  private let lensLayer = CAShapeLayer()
  private let hint = CaptureLabel()
  private let badge = CaptureLabel()
  private var tracking: NSTrackingArea?
  private var lookup = Lookup.idle
  private var hoverPoint: NSPoint?
  private var candidates: [NSRect] = []
  private var level = -1
  private var stepOrigin: NSPoint?
  private var wheel: CGFloat = 0
  private var dragStart: NSPoint?
  private var dragRect: NSRect?
  private var lens: NSRect?
  private var clickPending = false
  private var finished = false
  private var keyMonitor: Any?
  private weak var previousResponder: NSResponder?

  init(frame: NSRect, picture: CGImage, page: PageTab, ended: @escaping (Ending) -> Void) {
    self.picture = picture
    self.page = page
    self.ended = ended
    super.init(frame: frame)
    wantsLayer = true
    autoresizingMask = [.width, .height]
    setAccessibilityElement(false)
    buildLayers()
  }

  required init?(coder: NSCoder) { nil }

  deinit {
    if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
  }

  private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

  private func buildLayers() {
    guard let root = layer else { return }
    pictureLayer.contents = picture
    pictureLayer.contentsGravity = .resize
    dimLayer.fillRule = .evenOdd
    dimLayer.fillColor = NSColor.black.withAlphaComponent(Self.dimAlpha).cgColor
    lensLayer.fillColor = nil
    lensLayer.strokeColor = NSColor.white.cgColor
    lensLayer.lineWidth = 1.5
    lensLayer.shadowColor = NSColor.black.cgColor
    lensLayer.shadowOpacity = 0.35
    lensLayer.shadowRadius = 2
    lensLayer.shadowOffset = .zero
    for sublayer in [pictureLayer, dimLayer, lensLayer, hint.layer, badge.layer] { root.addSublayer(sublayer) }
    badge.layer.isHidden = true
    layoutLayers()
  }

  override func layout() {
    super.layout()
    layoutLayers()
  }

  private func layoutLayers() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    pictureLayer.frame = bounds
    dimLayer.frame = bounds
    lensLayer.frame = bounds
    let scale = window?.backingScaleFactor ?? 2
    [pictureLayer, dimLayer, lensLayer, hint.layer, badge.layer].forEach { $0.contentsScale = scale }
    hint.scale = scale
    badge.scale = scale
    showHint()
    drawLens(animated: false)
    CATransaction.commit()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    guard let window else { return finish(.cancelled) }
    previousResponder = window.firstResponder
    window.makeFirstResponder(self)
    if keyMonitor == nil {
      keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
        guard let self, !self.finished, event.window === self.window, self.handleKey(event) else { return event }
        return nil
      }
    }
    if let point = mouseInPage() {
      hoverPoint = point
      requestTargets()
    }
  }

  override var acceptsFirstResponder: Bool { true }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? { finished ? nil : super.hitTest(point) }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let tracking { removeTrackingArea(tracking) }
    let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect, .cursorUpdate], owner: self)
    addTrackingArea(area)
    tracking = area
  }

  override func cursorUpdate(with event: NSEvent) { NSCursor.crosshair.set() }

  override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }

  private func pagePoint(_ event: NSEvent) -> NSPoint {
    let local = convert(event.locationInWindow, from: nil)
    return NSPoint(x: local.x, y: bounds.height - local.y)
  }

  private func mouseInPage() -> NSPoint? {
    guard let window else { return nil }
    let local = convert(window.mouseLocationOutsideOfEventStream, from: nil)
    guard bounds.contains(local) else { return nil }
    return NSPoint(x: local.x, y: bounds.height - local.y)
  }

  override func mouseMoved(with event: NSEvent) {
    guard !finished, dragStart == nil else { return }
    NSCursor.crosshair.set()
    let point = pagePoint(event)
    if let origin = stepOrigin, hypot(point.x - origin.x, point.y - origin.y) > 3 { stepOrigin = nil }
    hoverPoint = point
    requestTargets()
  }

  override func mouseExited(with event: NSEvent) {
    guard !finished, dragStart == nil else { return }
    hoverPoint = nil
    candidates = []
    level = -1
    setLens(nil, animated: true)
  }

  override func mouseDown(with event: NSEvent) {
    guard !finished else { return }
    dragStart = pagePoint(event)
    dragRect = nil
  }

  override func mouseDragged(with event: NSEvent) {
    guard !finished, let start = dragStart else { return }
    let point = pagePoint(event)
    if dragRect == nil, hypot(point.x - start.x, point.y - start.y) < Self.dragThreshold { return }
    let rect = NSRect(x: min(start.x, point.x), y: min(start.y, point.y), width: abs(point.x - start.x), height: abs(point.y - start.y))
    dragRect = rect.intersection(NSRect(origin: .zero, size: bounds.size))
    setLens(dragRect, animated: false)
  }

  override func mouseUp(with event: NSEvent) {
    guard !finished else { return }
    let dragged = dragRect
    dragStart = nil
    dragRect = nil
    if let dragged {
      if dragged.width >= Self.smallestArea && dragged.height >= Self.smallestArea { return capture(dragged, kind: "area") }
      hoverPoint = pagePoint(event)
      return requestTargets()
    }
    let point = pagePoint(event)
    if let lens, lens.contains(point) || stepOrigin != nil { return capture(lens, kind: "element") }
    clickPending = true
    hoverPoint = point
    stepOrigin = nil
    requestTargets()
  }

  override func rightMouseDown(with event: NSEvent) { finish(.cancelled) }

  override func scrollWheel(with event: NSEvent) {
    guard !finished, dragStart == nil, !candidates.isEmpty else { return }
    if event.phase == .began || event.phase == .mayBegin { wheel = 0 }
    wheel += event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * Self.wheelStep
    while abs(wheel) >= Self.wheelStep {
      step(wheel > 0 ? 1 : -1)
      wheel -= wheel > 0 ? Self.wheelStep : -Self.wheelStep
    }
  }

  override func keyDown(with event: NSEvent) {
    if !handleKey(event) { super.keyDown(with: event) }
  }

  private func handleKey(_ event: NSEvent) -> Bool {
    guard !finished, event.modifierFlags.intersection([.command, .control, .option]).isEmpty else { return false }
    switch event.keyCode {
    case 53: finish(.cancelled)
    case 126: step(1)
    case 125: step(-1)
    case 36, 76: if let lens { capture(lens, kind: "element") }
    default: return false
    }
    return true
  }

  override func cancelOperation(_ sender: Any?) { finish(.cancelled) }

  private func step(_ direction: Int) {
    guard !candidates.isEmpty else { return }
    let next = level < 0 ? (direction > 0 ? 0 : candidates.count - 1) : level + direction
    level = max(0, min(candidates.count - 1, next))
    stepOrigin = hoverPoint
    setLens(candidates[level], animated: true)
  }

  private func requestTargets() {
    switch lookup {
    case .idle:
      lookup = .busy
      askPage()
    case .busy:
      lookup = .busyAgain
    case .busyAgain:
      break
    }
  }

  private func askPage() {
    guard let page, let point = hoverPoint, !Self.script.isEmpty, !finished else {
      lookup = .idle
      return
    }
    let backing = window?.backingScaleFactor ?? 2
    let code = "(\(Self.script))(\(Double(point.x)), \(Double(point.y)), \(Double(backing)))"
    page.evaluate(code) { [weak self] json in
      DispatchQueue.main.async {
        guard let self else { return }
        self.answered(json)
        if self.lookup == .busyAgain {
          self.lookup = .busy
          self.askPage()
        } else {
          self.lookup = .idle
        }
      }
    }
  }

  private func answered(_ json: String?) {
    guard !finished, dragStart == nil, stepOrigin == nil else { return }
    let clicked = clickPending
    clickPending = false
    guard let data = json?.data(using: .utf8),
      let reply = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let boxes = reply["candidates"] as? [[Double]]
    else {
      candidates = []
      level = -1
      return setLens(nil, animated: true)
    }
    candidates = boxes.filter { $0.count == 4 }.map { NSRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
    let best = reply["best"] as? Int ?? -1
    level = best >= 0 && best < candidates.count ? best : -1
    setLens(level >= 0 ? candidates[level] : nil, animated: true)
    if clicked, let lens { capture(lens, kind: "element") }
  }

  private func setLens(_ rect: NSRect?, animated: Bool) {
    let moves = animated && !reduceMotion && lens != nil && rect != nil
    lens = rect
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    drawLens(animated: moves)
    showHint()
    CATransaction.commit()
  }

  private func layerRect(_ rect: NSRect) -> NSRect {
    NSRect(x: rect.minX, y: bounds.height - rect.maxY, width: rect.width, height: rect.height)
  }

  private func movePath(of shape: CAShapeLayer, to path: CGPath) {
    if let from = shape.presentation()?.path ?? shape.path {
      let motion = CABasicAnimation(keyPath: "path")
      motion.fromValue = from
      motion.toValue = path
      motion.duration = Self.lensMotion
      motion.timingFunction = CAMediaTimingFunction(name: .easeOut)
      shape.add(motion, forKey: "path")
    }
    shape.path = path
  }

  private func drawLens(animated: Bool) {
    let whole = CGPath(rect: bounds, transform: nil)
    guard let lens else {
      dimLayer.removeAllAnimations()
      lensLayer.removeAllAnimations()
      dimLayer.path = whole
      lensLayer.path = nil
      badge.layer.isHidden = true
      return
    }
    let hole = layerRect(lens)
    let dim = CGMutablePath()
    dim.addPath(whole)
    dim.addRect(hole)
    let outline = CGPath(rect: hole.insetBy(dx: -0.75, dy: -0.75), transform: nil)
    if animated {
      movePath(of: dimLayer, to: dim)
      movePath(of: lensLayer, to: outline)
    } else {
      dimLayer.removeAllAnimations()
      lensLayer.removeAllAnimations()
      dimLayer.path = dim
      lensLayer.path = outline
    }
    let pixels = pixelRect(lens)
    badge.text = "\(Int(pixels.width)) × \(Int(pixels.height))"
    let size = badge.size
    let below = hole.minY - Self.badgeGap - size.height
    let y = below >= 0 ? below : hole.minY + Self.badgeGap
    let x = min(max(0, hole.minX), max(0, bounds.width - size.width))
    badge.layer.frame = NSRect(x: x, y: y, width: size.width, height: size.height)
    badge.layer.isHidden = false
  }

  private func showHint() {
    hint.text = candidates.isEmpty && lens == nil && hoverPoint != nil ? "Drag to capture · Esc to cancel" : "Click or drag to capture · Esc to cancel"
    let size = hint.size
    hint.layer.frame = NSRect(x: ((bounds.width - size.width) / 2).rounded(), y: bounds.height - Self.hintGap - size.height, width: size.width, height: size.height)
  }

  private func pixelRect(_ rect: NSRect) -> CGRect {
    let scaleX = CGFloat(picture.width) / max(1, bounds.width)
    let scaleY = CGFloat(picture.height) / max(1, bounds.height)
    let pixels = CGRect(x: (rect.minX * scaleX).rounded(), y: (rect.minY * scaleY).rounded(), width: (rect.width * scaleX).rounded(), height: (rect.height * scaleY).rounded())
    return pixels.intersection(CGRect(x: 0, y: 0, width: picture.width, height: picture.height))
  }

  private func capture(_ rect: NSRect, kind: String) {
    let pixels = pixelRect(rect)
    guard !pixels.isEmpty, let cropped = picture.cropping(to: pixels), let png = CaptureOverlay.copyToPasteboard(cropped, points: rect.size) else {
      return finish(.failed)
    }
    finish(.copied(Shot(png: png, kind: kind, width: Int(pixels.width), height: Int(pixels.height))))
  }

  static func copyToPasteboard(_ image: CGImage, points: NSSize) -> Data? {
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { return nil }
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    guard let srgb = context.makeImage() else { return nil }
    let bitmap = NSBitmapImageRep(cgImage: srgb)
    bitmap.size = points
    guard let png = bitmap.representation(using: .png, properties: [:]), let tiff = bitmap.tiffRepresentation else { return nil }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setData(png, forType: .png)
    pasteboard.setData(tiff, forType: .tiff)
    return png
  }

  func cancel() { finish(.cancelled) }

  private func finish(_ ending: Ending) {
    guard !finished else { return }
    finished = true
    if let keyMonitor {
      NSEvent.removeMonitor(keyMonitor)
      self.keyMonitor = nil
    }
    if let window, window.firstResponder === self {
      if let previous = previousResponder, previous !== self, (previous as? NSView)?.window === window || previous === window {
        window.makeFirstResponder(previous)
      } else {
        window.makeFirstResponder(nil)
      }
    }
    ended(ending)
    guard window != nil, !reduceMotion else { return removeFromSuperview() }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = Self.fadeOut
      animator().alphaValue = 0
    } completionHandler: { [weak self] in
      self?.removeFromSuperview()
    }
  }
}
