import AppKit
import ExpoModulesCore

public class CardNotchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaCardNotch")

    Constant("drivesLights") { true }
    Constant("trigger") { "corner" }

    AsyncFunction("devState") { () -> [[String: Any]] in
      #if DEBUG
      return CardNotchView.live.allObjects.map(\.devState)
      #else
      return []
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devSamples") { (start: Bool) -> [[Double]] in
      #if DEBUG
      return CardNotchView.live.allObjects.first { $0.window != nil }?.devSamples(start: start) ?? []
      #else
      return []
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devPointer") { (x: Double, y: Double, on: Bool) -> [String] in
      #if DEBUG
      return CardNotchView.live.allObjects.compactMap { $0.devPointer(on ? CGPoint(x: x, y: y) : nil) }
      #else
      return []
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devFreeze") { (on: Bool) -> [String: Any] in
      #if DEBUG
      return CardNotchView.live.allObjects.first { $0.window != nil }?.devFreeze(on) ?? [:]
      #else
      return [:]
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devHitTest") { (x: Double, y: Double) -> String in
      #if DEBUG
      guard let window = CardNotchView.live.allObjects.first(where: { $0.window != nil })?.window, let frame = window.contentView?.superview,
        let content = window.contentView
      else { return "" }
      let point = frame.convert(NSPoint(x: x, y: content.bounds.height - y), from: nil)
      guard let hit = frame.hitTest(point) else { return "nil" }
      var chain: [String] = []
      var view: NSView? = hit
      while let current = view, chain.count < 4 {
        chain.append(NSStringFromClass(type(of: current)))
        view = current.superview
      }
      return chain.joined(separator: " < ")
      #else
      return ""
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devReleaseLightsHover") { (windowId: String) -> Int in
      #if DEBUG
      guard let window = WindowManager.shared.windows[windowId] else { return 0 }
      TrafficLights.devReleaseLightsHover(window)
      return LightsDiagnostics.counts["lights.hoverRelease"] ?? 0
      #else
      return 0
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devWindows") { () -> [String: Any] in
      #if DEBUG
      return ["windows": LightsDiagnostics.windowList(), "menusTracking": TrafficLights.shared.menusTracking, "counts": LightsDiagnostics.counts, "events": LightsDiagnostics.events]
      #else
      return [:]
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devHoverZoomButton") { (windowId: String) -> String in
      #if DEBUG
      guard let window = WindowManager.shared.windows[windowId], let zoom = TrafficLights.lightButton(window, .zoomButton) else { return "no button" }
      let point = zoom.convert(NSPoint(x: zoom.bounds.midX, y: zoom.bounds.midY), to: nil)
      guard let event = NSEvent.enterExitEvent(
        with: .mouseEntered, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0, trackingNumber: 0, userData: nil)
      else { return "no event" }
      let entered = #selector(NSResponder.mouseEntered(with:))
      let owners = zoom.trackingAreas.compactMap { $0.owner as AnyObject? }
      owners.filter { $0.responds(to: entered) }.forEach { _ = $0.perform(entered, with: event) }
      zoom.mouseEntered(with: event)
      return "\(zoom.className) areas=\(zoom.trackingAreas.count) owners=\(owners.map { NSStringFromClass(type(of: $0)) })"
      #else
      return ""
      #endif
    }.runOnQueue(.main)

    View(CardNotchView.self) {
      Prop("active") { (view: CardNotchView, on: Bool?) in view.active = on ?? false }
      Prop("notch") { (view: CardNotchView, size: [Double]?) in view.notch = CardNotchView.size(size) }
      Prop("radius") { (view: CardNotchView, radius: Double?) in view.radius = CGFloat(radius ?? 0) }
      Prop("bubble") { (view: CardNotchView, size: [Double]?) in view.bubble = CardNotchView.size(size) }
      Prop("zone") { (view: CardNotchView, zone: Double?) in view.zone = CGFloat(zone ?? 0) }
      Prop("slack") { (view: CardNotchView, slack: Double?) in view.slack = CGFloat(slack ?? 0) }
      Prop("spring") { (view: CardNotchView, spring: [Double]?) in
        if let spring, spring.count == 2 { view.spring = CardNotchSpring(response: max(0.01, spring[0]), damping: min(0.99, max(0.05, spring[1]))) }
      }
      Prop("closeDuration") { (view: CardNotchView, ms: Double?) in view.closeDuration = ms.map { $0 / 1000 } ?? CardNotchView.defaultCloseDuration }
      Prop("drivesLights") { (view: CardNotchView, on: Bool?) in view.drivesLights = on ?? false }
      Prop("frozen") { (view: CardNotchView, on: Bool?) in view.frozen = on ?? false }
      OnViewDidUpdateProps { (view: CardNotchView) in view.propsDidUpdate() }
    }
  }
}

struct CardNotchSpring: Equatable {
  var response: Double
  var damping: Double

  var omega: Double { 2 * .pi / response }
}

final class CardNotchView: ExpoView {
  static let live = NSHashTable<CardNotchView>.weakObjects()
  static let defaultCloseDuration = 0.15
  static let trackingSettle = 0.08
  static let lightReach: CGFloat = 8
  static let lightsRestore = 0.1
  static let fullScreenSettle = 0.3
  static let bubbleNear: CGFloat = 20
  static let bubbleFloor: CGFloat = 0.3
  static let revealScale: CGFloat = 0.6
  static let levelStep: CGFloat = 0.004
  static let pokeSpring = CardNotchSpring(response: 0.15, damping: 0.9)

  enum Stage: String { case closed, bubble, open }

