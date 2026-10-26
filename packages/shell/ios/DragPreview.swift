import AppKit
import ArdiaCore

final class DragPreview {
  static let shared = DragPreview()

  static let card = NSSize(width: 209, height: 110)
  private static let pillMs = 0.03
  private static let morph = 0.06
  private static let grow = 0.2
  private static let fadeOut = 0.1

  private final class Panel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
  }

  private var panel: Panel?
  private let rim = CALayer()
  private let picture = CALayer()
  private var windowAspect: CGFloat = 0
  private weak var source: NSWindow?
  private var sourceClosing: NSObjectProtocol?
  private var windowImage: CGImage?
  private var pageImage: (image: CGImage, frame: NSRect)?
  private var placeholder = false
  private var cardImage: CGImage?
  private var pillImage: CGImage?
  private var pillSize = NSSize(width: 173, height: 32)
  private var grab = NSPoint(x: 86, y: 16)
  private var shape = "hidden" { didSet { if shape != oldValue { shapes.append(shape) } } }
  private var shapes: [String] = []
  private var wanted = "hidden"
  private var lastPoint = NSPoint.zero
  private var shownAt = 0.0
  private var generation = 0
  private let background = LaunchConfig.shared.background
  private var animation: Timer?
  private var desired = NSRect.zero

  func begin(windowId: String, chip: NSRect, grab: NSPoint) {
    cancel()
    shapes = []
    guard let window = WindowManager.shared.windows[windowId] else { return }
    source = window
    sourceClosing = NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) {
      [weak self] _ in self?.cancel()
    }
    pillSize = chip.size
    self.grab = NSPoint(x: grab.x - chip.minX, y: grab.y - chip.minY)
    windowImage = Self.snapshot(window, scale: 0.5)
    pillImage = Self.snapshot(window, scale: window.backingScaleFactor, of: chip)
    composeCard()
  }

  func setPage(_ data: Data, frame: NSRect) {
    guard source != nil, let image = NSImage(data: data)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
    pageImage = (image, frame)
    placeholder = false
    composeCard()
    if shape == "card" { show(cardImage) }
  }

  func setPlaceholder(title: String, favicon: String?) {
    guard let window = source, pageImage == nil else { return }
    let size = window.frame.size
    let top: CGFloat = 42
    let page = NSRect(x: 0, y: top, width: size.width, height: max(1, size.height - top))
    let icon: NSImage? = favicon.flatMap { spec -> NSImage? in
      guard let url = URL(string: spec) else { return nil }
      if url.isFileURL { return NSImage(contentsOf: url) }
      if url.scheme == "data", let data = try? Data(contentsOf: url) { return NSImage(data: data) }
      return nil
    } ?? NSImage(systemSymbolName: "globe", accessibilityDescription: nil)
    let image = NSImage(size: page.size, flipped: false) { rect in
      let dark = window.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
      (dark ? NSColor(white: 0.12, alpha: 1) : NSColor(white: 0.97, alpha: 1)).setFill()
      rect.fill()
      let iconSide: CGFloat = 64
      let ink = dark ? NSColor(white: 1, alpha: 0.7) : NSColor(white: 0, alpha: 0.6)
      let label = NSAttributedString(string: title, attributes: [
        .font: NSFont.systemFont(ofSize: 34, weight: .medium),
        .foregroundColor: ink,
      ])
      let textSize = label.size()
      let textWidth = min(textSize.width, rect.width - 80)
      let icon = icon?.isTemplate == true ? icon?.withSymbolConfiguration(.init(paletteColors: [ink])) ?? icon : icon
      icon?.draw(in: NSRect(x: rect.midX - iconSide / 2, y: rect.midY + 12, width: iconSide, height: iconSide))
      label.draw(with: NSRect(x: rect.midX - textWidth / 2, y: rect.midY - 12 - textSize.height, width: textWidth, height: textSize.height),
        options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
      return true
    }
    guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
    pageImage = (cg, page)
    placeholder = true
    composeCard()
    if shape == "card" { show(cardImage) }
  }

  func update(shape next: String, at local: NSPoint) {
    guard let source else { return }
    let point = NSPoint(x: source.frame.minX + local.x, y: source.frame.maxY - local.y)
    wanted = next
    lastPoint = point
    if next == "hidden" {
      hide()
      return
    }
    let panel = self.panel ?? makePanel()
    if shape == "hidden" {
      shownAt = ProcessInfo.processInfo.systemUptime
      shape = "pill"
      animation?.invalidate()
      animation = nil
      panel.alphaValue = 1
      place(panel, shape: "pill", at: point, animated: false)
      if background { panel.order(.above, relativeTo: source.windowNumber) } else { panel.orderFrontRegardless() }
      guard next == "card" else { return }
      let gen = generation
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.pillMs) { [weak self] in
        guard let self, self.generation == gen, self.shape == "pill", self.wanted == "card" else { return }
        self.shape = "card"
        self.place(panel, shape: "card", at: self.lastPoint, animated: true)
      }
    } else if shape != next, !(next == "card" && ProcessInfo.processInfo.systemUptime - shownAt < Self.pillMs) {
      shape = next
      place(panel, shape: next, at: point, animated: true)
    } else {
      place(panel, shape: shape, at: point, animated: false)
    }
  }

  func end(windowId: String?, fallback: NSRect?) {
    let panel = self.panel
    let showing = shape != "hidden"
    let whole = windowId != nil ? composeWindow() : nil
    release()
    guard let panel, showing else {
      panel?.orderOut(nil)
      return
    }
    let gen = generation
    let fade: () -> Void = { [weak self] in
      guard let self, self.generation == gen else { return }
      self.animate(panel, to: panel.frame, alpha: 0, duration: Self.fadeOut) { panel.orderOut(nil) }
    }
    guard let windowId, let fallback, fallback.width > 0 else { return fade() }
    if let whole { show(whole.image, windowAspect: whole.aspect) }
    var tries = 0
    func grow() {
      guard generation == gen else { return }
      guard let window = WindowManager.shared.windows[windowId] else {
        tries += 1
        if tries > 20 { return animate(panel, to: fallback, alpha: 1, duration: Self.grow, then: fade) }
        return DispatchQueue.main.asyncAfter(deadline: .now() + 0.016) { grow() }
      }
      if background { panel.order(.above, relativeTo: window.windowNumber) }
      animate(panel, to: window.frame, alpha: 1, duration: Self.grow) {
        WindowManager.shared.whenRevealed(windowId, fade)
      }
    }
    grow()
  }

  func cancel() {
    animation?.invalidate()
    animation = nil
    panel?.orderOut(nil)
    release()
  }

  private func release() {
    generation += 1
    shape = "hidden"
    wanted = "hidden"
    windowAspect = 0
    if let sourceClosing { NotificationCenter.default.removeObserver(sourceClosing) }
    sourceClosing = nil
    source = nil
    windowImage = nil
    pageImage = nil
    placeholder = false
    cardImage = nil
    pillImage = nil
  }

  private func hide() {
    animation?.invalidate()
    animation = nil
    guard shape != "hidden" else { return }
    shape = "hidden"
    panel?.orderOut(nil)
  }

  var debugState: [String: Any] {
    let frame = panel?.frame ?? .zero
    return [
      "shape": shape, "shapes": shapes, "visible": panel?.isVisible ?? false, "alpha": panel?.alphaValue ?? 0,
      "frame": [frame.minX, frame.minY, frame.width, frame.height], "page": pageImage != nil, "placeholder": placeholder,
      "key": panel?.isKeyWindow ?? false, "ignoresMouse": panel?.ignoresMouseEvents ?? false,
      "level": panel?.level.rawValue ?? 0, "activeApp": NSRunningApplication.current.isActive,
    ]
  }

  private func animate(_ panel: NSPanel, to frame: NSRect, alpha: CGFloat, duration: Double, then done: (() -> Void)? = nil) {
    animation?.invalidate()
    desired = frame
    let from = panel.frame, fromAlpha = panel.alphaValue
    let start = ProcessInfo.processInfo.systemUptime
    let timer = Timer(timeInterval: 1.0 / 120, repeats: true) { [weak self] timer in
      let t = min(1, (ProcessInfo.processInfo.systemUptime - start) / max(duration, 0.001))
      let target = self?.desired ?? frame
      let e = 1 - pow(1 - t, 3)
      let mix = { (a: CGFloat, b: CGFloat) in a + (b - a) * e }
      panel.setFrame(NSRect(x: mix(from.minX, target.minX), y: mix(from.minY, target.minY), width: mix(from.width, target.width),
        height: mix(from.height, target.height)), display: true)
      self?.layoutPicture()
      panel.alphaValue = mix(fromAlpha, alpha)
      guard t >= 1 else { return }
      timer.invalidate()
      if self?.animation === timer { self?.animation = nil }
      done?()
    }
    RunLoop.main.add(timer, forMode: .common)
    animation = timer
  }

  private func makePanel() -> Panel {
    let panel = Panel(contentRect: NSRect(origin: .zero, size: Self.card), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    panel.isFloatingPanel = !background
    panel.level = background ? .normal : .floating
    panel.ignoresMouseEvents = true
    panel.hidesOnDeactivate = false
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.animationBehavior = .none
    panel.isReleasedWhenClosed = false
    panel.collectionBehavior = [.transient, .ignoresCycle, .fullScreenAuxiliary, .canJoinAllSpaces]
    let view = NSView(frame: panel.contentLayoutRect)
    view.wantsLayer = true
    view.autoresizingMask = [.width, .height]
    rim.frame = view.bounds
    rim.autoresizingMask = [.layerWidthSizable, .layerHeightSizable]
    rim.masksToBounds = true
    rim.borderWidth = 0.5
    picture.frame = rim.bounds
    picture.contentsGravity = .resizeAspectFill
    rim.addSublayer(picture)
    view.layer?.addSublayer(rim)
    panel.contentView = view
    self.panel = panel
    return panel
  }

  private func place(_ panel: NSPanel, shape: String, at point: NSPoint, animated: Bool) {
    let pill = shape == "pill"
    let size = pill ? pillSize : Self.card
    let offset = pill ? grab : NSPoint(x: size.width / 2, y: size.height / 2)
    let frame = NSRect(x: (point.x - offset.x).rounded(), y: (point.y - size.height + offset.y).rounded(), width: size.width, height: size.height)
    show(pill ? pillImage : cardImage, fit: pill)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    rim.cornerRadius = pill ? 10 : 4
    rim.borderColor = NSColor(white: 1, alpha: pill ? 0.15 : 0.3).cgColor
    CATransaction.commit()
    if animated, panel.frame.size != frame.size {
      animate(panel, to: frame, alpha: 1, duration: Self.morph)
    } else if animation == nil {
      panel.setFrame(frame, display: false)
    } else {
      desired = frame
    }
    layoutPicture()
  }

  private func show(_ image: CGImage?, windowAspect: CGFloat = 0, fit: Bool = false) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    self.windowAspect = windowAspect
    picture.contents = image
    picture.contentsGravity = windowAspect > 0 ? .resize : fit ? .resizeAspect : .resizeAspectFill
    CATransaction.commit()
    layoutPicture()
  }

  private func layoutPicture() {
    guard let bounds = panel?.contentView?.bounds else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    rim.frame = bounds
    if windowAspect > 0 {
      let height = bounds.width * windowAspect
      picture.frame = CGRect(x: 0, y: bounds.height - height, width: bounds.width, height: height)
    } else {
      picture.frame = bounds
    }
    CATransaction.commit()
  }

  private func composeWindow() -> (image: CGImage, aspect: CGFloat)? {
    guard let window = source, let base = windowImage else { return nil }
    let size = window.frame.size
    guard size.width > 0, size.height > 0 else { return nil }
    let width = base.width, height = base.height
    let scale = CGFloat(width) / size.width
    guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.interpolationQuality = .high
    ctx.draw(base, in: CGRect(x: 0, y: 0, width: width, height: height))
    if let page = pageImage {
      let r = page.frame
      ctx.draw(page.image, in: CGRect(x: r.minX * scale, y: CGFloat(height) - r.maxY * scale, width: r.width * scale, height: r.height * scale))
    }
    guard let image = ctx.makeImage() else { return nil }
    return (image, size.height / size.width)
  }

  private func composeCard() {
    guard let window = source, let base = windowImage else { return }
    let size = window.frame.size
    let scale = 2.0
    let width = Int(Self.card.width * scale), height = Int(Self.card.height * scale)
    guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
    let fit = max(Self.card.width / size.width, Self.card.height / size.height) * scale
    let drawn = CGRect(x: 0, y: CGFloat(height) - size.height * fit, width: size.width * fit, height: size.height * fit)
    ctx.interpolationQuality = .high
    ctx.draw(base, in: drawn)
    if let page = pageImage {
      let r = page.frame
      ctx.draw(page.image, in: CGRect(x: r.minX * fit, y: drawn.maxY - r.maxY * fit, width: r.width * fit, height: r.height * fit))
    }
    cardImage = ctx.makeImage()
  }

  private static func snapshot(_ window: NSWindow, scale: CGFloat, of rect: NSRect? = nil) -> CGImage? {
    guard let view = window.contentView, let layer = view.layer else { return nil }
    let size = view.bounds.size
    let part = rect ?? NSRect(origin: .zero, size: size)
    guard part.width > 0, part.height > 0,
      let ctx = CGContext(data: nil, width: Int(part.width * scale), height: Int(part.height * scale), bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    ctx.setFillColor((window.backgroundColor ?? .windowBackgroundColor).cgColor)
    ctx.fill(CGRect(x: 0, y: 0, width: part.width * scale, height: part.height * scale))
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: -part.minX, y: part.maxY - size.height)
    if view.isFlipped || layer.isGeometryFlipped {
      ctx.translateBy(x: 0, y: size.height)
      ctx.scaleBy(x: 1, y: -1)
    }
    layer.render(in: ctx)
    return ctx.makeImage()
  }
}
