import AppKit

enum SyntheticInput {
  static func key(
    _ type: NSEvent.EventType, in window: NSWindow, characters: String, ignoringModifiers: String? = nil,
    modifiers: NSEvent.ModifierFlags = [], keyCode: Int = 0, isARepeat: Bool = false
  ) -> NSEvent? {
    NSEvent.keyEvent(
      with: type, location: .zero, modifierFlags: modifiers, timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: ignoringModifiers ?? characters,
      isARepeat: isARepeat, keyCode: UInt16(keyCode))
  }

  static func hardwareKey(
    _ type: NSEvent.EventType, in window: NSWindow, keyCode: Int, modifiers: NSEvent.ModifierFlags = [], isARepeat: Bool = false
  ) -> NSEvent? {
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(keyCode), keyDown: type == .keyDown) else { return nil }
    if type == .flagsChanged { event.type = .flagsChanged }
    let requested = CGEventFlags(rawValue: UInt64(modifiers.intersection(.deviceIndependentFlagsMask).rawValue))
    event.flags = event.flags.intersection([.maskSecondaryFn, .maskNumericPad, .maskNonCoalesced]).union(requested)
    event.timestamp = CGEventTimestamp(ProcessInfo.processInfo.systemUptime * 1_000_000_000)
    event.setIntegerValueField(.keyboardEventAutorepeat, value: isARepeat ? 1 : 0)
    guard let windowNumberField else { return nil }
    event.setIntegerValueField(windowNumberField, value: Int64(window.windowNumber))
    return NSEvent(cgEvent: event)
  }

  private static let windowNumberField = CGEventField(rawValue: 51)

  static func contentPoint(x: CGFloat, top: CGFloat, in content: NSView) -> NSPoint {
    NSPoint(x: x, y: content.isFlipped ? top : content.bounds.height - top)
  }
}
