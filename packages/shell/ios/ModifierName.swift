import AppKit
import ExpoModulesCore

enum ModifierName: String, Enumerable {
  case control
  case option
  case shift
  case command
  case function

  var flag: NSEvent.ModifierFlags {
    switch self {
    case .control: .control
    case .option: .option
    case .shift: .shift
    case .command: .command
    case .function: .function
    }
  }

  static func flags(_ names: [ModifierName]) -> NSEvent.ModifierFlags { NSEvent.ModifierFlags(names.map(\.flag)) }

  static func flags(named names: some Sequence<String>) -> NSEvent.ModifierFlags {
    flags(names.compactMap(ModifierName.init(rawValue:)))
  }

  static func names(_ flags: NSEvent.ModifierFlags) -> [String] { allCases.filter { flags.contains($0.flag) }.map(\.rawValue) }
}