  static func size(_ pair: [Double]?) -> CGSize {
    guard let pair, pair.count == 2 else { return .zero }
    return CGSize(width: pair[0], height: pair[1])
  }

  var active = false
  var notch: CGSize = .zero
  var radius: CGFloat = 0
  var bubble: CGSize = .zero
  var zone: CGFloat = 0
  var slack: CGFloat = 0
  var spring = CardNotchSpring(response: 0.185, damping: 0.77)
  var closeDuration = defaultCloseDuration
  var drivesLights = false
  var frozen = false

  private(set) var stage = Stage.closed
  private var level: CGFloat = 0
  private let cover = CardNotchCover()
  private var glides: [String: CardNotchGlide] = [:]
  private var tracking: (area: NSTrackingArea, view: NSView, rect: NSRect)?
  private var trackingWanted: NSRect?
  private lazy var pointerOwner = CardNotchPointer(self)
  private var drivingLights = false
  private var lightsOutOfStep = false
  private var fullScreenHold = false
  private var fullScreenWatch: [NSObjectProtocol] = []
  private var menuWait: NSObjectProtocol?
  private var miniaturizeWatch: NSObjectProtocol?
  private var hideGeneration = 0
  private var lastPointer: CGPoint?
  private var rechecks = 0
  #if DEBUG
  private var pointerEventCount = 0
  private var samples: [[Double]]?
  private var sampler: CADisplayLink?
  private var devInside = false
  private var devCost: [String: (count: Int, ms: Double)] = [:]
  #endif

  private func measured<T>(_ name: String, _ body: () -> T) -> T {
    #if DEBUG
    let start = CACurrentMediaTime()
    defer {
      let spent = devCost[name] ?? (0, 0)
      devCost[name] = (spent.count + 1, spent.ms + (CACurrentMediaTime() - start) * 1000)
    }
    #endif
    return body()
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    Self.live.add(self)
    addSubview(cover)
  }

  deinit {
    NSObject.cancelPreviousPerformRequests(withTarget: self)
    if let menuWait { NotificationCenter.default.removeObserver(menuWait) }
    if let miniaturizeWatch { NotificationCenter.default.removeObserver(miniaturizeWatch) }
    fullScreenWatch.forEach { NotificationCenter.default.removeObserver($0) }
    if let tracking { tracking.view.removeTrackingArea(tracking.area) }
  }

  private var ready: Bool {
    active && window != nil && notch.width > 0 && notch.height > 0 && bubble.width > 0 && bubble.height > 0 && zone > 0
  }

  private var suspended: Bool { frozen || fullScreenHold }

  func propsDidUpdate() {
    measured("props") {
      cover.setGeometry(notch: notch, radius: radius, bubble: bubble)
      if suspended { return suspend() }
      updateLightsDriving()
      if !ready { setStage(.closed, animated: false) }
      updateTracking(settle: false)
      updateMiniaturizeWatch()
      if ready { placeCover() }
    }
  }

