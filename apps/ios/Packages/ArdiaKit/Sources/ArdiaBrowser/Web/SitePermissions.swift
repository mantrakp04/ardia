import Foundation

public enum SitePermission: String, Codable, Sendable, CaseIterable, Identifiable, Comparable {
  case camera
  case microphone
  case location

  public var id: String { rawValue }

  public var title: String {
    switch self {
    case .camera: String(localized: "Camera")
    case .microphone: String(localized: "Microphone")
    case .location: String(localized: "Location")
    }
  }

  public var symbol: String {
    switch self {
    case .camera: "video.fill"
    case .microphone: "mic.fill"
    case .location: "location.fill"
    }
  }

  public static func permissions(for capture: MediaCaptureKind) -> Set<SitePermission> {
    switch capture {
    case .camera: [.camera]
    case .microphone: [.microphone]
    case .cameraAndMicrophone: [.camera, .microphone]
    }
  }

  public static func < (lhs: SitePermission, rhs: SitePermission) -> Bool {
    allCases.firstIndex(of: lhs)! < allCases.firstIndex(of: rhs)!
  }
}

public struct SitePermissionGrant: Identifiable, Equatable, Sendable {
  public var host: String
  public var permissions: [SitePermission]

  public var id: String { host }

  public init(host: String, permissions: [SitePermission]) {
    self.host = host
    self.permissions = permissions
  }
}

public enum SitePermissionMemory: Equatable, Sendable {
  case saved
  case session
  case privateSession

  public init(scheme: String, isPrivate: Bool) {
    if isPrivate {
      self = .privateSession
    } else {
      self = scheme.lowercased() == "https" ? .saved : .session
    }
  }
}

public enum SitePermissionSite {
  public static func key(host: String, port: Int) -> String {
    let site = normalize(host)
    return port == 0 ? site : "\(site):\(port)"
  }

  public static func normalize(_ site: String) -> String {
    site.lowercased()
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .trimmingCharacters(in: CharacterSet(charactersIn: "."))
  }
}

public struct SitePermissionUse: Sendable, Equatable {
  private let uses: [UUID: [String: Set<SitePermission>]]

  public init() {
    uses = [:]
  }

  private init(uses: [UUID: [String: Set<SitePermission>]]) {
    self.uses = uses
  }

  public func recording(_ permissions: Set<SitePermission>, site: String, tab: UUID) -> SitePermissionUse {
    let key = SitePermissionSite.normalize(site)
    var tabUses = uses[tab] ?? [:]
    tabUses[key] = (tabUses[key] ?? []).union(permissions)
    return SitePermissionUse(uses: uses.merging([tab: tabUses]) { $1 })
  }

  public func forgetting(tab: UUID) -> SitePermissionUse {
    SitePermissionUse(uses: uses.filter { $0.key != tab })
  }

  public func tabs(using permissions: Set<SitePermission>, site: String) -> Set<UUID> {
    let key = SitePermissionSite.normalize(site)
    return Set(uses.compactMap { tab, sites in
      (sites[key] ?? []).isDisjoint(with: permissions) ? nil : tab
    })
  }
}
