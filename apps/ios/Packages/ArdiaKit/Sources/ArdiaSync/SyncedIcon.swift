import Foundation

public enum SyncedIcon: Equatable, Hashable, Sendable {
  case symbol(String)
  case emoji(String)
  case initial(String)

  static let symbolPrefix = "symbol:"

  public init?(wire: String?) {
    guard let wire, !wire.isEmpty else { return nil }
    guard wire.hasPrefix(Self.symbolPrefix) else {
      self = .emoji(wire)
      return
    }
    let name = String(wire.dropFirst(Self.symbolPrefix.count))
    guard !name.isEmpty else { return nil }
    self = .symbol(name)
  }

  public static func badge(wire: String?, name: String) -> SyncedIcon {
    SyncedIcon(wire: wire) ?? .initial(name.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "?")
  }
}

extension SyncedProfile {
  public var badge: SyncedIcon { .badge(wire: icon, name: name) }
}

extension PinnedTile {
  public var mark: SyncedIcon? { SyncedIcon(wire: icon) }
}

extension PinnedTab {
  public var mark: SyncedIcon? { SyncedIcon(wire: icon) }
}

extension PinnedGroup {
  public var mark: SyncedIcon? { SyncedIcon(wire: icon) }
}
