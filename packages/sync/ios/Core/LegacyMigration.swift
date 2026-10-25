import AppKit
import Foundation
import Security

public enum LegacyName {
  public static let bundleId = "com.netnyahoo.browser"
  public static let appFileName = "Netnyahoo.app"
  public static let appName = "Netnyahoo"
  public static let successorBundleId = "com.ardia.browser"

  public static func isSuccessor(_ bundleId: String?) -> Bool { bundleId?.lowercased() == successorBundleId }

  public static let syncMagic = "NNS1"
  public static let syncSalt = "netnyahoo-sync/v1"
  public static let syncFolderName = "Netnyahoo Sync"
}

enum Renamed {
  struct KeychainItem {
    let oldService: String
    let newService: String
    let account: (old: String, new: String)?
    let label: (String) -> String
    let accessible: CFString?
    let critical: Bool
  }

  static let safeStorage = KeychainItem(
    oldService: "Netnyahoo Safe Storage", newService: "Ardia Safe Storage", account: ("Netnyahoo", "Ardia"),
    label: { _ in "Ardia Safe Storage" }, accessible: nil, critical: true)
  static let connectedAccounts = KeychainItem(
    oldService: "Netnyahoo Connected Accounts", newService: "Ardia Connected Accounts", account: nil,
    label: { "Ardia: \($0)" }, accessible: nil, critical: false)
  static let syncKey = KeychainItem(
    oldService: "Netnyahoo Sync Key", newService: "Ardia Sync Key", account: nil,
    label: { _ in "Ardia Sync Key" }, accessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, critical: false)
  static let keychain = [safeStorage, connectedAccounts, syncKey]

  static let paths: [(old: String, new: String)] = [
    ("Chromium/NetnyahooPictureInPicture.plist", "Chromium/ArdiaPictureInPicture.plist"),
    ("Chromium/NativeMessagingHosts/.netnyahoo-managed.json", "Chromium/NativeMessagingHosts/.ardia-managed.json"),
    ("Chromium/*/Netnyahoo Favicons", "Chromium/*/Ardia Favicons"),
  ]

  static let jsonKeys = [
    "openLinksInSmallYahu": "openLinksInLittleArdia",
    "smallYahuSize": "littleArdiaSize",
    "newSmallYahu": "newLittleArdia",
    "toggleOpenLinksInSmallYahu": "toggleOpenLinksInLittleArdia",
    "nn_sync_key": "ac_sync_key",
  ]

  static let urls: [(old: String, new: String)] = [
    ("netnyahoo://yahu", "ardia://game"),
    ("chrome://yahu", "chrome://game"),
    ("netnyahoo://", "ardia://"),
  ]

  static let defaultsKeys = [
    "NNAppIcon": "ACAppIcon",
    "NNPictureInPictureKeepOnTop": "ACPictureInPictureKeepOnTop",
    "NNPictureInPictureZoom": "ACPictureInPictureZoom",
    "NNUpdateFeedURL": "ACUpdateFeedURL",
  ]
  static let defaultsKeyPrefixes = [("NSWindow Frame Netnyahoo", "NSWindow Frame Ardia")]
  static let menuTitleWords = [("Small Yahu", "Little Ardia"), ("Netnyahoo", "Ardia")]
}

enum SecretRead: Equatable {
  case found(Data)
  case missing
  case denied
  case failed(OSStatus)
}

protocol SecretStore {
  func accounts(service: String) -> [String]?
  func read(service: String, account: String) -> SecretRead
  func write(service: String, account: String, label: String, accessible: CFString?, data: Data) -> Bool
}

struct LoginKeychain: SecretStore {
  var only: SecKeychain? = nil

  private func query(_ service: String, _ account: String?) -> [String: Any] {
    var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
    if let account { q[kSecAttrAccount as String] = account }
    if let only { q[kSecMatchSearchList as String] = [only] }
    return q
  }

  func accounts(service: String) -> [String]? {
    var q = query(service, nil)
    q[kSecReturnAttributes as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitAll
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return [] }
    guard status == errSecSuccess else { return nil }
    let items = (result as? [[String: Any]]) ?? []
    return Array(Set(items.compactMap { $0[kSecAttrAccount as String] as? String })).sorted()
  }

  func read(service: String, account: String) -> SecretRead {
    var q = query(service, account)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    switch status {
    case errSecSuccess: return (result as? Data).map(SecretRead.found) ?? .failed(status)
    case errSecItemNotFound: return .missing
    case errSecUserCanceled, errSecAuthFailed, errSecInteractionNotAllowed: return .denied
    default: return .failed(status)
    }
  }

  func write(service: String, account: String, label: String, accessible: CFString?, data: Data) -> Bool {
    let match = query(service, account)
    let status = SecItemUpdate(match as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecSuccess { return true }
    guard status == errSecItemNotFound else { return false }
    var add = match
    add.removeValue(forKey: kSecMatchSearchList as String)
    if let only { add[kSecUseKeychain as String] = only }
    add[kSecValueData as String] = data
    add[kSecAttrLabel as String] = label
    if let accessible { add[kSecAttrAccessible as String] = accessible }
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }
}

struct SecretFile: SecretStore {
  let url: URL

  private func load() -> [String: Any] {
    guard let data = try? Data(contentsOf: url) else { return [:] }
    return ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]) ?? [:]
  }

  func accounts(service: String) -> [String]? { ((load()[service] as? [String: String]) ?? [:]).keys.sorted() }

  func read(service: String, account: String) -> SecretRead {
    let all = load()
    if (all["denied"] as? [String])?.contains(service) == true { return .denied }
    guard let encoded = (all[service] as? [String: String])?[account] else { return .missing }
    return Data(base64Encoded: encoded).map(SecretRead.found) ?? .failed(errSecDecode)
  }

  func write(service: String, account: String, label: String, accessible: CFString?, data: Data) -> Bool {
    var all = load()
    var items = (all[service] as? [String: String]) ?? [:]
    items[account] = data.base64EncodedString()
    all[service] = items
    return MigrationFiles.writeDurably(try? JSONSerialization.data(withJSONObject: all, options: [.sortedKeys]), to: url, mode: 0o600)
  }
}

