import Foundation

public struct SpaceRoster: Equatable, Sendable {
  public let ids: [String]
  public let defaultId: String?

  public init(ids: [String], defaultId: String?) {
    self.ids = ids
    self.defaultId = defaultId
  }

  public init(snapshot: SyncSnapshot) {
    self.init(ids: snapshot.profiles.map(\.syncId), defaultId: snapshot.defaultProfile?.syncId)
  }

  public static let unnamed = SpaceRoster(ids: [], defaultId: nil)

  public var isUnnamed: Bool { ids.isEmpty }

  public func space(of profileSyncId: String?) -> String? {
    if let profileSyncId, ids.contains(profileSyncId) { return profileSyncId }
    return defaultId
  }

  public func contains(_ profileSyncId: String?, in space: String?) -> Bool {
    self.space(of: profileSyncId) == self.space(of: space)
  }

  public func cycled(from current: String?, by delta: Int) -> String? {
    guard ids.count > 1 else { return nil }
    let index = space(of: current).flatMap { ids.firstIndex(of: $0) } ?? 0
    let count = ids.count
    return ids[((index + delta) % count + count) % count]
  }
}
