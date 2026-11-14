import ArdiaSync
import Foundation
import PhoneSync

enum SyncPayloads {
  static func object(_ fields: [String: Any?]) -> [String: Any] {
    fields.mapValues(bridge)
  }

  static func list(_ items: [[String: Any?]]) -> [[String: Any]] {
    items.map(object)
  }

  private static func bridge(_ value: Any?) -> Any {
    guard let value else { return NSNull() }
    if let fields = value as? [String: Any?] { return object(fields) }
    if let items = value as? [Any?] { return items.map(bridge) }
    return value
  }

  static func milliseconds(_ date: Date?) -> Double? {
    date.map { ($0.timeIntervalSince1970 * 1000).rounded() }
  }

  static func phase(_ phase: SyncPhase) -> String {
    switch phase {
    case .off: "off"
    case .starting: "starting"
    case .updating: "updating"
    case .updated: "updated"
    case .stalled: "stalled"
    case .offline: "offline"
    case .needsFolderAccess: "needsFolderAccess"
    case .locked: "locked"
    case .reset: "reset"
    }
  }

  static func attention(_ phase: SyncPhase) -> String {
    switch phase {
    case .needsFolderAccess: "folder"
    case .locked: "phrase"
    case .reset: "reset"
    case .stalled: "stalled"
    default: "none"
    }
  }

  @MainActor
  static func status(_ sync: SyncService, isDemo: Bool, inboxProblem: String?) -> [String: Any?] {
    var stalled: String?
    if case .stalled(let message) = sync.phase { stalled = message }
    return [
      "phase": phase(sync.phase),
      "statusText": sync.statusText,
      "stalledMessage": stalled,
      "attention": attention(sync.phase),
      "isEnabled": sync.isEnabled,
      "isSyncing": sync.phase == .starting || sync.phase == .updating,
      "isDemo": isDemo || sync.isDemo,
      "pendingDownloads": sync.pendingDownloads,
      "lastSynced": milliseconds(sync.lastSynced),
      "folderName": sync.folderName,
      "deviceName": sync.deviceName,
      "selectedProfileId": sync.selectedProfileId,
      "showsResetNotice": sync.phase == .reset,
      "inboxProblem": inboxProblem,
    ]
  }

  static func check(_ check: PhraseCheck) -> [String: Any?] {
    [
      "wordCount": check.wordCount,
      "counterText": check.counterText,
      "isTooLong": check.isTooLong,
      "problem": check.problem,
      "isValid": check.isValid,
    ]
  }

  static func connect(_ result: ConnectResult?) -> [String: Any?] {
    switch result {
    case nil: ["result": "cancelled"]
    case .connected: ["result": "connected"]
    case .invalidPhrase(let problem): ["result": "invalidPhrase", "problem": problem]
    case .mismatch: ["result": "mismatch"]
    case .noSyncData: ["result": "noSyncData"]
    case .folderUnavailable: ["result": "folderUnavailable"]
    case .keychainFailed: ["result": "keyStoreFailed"]
    case .busy: ["result": "busy"]
    }
  }

  static func ordered(_ devices: [SyncedDevice]) -> [SyncedDevice] {
    devices.sorted { left, right in
      if left.isCurrent != right.isCurrent { return !left.isCurrent }
      return (left.lastSeen ?? .distantPast) > (right.lastSeen ?? .distantPast)
    }
  }

  static func device(_ device: SyncedDevice) -> [String: Any?] {
    [
      "id": device.id,
      "name": device.name,
      "kind": device.kind.rawValue,
      "lastSeen": milliseconds(device.lastSeen),
      "isCurrent": device.isCurrent,
      "canReceiveTabs": device.canReceiveTabs,
    ]
  }

  @MainActor
  static func view(_ sync: SyncService) -> [String: Any?] {
    let snapshot = sync.snapshot
    return [
      "devices": ordered(snapshot.devices).map(device),
      "profiles": snapshot.profiles.map(profile),
      "search": snapshot.search.map { search -> [String: Any?] in
        [
          "engineId": search.engineId,
          "customURL": search.customURL,
          "customEngines": search.customEngines.map { ["id": $0.id, "name": $0.name, "keyword": $0.keyword, "url": $0.url] },
        ]
      },
      "syncedAt": milliseconds(snapshot.syncedAt),
      "selectedProfileId": sync.selectedProfileId,
      "shownProfileId": sync.selectedProfile?.syncId,
      "receivers": sync.devicesThatReceiveTabs.map(device),
    ]
  }

  static func profile(_ profile: SyncedProfile) -> [String: Any?] {
    [
      "syncId": profile.syncId,
      "name": profile.name,
      "color": profile.color,
      "icon": profile.icon,
      "isDefault": profile.isDefault,
      "theme": profile.theme.map { ["colors": $0.colors, "darkColors": $0.darkColors] as [String: Any?] },
      "deviceTabs": profile.deviceTabs.map { tabs -> [String: Any?] in
        [
          "deviceId": tabs.deviceId,
          "deviceName": tabs.deviceName,
          "kind": tabs.kind.rawValue,
          "tabs": tabs.tabs.map { ["url": $0.url, "title": $0.title] },
        ]
      },
      "pinned": [
        "tiles": profile.pinned.tiles.map { tile -> [String: Any?] in
          var fields = pinnedTab(PinnedTab(key: tile.key, title: tile.title, url: tile.url, icon: tile.icon))
          fields["folder"] = tile.folder?.map(pinnedTab)
          return fields
        },
        "sections": profile.pinned.sections.map(section),
      ] as [String: Any],
      "bookmarks": profile.bookmarks.map(bookmark),
      "history": profile.history.map { ["url": $0.url, "title": $0.title, "visits": $0.visits, "lastVisit": milliseconds($0.lastVisit)] as [String: Any?] },
      "sendTargets": profile.sendTargets,
    ]
  }

  static func pinnedTab(_ tab: PinnedTab) -> [String: Any?] {
    ["key": tab.key, "title": tab.title, "url": tab.url, "icon": tab.icon]
  }

  static func section(_ section: PinnedSection) -> [String: Any?] {
    switch section {
    case .tab(let tab): ["tab": pinnedTab(tab), "group": nil]
    case .group(let group):
      ["tab": nil, "group": ["key": group.key, "name": group.name, "icon": group.icon, "color": group.color, "items": group.items.map(Self.section)] as [String: Any?]]
    }
  }

  static func bookmark(_ item: BookmarkItem) -> [String: Any?] {
    [
      "key": item.key,
      "title": item.title,
      "url": item.url,
      "added": milliseconds(item.added),
      "root": item.root?.rawValue,
      "children": item.children?.map(bookmark),
    ]
  }

  static func received(_ tab: ReceivedTab) -> [String: Any] {
    PhoneInbox.json(tab)
  }

  static func inbox(_ entries: [PhoneInbox.Entry]) -> [[String: Any]] {
    entries.map { entry in
      ["id": Double(entry.id), "received": entry.received.map(received), "removals": entry.removals.map(PhoneInbox.json)]
    }
  }
}