  private func suspend() {
    NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(recheckPointer), object: nil)
    NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(installTracking), object: nil)
    trackingWanted = tracking?.rect
    endMenuWait()
    if drivingLights { lightsOutOfStep = true }
    guard stage != .closed || cover.shown else { return }
    stage = .closed
    level = 0
    hideGeneration += 1
    glides = [:]
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    cover.shape.removeAllAnimations()
    cover.setMask(\.width, to: targetSize(.closed).width)
    cover.setMask(\.height, to: targetSize(.closed).height)
    cover.setScale(0)
    cover.conceal()
    CATransaction.commit()
  }

  override func didAddSubview(_ subview: NSView) {
    super.didAddSubview(subview)
    if subview !== cover { raiseCover() }
  }

  override func layout() {
    super.layout()
    raiseCover()
  }

  private func raiseCover() {
    guard cover.superview === self, subviews.last !== cover else { return }
    addSubview(cover, positioned: .above, relativeTo: nil)
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    guard !suspended else { return }
    measured("frame") { updateTracking(settle: true) }
  }

  override func setFrameOrigin(_ newOrigin: NSPoint) {
    super.setFrameOrigin(newOrigin)
    guard !suspended else { return }
    measured("frame") {
      if cover.shown { placeCover() }
      updateTracking(settle: true)
    }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    drivingLights = false
    NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(installTracking), object: nil)
    if let tracking { tracking.view.removeTrackingArea(tracking.area) }
    tracking = nil
    trackingWanted = nil
    fullScreenHold = false
    watchFullScreen()
    if window == nil { setStage(.closed, animated: false) }
    propsDidUpdate()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    cover.backingScale = window?.backingScaleFactor ?? 2
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    if !suspended, stage != .closed, let superview, cover.contains(cardPoint(local: convert(point, from: superview))) { return nil }
    return super.hitTest(point)
  }

  private func watchFullScreen() {
    fullScreenWatch.forEach { NotificationCenter.default.removeObserver($0) }
    fullScreenWatch = []
    guard let window else { return }
    let center = NotificationCenter.default
    let hold: (Notification) -> Void = { [weak self] _ in
      guard let self else { return }
      NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(self.endFullScreenHold), object: nil)
      self.fullScreenHold = true
      self.suspend()
    }
    let settle: (Notification) -> Void = { [weak self] _ in
      guard let self else { return }
      NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(self.endFullScreenHold), object: nil)
      self.perform(#selector(self.endFullScreenHold), with: nil, afterDelay: Self.fullScreenSettle)
    }
    fullScreenWatch = [
      center.addObserver(forName: NSWindow.willEnterFullScreenNotification, object: window, queue: .main, using: hold),
      center.addObserver(forName: NSWindow.willExitFullScreenNotification, object: window, queue: .main, using: hold),
      center.addObserver(forName: NSWindow.didEnterFullScreenNotification, object: window, queue: .main, using: settle),
      center.addObserver(forName: NSWindow.didExitFullScreenNotification, object: window, queue: .main, using: settle),
    ]
  }

  @objc private func endFullScreenHold() {
    guard fullScreenHold else { return }
    fullScreenHold = false
    propsDidUpdate()
  }

  private func cardPoint(local: NSPoint) -> CGPoint {
    CGPoint(x: local.x - bounds.minX, y: isFlipped ? local.y - bounds.minY : bounds.maxY - local.y)
  }

  private var cardCornerInWindow: NSPoint {
    convert(NSPoint(x: bounds.minX, y: isFlipped ? bounds.minY : bounds.maxY), to: nil)
  }

  private func cardPoint(window point: NSPoint) -> CGPoint {
    let corner = cardCornerInWindow
    return CGPoint(x: point.x - corner.x, y: corner.y - point.y)
  }

  private func cardRectInView(_ rect: CGRect) -> NSRect {
    isFlipped
      ? NSRect(x: bounds.minX + rect.minX, y: bounds.minY + rect.minY, width: rect.width, height: rect.height)
      : NSRect(x: bounds.minX + rect.minX, y: bounds.maxY - rect.maxY, width: rect.width, height: rect.height)
  }

  private func placeCover() {
    guard let content = window?.contentView else { return }
    let corner = cardCornerInWindow
    let top = content.convert(content.bounds, to: nil).maxY - corner.y
    let rect = cover.reach(cardOffset: CGPoint(x: corner.x, y: top))
    cover.place(cardRect: rect, frame: cardRectInView(rect))
  }

  private func trackingRect() -> NSRect? {
    guard ready, let window, let content = window.contentView else { return nil }
    let corner = cardCornerInWindow
    let reach = CGSize(width: max(zone, notch.width + slack), height: max(zone, notch.height + slack))
    let top = content.convert(content.bounds, to: nil).maxY
    let zoneInWindow = NSRect(x: 0, y: corner.y - reach.height, width: corner.x + reach.width, height: top - corner.y + reach.height)
    return content.convert(zoneInWindow, from: nil).integral
  }

  private func updateTracking(settle: Bool) {
    let wanted = trackingRect()
    let current = tracking.flatMap { $0.view === window?.contentView ? $0.rect : nil }
    if wanted == current {
      if trackingWanted != wanted { NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(installTracking), object: nil) }
      trackingWanted = wanted
      return
    }
    guard wanted != trackingWanted || !settle else { return }
    trackingWanted = wanted
    NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(installTracking), object: nil)
    if settle, wanted != nil {
      perform(#selector(installTracking), with: nil, afterDelay: Self.trackingSettle)
    } else {
      installTracking()
    }
  }

  private var trackingStale: Bool {
    guard let tracking else { return false }
    return tracking.rect != trackingWanted || tracking.view !== window?.contentView
  }

  @objc private func installTracking() {
    guard !suspended else { return }
    let wanted = trackingRect()
    guard wanted == trackingWanted, trackingStale || (tracking == nil && wanted != nil) else { return }
    if let tracking {
      tracking.view.removeTrackingArea(tracking.area)
      self.tracking = nil
      #if DEBUG
      LightsDiagnostics.count("notch.trackingRemove")
      #endif
    }
    guard let rect = wanted, let content = window?.contentView else { return }
    let area = NSTrackingArea(rect: rect, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways], owner: pointerOwner, userInfo: nil)
    content.addTrackingArea(area)
    tracking = (area, content, rect)
    #if DEBUG
    LightsDiagnostics.count("notch.trackingAdd")
    #endif
  }

  private func updateMiniaturizeWatch() {
    let wanted = ready ? window : nil
    if let miniaturizeWatch {
      NotificationCenter.default.removeObserver(miniaturizeWatch)
      self.miniaturizeWatch = nil
    }
    guard let wanted else { return }
    miniaturizeWatch = NotificationCenter.default.addObserver(forName: NSWindow.willMiniaturizeNotification, object: wanted, queue: .main) {
      [weak self] _ in self?.setStage(.closed, animated: false)
    }
  }

  fileprivate func pointerEvent(_ event: NSEvent?) {
    #if DEBUG
    pointerEventCount += 1
    #endif
    guard !suspended, !trackingStale else { return }
    measured("pointer") {
      guard let event, event.window == nil || event.window === window else { return pointerGone() }
      pointer(at: cardPoint(window: event.locationInWindow))
    }
  }

  func bubbleLevel(at distance: CGFloat) -> CGFloat {
    guard distance < zone else { return 0 }
    let t = min(1, max(0, (zone - distance) / max(1, zone - Self.bubbleNear)))
    return Self.bubbleFloor + (1 - Self.bubbleFloor) * t * t * (3 - 2 * t)
  }

  func pointer(at p: CGPoint) {
    lastPointer = p
    guard ready else { return setStage(.closed, animated: false) }
    let near = bubbleLevel(at: (p.x * p.x + p.y * p.y).squareRoot())
    if stage == .open {
      if p.x <= notch.width + slack, p.y <= notch.height + slack { return endMenuWait() }
      return leaveOpen(to: near > 0 ? .bubble : .closed, level: near)
    }
    if revealable(p) { return setStage(.open) }
    setStage(near > 0 ? .bubble : .closed, level: near)
    if stage == .bubble, cover.contains(p, scale: near, maskSize: targetSize(.bubble)) { scheduleRecheck(fresh: true) }
  }

  private func revealable(_ p: CGPoint) -> Bool {
    cover.presentedScale >= Self.revealScale && cover.contains(p)
  }

  private func scheduleRecheck(fresh: Bool) {
    if fresh { rechecks = 0 }
    NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(recheckPointer), object: nil)
    guard rechecks < 8 else { return }
    rechecks += 1
    perform(#selector(recheckPointer), with: nil, afterDelay: 1.0 / 30)
  }

  @objc private func recheckPointer() {
    guard !suspended, stage == .bubble, let p = lastPointer else { return }
    if revealable(p) { setStage(.open) } else { scheduleRecheck(fresh: false) }
  }

  private func pointerGone() {
    lastPointer = nil
    guard stage == .open else { return setStage(.closed) }
    leaveOpen(to: .closed, level: 0)
  }

  private func leaveOpen(to next: Stage, level: CGFloat) {
    if let window, TrafficLights.shared.pointerOverTrafficLights(window) { return }
    guard TrafficLights.shared.menusTracking == 0 else { return waitForMenus() }
    endMenuWait()
    setStage(next, level: level)
  }

  private func waitForMenus() {
    guard menuWait == nil else { return }
    menuWait = NotificationCenter.default.addObserver(forName: NSMenu.didEndTrackingNotification, object: nil, queue: .main) { [weak self] _ in
      DispatchQueue.main.async { self?.menusEnded() }
    }
  }

  private func endMenuWait() {
    guard let menuWait else { return }
    NotificationCenter.default.removeObserver(menuWait)
    self.menuWait = nil
  }

  private func menusEnded() {
    guard TrafficLights.shared.menusTracking == 0 else { return }
    endMenuWait()
    guard !suspended, let window, stage == .open else { return }
    let mouse = window.convertPoint(fromScreen: NSEvent.mouseLocation)
    let inside = tracking.map { $0.view.convert($0.rect, to: nil).contains(mouse) } ?? false
    if inside { pointer(at: cardPoint(window: mouse)) } else { leaveOpen(to: .closed, level: 0) }
  }

  private func targetSize(_ stage: Stage) -> CGSize {
    cover.maskSize(tab: stage == .open ? notch : bubble)
  }

  private func targetScale(_ stage: Stage, level: CGFloat) -> CGFloat {
    switch stage {
    case .closed: return 0
    case .bubble: return level
    case .open: return 1
    }
  }

  func setStage(_ next: Stage, level: CGFloat = 1, animated: Bool = true) {
    measured("stage>" + next.rawValue) { applyStage(next, level: level, animated: animated) }
  }

  private func applyStage(_ next: Stage, level nextLevel: CGFloat, animated: Bool) {
    let moving = cover.shape.animationKeys()?.isEmpty == false
    if next == stage, animated {
      guard next == .bubble, abs(nextLevel - level) > Self.levelStep else { return }
    } else if next == stage, !moving, !cover.shown {
      return
    }
    #if DEBUG
    LightsDiagnostics.count(next == stage ? "notch.level" : "notch.stage")
    #endif
    let previous = stage
    stage = next
    level = next == .bubble ? nextLevel : 0
    if next != .open { endMenuWait() }
    let now = CACurrentMediaTime()
    let size = targetSize(next)
    let scale = Double(targetScale(next, level: level))
    let opening = next == .open
    hideGeneration += 1
    let generation = hideGeneration
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if next == .closed {
      CATransaction.setCompletionBlock { [weak self] in
        guard let self, self.hideGeneration == generation, self.stage == .closed else { return }
        self.cover.conceal()
      }
    } else {
      placeCover()
      cover.reveal()
    }
    let channels: [(key: String, path: String, value: Double, presented: Double, curve: (Double) -> CardNotchGlide.Curve)] = [
      ("w", "bounds.size.width", Double(size.width), Double(cover.presentedMask(\.width)), { v in opening ? .spring(self.spring, v) : .ease(self.closeDuration) }),
      ("h", "bounds.size.height", Double(size.height), Double(cover.presentedMask(\.height)), { v in opening ? .spring(self.spring, v) : .ease(self.closeDuration) }),
      ("s", "transform.scale", scale, Double(cover.presentedScale), { v in
        opening ? .spring(self.spring, v) : next == .closed || (previous == .open && next == .bubble) ? .ease(self.closeDuration) : .spring(Self.pokeSpring, v)
      }),
    ]
    for channel in channels {
      let carried = glides[channel.key]?.velocity(at: now) ?? 0
      let velocity = channel.key == "s" && carried * (channel.value - channel.presented) < 0 && channel.presented < 0.3 ? 0 : carried
      if channel.key == "s" { cover.setScale(CGFloat(scale)) } else { cover.setMask(channel.key == "w" ? \.width : \.height, to: CGFloat(channel.value)) }
      glides[channel.key] = nil
      cover.shape.removeAnimation(forKey: channel.key)
      guard animated, abs(channel.value - channel.presented) > 0.0005 else { continue }
      let glide = CardNotchGlide(from: channel.presented, to: channel.value, start: now, curve: channel.curve(velocity))
      cover.shape.add(glide.animation(keyPath: channel.path), forKey: channel.key)
      glides[channel.key] = glide
    }
    if drivingLights, previous != next || lightsOutOfStep, let window { driveLights(in: window, open: opening, animated: animated, now: now) }
    if next == .closed, cover.shape.animationKeys()?.isEmpty != false { cover.conceal() }
    CATransaction.commit()
  }

  private func driveLights(in window: NSWindow, open: Bool, animated: Bool, now: CFTimeInterval) {
    lightsOutOfStep = false
    if !open, TrafficLights.lightButton(window, .closeButton)?.isHidden != false { return }
    let span = lightsSpan(in: window)
    let r = Double(radius)
    let reveal = { (w: Double, h: Double, s: Double) -> Double in
      let w = (w - r) * s + r, h = (h - r) * s + r
      return min(1, max(0, min((w - span.low.width) / (span.high.width - span.low.width), (h - span.low.height) / (span.high.height - span.low.height))))
    }
    let glides = (w: animated ? self.glides["w"] : nil, h: animated ? self.glides["h"] : nil, s: animated ? self.glides["s"] : nil)
    let model = (size: cover.shape.bounds.size, scale: Double(cover.modelScale))
    TrafficLights.shared.setTrafficLightsAlpha(of: window, alpha: open ? 1 : 0) { _ in
      let duration = [glides.w, glides.h, glides.s].compactMap { $0?.duration }.max() ?? 0
      return CardNotchGlide.keyframes(keyPath: "opacity", start: now, duration: duration) { t in
        reveal(glides.w?.value(at: t) ?? Double(model.size.width), glides.h?.value(at: t) ?? Double(model.size.height), glides.s?.value(at: t) ?? model.scale)
      }
    }
  }

  private func lightsSpan(in window: NSWindow) -> (low: CGSize, high: CGSize) {
    let full = targetSize(.open)
    let corner = cardCornerInWindow
    let lights = TrafficLights.trafficLightButtons(window)
      .map { $0.convert($0.bounds, to: nil) }.map { NSRect(x: $0.midX - Self.lightReach, y: $0.midY - Self.lightReach, width: 2 * Self.lightReach, height: 2 * Self.lightReach) }
      .reduce(NSRect.null) { $0.union($1) }
    let reach = lights.isNull ? CGSize(width: notch.width - radius, height: notch.height - radius)
      : CGSize(width: lights.maxX - corner.x, height: corner.y - lights.minY)
    let low = CGSize(width: min(full.width - 1, reach.width + full.width - notch.width), height: min(full.height - 1, reach.height + full.height - notch.height))
    return (low, full)
  }

  private func updateLightsDriving() {
    let wanted = drivesLights && active && window != nil
    guard let window else { return }
    if wanted == drivingLights {
      guard wanted, lightsOutOfStep else { return }
      lightsOutOfStep = false
      return fadeLights(in: window, to: stage == .open ? 1 : 0)
    }
    drivingLights = wanted
    lightsOutOfStep = false
    fadeLights(in: window, to: wanted ? (stage == .open ? 1 : 0) : 1)
  }

  private func fadeLights(in window: NSWindow, to alpha: CGFloat) {
    let duration = alpha > 0 ? Self.lightsRestore : closeDuration
    TrafficLights.shared.setTrafficLightsAlpha(of: window, alpha: alpha) { from in
      CardNotchGlide(from: from, to: Double(alpha), start: CACurrentMediaTime(), curve: .ease(duration)).animation(keyPath: "opacity")
    }
  }

  #if DEBUG
  var devState: [String: Any] {
    let lights = window.flatMap { TrafficLights.lightButton($0, .closeButton) }
    return [
      "active": active, "ready": ready, "stage": stage.rawValue, "drivingLights": drivingLights, "pointerEvents": pointerEventCount,
      "trackingRect": tracking.map { NSStringFromRect($0.rect) } ?? "", "trackingPending": trackingWanted != nil && tracking == nil,
      "window": window?.windowNumber ?? 0, "menuWait": menuWait != nil, "sampling": sampler != nil,
      "lightsHidden": lights?.isHidden ?? true, "lightsModelAlpha": Double(lights?.layer?.opacity ?? -1), "lightsViewAlpha": Double(lights?.alphaValue ?? -1),
      "lightsPresentedAlpha": Double(lights?.layer?.presentation()?.opacity ?? -1), "lightsAnimations": lights?.layer?.animationKeys() ?? [],
      "cover": cover.devDescription + " index=\(subviews.firstIndex(of: cover) ?? -1)/\(subviews.count)",
      "lightsFrame": lights.map { NSStringFromRect($0.convert($0.bounds, to: nil)) } ?? "", "lightsClass": lights?.superview.map { NSStringFromClass(type(of: $0)) } ?? "",
      "standardLightsHidden": window?.standardWindowButton(.closeButton)?.isHidden ?? true,
      "cardCornerInWindow": NSStringFromPoint(cardCornerInWindow), "level": Double(level), "frozen": frozen, "fullScreenHold": fullScreenHold,
      "nativeCost": devCost.mapValues { ["count": $0.count, "ms": ($0.ms * 1000).rounded() / 1000] },
    ]
  }

  func devSamples(start: Bool) -> [[Double]] {
    let taken = samples ?? []
    sampler?.invalidate()
    sampler = nil
    samples = nil
    if start {
      samples = []
      let link = displayLink(target: CardNotchSampler(self), selector: #selector(CardNotchSampler.frame(_:)))
      link.add(to: .main, forMode: .common)
      sampler = link
    }
    return taken
  }

  fileprivate func sample(_ link: CADisplayLink) {
    let lights = window.flatMap { TrafficLights.lightButton($0, .closeButton) }?.layer
    samples?.append([
      link.timestamp, Double(cover.presentedMask(\.width)), Double(cover.presentedMask(\.height)),
      Double(lights?.presentation()?.opacity ?? -1), stage == .open ? 2 : stage == .bubble ? 1 : 0, cover.shown ? 1 : 0, Double(cover.presentedScale),
    ])
  }

  func devFreeze(_ on: Bool) -> [String: Any] {
    let lights = (window.map { TrafficLights.trafficLightButtons($0) } ?? []).compactMap(\.layer)
    for layer in [cover.layer].compactMap({ $0 }) + lights {
      if on {
        layer.timeOffset = layer.convertTime(CACurrentMediaTime(), from: nil)
        layer.speed = 0
      } else {
        let paused = layer.timeOffset
        layer.speed = 1
        layer.timeOffset = 0
        layer.beginTime = 0
        layer.beginTime = layer.convertTime(CACurrentMediaTime(), from: nil) - paused
      }
    }
    return devState
  }

  func devPointer(_ point: CGPoint?) -> String? {
    guard let window, let content = window.contentView else { return nil }
    let location = point.map { NSPoint(x: $0.x, y: content.bounds.height - $0.y) } ?? NSPoint(x: -1000, y: -1000)
    let inside = tracking.map { $0.view.convert($0.rect, to: nil).contains(location) } ?? false
    let now = ProcessInfo.processInfo.systemUptime
    let selector: String
    let event: NSEvent?
    switch (inside, devInside) {
    case (true, false):
      selector = "mouseEntered:"
      event = NSEvent.enterExitEvent(
        with: .mouseEntered, location: location, modifierFlags: [], timestamp: now, windowNumber: window.windowNumber, context: nil,
        eventNumber: 0, trackingNumber: 0, userData: nil)
    case (true, true):
      selector = "mouseMoved:"
      event = NSEvent.mouseEvent(
        with: .mouseMoved, location: location, modifierFlags: [], timestamp: now, windowNumber: window.windowNumber, context: nil,
        eventNumber: 0, clickCount: 0, pressure: 0)
    case (false, true):
      selector = "mouseExited:"
      event = NSEvent.enterExitEvent(
        with: .mouseExited, location: location, modifierFlags: [], timestamp: now, windowNumber: window.windowNumber, context: nil,
        eventNumber: 0, trackingNumber: 0, userData: nil)
    case (false, false):
      return "outside"
    }
    devInside = inside
    guard let event, let owner = tracking?.area.owner as AnyObject? else { return "no tracking" }
    _ = owner.perform(NSSelectorFromString(selector), with: event)
    return selector
  }
  #endif
}