struct IsolatedSecretStores: SecretStore {
  let dataDirectory: URL
  private var accountsFile: URL { dataDirectory.appendingPathComponent("Connected Accounts.json") }
  private var others: SecretFile { SecretFile(url: dataDirectory.appendingPathComponent("legacy-keychain.json")) }

  private func connectedAccounts() -> [String: String] {
    guard let data = try? Data(contentsOf: accountsFile) else { return [:] }
    return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
  }

  func accounts(service: String) -> [String]? {
    switch service {
    case Renamed.connectedAccounts.newService: return connectedAccounts().keys.sorted()
    case Renamed.syncKey.newService:
      let names = (try? FileManager.default.contentsOfDirectory(atPath: dataDirectory.path)) ?? []
      return names.filter { $0.hasPrefix("sync-key-") }.map { String($0.dropFirst("sync-key-".count)) }.sorted()
    default: return others.accounts(service: service)
    }
  }

  func read(service: String, account: String) -> SecretRead {
    switch service {
    case Renamed.connectedAccounts.newService:
      return connectedAccounts()[account].map { .found(Data($0.utf8)) } ?? .missing
    case Renamed.syncKey.newService:
      return FileKeyStore(directory: dataDirectory).load(account: account).map(SecretRead.found) ?? .missing
    default: return others.read(service: service, account: account)
    }
  }

  func write(service: String, account: String, label: String, accessible: CFString?, data: Data) -> Bool {
    switch service {
    case Renamed.connectedAccounts.newService:
      guard let secret = String(data: data, encoding: .utf8) else { return false }
      var all = connectedAccounts()
      all[account] = secret
      return MigrationFiles.writeDurably(try? JSONEncoder().encode(all), to: accountsFile, mode: 0o600)
    case Renamed.syncKey.newService:
      return FileKeyStore(directory: dataDirectory).save(data, account: account)
    default:
      return others.write(service: service, account: account, label: label, accessible: accessible, data: data)
    }
  }
}

struct PreferencesDomain {
  let id: String

