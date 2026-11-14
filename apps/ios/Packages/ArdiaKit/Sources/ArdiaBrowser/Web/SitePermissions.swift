import Foundation
import Observation

public enum SitePermission: String, Codable, CaseIterable, Comparable, Sendable {
  case camera
  case microphone
  case location

  public static func < (lhs: SitePermission, rhs: SitePermission) -> Bool {
    allCases.firstIndex(of: lhs)! < allCases.firstIndex(of: rhs)!
  }

  public var name: String {
    switch self {
    case .camera: String(localized: "Camera")
    case .microphone: String(localized: "Microphone")
    case .location: String(localized: "Location")
    }
  }
}

public struct SitePermissionGrant: Codable, Equatable, Hashable, Identifiable, Sendable {
  public var origin: String
  public var host: String
  public var permissions: Set<SitePermission>
  public var grantedAt: Date

  public var id: String { origin }

  public init(origin: String, host: String, permissions: Set<SitePermission>, grantedAt: Date) {
    self.origin = origin
    self.host = host
    self.permissions = permissions
    self.grantedAt = grantedAt
  }

  public var summary: String {
    permissions.sorted().map(\.name).formatted(.list(type: .and))
  }
}

@MainActor
@Observable
public final class SitePermissions {
  static let key = "browsing.sitePermissions"
  static let limit = 200

  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private let now: () -> Date

  public private(set) var grants: [SitePermissionGrant]

  public init(defaults: UserDefaults, now: @escaping () -> Date = Date.init) {
    self.defaults = defaults
    self.now = now
    let stored = defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode([SitePermissionGrant].self, from: $0) } ?? []
    grants = Self.sorted(stored.filter { !$0.permissions.isEmpty })
  }

  public static func origin(scheme: String, host: String, port: Int) -> String {
    let defaultPort = scheme == "https" ? 443 : scheme == "http" ? 80 : 0
    let base = "\(scheme.lowercased())://\(host.lowercased())"
    return port == 0 || port == defaultPort ? base : "\(base):\(port)"
  }

  public func allows(_ needed: Set<SitePermission>, origin: String) -> Bool {
    guard !needed.isEmpty, let grant = grants.first(where: { $0.origin == origin }) else { return false }
    return needed.isSubset(of: grant.permissions)
  }

  public func allow(_ granted: Set<SitePermission>, origin: String, host: String) {
    guard !granted.isEmpty, !origin.isEmpty else { return }
    var next = grants
    if let index = next.firstIndex(where: { $0.origin == origin }) {
      next[index].permissions.formUnion(granted)
      next[index].grantedAt = now()
    } else {
      next.append(SitePermissionGrant(origin: origin, host: host, permissions: granted, grantedAt: now()))
    }
    if next.count > Self.limit, let oldest = next.filter({ $0.origin != origin }).min(by: { $0.grantedAt < $1.grantedAt }) {
      next.removeAll { $0.origin == oldest.origin }
    }
    save(next)
  }

  public func revoke(_ permission: SitePermission, origin: String) {
    var next = grants
    guard let index = next.firstIndex(where: { $0.origin == origin }) else { return }
    next[index].permissions.remove(permission)
    if next[index].permissions.isEmpty { next.remove(at: index) }
    save(next)
  }

  public func revokeAll(origin: String) {
    save(grants.filter { $0.origin != origin })
  }

  public func removeAll() {
    save([])
  }

  private func save(_ next: [SitePermissionGrant]) {
    grants = Self.sorted(next)
    if let data = try? JSONEncoder().encode(grants) { defaults.set(data, forKey: Self.key) }
  }

  private static func sorted(_ list: [SitePermissionGrant]) -> [SitePermissionGrant] {
    list.sorted { $0.host == $1.host ? $0.origin < $1.origin : $0.host < $1.host }
  }
}