private final class CardNotchPointer: NSObject {
  weak var view: CardNotchView?

  init(_ view: CardNotchView) {
    self.view = view
  }

  @objc(mouseEntered:) func mouseEntered(with event: NSEvent) { view?.pointerEvent(event) }
  @objc(mouseMoved:) func mouseMoved(with event: NSEvent) { view?.pointerEvent(event) }
  @objc(mouseExited:) func mouseExited(with event: NSEvent) { view?.pointerEvent(nil) }
}

#if DEBUG
private final class CardNotchSampler: NSObject {
  weak var view: CardNotchView?

  init(_ view: CardNotchView) {
    self.view = view
  }

  @objc func frame(_ link: CADisplayLink) {
    guard let view else { return link.invalidate() }
    view.sample(link)
  }
}
#endif

struct CardNotchGlide {
  enum Curve {
    case spring(CardNotchSpring, Double)
    case ease(Double)
  }

  static let ease = (x1: 0.65, y1: 0.0, x2: 0.35, y2: 1.0)

  let from: Double
  let to: Double
  let start: CFTimeInterval
  let curve: Curve

  private var springVelocity: Double {
    guard case .spring(_, let velocity) = curve, to != from else { return 0 }
    return velocity / (to - from)
  }

  var duration: Double {
    switch curve {
    case .spring: return (animation(keyPath: "opacity") as? CASpringAnimation)?.settlingDuration ?? 0
    case .ease(let duration): return duration
    }
  }