  func all() -> [String: Any] {
    guard let keys = CFPreferencesCopyKeyList(id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost) as? [String],
      !keys.isEmpty else { return [:] }
    return (CFPreferencesCopyMultiple(keys as CFArray, id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
      as? [String: Any]) ?? [:]
  }

  func has(_ key: String) -> Bool {
    CFPreferencesCopyValue(key as CFString, id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost) != nil
  }

  @discardableResult
  func set(_ values: [String: Any]) -> Bool {
    guard !values.isEmpty else { return true }
    CFPreferencesSetMultiple(values as CFDictionary, nil, id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
    return CFPreferencesSynchronize(id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
  }
}

protocol AccessGroupMover {
  func entitled(to groups: [String]) -> Bool
  func move(from old: String, to new: String) -> (moved: Int, failure: OSStatus?)
}

struct KeychainAccessGroups: AccessGroupMover {
  static let suffixes = ["webauthn", "unexportable-keys", "secure-payment-confirmation"]

  func entitled(to groups: [String]) -> Bool {
    guard let task = SecTaskCreateFromSelf(nil),
      let value = SecTaskCopyValueForEntitlement(task, "keychain-access-groups" as CFString, nil) as? [String] else { return false }
    return groups.allSatisfy(value.contains)
  }

  func move(from old: String, to new: String) -> (moved: Int, failure: OSStatus?) {
    var moved = 0
    var failure: OSStatus?
    for itemClass in [kSecClassKey, kSecClassGenericPassword] {
      let query: [String: Any] = [
        kSecClass as String: itemClass, kSecAttrAccessGroup as String: old, kSecUseDataProtectionKeychain as String: true,
      ]
      var count = query
      count[kSecMatchLimit as String] = kSecMatchLimitAll
      count[kSecReturnAttributes as String] = true
      var found: CFTypeRef?
      let status = SecItemCopyMatching(count as CFDictionary, &found)
      if status == errSecItemNotFound { continue }
      guard status == errSecSuccess else {
        failure = status
        continue
      }
      let items = ((found as? [[String: Any]]) ?? []).filter { $0[kSecAttrAccessGroup as String] as? String == old }
      guard !items.isEmpty else { continue }
      let updated = SecItemUpdate(query as CFDictionary, [kSecAttrAccessGroup as String: new] as CFDictionary)
      if updated == errSecSuccess { moved += items.count } else { failure = updated }
    }
    return (moved, failure)
  }
}

typealias Ask = (_ title: String, _ message: String, _ buttons: [String]) -> Int?

struct LegacyMigrator {
  struct Context {
    var oldData: URL
    var newData: URL
    var extras: [(URL, URL)] = []
    var oldDefaults: PreferencesDomain
    var newDefaults: PreferencesDomain
    var oldSecrets: SecretStore?
    var newSecrets: SecretStore?
    var accessGroups: [(old: String, new: String)] = []
    var groupMover: AccessGroupMover? = nil
    var oldAppRunning: () -> Bool
    var oldAppWasDefaultBrowser: () -> Bool = { false }
    var ask: Ask
    var crashAfter: String? = nil
  }

  enum Outcome: Equatable {
    case proceed
    case quit
  }

  struct Journal: Codable, Equatable {
    var version = 1
    var phase: String
    var outcome: String?
    var files: Int?
    var secrets: [String: String]?
    var secretAttempts: Int?
    var groups: String?
    var groupAttempts: Int?
    var defaultBrowser: String?
    var finishedAt: Date?

    var isDone: Bool { phase == "done" && groups != "pending" && defaultBrowser != nil && !secretsPending }

    static let secretTries = 3
    static func retryable(_ outcome: String) -> Bool { outcome == "denied" || outcome.hasPrefix("failed") }
    var secretsPending: Bool {
      (secretAttempts ?? 1) < Self.secretTries && (secrets ?? [:]).values.contains(where: Self.retryable)
    }
  }

  static let journalName = ".legacy-migration.json"
  static let defaultBrowserOfferName = "default-browser-offer.json"
  static let stagingName = ".legacy-migration-staging"
  static let lockName = ".legacy-migration.lock"
  static let asideName = ".legacy-migration-replaced"

  let context: Context
  private let fm = FileManager.default

  init(_ context: Context) { self.context = context }

  var journalURL: URL { context.newData.appendingPathComponent(Self.journalName) }
  var oldRoot: URL { context.oldData.resolvingSymlinksInPath() }
  var stagingURL: URL { context.newData.appendingPathComponent(Self.stagingName) }

  func readJournal() -> Journal? {
    guard let data = try? Data(contentsOf: journalURL) else { return nil }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return try? decoder.decode(Journal.self, from: data)
  }

  var isDone: Bool { readJournal()?.isDone == true }

  func run() -> Outcome {
    if isDone { return .proceed }
    do {
      try fm.createDirectory(at: context.newData, withIntermediateDirectories: true)
    } catch {
      log("can't make \(context.newData.path): \(error)")
      return .proceed
    }
    let lock = open(context.newData.appendingPathComponent(Self.lockName).path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
    guard lock >= 0 else {
      log("can't open the migration lock: \(String(cString: strerror(errno)))")
      return .quit
    }
    defer { close(lock) }
    let deadline = Date().addingTimeInterval(600)
    while flock(lock, LOCK_EX | LOCK_NB) != 0 {
      guard errno == EWOULDBLOCK || errno == EINTR, Date() < deadline else {
        log("another launch is migrating; quitting")
        return .quit
      }
      usleep(200_000)
    }
    defer { flock(lock, LOCK_UN) }
    return runLocked()
  }

  private func runLocked() -> Outcome {
    let journal = readJournal()
    if var done = journal, done.phase == "done" {
      let before = done
      if done.defaultBrowser == nil { done.defaultBrowser = checkDefaultBrowser() }
      if done.groups == "pending" {
        let (groups, counts) = moveAccessGroups()
        done.groups = groups
        if counts { done.groupAttempts = (done.groupAttempts ?? 0) + 1 }
        if done.groups == "pending", (done.groupAttempts ?? 0) >= 5 { done.groups = "failed" }
      }
      if done.secretsPending { retrySecrets(&done) }
      if done != before, !writeJournal(done) { log("couldn't record what's left to bring across") }
      return .proceed
    }
    if let publishing = journal, publishing.phase == "publishing" {
      return publishOrQuit() ? finish(publishing) : .quit
    }
    guard exists(context.oldData) else {
      return finish(Journal(phase: "done", outcome: "nothing"))
    }
    if hasData(context.newData) {
      log("\(context.newData.path) already has data; leaving it and \(context.oldData.path) as they are")
      return finish(Journal(phase: "done", outcome: "existing"))
    }
    var files = 0
    var secrets: [String: String] = [:]
    while true {
      while context.oldAppRunning() {
        let choice = context.ask(
          "Quit \(LegacyName.appName) to continue",
          "Ardia is the new name of \(LegacyName.appName). Quit \(LegacyName.appName), then click Continue to bring your tabs, passwords and settings across.",
          ["Continue", "Quit"])
        if choice != 0 { return .quit }
      }
      do {
        files = try stage()
      } catch {
        log("couldn't copy \(context.oldData.path): \(error)")
        try? fm.removeItem(at: stagingURL)
        let choice = context.ask(
          "Ardia couldn't bring your data across",
          "Copying your data from \(LegacyName.appName) failed (\(error.localizedDescription)). Nothing was changed. You can try again, quit, or start Ardia without it; \(LegacyName.appName)'s data stays where it is.",
          ["Try Again", "Quit", "Start Without It"])
        if choice == 0 { continue }
        if choice == 2 { return finish(Journal(phase: "done", outcome: "fresh")) }
        return .quit
      }
      if context.oldAppRunning() {
        try? fm.removeItem(at: stagingURL)
        continue
      }
      if crash("staged") { return .quit }

      if let old = context.oldSecrets, let new = context.newSecrets {
        for item in Renamed.keychain {
          switch copySecrets(item, from: old, to: new, skip: Self.accounts(of: item, in: secrets) { $0 == "copied" }) {
          case let .copied(results): secrets.merge(results) { $1 }
          case .quit:
            try? fm.removeItem(at: stagingURL)
            return .quit
          case .startFresh:
            try? fm.removeItem(at: stagingURL)
            return finish(Journal(phase: "done", outcome: "fresh"))
          }
        }
      }
      if crash("secrets") { return .quit }
      guard context.oldAppRunning() else { break }
      try? fm.removeItem(at: stagingURL)
    }

    let publishing = Journal(phase: "publishing", outcome: "migrated", files: files, secrets: secrets)
    guard writeJournal(publishing) else {
      log("couldn't write the journal")
      try? fm.removeItem(at: stagingURL)
      return .quit
    }
    if crash("journal") { return .quit }
    guard publishOrQuit() else { return .quit }
    if crash("published") { return .quit }
    return finish(publishing)
  }

  private func publishOrQuit() -> Bool {
    while true {
      do {
        return try publish()
      } catch {
        log("couldn't move the data in: \(error)")
        let choice = context.ask(
          "Ardia couldn't finish bringing your data across",
          "Moving your copied data into place failed (\(error.localizedDescription)). \(LegacyName.appName)'s data is untouched. Try again, or quit and Ardia will finish the next time it opens.",
          ["Try Again", "Quit"])
        if choice != 0 { return false }
      }
    }
  }

  func stage() throws -> Int {
    if exists(stagingURL) { try fm.removeItem(at: stagingURL) }
    try fm.copyItem(at: oldRoot, to: stagingURL)
    guard !isLink(stagingURL) else { throw MigrationError("\(context.oldData.path) copied as a link") }
    for name in ["SingletonLock", "SingletonSocket", "SingletonCookie"] {
      let lock = stagingURL.appendingPathComponent("Chromium/\(name)")
      if ownCopy(lock) { try? fm.removeItem(at: lock) }
    }
    var renamed: [String: String] = [:]
    for (old, new) in expandedRenames(in: stagingURL) {
      let from = stagingURL.appendingPathComponent(old), to = stagingURL.appendingPathComponent(new)
      guard exists(from), !exists(to), ownCopy(from), ownCopy(to) else { continue }
      try fm.moveItem(at: from, to: to)
      renamed[old] = new
    }
    let rewriter = DocumentRewriter(oldData: context.oldData.path, newData: context.newData.path, aliases: [oldRoot.path])
    var rewritten = Set<String>()
    for relative in documents(in: stagingURL) {
      let url = stagingURL.appendingPathComponent(relative)
      guard ownCopy(url), !isLink(url) else {
        log("left \(relative) as it is: it's reached through a link out of the folder")
        continue
      }
      if try rewriter.rewriteFile(url) { rewritten.insert(relative) }
    }
    return try verify(renamed: renamed, rewritten: rewritten)
  }

  func verify(renamed: [String: String], rewritten: Set<String>) throws -> Int {
    var count = 0
    let root = oldRoot
    let base = root.standardizedFileURL.path
    guard let walk = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey]) else {
      throw MigrationError("can't list \(base)")
    }
    for case let url as URL in walk {
      let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
      guard values.isRegularFile == true else { continue }
      var relative = String(url.standardizedFileURL.path.dropFirst(base.count + 1))
      if relative.hasPrefix("Chromium/Singleton") { continue }
      for (old, new) in renamed where relative == old || relative.hasPrefix(old + "/") {
        relative = new + relative.dropFirst(old.count)
      }
      let copy = stagingURL.appendingPathComponent(relative)
      let copied = try? copy.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
      guard copied?.isRegularFile == true else { throw MigrationError("\(relative) didn't copy") }
      if rewritten.contains(relative) {
        guard DocumentRewriter.parses(copy) else { throw MigrationError("\(relative) doesn't parse after rewriting") }
      } else if copied?.fileSize != values.fileSize {
        throw MigrationError("\(relative) copied short")
      }
      count += 1
    }
    return count
  }

  enum SecretsResult {
    case copied([String: String])
    case quit
    case startFresh
  }

  func copySecrets(_ item: Renamed.KeychainItem, from old: SecretStore, to new: SecretStore, skip: Set<String> = [],
                   keepPresent: Bool = false) -> SecretsResult {
    var results: [String: String] = [:]
    while true {
      guard let present = old.accounts(service: item.oldService) else {
        if item.critical {
          switch askAboutKey(item, "macOS couldn't list it") {
          case .copied: continue
          case let other: return other
          }
        }
        results["\(item.newService)/*"] = "failed"
        log("couldn't list \(item.oldService)")
        return .copied(results)
      }
      let accounts = (item.account.map { present.contains($0.old) ? [$0] : [] } ?? present.map { ($0, $0) }).filter { !skip.contains($0.1) }
      var retry = false
      for (oldAccount, newAccount) in accounts {
        let key = "\(item.newService)/\(newAccount)"
        let read = old.read(service: item.oldService, account: oldAccount)
        var outcome = "\(read)"
        let presentNow = keepPresent ? new.accounts(service: item.newService).map { $0.contains(newAccount) } : false
        if case .found = read, presentNow != false {
          outcome = presentNow == nil ? "failed" : "present"
        } else if case let .found(data) = read {
          let wrote = new.write(service: item.newService, account: newAccount, label: item.label(newAccount), accessible: item.accessible, data: data)
          outcome = wrote && new.read(service: item.newService, account: newAccount) == .found(data) ? "copied" : "failed"
        }
        if outcome != "copied", item.critical {
          switch askAboutKey(item, outcome) {
          case .copied:
            retry = true
          case let other: return other
          }
          break
        }
        results[key] = outcome
        if outcome != "copied" { log("\(item.oldService) (\(oldAccount)): \(outcome)") }
      }
      if !retry { return .copied(results) }
    }
  }

  private func askAboutKey(_ item: Renamed.KeychainItem, _ why: String) -> SecretsResult {
    log("\(item.oldService): \(why)")
    let choice = context.ask(
      "Ardia needs your passwords' key",
      "To keep your saved passwords and website logins, allow Ardia to use “\(item.oldService)” (the key \(LegacyName.appName) kept them with); choose Always Allow when macOS asks. Or start Ardia without \(LegacyName.appName)'s data, which stays where it is.",
      ["Try Again", "Quit", "Start Without It"])
    return choice == 0 ? .copied([:]) : choice == 2 ? .startFresh : .quit
  }

  func retrySecrets(_ journal: inout Journal) {
    guard let old = context.oldSecrets, let new = context.newSecrets else { return }
    var secrets = journal.secrets ?? [:]
    for item in Renamed.keychain where !item.critical {
      let pending = Self.accounts(of: item, in: secrets, Journal.retryable)
      guard !pending.isEmpty else { continue }
      guard let present = new.accounts(service: item.newService) else { continue }
      let done = Self.accounts(of: item, in: secrets) { !Journal.retryable($0) }
      guard case let .copied(results) = copySecrets(item, from: old, to: new, skip: done.union(present), keepPresent: true) else { continue }
      if results["\(item.newService)/*"] != nil {
        secrets.merge(results) { $1 }
        continue
      }
      for account in pending where results["\(item.newService)/\(account)"] == nil {
        secrets["\(item.newService)/\(account)"] = account == "*" ? nil : present.contains(account) ? "present" : "missing"
      }
      secrets.merge(results) { $1 }
    }
    journal.secrets = secrets
    journal.secretAttempts = (journal.secretAttempts ?? 1) + 1
  }

  static func accounts(of item: Renamed.KeychainItem, in secrets: [String: String], _ matching: (String) -> Bool) -> Set<String> {
    Set(secrets.compactMap { key, outcome in
      key.hasPrefix(item.newService + "/") && matching(outcome) ? String(key.dropFirst(item.newService.count + 1)) : nil
    })
  }

  @discardableResult
  func publish() throws -> Bool {
    if exists(stagingURL) {
      for (index, name) in try fm.contentsOfDirectory(atPath: stagingURL.path).sorted().enumerated() {
        if index == 1, crash("moved-one") { return false }
        let from = stagingURL.appendingPathComponent(name), to = context.newData.appendingPathComponent(name)
        if exists(to) {
          let aside = context.newData.appendingPathComponent(Self.asideName)
          try fm.createDirectory(at: aside, withIntermediateDirectories: true)
          try fm.moveItem(at: to, to: uniqueURL(aside.appendingPathComponent(name)))
        }
        try fm.moveItem(at: from, to: to)
      }
      MigrationFiles.syncFolder(context.newData)
      try fm.removeItem(at: stagingURL)
    }
    return true
  }

  func copyDefaults() {
    var copy: [String: Any] = [:]
    for (key, value) in context.oldDefaults.all() {
      var newKey = Renamed.defaultsKeys[key] ?? key
      for (old, new) in Renamed.defaultsKeyPrefixes where newKey.hasPrefix(old) {
        newKey = new + newKey.dropFirst(old.count)
      }
      guard !context.newDefaults.has(newKey) else { continue }
      if newKey == "NSUserKeyEquivalents", let titles = value as? [String: Any] {
        copy[newKey] = Dictionary(titles.map { title, shortcut in
          (Renamed.menuTitleWords.reduce(title) { $0.replacingOccurrences(of: $1.0, with: $1.1) }, shortcut)
        }) { first, _ in first }
      } else {
        copy[newKey] = value
      }
    }
    if !context.newDefaults.set(copy) { log("couldn't save the copied preferences") }
  }

  func moveAccessGroups() -> (state: String?, counts: Bool) {
    guard let mover = context.groupMover, !context.accessGroups.isEmpty else { return (nil, false) }
    let all = context.accessGroups.flatMap { [$0.old, $0.new] }
    guard mover.entitled(to: all) else {
      log("not entitled to the old keychain groups; Chrome's passkeys stay there until a build is")
      return ("pending", false)
    }
    var moved = 0
    var failed = false, transient = false
    for (old, new) in context.accessGroups {
      let result = mover.move(from: old, to: new)
      moved += result.moved
      if let status = result.failure {
        failed = true
        if [errSecInteractionNotAllowed, errSecNotAvailable, errSecUserCanceled].contains(status) { transient = true }
        log("moving \(old) to \(new): \(status)")
      }
    }
    return (failed ? "pending" : moved > 0 ? "moved \(moved)" : "none", failed && !transient)
  }

  @discardableResult
  func copyExtras() -> Bool {
    for (old, new) in context.extras where exists(old) && !exists(new) {
      let partial = new.deletingLastPathComponent().appendingPathComponent(".\(new.lastPathComponent).legacy-partial")
      do {
        try fm.createDirectory(at: new.deletingLastPathComponent(), withIntermediateDirectories: true)
        if exists(partial) { try fm.removeItem(at: partial) }
        try fm.copyItem(at: old, to: partial)
        if crash("extra") { return false }
        try fm.moveItem(at: partial, to: new)
      } catch {
        log("skipped \(old.lastPathComponent): \(error)")
        try? fm.removeItem(at: partial)
      }
    }
    return true
  }

  private func finish(_ journal: Journal) -> Outcome {
    var journal = journal
    if journal.outcome == "migrated" {
      copyDefaults()
      if crash("defaults") { return .quit }
      if !copyExtras() { return .quit }
      let (groups, counts) = moveAccessGroups()
      journal.groups = groups
      if counts { journal.groupAttempts = 1 }
    }
    journal.defaultBrowser = checkDefaultBrowser()
    journal.phase = "done"
    journal.finishedAt = Date()
    if !writeJournal(journal) { log("couldn't record the migration as done") }
    log("done: \(journal.outcome ?? "?")\(journal.files.map { ", \($0) files" } ?? "")")
    return .proceed
  }

  func checkDefaultBrowser() -> String? {
    guard context.oldAppWasDefaultBrowser() else { return "no" }
    let url = context.newData.appendingPathComponent(Self.defaultBrowserOfferName)
    guard !exists(url) else { return "offered" }
    let offer = try? JSONSerialization.data(withJSONObject: ["version": 1, "askedAt": NSNull()], options: [.sortedKeys])
    guard MigrationFiles.writeDurably(offer, to: url, mode: 0o644) else {
      log("couldn't record the default browser offer")
      return nil
    }
    return "offered"
  }

  private func crash(_ step: String) -> Bool { context.crashAfter == step }

  private func writeJournal(_ journal: Journal) -> Bool {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys]
    return MigrationFiles.writeDurably(try? encoder.encode(journal), to: journalURL, mode: 0o644, fullSync: true)
  }

  private func exists(_ url: URL) -> Bool {
    var info = stat()
    return lstat(url.path, &info) == 0
  }

  private func ownCopy(_ url: URL) -> Bool {
    guard let base = realpath(stagingURL.path, nil) else { return false }
    defer { free(base) }
    guard let parent = realpath(url.deletingLastPathComponent().path, nil) else { return false }
    defer { free(parent) }
    let root = String(cString: base), dir = String(cString: parent)
    return dir == root || dir.hasPrefix(root + "/")
  }

  private func isLink(_ url: URL) -> Bool {
    var info = stat()
    return lstat(url.path, &info) == 0 && info.st_mode & S_IFMT == S_IFLNK
  }

  private func hasData(_ dir: URL) -> Bool {
    exists(dir.appendingPathComponent("session.json")) || exists(dir.appendingPathComponent("Chromium/Local State"))
  }

  private func uniqueURL(_ url: URL) -> URL {
    var candidate = url, n = 2
    while exists(candidate) {
      candidate = url.deletingLastPathComponent().appendingPathComponent("\(url.lastPathComponent) \(n)")
      n += 1
    }
    return candidate
  }

  func expandedRenames(in root: URL) -> [(String, String)] {
    var result: [(String, String)] = []
    for (old, new) in Renamed.paths {
      let oldParts = old.split(separator: "/").map(String.init), newParts = new.split(separator: "/").map(String.init)
      guard let star = oldParts.firstIndex(of: "*") else {
        result.append((old, new))
        continue
      }
      let parent = oldParts[..<star].joined(separator: "/")
      for name in ((try? fm.contentsOfDirectory(atPath: root.appendingPathComponent(parent).path)) ?? []).sorted() {
        let fill = { (parts: [String]) in parts.map { $0 == "*" ? name : $0 }.joined(separator: "/") }
        result.append((fill(oldParts), fill(newParts)))
      }
    }
    return result
  }

  func documents(in root: URL) -> [String] {
    var result: [String] = []
    for name in ((try? fm.contentsOfDirectory(atPath: root.path)) ?? []).sorted() where name.hasSuffix(".json") {
      if (try? root.appendingPathComponent(name).resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
        result.append(name)
      }
    }
    for profile in ((try? fm.contentsOfDirectory(atPath: root.appendingPathComponent("Chromium").path)) ?? []).sorted() {
      for name in ["Bookmarks", "Bookmarks.bak"] {
        let relative = "Chromium/\(profile)/\(name)"
        if (try? root.appendingPathComponent(relative).resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
          result.append(relative)
        }
      }
    }
    return result
  }

  private func log(_ message: String) { NSLog("Ardia: migration from \(LegacyName.appName): \(message)") }
}

struct MigrationError: Error, LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

enum MigrationFiles {
  static func writeDurably(_ data: Data?, to url: URL, mode: mode_t, fullSync: Bool = false) -> Bool {
    guard let data else { return false }
    let temp = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).\(getpid()).tmp")
    unlink(temp.path)
    let fd = open(temp.path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, mode)
    guard fd >= 0 else { return false }
    let wrote = fchmod(fd, mode) == 0 && data.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) } == data.count
    let synced = fullSync ? fcntl(fd, F_FULLFSYNC) == 0 : fsync(fd) == 0
    close(fd)
    guard wrote, synced, rename(temp.path, url.path) == 0 else {
      unlink(temp.path)
      return false
    }
    syncFolder(url.deletingLastPathComponent(), full: fullSync)
    return true
  }

  static func syncFolder(_ url: URL, full: Bool = true) {
    let fd = open(url.path, O_RDONLY | O_CLOEXEC)
    guard fd >= 0 else { return }
    if !full || fcntl(fd, F_FULLFSYNC) != 0 { fsync(fd) }
    close(fd)
  }
}

