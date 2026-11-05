import AppKit

final class TypeAheadHold {
  private final class Held {
    weak var window: NSWindow?
    var keys: [NSEvent] = []
    var watches: [NSObjectProtocol] = []
    var keyed = false
    var passing = false
    init(_ window: NSWindow) { self.window = window }
  }

  private var held: Held?
  private var monitor: Any?
  weak var keyOnReveal: NSWindow?

  var window: NSWindow? { held?.window }

  func hold(in window: NSWindow) {
    end(send: false)
    monitor = monitor ?? NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak self] event in
      guard let self, let held = self.held, let window = held.window, !held.passing, !held.keyed || event.window === window,
        !held.keys.isEmpty || (event.type == .keyDown && (!held.keyed || !event.modifierFlags.contains(.command)))
      else { return event }
      guard held.keys.count < 256 else {
        self.end(send: false)
        return event
      }
      held.keys.append(event)
      return nil
    }
    let held = Held(window)
    held.watches.append(window.observe(\.firstResponder) { [weak self, weak held] window, _ in
      guard held?.keyed == true, Self.takesTyping(window.firstResponder) else { return }
      DispatchQueue.main.async { if let held, self?.held === held { self?.end(send: true) } }
    })
    for name in [NSWindow.didResignKeyNotification, NSWindow.willCloseNotification] {
      held.watches.append(NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self, weak held] _ in
        if let held, self?.held === held { self?.end(send: false) }
      })
    }
    held.watches.append(NotificationCenter.default.addObserver(forName: NSWindow.didBecomeKeyNotification, object: nil, queue: .main) {
      [weak self, weak held, weak window] note in
      guard let self, let held, self.held === held, !held.keyed, note.object as? NSWindow !== window else { return }
      if self.keyOnReveal === window { self.keyOnReveal = nil }
      self.end(send: false)
    })
    self.held = held
  }

  func keyed(_ window: NSWindow) {
    guard let held, held.window === window, !held.keyed else { return }
    held.keyed = true
    held.keys = held.keys.compactMap { Self.retarget($0, to: window) }
    if Self.takesTyping(window.firstResponder) || !window.isKeyWindow { return end(send: window.isKeyWindow) }
    let first = held.keys.firstIndex { $0.type == .keyDown && !$0.modifierFlags.contains(.command) } ?? held.keys.endIndex
    let now = held.keys[..<first]
    held.keys.removeFirst(first)
    held.passing = true
    now.forEach { NSApp.sendEvent($0) }
    held.passing = false
  }

  func end(send: Bool) {
    guard let held else { return }
    self.held = nil
    for watch in held.watches {
      if let focused = watch as? NSKeyValueObservation { focused.invalidate() } else { NotificationCenter.default.removeObserver(watch) }
    }
    if send { held.keys.forEach { NSApp.sendEvent($0) } }
  }

  private static func retarget(_ event: NSEvent, to window: NSWindow) -> NSEvent? {
    if event.windowNumber == window.windowNumber { return event }
    return NSEvent.keyEvent(
      with: event.type, location: event.locationInWindow, modifierFlags: event.modifierFlags, timestamp: event.timestamp,
      windowNumber: window.windowNumber, context: nil, characters: event.characters ?? "",
      charactersIgnoringModifiers: event.charactersIgnoringModifiers ?? "", isARepeat: event.isARepeat, keyCode: event.keyCode)
  }

  private static func takesTyping(_ responder: NSResponder?) -> Bool {
    responder is NSTextView || responder.map { String(describing: type(of: $0)) == "RenderWidgetHostViewCocoa" } == true
  }
}