  func value(at time: CFTimeInterval) -> Double {
    let t = time - start
    guard t > 0 else { return from }
    switch curve {
    case .spring(let spring, _):
      let omega = spring.omega, zeta = spring.damping
      guard zeta < 1 else { return to }
      let wd = omega * (1 - zeta * zeta).squareRoot()
      let b = (zeta * omega - springVelocity) / wd
      return from + (to - from) * (1 - exp(-zeta * omega * t) * (cos(wd * t) + b * sin(wd * t)))
    case .ease(let duration):
      guard duration > 0, t < duration else { return to }
      return from + (to - from) * Self.bezier(Self.solve(t / duration), Self.ease.y1, Self.ease.y2)
    }
  }

  static func keyframes(keyPath: String, start: CFTimeInterval, duration: Double, value: (CFTimeInterval) -> Double) -> CAKeyframeAnimation? {
    guard duration > 0 else { return nil }
    let steps = max(2, Int((duration * 120).rounded(.up)))
    let samples = (0...steps).map { value(start + duration * Double($0) / Double(steps)) }
    guard let last = samples.last else { return nil }
    let end = max(1, (samples.lastIndex { abs($0 - last) > 0.0005 } ?? 0) + 1)
    let animation = CAKeyframeAnimation(keyPath: keyPath)
    animation.values = Array(samples[0...end])
    animation.keyTimes = (0...end).map { NSNumber(value: Double($0) / Double(end)) }
    animation.calculationMode = .linear
    animation.duration = duration * Double(end) / Double(steps)
    return animation
  }

