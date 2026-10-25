import Foundation

public struct SyncSnapshot: Codable, Equatable, Sendable {
  public var devices: [SyncedDevice]
  public var profiles: [SyncedProfile]
  public var search: SyncedSearch?
  public var syncedAt: Date?

  public init(devices: [SyncedDevice] = [], profiles: [SyncedProfile] = [], search: SyncedSearch? = nil, syncedAt: Date? = nil) {
    self.devices = devices
    self.profiles = profiles
    self.search = search
    self.syncedAt = syncedAt
  }

  public static let empty = SyncSnapshot()

  public var defaultProfile: SyncedProfile? { profiles.first(where: \.isDefault) ?? profiles.first }

  public func profile(_ syncId: String?) -> SyncedProfile? {
    syncId.flatMap { id in profiles.first { $0.syncId == id } } ?? defaultProfile
  }
}

public struct SyncedDevice: Codable, Equatable, Hashable, Identifiable, Sendable {
  public enum Kind: String, Codable, Sendable {
    case mac
    case phone
  }

  public var id: String
  public var name: String
  public var kind: Kind
  public var lastSeen: Date?
  public var isCurrent: Bool
  public var canReceiveTabs: Bool

  public init(id: String, name: String, kind: Kind, lastSeen: Date?, isCurrent: Bool, canReceiveTabs: Bool) {
    self.id = id
    self.name = name
    self.kind = kind
    self.lastSeen = lastSeen
    self.isCurrent = isCurrent
    self.canReceiveTabs = canReceiveTabs
  }
}

public struct SyncedProfile: Codable, Equatable, Hashable, Identifiable, Sendable {
  public var syncId: String
  public var name: String
  public var color: String?
  public var icon: String?
  public var isDefault: Bool
  public var theme: SyncedTheme?
  public var deviceTabs: [DeviceTabs]
  public var pinned: PinnedArea
  public var bookmarks: [BookmarkItem]
  public var history: [HistoryItem]

  public var id: String { syncId }

  public init(syncId: String, name: String, color: String?, icon: String?, isDefault: Bool, theme: SyncedTheme?, deviceTabs: [DeviceTabs], pinned: PinnedArea, bookmarks: [BookmarkItem], history: [HistoryItem]) {
    self.syncId = syncId
    self.name = name
    self.color = color
    self.icon = icon
    self.isDefault = isDefault
    self.theme = theme
    self.deviceTabs = deviceTabs
    self.pinned = pinned
    self.bookmarks = bookmarks
    self.history = history
  }
}

public struct SyncedTheme: Codable, Equatable, Hashable, Sendable {
  public var colors: [String]
  public var darkColors: [String]?

  public init(colors: [String], darkColors: [String]?) {
    self.colors = colors
    self.darkColors = darkColors
  }
}

public struct DeviceTabs: Codable, Equatable, Hashable, Identifiable, Sendable {
  public var deviceId: String
  public var deviceName: String
  public var kind: SyncedDevice.Kind
  public var tabs: [RemoteTab]

  public var id: String { deviceId }

  public init(deviceId: String, deviceName: String, kind: SyncedDevice.Kind, tabs: [RemoteTab]) {
    self.deviceId = deviceId
    self.deviceName = deviceName
    self.kind = kind
    self.tabs = tabs
  }
}

public struct RemoteTab: Codable, Equatable, Hashable, Identifiable, Sendable {
  public var url: String
  public var title: String

  public var id: String { url + "\n" + title }

  public init(url: String, title: String) {
    self.url = url
    self.title = title
  }
}

public struct PinnedArea: Codable, Equatable, Hashable, Sendable {
  public var tiles: [PinnedTile]
  public var sections: [PinnedSection]

  public init(tiles: [PinnedTile] = [], sections: [PinnedSection] = []) {
    self.tiles = tiles
    self.sections = sections
  }

  public var isEmpty: Bool { tiles.isEmpty && sections.isEmpty }
}

public struct PinnedTile: Codable, Equatable, Hashable, Identifiable, Sendable {
  public var key: String
  public var title: String
  public var url: String
  public var icon: String?
  public var folder: [PinnedTab]?

  public var id: String { key }

  public init(key: String, title: String, url: String, icon: String?, folder: [PinnedTab]?) {
    self.key = key
    self.title = title
    self.url = url
    self.icon = icon
    self.folder = folder
  }
}

public struct PinnedTab: Codable, Equatable, Hashable, Identifiable, Sendable {
  public var key: String
  public var title: String
  public var url: String
  public var icon: String?

  public var id: String { key }

  public init(key: String, title: String, url: String, icon: String?) {
    self.key = key
    self.title = title
    self.url = url
    self.icon = icon
  }
}

