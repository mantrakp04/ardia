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

  static func contentPoint(x: CGFloat, top: CGFloat, in content: NSView) -> NSPoint {
    NSPoint(x: x, y: content.isFlipped ? top : content.bounds.height - top)
  }
}