struct DocumentRewriter {
  let oldData: String
  let newData: String
  var aliases: [String] = []

  func string(_ s: String) -> String {
    let lower = s.lowercased()
    for prefix in ["", "view-source:"] {
      for (old, new) in Renamed.urls where lower.hasPrefix(prefix + old) {
        let rest = s.dropFirst(prefix.count + old.count)
        if !old.hasSuffix("://"), let next = rest.first, !"/?#".contains(next) { continue }
        return String(s.prefix(prefix.count)) + new + rest
      }
    }
    for old in [oldData] + aliases where s == old || s.hasPrefix(old + "/") { return newData + s.dropFirst(old.count) }
    return s
  }

  func value(_ value: Any) -> Any {
    switch value {
    case let s as String:
      return string(s)
    case let list as [Any]:
      return list.map(self.value)
    case let object as [String: Any]:
      var out: [String: Any] = [:]
      for (key, v) in object {
        let newKey = Renamed.jsonKeys[key] ?? string(key)
        if newKey != key, object[newKey] != nil { continue }
        out[newKey] = self.value(v)
      }
      return out
    default:
      return value
    }
  }

  func rewriteFile(_ url: URL) throws -> Bool {
    let data = try Data(contentsOf: url)
    guard let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return false }
    let rewritten = value(parsed)
    guard !NSDictionary(dictionary: ["v": parsed]).isEqual(to: ["v": rewritten]) else { return false }
    let out = try JSONSerialization.data(withJSONObject: rewritten, options: [.fragmentsAllowed, .withoutEscapingSlashes])
    let mode = ((try? FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions]) as? NSNumber)?.uint16Value ?? 0o644
    guard MigrationFiles.writeDurably(out, to: url, mode: mode_t(mode)) else { throw MigrationError("can't write \(url.lastPathComponent)") }
    return true
  }

  static func parses(_ url: URL) -> Bool {
    guard let data = try? Data(contentsOf: url) else { return false }
    if url.pathExtension == "plist" { return (try? PropertyListSerialization.propertyList(from: data, format: nil)) != nil }
    return (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) != nil
  }
}

