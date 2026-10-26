import AppKit
import ArdiaCore

final class FocusHandoff {
  static let shared = FocusHandoff()
  static let editActions: Set<Selector> = [
    #selector(NSText.cut(_:)), #selector(NSText.copy(_:)), #selector(NSText.paste(_:)), #selector(NSText.selectAll(_:)),
    Selector(("pasteAndMatchStyle:")),
  ]

  private enum Input {
    case action(Selector)
    case key(NSEvent, up: NSEvent?)
  }

  private struct Held {
    var input: Input
    var generation: Int?
    let at: TimeInterval
  }

  private final class Release {
    weak var target: NSResponder?
  }

  private final class Generation {
    let id: Int
    weak var destination: NSView?
    var claimed = false
    init(_ id: Int) { self.id = id }
  }

  private final class Gate {
    weak var window: NSWindow?
    weak var resigned: NSView?
    var restoresSource = true
    var deadline: CFTimeInterval = 0
    var generations: [Generation] = []
    var held: [Held] = []
    var watches: [NSObjectProtocol] = []
    init(_ window: NSWindow) { self.window = window }
  }

  private static let lifetime: CFTimeInterval = 0.4
  private static let capacity = 64
  private var gates: [ObjectIdentifier: Gate] = [:]
  private var generations = 0
  private var begun: Int?
  private var monitor: Any?
  private let editKeys = NSMapTable<NSEvent, NSArray>(keyOptions: .weakMemory, valueOptions: .strongMemory)
  private var epochs: [Int: Int] = [:]
  private var releases: [UInt16: Release] = [:]
  private var closedAt: [Int: TimeInterval] = [:]
  private var typedAfterGate: [Int: TimeInterval] = [:]
  private weak var acknowledged: NSEvent?
  private(set) var trace: [String] = []
  var afterPendingUI: (@escaping () -> Void) -> Void = { DispatchQueue.main.async(execute: $0) }

  var gatesKeyWindow: Bool { NSApp.keyWindow.map { gates[ObjectIdentifier($0)] != nil } ?? false }

  @discardableResult
  func begin(in window: NSWindow) -> Int? {
    guard window.isKeyWindow, WindowManager.shared.id(of: window) != nil else { return nil }
    let focused = window.firstResponder
    let existing = gates[ObjectIdentifier(window)]
    guard existing != nil || Self.isPage(focused) else { return nil }
    if Self.isPage(focused), let input = focused as? NSTextInputClient, input.hasMarkedText() { return nil }
    let gate = existing ?? open(in: window)
    if let page = focused as? NSView, Self.isPage(page) {
      NotificationCenter.default.post(name: .ardiaOutgoingFocus, object: page)
      gate.resigned = page
      window.makeFirstResponder(nil)
    }
    generations += 1
    drop(in: gate) { _ in true }
    gate.generations.append(Generation(generations))
    begun = generations
    note("begin \(generations)")
    return generations
  }

  func takeBegun() -> Int? {
    defer { begun = nil }
    return begun
  }

  func defers(_ action: Selector) -> Bool {
    guard let window = NSApp.keyWindow, let gate = gates[ObjectIdentifier(window)], live(gate) else {
      return dropsLateAcknowledgement(action, in: NSApp.keyWindow)
    }
    note("defer \(action)")
    guard !gate.generations.isEmpty else {
      settle(gate)
      return false
    }
    if let at = Self.origin(of: acknowledged ?? NSApp.currentEvent) {
      hold(.action(action), at: at, in: gate)
    } else if gate.held.isEmpty {
      hold(.action(action), at: ProcessInfo.processInfo.systemUptime, in: gate)
    } else {
      note("drop \(action): no origin")
      NSSound.beep()
    }
    return true
  }

  private func noteTyped(_ down: NSEvent, in window: NSWindow) {
    guard let closed = closedAt[window.windowNumber], ProcessInfo.processInfo.systemUptime - closed < 1 else { return }
    typedAfterGate[window.windowNumber] = max(typedAfterGate[window.windowNumber] ?? 0, down.timestamp)
  }

  private func dropsLateAcknowledgement(_ action: Selector, in window: NSWindow?) -> Bool {
    guard let window, let event = acknowledged, let closed = closedAt[window.windowNumber], event.timestamp < closed,
      let typed = typedAfterGate[window.windowNumber], typed > event.timestamp else { return false }
    note("drop \(action): acknowledged after later keys were replayed")
    NSSound.beep()
    return true
  }

  private static func origin(of event: NSEvent?) -> TimeInterval? {
    guard let event else { return nil }
    switch event.type {
    case .keyDown where event.modifierFlags.contains(.command): return event.timestamp
    case .leftMouseDown, .leftMouseUp: return event.timestamp
    default: return nil
    }
  }

