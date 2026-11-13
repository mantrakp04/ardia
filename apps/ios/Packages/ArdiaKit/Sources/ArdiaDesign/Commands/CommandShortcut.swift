import SwiftUI

public struct CommandModifiers: OptionSet, Hashable, Sendable {
  public let rawValue: Int

  public init(rawValue: Int) {
    self.rawValue = rawValue
  }

  public static let command = CommandModifiers(rawValue: 1 << 0)
  public static let shift = CommandModifiers(rawValue: 1 << 1)
  public static let option = CommandModifiers(rawValue: 1 << 2)
  public static let control = CommandModifiers(rawValue: 1 << 3)
  public static let function = CommandModifiers(rawValue: 1 << 4)
}

public struct CommandShortcut: Hashable, Sendable, CustomStringConvertible {
  public let key: String
  public let modifiers: CommandModifiers

  public init(_ key: String, _ modifiers: CommandModifiers) {
    self.key = key
    self.modifiers = modifiers
  }

  public var isExpressible: Bool {
    keyEquivalent != nil && !modifiers.contains(.function)
  }

  public var keyEquivalent: KeyEquivalent? {
    switch key {
    case "\u{F700}": .upArrow
    case "\u{F701}": .downArrow
    case "\u{F702}": .leftArrow
    case "\u{F703}": .rightArrow
    case "\u{F72C}": .pageUp
    case "\u{F72D}": .pageDown
    case "\u{F729}": .home
    case "\u{F72B}": .end
    case "\u{8}": .delete
    case "\u{F728}": .deleteForward
    case "\u{D}": .return
    case "\u{9}": .tab
    case "\u{1B}": .escape
    case " ": .space
    default: Self.printable(key).map { KeyEquivalent($0) }
    }
  }

  public var keyboardShortcut: KeyboardShortcut? {
    guard isExpressible, let key = keyEquivalent else { return nil }
    return KeyboardShortcut(key, modifiers: eventModifiers)
  }

  public var eventModifiers: EventModifiers {
    var result: EventModifiers = []
    if modifiers.contains(.command) { result.insert(.command) }
    if modifiers.contains(.shift) { result.insert(.shift) }
    if modifiers.contains(.option) { result.insert(.option) }
    if modifiers.contains(.control) { result.insert(.control) }
    return result
  }

  public var description: String {
    let names: [(CommandModifiers, String)] = [(.control, "ctrl"), (.option, "opt"), (.shift, "shift"), (.command, "cmd")]
    let prefix = names.filter { modifiers.contains($0.0) }.map(\.1)
    let shown = key.unicodeScalars.map { $0.value > 0x20 && $0.value < 0xF700 ? String($0) : "u+" + String($0.value, radix: 16) }.joined()
    return (prefix + [shown]).joined(separator: "-")
  }

  private static func printable(_ key: String) -> Character? {
    guard key.count == 1, let character = key.first, let scalar = key.unicodeScalars.first else { return nil }
    let isPrivateUse = (0xF700...0xF8FF).contains(scalar.value)
    let isControl = scalar.value < 0x20 || scalar.value == 0x7F
    return isPrivateUse || isControl ? nil : character
  }
}
