import AppKit
import QuartzCore

private let trackingScale = 0.5
private let rubberDimension = 255.0
private let rubberCoefficient = 0.15
private let flickVelocity = 5.0
private let omega = 2 * Double.pi / 0.25
private let restDisplacement = 0.003
private let restSpeed = 0.1
private let historyWindow = 0.1
private let linkStall = 0.05

private func rubberBand(_ value: Double, _ dimension: Double) -> Double {
  (1 - 1 / (value * rubberCoefficient / dimension + 1)) * dimension
}

private final class PagerFrames: NSObject {
  weak var pager: Pager?
  let generation: Int

  init(_ pager: Pager, generation: Int) {
    self.pager = pager
    self.generation = generation
  }

  @objc func frame(_ link: CADisplayLink) {
    guard let pager, pager.frame(generation: generation, fromLink: true) else { return link.invalidate() }
  }
}

final class Pager {
  enum Phase: String { case idle, tracking, holding, settling }

  private struct Drag {
    var start = 0.0, lo = 0, hi = 0, home = 0, detent = 0
    weak var area: SwipeArea?
  }

  private struct Spring {
    let from: Double
    let target: Int
    let velocity: Double
    let start: CFTimeInterval
  }

  private static var pagers: [String: Pager] = [:]
  private static let lock = NSLock()
  private static var snapshots: [String: [String: Any]] = [:]
  private static var counter = 0

  static func named(_ key: String) -> Pager {
    if let pager = pagers[key] { return pager }
    let pager = Pager(key: key)
    pagers[key] = pager
    return pager
  }

  static func existing(_ key: String) -> Pager? { pagers[key] }

  static func snapshot(_ key: String) -> [String: Any]? {
    lock.lock()
    defer { lock.unlock() }
    return snapshots[key]
  }

  let key: String
  private let areas = NSHashTable<SwipeArea>.weakObjects()
  private var configured = false
  private var count = 1
  private var order: [String]?
  private var selected = 0
  private var position = 0.0
  private var velocity = 0.0
  private var phase = Phase.idle
  private var sequence = 0
  private var selectionSequence = 0
  private var propSelected = 0
  private var propAck = 0
  private var drag = Drag()
  private var history: [(time: TimeInterval, position: Double)] = []
  private var spring: Spring?
  private var link: CADisplayLink?
  private var lastLinkFrame: CFTimeInterval = 0
  private var timer: Timer?
  private var generation = 0
  #if DEBUG
  private var lastInput: [String: Any] = [:]
  #endif

  private init(key: String) { self.key = key }

  func attach(_ area: SwipeArea) {
    areas.add(area)
    if configured { area.onPagerPosition(["position": position]) }
  }

  func detach(_ area: SwipeArea) {
    areas.remove(area)
    prune()
  }

  func prune() {
    guard areas.allObjects.isEmpty, Pager.pagers[key] === self else { return }
    stopSpring()
    Pager.pagers[key] = nil
    Pager.lock.lock()
    Pager.snapshots[key] = nil
    Pager.lock.unlock()
  }

  func configure(selected newSelected: Int, count newCount: Int, ack: Int, order newOrder: [String]?) {
    let count = max(1, newCount)
    propSelected = min(max(newSelected, 0), count - 1)
    propAck = max(propAck, ack)
    if !configured {
      configured = true
      self.count = count
      order = newOrder
      selected = propSelected
      position = Double(selected)
      sequence = Pager.next()
      publish()
      emitPosition()
      return
    }
    if count != self.count || (newOrder != nil && newOrder != order) {
      var index = propSelected
      let old = order
      self.count = count
      order = newOrder
      if propAck < selectionSequence, let old, selected < old.count, let moved = order?.firstIndex(of: old[selected]) {
        index = moved
      }
      cancelMotion()
      jump(to: index)
      return
    }
    reconcile()
  }

  private func reconcile() {
    guard phase == .idle, propAck >= selectionSequence, propSelected != selected else { return }
    jump(to: propSelected)
  }

  private func jump(to index: Int, selection: Bool = false) {
    announceActivity()
    selected = index
    position = Double(index)
    velocity = 0
    sequence = Pager.next()
    if selection { selectionSequence = sequence }
    publish()
    emitPosition()
  }