  func claim(_ id: Int, destination: NSView) {
    note("claim \(id) \(type(of: destination))")
    guard let gate = gate(of: id), live(gate), let newest = gate.generations.last, newest.id == id else { return }
    newest.destination = destination
    newest.claimed = true
    deliverIfReady(gate)
  }

  func cancel(_ id: Int, restoringSource: Bool) {
    note("cancel \(id) restoring=\(restoringSource)")
    guard let gate = gate(of: id), let index = gate.generations.firstIndex(where: { $0.id == id }) else { return }
    if !restoringSource { gate.restoresSource = false }
    drop(in: gate) { $0.generation == id }
    gate.generations.remove(at: index)
    settle(gate)
  }

  func refusesUnhandledKey(_ event: NSEvent, in window: NSWindow) -> Bool {
    guard let tag = editKeys.object(forKey: event) as? [Int], tag.count == 2 else { return false }
    let current = [window.windowNumber, epochs[window.windowNumber] ?? 0]
    guard tag != current || NSApp.keyWindow !== window else {
      acknowledged = event
      DispatchQueue.main.async { [weak self] in if self?.acknowledged === event { self?.acknowledged = nil } }
      return false
    }
    NSSound.beep()
    return true
  }

  func install() {
    guard monitor == nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .leftMouseDown, .rightMouseDown]) { [weak self] event in
      guard let self, let window = event.window else { return event }
      let gate = self.gates[ObjectIdentifier(window)]
      if event.type == .leftMouseDown || event.type == .rightMouseDown {
        if let gate { self.end(gate, restoring: false) }
        return event
      }
      if event.type == .keyDown, Self.isEditKey(event) {
        self.editKeys.setObject([window.windowNumber, self.epochs[window.windowNumber] ?? 0] as NSArray, forKey: event)
      }
      if event.type == .keyUp { return self.releases(event, in: gate) ? nil : event }
      if gate == nil, !event.modifierFlags.contains(.command) { self.noteTyped(event, in: window) }
      guard let gate, !event.modifierFlags.contains(.command), self.live(gate), !gate.generations.isEmpty else {
        if !event.isARepeat { self.releases[event.keyCode] = nil }
        return event
      }
      self.releases[event.keyCode] = Release()
      self.hold(.key(event, up: nil), at: event.timestamp, in: gate)
      return nil
    }
    let center = NotificationCenter.default
    center.addObserver(forName: NSWindow.didBecomeKeyNotification, object: nil, queue: .main) { [weak self] note in
      guard let self, let window = note.object as? NSWindow else { return }
      self.epochs[window.windowNumber, default: 0] += 1
    }
    for name in [NSApplication.didResignActiveNotification, NSWindow.didResignKeyNotification] {
      center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.releases.removeAll() }
    }
    center.addObserver(forName: NSWindow.willCloseNotification, object: nil, queue: .main) { [weak self] note in
      guard let self, let window = note.object as? NSWindow else { return }
      self.closedAt[window.windowNumber] = nil
      self.typedAfterGate[window.windowNumber] = nil
    }
  }

  func noteForwarded(_ action: Selector) { note("forward \(action)") }

  private func releases(_ up: NSEvent, in gate: Gate?) -> Bool {
    guard let release = releases.removeValue(forKey: up.keyCode) else { return false }
    if let gate, let index = gate.held.lastIndex(where: {
      if case .key(let down, nil) = $0.input { return down.keyCode == up.keyCode }
      return false
    }), case .key(let down, _) = gate.held[index].input {
      gate.held[index].input = .key(down, up: up)
    } else {
      release.target?.keyUp(with: up)
    }
    return true
  }

  private func hold(_ input: Input, at: TimeInterval, in gate: Gate) {
    guard gate.held.count < Self.capacity else { return NSSound.beep() }
    let index = gate.held.lastIndex { $0.at <= at }.map { $0 + 1 } ?? 0
    gate.held.insert(Held(input: input, generation: gate.generations.last?.id, at: at), at: index)
  }

  private func open(in window: NSWindow) -> Gate {
    let gate = Gate(window)
    let key = ObjectIdentifier(window)
    gates[key] = gate
    gate.deadline = CACurrentMediaTime() + Self.lifetime
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.lifetime) { [weak self, weak gate] in
      guard let self, let gate, self.gates[key] === gate else { return }
      self.note("deadline")
      self.end(gate, restoring: true)
    }
    gate.watches.append(window.observe(\.firstResponder) { [weak self, weak gate] _, _ in
      DispatchQueue.main.async {
        guard let self, let gate, self.gates[key] === gate else { return }
        self.deliverIfReady(gate)
      }
    })
    for name in [NSWindow.didResignKeyNotification, NSWindow.willCloseNotification] {
      gate.watches.append(NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self, weak gate] _ in
        guard let self, let gate, self.gates[key] === gate else { return }
        self.end(gate, restoring: false)
      })
    }
    return gate
  }

  private func live(_ gate: Gate) -> Bool {
    if CACurrentMediaTime() < gate.deadline { return true }
    note("expired")
    end(gate, restoring: true)
    return false
  }

  private func settle(_ gate: Gate) {
    if gate.generations.isEmpty || CACurrentMediaTime() >= gate.deadline { end(gate, restoring: true) }
  }

  private func deliverIfReady(_ gate: Gate) {
    guard ready(gate) != nil else { return }
    afterPendingUI { [weak self, weak gate] in
      guard let self, let gate, let window = gate.window, self.gates[ObjectIdentifier(window)] === gate, self.live(gate),
        let (newest, responder) = self.ready(gate) else { return }
      let mine = gate.held.filter { $0.generation == newest.id }
      self.drop(in: gate) { $0.generation != newest.id }
      gate.held = []
      self.close(gate)
      if let destination = newest.destination { self.replay(mine, into: destination, in: window) }
    }
  }

  private func ready(_ gate: Gate) -> (Generation, NSView)? {
    guard let window = gate.window, let newest = gate.generations.last, newest.claimed, let destination = newest.destination,
      let responder = window.firstResponder as? NSView, responder === destination || responder.isDescendant(of: destination)
    else { return nil }
    return (newest, responder)
  }

  private func end(_ gate: Gate, restoring: Bool) {
    note("end restoring=\(restoring && gate.restoresSource)")
    drop(in: gate) { _ in true }
    close(gate)
    guard restoring, gate.restoresSource, let window = gate.window, Self.unfocused(window), let page = gate.resigned,
      page.window === window, !page.isHiddenOrHasHiddenAncestor else { return }
    window.makeFirstResponder(page)
  }

  private func close(_ gate: Gate) {
    guard let window = gate.window else { return }
    closedAt[window.windowNumber] = ProcessInfo.processInfo.systemUptime
    typedAfterGate[window.windowNumber] = nil
    let key = ObjectIdentifier(window)
    if gates[key] === gate { gates[key] = nil }
    gate.watches.forEach { ($0 as? NSKeyValueObservation)?.invalidate() ?? NotificationCenter.default.removeObserver($0) }
    gate.watches = []
    if let resigned = gate.resigned { NotificationCenter.default.post(name: .ardiaFocusHandoffEnded, object: resigned) }
  }

  private func gate(of id: Int) -> Gate? {
    gates.values.first { $0.generations.contains { $0.id == id } }
  }

  private func replay(_ held: [Held], into destination: NSView, in window: NSWindow) {
    guard !held.isEmpty else { return }
    note("replay \(held.count) into \(type(of: destination))")
    for entry in held { if case .key(let down, _) = entry.input { noteTyped(down, in: window) } }
    for (index, entry) in held.enumerated() {
      guard let responder = window.firstResponder as? NSView, responder === destination || responder.isDescendant(of: destination) else {
        return beep(Array(held[index...]))
      }
      switch entry.input {
      case .key(let down, let up):
        NSApp.sendEvent(down)
        if let up {
          responder.keyUp(with: up)
        } else if let release = releases[down.keyCode] {
          release.target = responder
        }
      case .action(let action):
        var selector = action
        if selector == Selector(("pasteAndMatchStyle:")), !responder.responds(to: selector) {
          selector = #selector(NSTextView.pasteAsPlainText(_:))
        }
        NSApp.sendAction(selector, to: responder, from: nil)
      }
    }
  }

  private func drop(in gate: Gate, where dropped: (Held) -> Bool) {
    let gone = gate.held.filter(dropped)
    guard !gone.isEmpty else { return }
    gate.held.removeAll(where: dropped)
    beep(gone)
  }

  private func beep(_ held: [Held]) {
    guard !held.isEmpty else { return }
    note("drop \(held.count)")
    NSSound.beep()
  }

  private func note(_ event: @autoclosure () -> String) {
    #if DEBUG
    let responder = NSApp.keyWindow?.firstResponder.map { String(describing: type(of: $0)) } ?? "nil"
    trace.append(String(format: "%.1f ", CACurrentMediaTime() * 1000) + event() + " fr=" + responder)
    if trace.count > 200 { trace.removeFirst(trace.count - 200) }
    #endif
  }

  private static func isEditKey(_ event: NSEvent) -> Bool {
    guard event.modifierFlags.contains(.command), !event.modifierFlags.contains(.control) else { return false }
    return ["x", "c", "v", "a"].contains(event.charactersIgnoringModifiers?.lowercased() ?? "")
  }

  static func isPage(_ responder: NSResponder?) -> Bool {
    responder.map { String(describing: type(of: $0)) == "RenderWidgetHostViewCocoa" } ?? false
  }

  private static func unfocused(_ window: NSWindow) -> Bool {
    window.firstResponder == nil || window.firstResponder === window
  }
}
