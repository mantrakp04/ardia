import Foundation

public struct ImportedShortcut: Codable, Equatable, Sendable {
  public var action: String
  public var key: String
  public var modifiers: [String]

  public init(action: String, key: String, modifiers: [String]) {
    self.action = action
    self.key = key
    self.modifiers = modifiers
  }
}

public enum ArcKeyBindings {
  static let modifierBits: [(String, Int)] = [("control", 1 << 18), ("option", 1 << 19), ("shift", 1 << 17), ("command", 1 << 20), ("function", 1 << 23)]

  public static func parse(_ data: Data) -> [ImportedShortcut] {
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let overrides = root["userOverrides"] as? [[String: Any]]
    else { return [] }
    return overrides.compactMap { entry in
      guard let action = (entry["action"] as? [String: Any])?["identifier"] as? String,
        let valid = ((entry["state"] as? [String: Any])?["valid"] as? [String: Any])?["_0"] as? [String: Any],
        let key = valid["keyEquivalent"] as? String, !key.isEmpty,
        let flags = valid["deviceIndependentModifierFlags"] as? Int
      else { return nil }
      return ImportedShortcut(action: action, key: key, modifiers: modifierBits.filter { flags & $0.1 != 0 }.map(\.0))
    }
  }
}