  private static func solve(_ u: Double) -> Double {
    var lo = 0.0, hi = 1.0
    for _ in 0..<24 {
      let mid = (lo + hi) / 2
      if bezier(mid, ease.x1, ease.x2) < u { lo = mid } else { hi = mid }
    }
    return (lo + hi) / 2
  }

  func animation(keyPath: String) -> CABasicAnimation {
    switch curve {
    case .spring(let spring, _):
      let animation = CASpringAnimation(keyPath: keyPath)
      animation.mass = 1
      animation.stiffness = spring.omega * spring.omega
      animation.damping = 2 * spring.damping * spring.omega
      animation.initialVelocity = springVelocity
      animation.duration = animation.settlingDuration
      animation.fromValue = from
      animation.toValue = to
      return animation
    case .ease(let duration):
      let animation = CABasicAnimation(keyPath: keyPath)
      animation.duration = duration
      animation.timingFunction = CAMediaTimingFunction(
        controlPoints: Float(Self.ease.x1), Float(Self.ease.y1), Float(Self.ease.x2), Float(Self.ease.y2))
      animation.fromValue = from
      animation.toValue = to
      return animation
    }
  }

  func velocity(at time: CFTimeInterval) -> Double {
    let t = time - start
    guard t >= 0 else { return 0 }
    switch curve {
    case .spring(let spring, _):
      let omega = spring.omega, zeta = spring.damping
      guard zeta < 1 else { return 0 }
      let wd = omega * (1 - zeta * zeta).squareRoot()
      let v0 = springVelocity
      let b = (zeta * omega - v0) / wd
      let rate = exp(-zeta * omega * t) * (v0 * cos(wd * t) + (zeta * omega * b + wd) * sin(wd * t))
      return (to - from) * rate
    case .ease(let duration):
      guard duration > 0, t < duration else { return 0 }
      let s = Self.solve(t / duration)
      let dx = Self.bezierSlope(s, Self.ease.x1, Self.ease.x2)
      guard dx > 1e-6 else { return 0 }
      return (to - from) * Self.bezierSlope(s, Self.ease.y1, Self.ease.y2) / dx / duration
    }
  }

