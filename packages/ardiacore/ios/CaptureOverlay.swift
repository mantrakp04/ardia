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
  private static let smallestDrag: CGFloat = 30
  private static let swipeStep: CGFloat = 32
  private static let settledScroll: TimeInterval = 0.15
  private static let swipePause: TimeInterval = 0.3
  private static let lensResponse = 0.35
  private static let lensDampingRatio = 0.87
  private static let lensPadding: CGFloat = 6
  private static let lensCornerRadius: CGFloat = 7
  private static let lensBorderWidth: CGFloat = 4
  private static let lensOpaqueSide: CGFloat = 40
  private static let lensBorderDark = NSColor(srgbRed: 0.082, green: 0.110, blue: 0.188, alpha: 1)
  private static let longestFrame = 1.0 / 30
  private static let fadeOut: TimeInterval = 0.15
  private static let shadeAlpha: CGFloat = 0.25
  private static let hintGap: CGFloat = 12
  private static let badgeGap: CGFloat = 6

  private static let script: String = {
    let bundle = Bundle(for: CaptureOverlay.self)
    guard let path = bundle.path(forResource: "capture_target", ofType: "js") else { return "" }
    return (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
  }()

  private weak var page: PageTab?
  private var picture: CGImage
  private var pictureSize: NSSize
  private let ended: (Ending) -> Void
  private let grayLayer = CALayer()
  private let shadeLayer = CALayer()
  private let lensContent = CALayer()
  private let lensPicture = CALayer()
  private let lensBorder = CALayer()
  private var laidOut = NSSize.zero
  private var spring = CaptureSpring(response: CaptureOverlay.lensResponse, dampingRatio: CaptureOverlay.lensDampingRatio, value: .zero)
  private var springPlaced = false
  private var ticker: CADisplayLink?
  private var lastTick: CFTimeInterval = 0
  private var lastPointer: NSPoint?
  private var refreshing = false
  private var refreshAgain = false
  private var settledRefresh: DispatchWorkItem?
  private let hint = CaptureLabel()
  private let badge = CaptureLabel()
  private var tracking: NSTrackingArea?
  private var lookup = Lookup.idle
  private var hoverPoint: NSPoint?
  private var candidates: [NSRect] = []
  private var level = -1
  private var pinned: NSRect?
  private var wheel: CGFloat = 0
  private var wheelAt: TimeInterval = 0
  private var dragStart: NSPoint?
  private var dragRect: NSRect?
  private var lens: NSRect?
  private var clickPoint: NSPoint?
  private var answeredPoint: NSPoint?
  private var finished = false
  private var closed = false
  private var keyMonitor: Any?
  private weak var previousResponder: NSResponder?

  init(frame: NSRect, picture: CGImage, pictureSize: NSSize, page: PageTab, ended: @escaping (Ending) -> Void) {
    self.picture = picture
    self.pictureSize = pictureSize
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
    ticker?.invalidate()
  }

  private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

  private func buildLayers() {
    guard let root = layer else { return }
    grayLayer.contents = Self.grayscale(picture) ?? picture
    grayLayer.contentsGravity = .resize
    shadeLayer.backgroundColor = NSColor.black.withAlphaComponent(Self.shadeAlpha).cgColor
    lensPicture.contents = picture
    lensPicture.contentsGravity = .resize
    lensContent.addSublayer(lensPicture)
    for lens in [lensContent, lensBorder] {
      lens.cornerRadius = Self.lensCornerRadius
      lens.cornerCurve = .continuous
      lens.opacity = 0
    }
    lensContent.masksToBounds = true
    lensBorder.borderWidth = Self.lensBorderWidth
    for sublayer in [grayLayer, shadeLayer, lensContent, lensBorder, hint.layer, badge.layer] { root.addSublayer(sublayer) }
    badge.layer.opacity = 0
    layoutLayers()
  }

  private static func grayscale(_ image: CGImage) -> CGImage? {
    let context = CGContext(
      data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(),
      bitmapInfo: CGImageAlphaInfo.none.rawValue)
    context?.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    return context?.makeImage()
  }

  override func layout() {
    super.layout()
    guard bounds.size != laidOut else { return }
    layoutLayers()
    pinned = nil
    if bounds.size != pictureSize { refreshSoon() }
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    paintBorder()
  }

  private func paintBorder() {
    let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    lensBorder.borderColor = (dark ? Self.lensBorderDark : NSColor.white).cgColor
  }

  private func layoutLayers() {
    laidOut = bounds.size
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for sublayer in [grayLayer, shadeLayer] { sublayer.frame = bounds }
    let scale = window?.backingScaleFactor ?? 2
    [grayLayer, lensPicture, lensContent, lensBorder, hint.layer, badge.layer].forEach { $0.contentsScale = scale }
    hint.scale = scale
    badge.scale = scale
    paintBorder()
    showHint()
    CATransaction.commit()
    retarget(animated: false)
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    guard let window else { return finish(.cancelled) }
    layoutLayers()
    previousResponder = window.firstResponder
    window.makeFirstResponder(self)
    window.invalidateCursorRects(for: self)
    NSCursor.crosshair.set()
    if keyMonitor == nil {
      keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
        guard let self, !self.finished, event.window === self.window, self.holdsKeys, self.handleKey(event) else { return event }
        return nil
      }
    }
    if let point = mouseInPage() {
      hoverPoint = point
      lastPointer = point
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

  override func cursorUpdate(with event: NSEvent) {
    if !finished { NSCursor.crosshair.set() }
  }

  override func resetCursorRects() {
    if !finished { addCursorRect(bounds, cursor: .crosshair) }
  }

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
    let point = pagePoint(event)
    hoverPoint = point
    lastPointer = point
    requestTargets()
  }

  override func mouseExited(with event: NSEvent) {
    guard !finished, dragStart == nil else { return }
    lastPointer = pagePoint(event)
    hoverPoint = nil
    pinned = nil
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
      if dragged.width > Self.smallestDrag && dragged.height > Self.smallestDrag { return capture(dragged, kind: "area") }
      setLens(nil, animated: true)
    }
    let point = pagePoint(event)
    if let lens, lens.contains(point), outlineIsCurrent { return capture(lens, kind: "element") }
    clickPoint = point
    hoverPoint = point
    requestTargets()
  }

  override func rightMouseDown(with event: NSEvent) { finish(.cancelled) }

  override func scrollWheel(with event: NSEvent) {
    guard !finished, dragStart == nil else { return }
    guard event.modifierFlags.contains(.command) else { return scrollPage(event) }
    guard event.momentumPhase.isEmpty, !candidates.isEmpty else { return }
    if event.phase == .began || event.phase == .mayBegin || event.timestamp - wheelAt > Self.swipePause { wheel = 0 }
    wheelAt = event.timestamp
    if event.hasPreciseScrollingDeltas {
      wheel += event.scrollingDeltaY
      guard abs(wheel) >= Self.swipeStep else { return }
      step(wheel > 0 ? 1 : -1)
      wheel = 0
    } else if event.scrollingDeltaY != 0 {
      step(event.scrollingDeltaY > 0 ? 1 : -1)
    }
  }

  private func scrollPage(_ event: NSEvent) {
    guard let page, let host = superview, let pointer = (hoverPoint ?? lastPointer).map(layerPoint) else { return }
    let target = page.hitTest(convert(pointer, to: host)) ?? page
    pinned = nil
    answeredPoint = nil
    target.scrollWheel(with: event)
    refreshSoon()
  }

  private func refreshSoon() {
    refreshPicture()
    settledRefresh?.cancel()
    let again = DispatchWorkItem { [weak self] in
      self?.settledRefresh = nil
      self?.refreshPicture()
    }
    settledRefresh = again
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.settledScroll, execute: again)
  }

  private func refreshPicture() {
    guard !finished, let page else { return }
    if refreshing {
      refreshAgain = true
      return
    }
    refreshing = true
    let size = bounds.size
    page.copyCapturePicture { [weak self] fresh, frame in
      DispatchQueue.main.async {
        guard let self else { return }
        self.refreshing = false
        guard !self.finished else { return }
        if let fresh, frame.size == size, size == self.bounds.size { self.show(fresh, size: size) }
        if self.refreshAgain {
          self.refreshAgain = false
          self.refreshPicture()
        } else {
          self.requestTargets()
        }
      }
    }
  }

  private func show(_ fresh: CGImage, size: NSSize) {
    picture = fresh
    pictureSize = size
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    lensPicture.contents = fresh
    grayLayer.contents = Self.grayscale(fresh) ?? fresh
    CATransaction.commit()
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
    case 36, 76: confirm()
    default: return false
    }
    return true
  }

  override func cancelOperation(_ sender: Any?) { finish(.cancelled) }

  private var outlineIsCurrent: Bool { pinned != nil || (lookup == .idle && answeredPoint == hoverPoint) }

  private func confirm() {
    if let lens, outlineIsCurrent { return capture(lens, kind: "element") }
    guard let point = hoverPoint else { return }
    clickPoint = point
    requestTargets()
  }

  private func step(_ direction: Int) {
    guard !candidates.isEmpty else { return }
    let next = level < 0 ? (direction > 0 ? 0 : candidates.count - 1) : level + direction
    level = max(0, min(candidates.count - 1, next))
    pinned = candidates[level]
    setLens(candidates[level], animated: true)
  }

  private func requestTargets() {
    guard settledRefresh == nil else { return }
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
    guard let page, let point = clickPoint ?? hoverPoint, !Self.script.isEmpty, !finished else {
      lookup = .idle
      return
    }
    let backing = window?.backingScaleFactor ?? 2
    let code = "(\(Self.script))(\(Double(point.x)), \(Double(point.y)), \(Double(backing)))"
    page.evaluate(code) { [weak self] json in
      DispatchQueue.main.async {
        guard let self else { return }
        self.answered(json, for: point)
        if self.lookup == .busyAgain {
          self.lookup = .busy
          self.askPage()
        } else {
          self.lookup = .idle
        }
      }
    }
  }

  private func answered(_ json: String?, for point: NSPoint) {
    guard !finished, dragStart == nil else { return }
    let clicked = clickPoint == point
    answeredPoint = point
    if clicked { clickPoint = nil }
    guard clicked || hoverPoint != nil else { return }
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
    if let held = pinned, held.contains(point) {
      if let kept = candidates.firstIndex(where: { abs($0.minX - held.minX) < 1 && abs($0.minY - held.minY) < 1 && abs($0.width - held.width) < 1 && abs($0.height - held.height) < 1 }) {
        level = kept
      } else {
        return setLens(held, animated: true)
      }
    } else {
      pinned = nil
    }
    setLens(level >= 0 ? candidates[level] : nil, animated: true)
    if clicked, let lens { capture(lens, kind: "element") }
  }

  private func setLens(_ rect: NSRect?, animated: Bool) {
    lens = rect
    if let rect {
      let pixels = pixelRect(rect)
      badge.text = "\(Int(pixels.width)) × \(Int(pixels.height))"
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    showHint()
    CATransaction.commit()
    retarget(animated: animated)
  }

  private func layerRect(_ rect: NSRect) -> NSRect {
    NSRect(x: rect.minX, y: bounds.height - rect.maxY, width: rect.width, height: rect.height)
  }

  private func layerPoint(_ point: NSPoint) -> NSPoint { NSPoint(x: point.x, y: bounds.height - point.y) }

  private func retarget(animated: Bool) {
    let pointer = (hoverPoint ?? lastPointer).map(layerPoint)
    let goal: NSRect
    if let lens {
      goal = dragRect == nil ? layerRect(lens).insetBy(dx: -Self.lensPadding, dy: -Self.lensPadding) : layerRect(lens)
    } else if let pointer {
      goal = NSRect(origin: pointer, size: .zero)
    } else {
      goal = NSRect(x: spring.value.midX, y: spring.value.midY, width: 0, height: 0)
    }
    let seed = pointer ?? (lens == nil ? nil : NSPoint(x: goal.midX, y: goal.midY))
    if !springPlaced, let seed {
      springPlaced = true
      spring.jump(to: NSRect(origin: seed, size: .zero))
    }
    if animated, dragRect == nil, !reduceMotion, springPlaced {
      spring.target = goal
      startTicking()
    } else {
      spring.jump(to: goal)
      if seed != nil { springPlaced = true }
      stopTicking()
    }
    showLens()
  }

  private func startTicking() {
    guard ticker == nil, window != nil else { return }
    let link = displayLink(target: self, selector: #selector(tick(_:)))
    link.add(to: .main, forMode: .common)
    ticker = link
    lastTick = 0
  }

  private func stopTicking() {
    ticker?.invalidate()
    ticker = nil
  }

  @objc private func tick(_ link: CADisplayLink) {
    let elapsed = lastTick == 0 ? link.duration : link.timestamp - lastTick
    lastTick = link.timestamp
    spring.advance(by: min(max(elapsed, 0), Self.longestFrame))
    if spring.settled { stopTicking() }
    showLens()
  }

  private func showLens() {
    let shown = spring.value
    let rect = NSRect(x: shown.minX, y: shown.minY, width: max(0, shown.width), height: max(0, shown.height))
    let opacity = Float(min(1, max(0, (rect.width + rect.height) / 2 / Self.lensOpaqueSide)))
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    lensContent.frame = rect
    lensPicture.frame = NSRect(x: -rect.minX, y: -rect.minY, width: bounds.width, height: bounds.height)
    lensBorder.frame = rect
    lensContent.opacity = opacity
    lensBorder.opacity = opacity
    let size = badge.size
    let below = rect.minY - Self.badgeGap - size.height
    let y = below >= 0 ? below : rect.minY + Self.badgeGap
    let x = min(max(0, rect.minX), max(0, bounds.width - size.width))
    badge.layer.frame = NSRect(x: x, y: y, width: size.width, height: size.height)
    badge.layer.opacity = lens == nil ? min(opacity, badge.layer.opacity) : opacity
    CATransaction.commit()
  }

  private func showHint() {
    hint.text = candidates.isEmpty && lens == nil && hoverPoint != nil
      ? "Drag to capture · Esc to cancel" : "Click or drag to capture · ⌘-scroll for a bigger or smaller block · Esc to cancel"
    let size = hint.size
    hint.layer.frame = NSRect(x: ((bounds.width - size.width) / 2).rounded(), y: bounds.height - Self.hintGap - size.height, width: size.width, height: size.height)
  }

  private func pixelRect(_ rect: NSRect, in image: CGImage? = nil) -> CGRect {
    let source = image ?? picture
    let scaleX = CGFloat(source.width) / max(1, bounds.width)
    let scaleY = CGFloat(source.height) / max(1, bounds.height)
    let pixels = CGRect(x: (rect.minX * scaleX).rounded(), y: (rect.minY * scaleY).rounded(), width: (rect.width * scaleX).rounded(), height: (rect.height * scaleY).rounded())
    return pixels.intersection(CGRect(x: 0, y: 0, width: source.width, height: source.height))
  }

  private func capture(_ rect: NSRect, kind: String) {
    guard !finished else { return }
    finished = true
    guard kind == "element", let page else { return crop(rect, from: picture, kind: kind) }
    let size = bounds.size
    page.copyCapturePicture { [weak self] fresh, frame in
      DispatchQueue.main.async {
        guard let self, !self.closed else { return }
        let matches = fresh != nil && frame.size == size
        self.crop(rect, from: matches ? fresh! : self.picture, kind: kind)
      }
    }
  }

  private func crop(_ rect: NSRect, from image: CGImage, kind: String) {
    let pixels = pixelRect(rect, in: image)
    guard !pixels.isEmpty, let cropped = image.cropping(to: pixels), let png = CaptureClipboard.copy(cropped, points: rect.size) else {
      return finish(.failed)
    }
    finish(.copied(Shot(png: png, kind: kind, width: Int(pixels.width), height: Int(pixels.height))))
  }

  func cancel() { finish(.cancelled) }

  private func finish(_ ending: Ending) {
    guard !closed else { return }
    closed = true
    finished = true
    stopTicking()
    settledRefresh?.cancel()
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
    let host = window
    host?.invalidateCursorRects(for: self)
    guard host != nil, !reduceMotion else {
      removeFromSuperview()
      return Self.handCursorBack(in: host)
    }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = Self.fadeOut
      animator().alphaValue = 0
    } completionHandler: { [weak self] in
      self?.removeFromSuperview()
      Self.handCursorBack(in: host)
    }
  }
}