  func input(from area: SwipeArea, phase input: String, distance: Double, direction: Int, timestamp: TimeInterval) {
    #if DEBUG
    lastInput = ["phase": input, "distance": distance, "direction": direction, "timestamp": timestamp]
    #endif
    switch input {
    case "prepare":
      announceActivity { ArdiaWebView.wakeNeighbourPages(in: $0, seconds: 1, committed: false) }
      if phase == .settling {
        stopSpring()
        phase = .holding
        publish()
      }
    case "abandon":
      if phase == .holding {
        settle(to: selected, velocity: 0)
      } else if phase == .tracking, drag.area === area {
        release(velocity: 0, cancelled: false)
      } else {
        announceActivity { ArdiaWebView.releaseNeighbourPages(in: $0) }
      }
    case "began":
      begin(area)
      track(distance, direction, timestamp, sample: true)
    case "changed":
      guard phase == .tracking, drag.area === area else { return }
      track(distance, direction, timestamp, sample: true)
    case "ended", "cancelled":
      guard phase == .tracking, drag.area === area else { return }
      track(distance, direction, timestamp, sample: false)
      release(velocity: releaseVelocity(at: timestamp), cancelled: input == "cancelled")
    default:
      break
    }
  }

  private func begin(_ area: SwipeArea) {
    announceActivity()
    stopSpring()
    let home = selected
    let x = position
    let lo = max(0, min(home - 1, Int(x.rounded(.down))))
    let hi = min(count - 1, max(home + 1, Int(x.rounded(.up))))
    drag = Drag(start: x, lo: lo, hi: hi, home: home, detent: min(max(Int(x.rounded()), lo), hi), area: area)
    history = []
    velocity = 0
    phase = .tracking
    sequence = Pager.next()
    publish()
    emitState("began")
  }

  private func track(_ distance: Double, _ direction: Int, _ timestamp: TimeInterval, sample: Bool) {
    guard let area = drag.area else { return }
    let width = area.pageWidth
    guard width > 0 else { return }
    let raw = drag.start + Double(direction > 0 ? -1 : 1) * distance * trackingScale / width
    let lo = Double(drag.lo), hi = Double(drag.hi)
    let x = raw > hi ? hi + rubberBand((raw - hi) * width, rubberDimension) / width
      : raw < lo ? lo - rubberBand((lo - raw) * width, rubberDimension) / width
      : raw
    position = x
    if sample {
      let time = max(timestamp, history.last?.time ?? timestamp)
      history.append((time, x))
      history.removeAll { time - $0.time > historyWindow }
    }
    let nearest = min(max(Int(x.rounded()), drag.lo), drag.hi)
    if nearest != drag.detent {
      drag.detent = nearest
      ArdiaSwipe.performHaptic("alignment")
    }
    publish()
    emitPosition()
  }

  private func releaseVelocity(at timestamp: TimeInterval) -> Double {
    let recent = history.filter { timestamp - $0.time <= historyWindow }
    guard recent.count >= 2, let first = recent.first, let last = recent.last, last.time > first.time else { return 0 }
    return (last.position - first.position) / (last.time - first.time)
  }

  private func release(velocity v: Double, cancelled: Bool) {
    let home = drag.home
    let area = drag.area
    let width = area?.pageWidth ?? 0
    drag.area = nil
    var target = home
    if !cancelled {
      let flick = abs(v * width) >= flickVelocity
      target = !flick ? Int(position.rounded()) : v > 0 ? Int(position.rounded(.down)) + 1 : Int(position.rounded(.up)) - 1
      target = max(0, home - 1, min(count - 1, home + 1, target))
    }
    settle(to: target, velocity: towards(target, v), from: area)
  }

  private func towards(_ target: Int, _ v: Double) -> Double {
    let d = Double(target) - position
    return d != 0 && v != 0 && (d > 0) == (v > 0) ? v : 0
  }

  func switchTo(_ index: Int, order newOrder: [String]? = nil) -> Bool {
    guard configured else { return false }
    sync(order: newOrder)
    let target = min(max(index, 0), count - 1)
    drag.area = nil
    let v = phase == .settling ? velocity : 0
    settle(to: target, velocity: towards(target, v))
    return true
  }

  private func sync(order newOrder: [String]?) {
    guard let ids = newOrder, ids != order, !ids.isEmpty else { return }
    let current = order.flatMap { selected < $0.count ? $0[selected] : nil }
    let id = current.flatMap { ids.contains($0) ? $0 : nil } ?? ids[min(max(propSelected, 0), ids.count - 1)]
    _ = select(id, order: ids)
  }

  func select(_ profileId: String, order ids: [String]) -> Bool {
    guard configured else { return false }
    guard let index = ids.firstIndex(of: profileId) else { return false }
    cancelMotion()
    count = ids.count
    order = ids
    jump(to: index, selection: true)
    emitState("selected")
    return true
  }