  private static func bezier(_ s: Double, _ p1: Double, _ p2: Double) -> Double {
    3 * (1 - s) * (1 - s) * s * p1 + 3 * (1 - s) * s * s * p2 + s * s * s
  }

  private static func bezierSlope(_ s: Double, _ p1: Double, _ p2: Double) -> Double {
    3 * (1 - s) * (1 - s) * p1 + 6 * (1 - s) * s * (p2 - p1) + 3 * s * s * (1 - p2)
  }
}

fileprivate final class CardNotchCover: NSView {
  static let minScale: CGFloat = 0.001
  let shape = CALayer()
  var backingScale: CGFloat = 2 { didSet { if backingScale != oldValue { source = nil } } }
  private var treatment: NSView?
  private var notch: CGSize = .zero
  private var radius: CGFloat = 0
  private var bubble: CGSize = .zero
  private var source: CGImage?

  override var isFlipped: Bool { false }

  init() {
    super.init(frame: .zero)
    wantsLayer = true
    setAccessibilityElement(false)
    shape.anchorPoint = CGPoint(x: 0, y: 1)
    shape.contentsGravity = .resize
    shape.bounds = .zero
    shape.transform = CATransform3DMakeScale(Self.minScale, Self.minScale, 1)
    shape.actions = ["bounds": NSNull(), "position": NSNull(), "contents": NSNull(), "contentsCenter": NSNull(), "contentsScale": NSNull(), "transform": NSNull()]
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func makeBackingLayer() -> CALayer {
    let layer = super.makeBackingLayer()
    layer.mask = shape
    layer.isHidden = !shown
    return layer
  }

  private var margin: CGFloat { radius }

  func setGeometry(notch: CGSize, radius: CGFloat, bubble: CGSize) {
    guard notch != self.notch || radius != self.radius || bubble != self.bubble else { return }
    self.notch = notch
    self.radius = radius
    self.bubble = bubble
    source = nil
  }

  func maskSize(tab: CGSize) -> CGSize {
    CGSize(width: margin + tab.width + radius, height: margin + tab.height + radius)
  }

  func reach(cardOffset: CGPoint) -> CGRect {
    let left = max(cardOffset.x, margin), top = max(cardOffset.y, margin)
    return CGRect(x: -left, y: -top, width: left + notch.width + radius + 2, height: top + notch.height + radius + 2)
  }

  func place(cardRect: CGRect, frame: NSRect) {
    if layer?.mask !== shape { layer?.mask = shape }
    if layer?.isHidden != !shown { layer?.isHidden = !shown }
    if source == nil { makeSource() }
    if self.frame != frame {
      self.frame = frame
      treatment?.needsLayout = true
      #if DEBUG
      LightsDiagnostics.count("notch.coverFrame")
      #endif
    }
    if treatment == nil || treatment?.window !== window { attachTreatment() }
    let origin = CGPoint(x: -margin - cardRect.minX, y: frame.height + margin + cardRect.minY)
    if shape.position != origin { shape.position = origin }
  }

  private(set) var shown = false

  func reveal() {
    guard !shown else { return }
    shown = true
    layer?.isHidden = false
  }

  func conceal() {
    guard shown else { return }
    shown = false
    layer?.isHidden = true
  }

  func setMask(_ axis: WritableKeyPath<CGSize, CGFloat>, to value: CGFloat) {
    var bounds = shape.bounds
    bounds.size[keyPath: axis] = value
    shape.bounds = bounds
  }

  func presentedMask(_ axis: KeyPath<CGSize, CGFloat>) -> CGFloat {
    (shown ? shape.presentation() ?? shape : shape).bounds.size[keyPath: axis]
  }

  func setScale(_ scale: CGFloat) {
    shape.transform = CATransform3DMakeScale(max(Self.minScale, scale), max(Self.minScale, scale), 1)
  }

  var modelScale: CGFloat { shape.transform.m11 }

  var presentedScale: CGFloat {
    guard shown else { return 0 }
    return (shape.presentation() ?? shape).transform.m11
  }

  func contains(_ p: CGPoint, scale: CGFloat? = nil, maskSize: CGSize? = nil) -> Bool {
    guard maskSize != nil || shown else { return false }
    let s = scale ?? presentedScale
    guard s > Self.minScale else { return false }
    let size = maskSize ?? (shape.presentation() ?? shape).bounds.size
    let q = CGPoint(x: -margin + (p.x + margin) / s, y: -margin + (p.y + margin) / s)
    let w = size.width - margin - radius, h = size.height - margin - radius, r = radius
    guard w > 0, h > 0, q.x >= 0, q.y >= 0 else { return false }
    if q.x <= w, q.y <= h {
      guard q.x > w - r, q.y > h - r else { return true }
      return hypot(q.x - (w - r), q.y - (h - r)) <= r
    }
    if q.x > w, q.x <= w + r, q.y <= r { return hypot(q.x - (w + r), q.y - r) >= r }
    if q.y > h, q.y <= h + r, q.x <= r { return hypot(q.x - r, q.y - (h + r)) >= r }
    return false
  }

  private func attachTreatment() {
    treatment?.removeFromSuperview()
    treatment = nil
    guard let window, let registry = NSClassFromString("ArdiaWindowTreatments") as AnyObject?,
      registry.responds(to: NSSelectorFromString("makeCoverFor:")),
      let made = registry.perform(NSSelectorFromString("makeCoverFor:"), with: window)?.takeUnretainedValue() as? NSView
    else { return }
    made.frame = bounds
    made.autoresizingMask = [.width, .height]
    addSubview(made)
    treatment = made
    #if DEBUG
    LightsDiagnostics.count("notch.clone")
    #endif
  }

  private func makeSource() {
    let r = radius, m = margin
    let size = maskSize(tab: notch)
    let scale = backingScale
    let width = Int(ceil(size.width * scale)), height = Int(ceil(size.height * scale))
    guard notch.width > 2 * r, notch.height > 2 * r, width > 0, height > 0,
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(),
        bitmapInfo: CGImageAlphaInfo.alphaOnly.rawValue)
    else { return }
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: scale, y: -scale)
    context.translateBy(x: m, y: m)
    for path in Self.frameParts(notch: notch, radius: r, margin: m) {
      context.addPath(path)
      context.fillPath()
    }
    guard let image = context.makeImage() else { return }
    source = image
    let full = CGSize(width: CGFloat(width) / scale, height: CGFloat(height) / scale)
    let fixed = 2 * r
    shape.contents = image
    shape.contentsScale = scale
    shape.contentsCenter = CGRect(
      x: fixed / full.width, y: fixed / full.height, width: max(0, full.width - 2 * fixed) / full.width,
      height: max(0, full.height - 2 * fixed) / full.height)
  }

  static func frameParts(notch: CGSize, radius r: CGFloat, margin m: CGFloat) -> [CGPath] {
    let w = notch.width, h = notch.height
    let tab = CGMutablePath()
    tab.move(to: CGPoint(x: -m, y: -m))
    tab.addLine(to: CGPoint(x: w, y: -m))
    tab.addLine(to: CGPoint(x: w, y: h - r))
    tab.addArc(tangent1End: CGPoint(x: w, y: h), tangent2End: CGPoint(x: w - r, y: h), radius: r)
    tab.addLine(to: CGPoint(x: -m, y: h))
    tab.closeSubpath()
    let top = CGMutablePath()
    top.move(to: CGPoint(x: w, y: 0))
    top.addLine(to: CGPoint(x: w + r, y: 0))
    top.addArc(tangent1End: CGPoint(x: w, y: 0), tangent2End: CGPoint(x: w, y: r), radius: r)
    top.closeSubpath()
    let left = CGMutablePath()
    left.move(to: CGPoint(x: 0, y: h))
    left.addLine(to: CGPoint(x: 0, y: h + r))
    left.addArc(tangent1End: CGPoint(x: 0, y: h), tangent2End: CGPoint(x: r, y: h), radius: r)
    left.closeSubpath()
    let strips = CGPath(rect: CGRect(x: -m, y: -m, width: m + w + r, height: m), transform: nil)
    let side = CGPath(rect: CGRect(x: -m, y: -m, width: m, height: m + h + r), transform: nil)
    return [tab, top, left, strips, side]
  }

  #if DEBUG
  var devDescription: String {
    let presented = (shape.presentation() ?? shape).bounds.size
    return "shown=\(shown) layerHidden=\(layer?.isHidden ?? true) frame=\(NSStringFromRect(frame)) treatment=\(treatment.map { NSStringFromClass(type(of: $0)) } ?? "-") "
      + "mask=\(NSStringFromSize(shape.bounds.size)) presented=\(NSStringFromSize(presented)) scale=\(presentedScale) position=\(NSStringFromPoint(shape.position)) "
      + "maskAttached=\(layer?.mask === shape) source=\(source.map { "\($0.width)x\($0.height)" } ?? "-") animations=\(shape.animationKeys() ?? [])"
  }
  #endif
}