public enum LegacyMigration {
  public static func runAtLaunch(bundleId: String? = Bundle.main.bundleIdentifier) -> Bool {
    guard let bundleId, LegacyName.isSuccessor(bundleId) else { return true }
    let env = ProcessInfo.processInfo.environment
    let context: LegacyMigrator.Context?
    if let data = env["ARDIA_DATA_DIR"], !data.isEmpty {
      guard let source = env["ARDIA_LEGACY_SOURCE"], !source.isEmpty else { return true }
      context = testInstanceContext(dataDir: data, legacyHome: source, bundleId: bundleId, crashAfter: env["ARDIA_LEGACY_CRASH_AFTER"])
    } else {
      context = installedContext(bundleId: bundleId)
    }
    guard let context else { return true }
    return LegacyMigrator(context).run() == .proceed
  }

  static func installedContext(bundleId: String) -> LegacyMigrator.Context? {
    #if DEBUG
    return nil
    #else
    let fm = FileManager.default
    guard let library = fm.urls(for: .libraryDirectory, in: .userDomainMask).first else { return nil }
    let support = library.appendingPathComponent("Application Support", isDirectory: true)
    let newData = support.appendingPathComponent(bundleId, isDirectory: true)
    if LegacyMigrator.Context.isDone(newData) { return nil }
    guard let team = teamIdentifier() else { return nil }
    let caches = library.appendingPathComponent("Caches", isDirectory: true)
    let storages = library.appendingPathComponent("HTTPStorages", isDirectory: true)
    var extras: [(URL, URL)] = [(storages.appendingPathComponent(LegacyName.bundleId), storages.appendingPathComponent(bundleId)),
                                (storages.appendingPathComponent("\(LegacyName.bundleId).binarycookies"),
                                 storages.appendingPathComponent("\(bundleId).binarycookies"))]
    let oldCaches = caches.appendingPathComponent(LegacyName.bundleId)
    for name in ((try? fm.contentsOfDirectory(atPath: oldCaches.path)) ?? []) where name != "org.sparkle-project.Sparkle" {
      extras.append((oldCaches.appendingPathComponent(name), caches.appendingPathComponent(bundleId).appendingPathComponent(name)))
    }
    return LegacyMigrator.Context(
      oldData: support.appendingPathComponent(LegacyName.bundleId, isDirectory: true),
      newData: newData,
      extras: extras,
      oldDefaults: PreferencesDomain(id: LegacyName.bundleId),
      newDefaults: PreferencesDomain(id: bundleId),
      oldSecrets: LoginKeychain(),
      newSecrets: LoginKeychain(),
      accessGroups: KeychainAccessGroups.suffixes.map { ("\(team).\(LegacyName.bundleId).\($0)", "\(team).\(bundleId).\($0)") },
      groupMover: KeychainAccessGroups(),
      oldAppRunning: {
        NSRunningApplication.runningApplications(withBundleIdentifier: LegacyName.bundleId).contains {
          !$0.isTerminated && $0.processIdentifier != getpid()
        } || singletonOwnerAlive(support.appendingPathComponent("\(LegacyName.bundleId)/Chromium/SingletonLock"), executable: LegacyName.appName)
      },
      oldAppWasDefaultBrowser: {
        let stored = CFPreferencesCopyValue("LSHandlers" as CFString, launchServicesDomain as CFString, kCFPreferencesCurrentUser,
                                            kCFPreferencesAnyHost) as? [[String: Any]]
        return ["http", "https"].contains {
          isOldApp(defaultFor: $0, live: LSCopyDefaultHandlerForURLScheme($0 as CFString)?.takeRetainedValue() as String?, stored: stored)
        }
      },
      ask: alert)
    #endif
  }

