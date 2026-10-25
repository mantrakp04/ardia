import Foundation

public enum SystemLink: Equatable, Sendable {
  case search(query: String?, browseForMe: Bool)
  case voiceSearch
  case incognito
  case open(URL)
  case tab(UUID)
  case macTabs
  case inbox

  public static let scheme = "ardia"

  public var url: URL {
    var components = URLComponents()
    components.scheme = Self.scheme
    switch self {
    case .search(let query, let browseForMe):
      components.host = browseForMe ? "browse-for-me" : "search"
      if let query, !query.isEmpty { components.queryItems = [URLQueryItem(name: "q", value: query)] }
    case .voiceSearch:
      components.host = "voice"
    case .incognito:
      components.host = "incognito"
    case .open(let target):
      components.host = "open"
      components.queryItems = [URLQueryItem(name: "url", value: target.absoluteString)]
    case .tab(let id):
      components.host = "tab"
      components.path = "/" + id.uuidString
    case .macTabs:
      components.host = "mac-tabs"
    case .inbox:
      components.host = "inbox"
    }
    return components.url ?? URL(string: "ardia://search")!
  }

  public init?(_ url: URL) {
    guard url.scheme?.lowercased() == Self.scheme,
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      let host = components.host?.lowercased()
    else { return nil }
    let query = components.queryItems?.first { $0.name == "q" }?.value?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let cleanQuery = query.flatMap { $0.isEmpty ? nil : $0 }
    switch host {
    case "search": self = .search(query: cleanQuery, browseForMe: false)
    case "browse-for-me": self = .search(query: cleanQuery, browseForMe: true)
    case "voice": self = .voiceSearch
    case "incognito": self = .incognito
    case "mac-tabs": self = .macTabs
    case "inbox": self = .inbox
    case "open":
      guard let value = components.queryItems?.first(where: { $0.name == "url" })?.value,
        let target = URL(string: value), let scheme = target.scheme?.lowercased(),
        scheme == "http" || scheme == "https"
      else { return nil }
      self = .open(target)
    case "tab":
      guard let id = UUID(uuidString: String(components.path.drop { $0 == "/" })) else { return nil }
      self = .tab(id)
    default:
      return nil
    }
  }
}

public struct SystemTab: Codable, Equatable, Hashable, Identifiable, Sendable {
  public var title: String
  public var url: String
  public var favicon: String?

  public var id: String { url }

  public init(title: String, url: String, favicon: String? = nil) {
    self.title = title
    self.url = url
    self.favicon = favicon
  }

  public var displayTitle: String {
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty { return trimmed }
    return host ?? url
  }

  public var host: String? {
    guard let host = URLComponents(string: url)?.host?.lowercased() else { return nil }
    return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
  }
}

public struct SystemDevice: Codable, Equatable, Hashable, Identifiable, Sendable {
  public enum Kind: String, Codable, Sendable {
    case mac
    case phone
  }

  public var id: String
  public var name: String
  public var kind: Kind

  public init(id: String, name: String, kind: Kind) {
    self.id = id
    self.name = name
    self.kind = kind
  }

  public var symbol: String {
    switch kind {
    case .mac: name.localizedCaseInsensitiveContains("imac") ? "desktopcomputer" : "laptopcomputer"
    case .phone: "iphone"
    }
  }
}

public struct SystemDeviceTabs: Codable, Equatable, Hashable, Identifiable, Sendable {
  public var device: SystemDevice
  public var tabs: [SystemTab]

  public var id: String { device.id }

  public init(device: SystemDevice, tabs: [SystemTab]) {
    self.device = device
    self.tabs = tabs
  }
}

public struct SystemSnapshot: Codable, Equatable, Sendable {
  public static let currentVersion = 1
  public static let tabLimitPerDevice = 8

  public var version: Int
  public var isSyncEnabled: Bool
  public var macTabs: [SystemDeviceTabs]
  public var sendTargets: [SystemDevice]
  public var gradient: [String]
  public var isBrowseForMeAvailable: Bool

  public init(isSyncEnabled: Bool = false, macTabs: [SystemDeviceTabs] = [], sendTargets: [SystemDevice] = [], gradient: [String] = [], isBrowseForMeAvailable: Bool = false) {
    version = Self.currentVersion
    self.isSyncEnabled = isSyncEnabled
    self.macTabs = macTabs
    self.sendTargets = sendTargets
    self.gradient = gradient
    self.isBrowseForMeAvailable = isBrowseForMeAvailable
  }