  func step(_ delta: Int, wrap: Bool, order newOrder: [String]? = nil) -> Bool {
    guard configured else { return false }
    sync(order: newOrder)
    let target = wrap ? ((selected + delta) % count + count) % count : min(max(selected + delta, 0), count - 1)
    return target == selected || switchTo(target)
  }

  private func settle(to target: Int, velocity v: Double, from origin: SwipeArea? = nil) {
    announceActivity()
    if target != selected {
      selected = target
      sequence = Pager.next()
      selectionSequence = sequence
      publish()
      emitState("selected")
    }
    stopSpring()
    phase = .settling
    velocity = v
    spring = Spring(from: position, target: target, velocity: v, start: CACurrentMediaTime())
    let generation = self.generation
    if let screen = origin?.window?.screen ?? areas.allObjects.lazy.compactMap({ $0.window?.screen }).first {
      let link = screen.displayLink(target: PagerFrames(self, generation: generation), selector: #selector(PagerFrames.frame(_:)))
      let fps = Float(max(60, screen.maximumFramesPerSecond))
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: fps, preferred: fps)
      link.add(to: .main, forMode: .common)
      self.link = link
      lastLinkFrame = CACurrentMediaTime()
    }
    let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] timer in
      guard let self else { return timer.invalidate() }
      if self.link != nil, CACurrentMediaTime() - self.lastLinkFrame < linkStall { return }
      if !self.frame(generation: generation) { timer.invalidate() }
    }
    RunLoop.main.add(timer, forMode: .common)
    self.timer = timer
    publish()
  }

  fileprivate func frame(generation: Int, fromLink: Bool = false) -> Bool {
    guard generation == self.generation, spring != nil else { return false }
    if fromLink { lastLinkFrame = CACurrentMediaTime() }
    step()
    return generation == self.generation
  }

  private func step() {
    guard let s = spring else { return }
    let t = CACurrentMediaTime() - s.start
    let x0 = s.from - Double(s.target)
    let b = s.velocity + omega * x0
    let decay = exp(-omega * t)
    let x = (x0 + b * t) * decay
    let v = (s.velocity - omega * b * t) * decay
    if abs(x) < restDisplacement && abs(v) < restSpeed {
      stopSpring()
      position = Double(s.target)
      velocity = 0
      phase = .idle
      sequence = Pager.next()
      publish()
      emitPosition()
      emitState("settled")
      reconcile()
      return
    }
    position = Double(s.target) + x
    velocity = v
    publish()
    emitPosition()
  }

  private func stopSpring() {
    generation += 1
    link?.invalidate()
    link = nil
    timer?.invalidate()
    timer = nil
    spring = nil
  }

  private func cancelMotion() {
    stopSpring()
    drag.area = nil
    phase = .idle
    velocity = 0
  }

  private static func next() -> Int {
    counter += 1
    return counter
  }

  private func emitPosition() {
    let area = phase == .tracking ? drag.area : nil
    let all = areas.allObjects
    (area ?? all.first { $0.window != nil } ?? all.first)?.onPagerPosition(["position": position])
  }

  private func emitState(_ name: String) {
    var event: [String: Any] = ["phase": name, "sequence": sequence, "position": position, "selected": selected, "velocity": velocity]
    if order != nil { event["profileId"] = selectedId }
    for area in areas.allObjects { area.onPagerState(event) }
  }

  private func announceActivity(_ tell: (NSWindow) -> Void = { ArdiaWebView.wakeNeighbourPages(in: $0) }) {
    var windows: [NSWindow] = []
    for case let window? in areas.allObjects.map(\.window) where !windows.contains(where: { $0 === window }) { windows.append(window) }
    windows.forEach(tell)
  }

  private func publish() {
    var state: [String: Any] = [
      "sequence": sequence, "selectionSequence": selectionSequence, "position": position, "selected": selected,
      "phase": phase.rawValue, "velocity": velocity, "count": count,
    ]
    if order != nil { state["profileId"] = selectedId }
    Pager.lock.lock()
    Pager.snapshots[key] = state
    Pager.lock.unlock()
  }

  private var selectedId: Any {
    guard let ids = order, selected >= 0, selected < ids.count else { return NSNull() }
    return ids[selected]
  }

  #if DEBUG
  func debug() -> [String: Any] {
    var out = Pager.snapshot(key) ?? [:]
    out["areas"] = areas.allObjects.count
    out["propSelected"] = propSelected
    out["propAck"] = propAck
    out["history"] = history.count
    out["lastInput"] = lastInput
    if phase == .tracking {
      out["drag"] = ["start": drag.start, "lo": drag.lo, "hi": drag.hi, "home": drag.home, "detent": drag.detent]
    }
    return out
  }
  #endif
}