  static func testInstanceContext(dataDir: String, legacyHome: String, bundleId: String, crashAfter: String?) -> LegacyMigrator.Context? {
    let cwd = FileManager.default.currentDirectoryPath
    let absolute = { (path: String) in
      URL(fileURLWithPath: (((path as NSString).isAbsolutePath ? path : (cwd as NSString).appendingPathComponent(path)) as NSString)
        .standardizingPath)
    }
    let data = absolute(dataDir), home = absolute(legacyHome)
    let resolved = { (url: URL) in url.resolvingSymlinksInPath().path }
    let realHome = resolved(URL(fileURLWithPath: NSHomeDirectory()))
    let inside = { (a: String, b: String) in a == b || a.hasPrefix(b + "/") }
    guard resolved(home) != realHome, !inside(resolved(home), realHome + "/Library"), !inside(resolved(data), resolved(home)),
      !inside(resolved(home), resolved(data)) else {
      NSLog("Ardia: ARDIA_LEGACY_SOURCE must be a scratch folder apart from the data dir and your home; ignored")
      return nil
    }
    let library = home.appendingPathComponent("Library")
    let oldData = library.appendingPathComponent("Application Support/\(LegacyName.bundleId)", isDirectory: true)
    let handlers = library.appendingPathComponent("Preferences/\(launchServicesDomain).plist")
    for input in [library, oldData, library.appendingPathComponent("Preferences"), handlers, home.appendingPathComponent("keychain.json")]
    where FileManager.default.fileExists(atPath: input.path) && !inside(resolved(input), resolved(home)) {
      NSLog("Ardia: \(input.path) leads out of ARDIA_LEGACY_SOURCE; ignored")
      return nil
    }
    return LegacyMigrator.Context(
      oldData: oldData,
      newData: data,
      oldDefaults: PreferencesDomain(id: library.appendingPathComponent("Preferences/\(LegacyName.bundleId)").path),
      newDefaults: PreferencesDomain(id: data.appendingPathComponent("Preferences/\(bundleId)").path),
      oldSecrets: SecretFile(url: home.appendingPathComponent("keychain.json")),
      newSecrets: IsolatedSecretStores(dataDirectory: data),
      oldAppRunning: { singletonOwnerAlive(oldData.appendingPathComponent("Chromium/SingletonLock")) },
      oldAppWasDefaultBrowser: {
        let plist = (try? Data(contentsOf: handlers)).flatMap { try? PropertyListSerialization.propertyList(from: $0, format: nil) }
        let stored = (plist as? [String: Any])?["LSHandlers"] as? [[String: Any]]
        return ["http", "https"].contains { isOldApp(defaultFor: $0, live: nil, stored: stored) }
      },
      ask: { _, _, _ in nil },
      crashAfter: crashAfter)
  }