  public static let empty = SystemSnapshot()

  public var faviconNames: Set<String> {
    Set(macTabs.flatMap { $0.tabs.compactMap(\.favicon) })
  }
}

public struct SystemInboxItem: Codable, Equatable, Identifiable, Sendable {
  public enum Action: Codable, Equatable, Sendable {
    case open
    case browseForMe(query: String)
    case send(to: SystemDevice)
  }

  public var id: UUID
  public var action: Action
  public var url: String?
  public var title: String
  public var created: Date

  public init(id: UUID = UUID(), action: Action, url: String?, title: String, created: Date = .now) {
    self.id = id
    self.action = action
    self.url = url
    self.title = title
    self.created = created
  }
}

public struct SystemStore: Sendable {
  public static let appGroupIdentifier = "group.com.ardia.ios"
  public static let inboxLifetime: TimeInterval = 7 * 24 * 3600

  public let directory: URL

  public init(directory: URL) {
    self.directory = directory
  }

  public static var shared: SystemStore? {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) else { return nil }
    return SystemStore(directory: container.appending(path: "System", directoryHint: .isDirectory))
  }

  var snapshotURL: URL { directory.appending(path: "snapshot.json") }
  public var faviconDirectory: URL { directory.appending(path: "Favicons", directoryHint: .isDirectory) }
  var inboxDirectory: URL { directory.appending(path: "Inbox", directoryHint: .isDirectory) }

  public func loadSnapshot() -> SystemSnapshot {
    guard let data = try? Data(contentsOf: snapshotURL),
      let snapshot = try? JSONDecoder().decode(SystemSnapshot.self, from: data),
      snapshot.version == SystemSnapshot.currentVersion
    else { return .empty }
    return snapshot
  }

  @discardableResult
  public func save(_ snapshot: SystemSnapshot) -> Bool {
    guard let data = try? JSONEncoder().encode(snapshot) else { return false }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try data.write(to: snapshotURL, options: .atomic)
    } catch {
      return false
    }
    removeFavicons(except: snapshot.faviconNames)
    return true
  }

  public func faviconURL(named name: String) -> URL {
    faviconDirectory.appending(path: name)
  }

  public func hasFavicon(named name: String) -> Bool {
    FileManager.default.fileExists(atPath: faviconURL(named: name).path(percentEncoded: false))
  }

  @discardableResult
  public func saveFavicon(_ data: Data, named name: String) -> Bool {
    do {
      try FileManager.default.createDirectory(at: faviconDirectory, withIntermediateDirectories: true)
      try data.write(to: faviconURL(named: name), options: .atomic)
      return true
    } catch {
      return false
    }
  }

  func removeFavicons(except keep: Set<String>) {
    guard let names = try? FileManager.default.contentsOfDirectory(atPath: faviconDirectory.path(percentEncoded: false)) else { return }
    for name in names where !keep.contains(name) {
      try? FileManager.default.removeItem(at: faviconURL(named: name))
    }
  }

  public static func faviconName(forHost host: String) -> String {
    var hash: UInt64 = 0xCBF2_9CE4_8422_2325
    for byte in host.lowercased().utf8 {
      hash ^= UInt64(byte)
      hash = hash &* 0x0000_0100_0000_01B3
    }
    return String(hash, radix: 16) + ".png"
  }

  @discardableResult
  public func enqueue(_ item: SystemInboxItem) -> Bool {
    guard let data = try? JSONEncoder().encode(item) else { return false }
    do {
      try FileManager.default.createDirectory(at: inboxDirectory, withIntermediateDirectories: true)
      try data.write(to: inboxDirectory.appending(path: item.id.uuidString + ".json"), options: .atomic)
      return true
    } catch {
      return false
    }
  }

  public func drainInbox(now: Date = .now) -> [SystemInboxItem] {
    let manager = FileManager.default
    guard let files = try? manager.contentsOfDirectory(at: inboxDirectory, includingPropertiesForKeys: nil) else { return [] }
    var items: [SystemInboxItem] = []
    for file in files where file.pathExtension == "json" {
      defer { try? manager.removeItem(at: file) }
      guard let data = try? Data(contentsOf: file),
        let item = try? JSONDecoder().decode(SystemInboxItem.self, from: data),
        now.timeIntervalSince(item.created) < Self.inboxLifetime
      else { continue }
      items.append(item)
    }
    return items.sorted { $0.created < $1.created }
  }
}
