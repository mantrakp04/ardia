import Foundation

public final class Importer: @unchecked Sendable {
  public let discovery: BrowserDiscovery
  private let lock = NSLock()
  private var keys: [String: Data] = [:]
  private var firefoxPasswords: [String: String] = [:]
  private var generation = 0

  public init(discovery: BrowserDiscovery) {
    self.discovery = discovery
  }

  public typealias SecretProvider = (_ service: String, _ account: String) throws -> Data

  public func unlock(browserId: String, primaryPassword: String = "",
                     secret: SecretProvider = SafeStorageKeychain.secret) throws {
    guard let def = BrowserDefinition.find(browserId) else { throw ImportError.notFound("Unknown browser \(browserId)") }
    switch def.family {
    case .chromium, .arc:
      let items = def.keychainItems
      guard !items.isEmpty else { return }
      let started = lock.withLock { generation }
      let key = ChromiumCrypto.deriveKey(secret: try Self.firstSecret(items, secret))
      lock.withLock { if generation == started { keys[browserId] = key } }
    case .firefox:
      lock.withLock { firefoxPasswords[browserId] = primaryPassword }
    case .safari:
      break
    }
  }

  static func firstSecret(_ items: [BrowserDefinition.KeychainItem], _ secret: SecretProvider) throws -> Data {
    var missing: Error?
    for item in items {
      do {
        return try secret(item.service, item.account)
      } catch ImportError.notFound(let message) {
        missing = missing ?? ImportError.notFound(message)
      }
    }
    throw missing ?? ImportError.notFound("No Safe Storage item in the Keychain")
  }

  public func setKey(_ key: Data, for browserId: String) { lock.withLock { keys[browserId] = key } }

  public func isUnlocked(_ browserId: String) -> Bool {
    lock.withLock { keys[browserId] != nil || firefoxPasswords[browserId] != nil }
  }

  public func forgetKeys() {
    lock.withLock {
      generation += 1
      keys.removeAll()
      firefoxPasswords.removeAll()
    }
  }

  private func key(_ browserId: String) -> Data? { lock.withLock { keys[browserId] } }
  private func primaryPassword(_ browserId: String) -> String? { lock.withLock { firefoxPasswords[browserId] } }