  static let launchServicesDomain = "com.apple.LaunchServices/com.apple.launchservices.secure"

  static func isOldApp(defaultFor scheme: String, live: String?, stored handlers: [[String: Any]]?) -> Bool {
    if let live { return live.lowercased() == LegacyName.bundleId }
    return (handlers ?? []).contains { handler in
      guard (handler["LSHandlerURLScheme"] as? String)?.lowercased() == scheme else { return false }
      return ["LSHandlerRoleAll", "LSHandlerRoleViewer"].contains { (handler[$0] as? String)?.lowercased() == LegacyName.bundleId }
    }
  }

  static func singletonOwnerAlive(_ lock: URL, executable: String? = nil) -> Bool {
    guard let target = try? FileManager.default.destinationOfSymbolicLink(atPath: lock.path),
      let pid = target.split(separator: "-").last.flatMap({ pid_t($0) }), pid > 0, pid != getpid() else { return false }
    guard kill(pid, 0) == 0 || errno == EPERM else { return false }
    guard let executable else { return true }
    var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
    guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return false }
    return String(cString: buffer).hasSuffix("/Contents/MacOS/\(executable)")
  }

  static func alert(_ title: String, _ message: String, _ buttons: [String]) -> Int? {
    var response: CFOptionFlags = 0
    let icon = Bundle.main.url(forResource: "AppIcon", withExtension: "icns") as CFURL?
    let result = CFUserNotificationDisplayAlert(
      0, kCFUserNotificationNoteAlertLevel, icon, nil, nil, title as CFString, message as CFString,
      buttons.first as CFString?, buttons.count > 1 ? buttons[1] as CFString : nil, buttons.count > 2 ? buttons[2] as CFString : nil,
      &response)
    guard result == 0 else { return nil }
    switch response & 0x3 {
    case CFOptionFlags(kCFUserNotificationDefaultResponse): return 0
    case CFOptionFlags(kCFUserNotificationAlternateResponse): return 1
    case CFOptionFlags(kCFUserNotificationOtherResponse): return 2
    default: return nil
    }
  }

  static func teamIdentifier() -> String? {
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
      let dict = info as? [String: Any] else { return nil }
    return dict[kSecCodeInfoTeamIdentifier as String] as? String
  }
}