public enum PinnedSection: Codable, Equatable, Hashable, Identifiable, Sendable {
  case tab(PinnedTab)
  case group(PinnedGroup)

  public var id: String {
    switch self {
    case .tab(let tab): "t:" + tab.key
    case .group(let group): "g:" + group.key
    }
  }

  private enum CodingKeys: String, CodingKey {
    case tab
    case group
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if let tab = try container.decodeIfPresent(PinnedTab.self, forKey: .tab) {
      self = .tab(tab)
    } else {
      self = .group(try container.decode(PinnedGroup.self, forKey: .group))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .tab(let tab): try container.encode(tab, forKey: .tab)
    case .group(let group): try container.encode(group, forKey: .group)
    }
  }
}

public struct PinnedGroup: Codable, Equatable, Hashable, Identifiable, Sendable {
  public var key: String
  public var name: String
  public var icon: String?
  public var color: String?
  public var items: [PinnedSection]

  public var id: String { key }

  public init(key: String, name: String, icon: String?, color: String?, items: [PinnedSection]) {
    self.key = key
    self.name = name
    self.icon = icon
    self.color = color
    self.items = items
  }
}

public struct BookmarkItem: Codable, Equatable, Hashable, Identifiable, Sendable {
  public enum Root: String, Codable, Sendable {
    case bar
    case other
  }

  public var key: String
  public var title: String
  public var url: String?
  public var added: Date
  public var root: Root?
  public var children: [BookmarkItem]?

  public var id: String { key }
  public var isFolder: Bool { url == nil }

  public init(key: String, title: String, url: String?, added: Date, root: Root?, children: [BookmarkItem]?) {
    self.key = key
    self.title = title
    self.url = url
    self.added = added
    self.root = root
    self.children = children
  }
}

public struct HistoryItem: Codable, Equatable, Hashable, Identifiable, Sendable {
  public var url: String
  public var title: String
  public var visits: Int
  public var lastVisit: Date

  public var id: String { url }

  public init(url: String, title: String, visits: Int, lastVisit: Date) {
    self.url = url
    self.title = title
    self.visits = visits
    self.lastVisit = lastVisit
  }
}

public struct SyncedSearch: Codable, Equatable, Hashable, Sendable {
  public var engineId: String
  public var customURL: String?
  public var customEngines: [CustomEngine]

  public init(engineId: String, customURL: String?, customEngines: [CustomEngine]) {
    self.engineId = engineId
    self.customURL = customURL
    self.customEngines = customEngines
  }

  public struct CustomEngine: Codable, Equatable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var keyword: String
    public var url: String

    public init(id: String, name: String, keyword: String, url: String) {
      self.id = id
      self.name = name
      self.keyword = keyword
      self.url = url
    }
  }
}

public struct ReceivedTab: Codable, Equatable, Hashable, Identifiable, Sendable {
  public var key: String
  public var url: String
  public var title: String
  public var fromDevice: String
  public var sentAt: Date
  public var profileSyncId: String
  public var fromDeviceId: String

  public var id: String { key }

  public init(key: String, url: String, title: String, fromDevice: String, sentAt: Date, profileSyncId: String, fromDeviceId: String = "") {
    self.key = key
    self.url = url
    self.title = title
    self.fromDevice = fromDevice
    self.sentAt = sentAt
    self.profileSyncId = profileSyncId
    self.fromDeviceId = fromDeviceId
  }
}

public struct LocalTabRecord: Codable, Equatable, Hashable, Sendable {
  public var url: String
  public var title: String
  public var lastActive: Date
  public var profileSyncId: String?

  public init(url: String, title: String, lastActive: Date, profileSyncId: String?) {
    self.url = url
    self.title = title
    self.lastActive = lastActive
    self.profileSyncId = profileSyncId
  }
}

public struct LocalVisitRecord: Codable, Equatable, Hashable, Sendable {
  public var url: String
  public var title: String
  public var visitedAt: [Date]
  public var profileSyncId: String?

  public init(url: String, title: String, visitedAt: [Date], profileSyncId: String?) {
    self.url = url
    self.title = title
    self.visitedAt = visitedAt
    self.profileSyncId = profileSyncId
  }
}

public enum SyncPhase: Equatable, Sendable {
  case off
  case starting
  case updating
  case updated
  case stalled(String)
  case offline
  case needsFolderAccess
  case locked
  case reset
}

@MainActor
public protocol LocalBrowsingSource: AnyObject {
  func syncedTabs() -> [LocalTabRecord]
  func syncedVisits(since: Date) -> [LocalVisitRecord]
  func removeVisits(urls: Set<String>, profileSyncId: String?)
  func receive(_ tabs: [ReceivedTab])
}