  public func importData(browserId: String, profileId: String, kinds: [ImportKind], options: ImportOptions = .init(),
                         observer: ImportObserver = .silent, cancellation: Cancellation = .init()) throws -> ImportResult {
    guard let def = BrowserDefinition.find(browserId) else { throw ImportError.notFound("Unknown browser \(browserId)") }
    guard def.family != .safari else { throw ImportError.unsupported("Safari imports come from its export archive") }
    let dir = try discovery.profileDirectory(def, profileId)
    var result = ImportResult(browserId: browserId, profileId: profileId)
    if let info = discovery.profile(def, profileId) {
      result.profile = ProfileSuggestion(name: info.name, color: info.color, avatarPath: info.avatarPath)
    }

    var arc: ArcSidebar?
    func arcSidebar() throws -> ArcSidebar {
      if let arc { return arc }
      let url = discovery.arcSidebarURL()
      guard FileManager.default.fileExists(atPath: url.path) else { throw ImportError.notFound("No Arc sidebar data") }
      let parsed = try ArcSidebar.parse(Data(contentsOf: url))
      arc = parsed
      return parsed
    }

    var zen: ZenSidebar?
    func zenSidebar() throws -> ZenSidebar {
      if let zen { return zen }
      let parsed = try ZenSidebar.load(profile: dir, profileId: profileId, cancellation: cancellation)
      zen = parsed
      return parsed
    }

    func sidebarSpaces() throws -> [SpaceSuggestion]? {
      switch def.sidebar {
      case .arc:
        return try arcSidebar().spaces.filter { $0.profileId == profileId }
      case .zen:
        let spaces = (try? zenSidebar())?.spaces ?? []
        return spaces.isEmpty ? nil : spaces
      case nil:
        return nil
      }
    }

    func take(_ all: [SpaceSuggestion], for kind: ImportKind) -> Int {
      let spaces = all.filter { options.spaceIds?.contains($0.id) ?? true }
      result.spaces = spaces.map { space in
        var s = space
        if !kinds.contains(.pinnedTabs) { s.pinned = [] }
        if !kinds.contains(.tabs) { s.tabs = [] }
        return s
      }
      switch kind {
      case .tabs:
        result.tabs = spaces.flatMap(\.tabs)
        return result.tabs.count
      case .pinnedTabs:
        return spaces.reduce(0) { $0 + $1.pinned.reduce(0) { $0 + $1.linkCount } }
      default:
        return spaces.count
      }
    }

    let ordered = ImportKind.allCases.filter(kinds.contains)
    for kind in ordered {
      try cancellation.check()
      if kind != .history { observer.progress(ImportProgress(kind: kind, phase: .start, processed: 0, total: nil)) }
      var count = 0
      var succeeded = false
      do {
        switch (kind, def.family) {
        case (.bookmarks, .chromium), (.bookmarks, .arc):
          result.bookmarks = try ChromiumBookmarks.load(profile: dir)
          count = result.bookmarks?.linkCount ?? 0
        case (.bookmarks, .firefox):
          result.bookmarks = try Firefox.bookmarks(places: dir.appendingPathComponent("places.sqlite"), cancellation: cancellation)
          count = result.bookmarks?.linkCount ?? 0

        case (.history, .chromium), (.history, .arc), (.history, .firefox):
          let flavor: HistoryReader.Flavor = def.family == .firefox ? .firefox : .chromium
          let file = dir.appendingPathComponent(def.family == .firefox ? "places.sqlite" : "History")
          let (entries, total) = try HistoryReader.read(file, flavor: flavor, options: options, observer: observer, cancellation: cancellation)
          result.history = entries
          result.historyCount = total
          count = total

        case (.tabs, .chromium):
          let session = try ChromiumSessions.load(profile: dir, key: key(browserId))
          result.tabs = session.tabs
          result.tabGroups = session.groups
          count = session.tabs.count
        case (.tabs, .firefox):
          if let spaces = try sidebarSpaces() {
            count = take(spaces, for: kind)
          } else {
            let session = try Firefox.loadSession(profile: dir)
            result.tabs = session.tabs
            result.tabGroups = session.groups
            count = session.tabs.count
          }

        case (.spaces, .arc), (.pinnedTabs, .arc), (.tabs, .arc), (.spaces, .firefox), (.pinnedTabs, .firefox):
          guard def.sidebar != nil else { throw ImportError.unsupported("\(def.name) has no \(kind.rawValue) to import") }
          guard let spaces = try sidebarSpaces() else { throw ImportError.notFound("No \(def.name) spaces in this profile") }
          count = take(spaces, for: kind)
        case (.favorites, .arc):
          result.favorites = try arcSidebar().favorites[profileId] ?? []
          count = result.favorites.count
        case (.favorites, .firefox):
          guard def.sidebar == .zen else { throw ImportError.unsupported("\(def.name) has no \(kind.rawValue) to import") }
          result.favorites = try zenSidebar().essentials
          count = result.favorites.count

        case (.passwords, .chromium), (.passwords, .arc):
          guard let key = key(browserId) else { throw ImportError.locked("Unlock \(def.name) to import passwords") }
          let outcome = try ChromiumSecrets.logins(profile: dir, key: key, cancellation: cancellation)
          result.credentials = outcome.items
          count = outcome.items.count
          if outcome.undecryptable > 0 {
            result.warnings.append(ImportWarning(kind, .undecryptable, "\(Self.count(outcome.undecryptable, "password")) couldn't be decrypted"))
            if outcome.items.isEmpty { throw ImportError.locked("The \(def.name) key didn't decrypt any passwords") }
          }
        case (.passwords, .firefox):
          guard let password = primaryPassword(browserId) else { throw ImportError.locked("Allow \(def.name) password import first") }
          result.credentials = try FirefoxLogins.logins(profile: dir, primaryPassword: password, cancellation: cancellation)
          count = result.credentials.count

        case (.cookies, .chromium), (.cookies, .arc):
          guard let key = key(browserId) else { throw ImportError.locked("Unlock \(def.name) to import cookies") }
          let outcome = try ChromiumSecrets.cookies(profile: dir, key: key, cancellation: cancellation)
          result.cookies = outcome.items
          count = outcome.items.count
          if outcome.undecryptable > 0 {
            result.warnings.append(ImportWarning(kind, .undecryptable, "\(Self.count(outcome.undecryptable, "cookie")) couldn't be decrypted"))
            if outcome.items.isEmpty { throw ImportError.locked("The \(def.name) key didn't decrypt any cookies") }
          }
        case (.cookies, .firefox):
          let outcome = try Firefox.cookies(profile: dir, cancellation: cancellation)
          result.cookies = outcome.items
          count = outcome.items.count
          if outcome.skipped > 0 {
            result.warnings.append(ImportWarning(kind, .skipped,
              "\(Self.count(outcome.skipped, "cookie")) from containers or private windows weren't imported"))
          }

        case (.autofill, .chromium), (.autofill, .arc):
          let key = key(browserId)
          let outcome = try ChromiumAutofill.load(profile: dir, key: key, cancellation: cancellation)
          result.addresses = outcome.addresses
          result.cards = outcome.cards
          count = outcome.addresses.count + outcome.cards.count
          if outcome.lockedCards > 0 {
            result.warnings.append(ImportWarning(kind, .locked, "Unlock \(def.name) to import \(Self.count(outcome.lockedCards, "saved card"))"))
          }
          if outcome.undecryptable > 0 {
            result.warnings.append(ImportWarning(kind, .undecryptable, "\(Self.count(outcome.undecryptable, "card")) couldn't be decrypted"))
          }

        default:
          throw ImportError.unsupported("\(def.name) has no \(kind.rawValue) to import")
        }
        succeeded = true
      } catch ImportError.cancelled {
        throw ImportError.cancelled
      } catch ImportError.notFound(let message) {
        result.warnings.append(ImportWarning(kind, .empty, message))
      } catch let error as ImportError {
        result.failed.append(kind)
        result.warnings.append(ImportWarning(kind, error.warningCode, error.description))
      } catch {
        result.failed.append(kind)
        result.warnings.append(ImportWarning(kind, .unreadable, error.localizedDescription))
      }
      if kind != .history || !succeeded { observer.progress(ImportProgress(kind: kind, phase: .end, processed: count, total: count)) }
    }
    if def.family == .chromium || def.family == .arc {
      try cancellation.check()
      result.favicons = ChromiumFavicons.read(profiles: [dir], pages: ChromiumFavicons.pages(of: result))
    }
    if let zen {
      result.favicons = zen.favicons(for: ChromiumFavicons.pages(of: result))
    }
    return result
  }

  public func favicons(browserId: String, pages: [String]) -> [ImportedFavicon] {
    guard let def = BrowserDefinition.find(browserId), def.family == .chromium || def.family == .arc else { return [] }
    let dirs = discovery.chromiumProfiles(def).compactMap { try? discovery.profileDirectory(def, $0.id) }
    return ChromiumFavicons.read(profiles: dirs, pages: pages)
  }

  static func count(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }
}
