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

  private static let dragThreshold: CGFloat = 4
  private static let smallestDrag: CGFloat = 30
  private static let settledScroll: TimeInterval = 0.15
  private static let lensCornerRadius: CGFloat = 7
  private static let lensBorderWidth: CGFloat = 4
  private static let lensBorderDark = NSColor(srgbRed: 0.082, green: 0.110, blue: 0.188, alpha: 1)
  private static let fadeOut: TimeInterval = 0.15
  private static let shadeAlpha: CGFloat = 0.25
  private static let hintGap: CGFloat = 12
  private static let badgeGap: CGFloat = 6

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
  private var lastPointer: NSPoint?
  private var refreshing = false
  private var refreshAgain = false
  private var settledRefresh: DispatchWorkItem?
  private let hint = CaptureLabel()
  private let badge = CaptureLabel()
  private var tracking: NSTrackingArea?
  private var dragStart: NSPoint?
  private var dragRect: NSRect?
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
    showLens()
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
    lastPointer = mouseInPage()
  }

  override var acceptsFirstResponder: Bool { true }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? { finished ? nil : super.hitTest(point) }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let tracking { removeTrackingArea(tracking) }
    let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .activeAlways, .inVisibleRect, .cursorUpdate], owner: self)
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
    lastPointer = pagePoint(event)
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
    lastPointer = point
    showLens()
  }

  override func mouseUp(with event: NSEvent) {
    guard !finished else { return }
    let dragged = dragRect
    dragStart = nil
    dragRect = nil
    if let dragged, dragged.width > Self.smallestDrag, dragged.height > Self.smallestDrag { return capture(dragged) }
    showLens()
  }

  override func rightMouseDown(with event: NSEvent) { finish(.cancelled) }

  override func scrollWheel(with event: NSEvent) {
    guard !finished, dragStart == nil else { return }
    scrollPage(event)
  }

  private func scrollPage(_ event: NSEvent) {
    guard let page, let host = superview, let pointer = lastPointer.map(layerPoint) else { return }
    let target = page.hitTest(convert(pointer, to: host)) ?? page
    target.scrollWheel(with: event)
    refreshSoon()
  }

  private func refreshSoon() {
    refreshPicture()
    settledRefresh?.cancel()
    let again = DispatchWorkItem { [weak self] in self?.refreshPicture() }
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
    guard !finished, event.modifierFlags.intersection([.command, .control, .option]).isEmpty, event.keyCode == 53 else { return false }
    finish(.cancelled)
    return true
  }

  override func cancelOperation(_ sender: Any?) { finish(.cancelled) }

  private func layerRect(_ rect: NSRect) -> NSRect {
    NSRect(x: rect.minX, y: bounds.height - rect.maxY, width: rect.width, height: rect.height)
  }

  private func layerPoint(_ point: NSPoint) -> NSPoint { NSPoint(x: point.x, y: bounds.height - point.y) }

  private func showLens() {
    let rect = dragRect.map(layerRect) ?? .zero
    let opacity: Float = dragRect == nil ? 0 : 1
    if let dragRect {
      let pixels = pixelRect(dragRect)
      badge.text = "\(Int(pixels.width)) × \(Int(pixels.height))"
    }
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
    badge.layer.opacity = opacity
    CATransaction.commit()
  }

  private func showHint() {
    hint.text = "Drag to capture · Esc to cancel"
    let size = hint.size
    hint.layer.frame = NSRect(x: ((bounds.width - size.width) / 2).rounded(), y: bounds.height - Self.hintGap - size.height, width: size.width, height: size.height)
  }

  private func pixelRect(_ rect: NSRect) -> CGRect {
    let scaleX = CGFloat(picture.width) / max(1, bounds.width)
    let scaleY = CGFloat(picture.height) / max(1, bounds.height)
    let pixels = CGRect(x: (rect.minX * scaleX).rounded(), y: (rect.minY * scaleY).rounded(), width: (rect.width * scaleX).rounded(), height: (rect.height * scaleY).rounded())
    return pixels.intersection(CGRect(x: 0, y: 0, width: picture.width, height: picture.height))
  }

  private func capture(_ rect: NSRect) {
    guard !finished else { return }
    finished = true
    let pixels = pixelRect(rect)
    guard !pixels.isEmpty, let cropped = picture.cropping(to: pixels), let png = CaptureClipboard.copy(cropped, points: rect.size) else {
      return finish(.failed)
    }
    finish(.copied(Shot(png: png, kind: "area", width: Int(pixels.width), height: Int(pixels.height))))
  }

  func cancel() { finish(.cancelled) }

  private func finish(_ ending: Ending) {
    guard !closed else { return }
    closed = true
    finished = true
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