extension LegacyMigration {
  public static func moveToNewName(
    bundleId: String? = Bundle.main.bundleIdentifier, launched: String? = launchedExecutable(),
    running: @escaping () -> String? = runningExecutable
  ) {
    guard LegacyName.isSuccessor(bundleId), let launched else { return }
    let executable = URL(fileURLWithPath: launched)
    let macOS = executable.deletingLastPathComponent(), contents = macOS.deletingLastPathComponent()
    let old = contents.deletingLastPathComponent(), name = executable.lastPathComponent
    guard macOS.lastPathComponent == "MacOS", contents.lastPathComponent == "Contents", old.lastPathComponent == LegacyName.appFileName,
      !old.path.contains("/AppTranslocation/"), "\(name).app" != old.lastPathComponent,
      let folder = realpath(old.deletingLastPathComponent().path, nil) else { return }
    let resolvedFolder = String(cString: folder)
    free(folder)
    let new = old.deletingLastPathComponent().appendingPathComponent("\(name).app")
    let log = { (message: String) in NSLog("Ardia: renaming \(old.path): \(message)") }
    var info = stat()
    let isIn = { (bundle: URL) in (running() ?? "").hasPrefix("\(resolvedFolder)/\(bundle.lastPathComponent)/") }
    let isBundle = lstat(old.path, &info) == 0 && info.st_mode & S_IFMT == S_IFDIR && isIn(old)
    let moved = isBundle && renamex_np(old.path, new.path, UInt32(RENAME_EXCL)) == 0
    let error = String(cString: strerror(errno))
    guard isIn(new) else {
      if moved {
        log("renamed it, but this app isn't in it (it was replaced a moment ago); runs as it is")
      } else if isBundle {
        log("stays: \(error)")
      }
      return
    }
    if moved { LSRegisterURL(new as CFURL, true) }
    let path = new.appendingPathComponent("Contents/MacOS").appendingPathComponent(name).path
    var argv = (0..<Int(CommandLine.argc)).map { CommandLine.unsafeArgv[$0] }
    if argv.isEmpty { argv.append(nil) }
    argv[0] = strdup(path)
    argv.append(nil)
    execv(path, argv)
    log("couldn't start from \(new.lastPathComponent): \(String(cString: strerror(errno))); quitting")
    exit(EXIT_FAILURE)
  }

  public static func launchedExecutable() -> String? {
    var size: UInt32 = 0
    _NSGetExecutablePath(nil, &size)
    var buffer = [CChar](repeating: 0, count: Int(size) + 1)
    guard _NSGetExecutablePath(&buffer, &size) == 0 else { return nil }
    return String(cString: buffer)
  }

  public static func runningExecutable() -> String? {
    var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
    guard proc_pidpath(getpid(), &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return String(cString: buffer)
  }
}

extension LegacyMigration {
  public static func namesJSON() -> Data {
    let names: [String: Any] = [
      "bundleId": LegacyName.bundleId,
      "appFileName": LegacyName.appFileName,
      "appName": LegacyName.appName,
      "keychain": Renamed.keychain.map { item -> [String: Any] in
        var entry: [String: Any] = ["oldService": item.oldService, "newService": item.newService]
        if let account = item.account { entry["oldAccount"] = account.old; entry["newAccount"] = account.new }
        return entry
      },
      "paths": Renamed.paths.map { [$0.old, $0.new] },
      "jsonKeys": Renamed.jsonKeys,
      "urls": Renamed.urls.map { [$0.old, $0.new] },
      "defaultsKeys": Renamed.defaultsKeys,
      "defaultsKeyPrefixes": Renamed.defaultsKeyPrefixes.map { [$0.0, $0.1] },
      "menuTitleWords": Renamed.menuTitleWords.map { [$0.0, $0.1] },
    ]
    return (try? JSONSerialization.data(withJSONObject: names, options: [.sortedKeys, .prettyPrinted])) ?? Data()
  }
}

extension LegacyMigrator.Context {
  static func isDone(_ newData: URL) -> Bool {
    guard let data = try? Data(contentsOf: newData.appendingPathComponent(LegacyMigrator.journalName)) else { return false }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return (try? decoder.decode(LegacyMigrator.Journal.self, from: data))?.isDone == true
  }
}
