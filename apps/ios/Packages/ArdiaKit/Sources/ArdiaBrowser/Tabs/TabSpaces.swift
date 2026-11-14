import Foundation

public struct TabSpaces: Equatable, Sendable {
  public var current: String?
  public var defaultID: String?
  public var known: Set<String>

  public static let unsynced = TabSpaces(current: nil, defaultID: nil, known: [])

  public init(current: String?, defaultID: String?, known: Set<String>) {
    self.current = current
    self.defaultID = defaultID
    self.known = known
  }

  public var isSplit: Bool {
    guard let current else { return false }
    return known.contains(current)
  }

  public func space(of profileSyncId: String?) -> String? {
    guard let profileSyncId, known.contains(profileSyncId) else { return defaultID }
    return profileSyncId
  }

  public func contains(_ profileSyncId: String?) -> Bool {
    guard isSplit else { return true }
    return space(of: profileSyncId) == current
  }
}
