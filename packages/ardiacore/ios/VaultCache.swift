import CryptoKit
import Foundation

struct VaultCacheSnapshot: Codable, Sendable {
  struct Entry: Codable, Sendable {
    var item: VaultItem
    var totpPeriod: Int?
  }

  struct Password: Codable, Sendable {
    var value: String
    var itemUpdatedAt: Double?
  }

  var version = 2
  var account: String
  var savedAt: Double
  var entries: [Entry]
  var passwords: [String: Password]
  var totps: [String: Password]?

  var items: [VaultItem] {
    entries.map { entry in
      var item = entry.item
      item.totpPeriod = entry.totpPeriod
      return item
    }
  }
}

enum VaultCache {
  private static let lock = NSLock()
  nonisolated(unsafe) private static var cloudEnabled = true

  private static var localDirectory: URL? {
    let base: URL
    if let sandbox = VaultSandbox.directory {
      base = URL(fileURLWithPath: sandbox, isDirectory: true)
    } else if let data = LaunchConfig.shared.dataDirectory {
      base = URL(fileURLWithPath: data, isDirectory: true)
    } else if let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
      base = support.appendingPathComponent(Bundle.main.bundleIdentifier ?? "Ardia", isDirectory: true)
    } else {
      return nil
    }
    return base.appendingPathComponent("Password Managers", isDirectory: true).appendingPathComponent("Cache", isDirectory: true)
  }

  private static var cloudDirectory: URL? {
    guard cloudEnabled else { return nil }
    if let chosen = LaunchConfig.shared.testValue("vaultCloudDirectory"), !chosen.isEmpty {
      return URL(fileURLWithPath: chosen, isDirectory: true)
    }
    guard !LaunchConfig.shared.background, VaultStoreKey.syncs else { return nil }
    let drive = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: drive.path, isDirectory: &isDirectory), isDirectory.boolValue else { return nil }
    return drive.appendingPathComponent("Ardia", isDirectory: true).appendingPathComponent("Password Managers", isDirectory: true)
  }

  static var syncsWithICloud: Bool { cloudDirectory != nil }

  static func setCloudEnabled(_ enabled: Bool) {
    lock.lock()
    let was = cloudEnabled
    let directory = cloudDirectory
    cloudEnabled = enabled
    lock.unlock()
    if was && !enabled, let directory { removeOurFiles(in: directory) }
  }

  private static func file(_ provider: String, in directory: URL?) -> URL? {
    directory?.appendingPathComponent("\(provider).vault")
  }

  static func exists(_ provider: String) -> Bool {
    guard let url = file(provider, in: localDirectory) else { return false }
    return FileManager.default.fileExists(atPath: url.path)
  }

  static func load(_ provider: String) -> VaultCacheSnapshot? {
    lock.lock()
    defer { lock.unlock() }
    guard let url = file(provider, in: localDirectory), let sealed = try? Data(contentsOf: url) else { return nil }
    guard let snapshot = open(sealed) else {
      try? FileManager.default.removeItem(at: url)
      return nil
    }
    return snapshot
  }

  @discardableResult
  static func save(_ provider: String, _ snapshot: VaultCacheSnapshot, toCloud: Bool = true) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard let sealed = seal(snapshot), write(sealed, provider: provider, in: localDirectory) else { return false }
    if toCloud, let cloud = cloudDirectory { coordinatedWrite(sealed, provider: provider, in: cloud) }
    return true
  }

  static func pullFromCloud(_ provider: String) -> VaultCacheSnapshot? {
    lock.lock()
    defer { lock.unlock() }
    guard let cloud = cloudDirectory, let url = file(provider, in: cloud), isDownloaded(url) else { return nil }
    guard let sealed = coordinatedRead(url), let remote = open(sealed) else { return nil }
    let local = file(provider, in: localDirectory).flatMap { try? Data(contentsOf: $0) }.flatMap(open)
    guard remote.savedAt > (local?.savedAt ?? 0) else { return nil }
    guard let resealed = seal(remote), write(resealed, provider: provider, in: localDirectory) else { return nil }
    return remote
  }

  private static func isDownloaded(_ url: URL) -> Bool {
    if FileManager.default.fileExists(atPath: url.path) {
      let status = (try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?.ubiquitousItemDownloadingStatus
      if status == nil || status == .current { return true }
    }
    try? FileManager.default.startDownloadingUbiquitousItem(at: url)
    return false
  }

  static func pushToCloud(_ provider: String) {
    lock.lock()
    defer { lock.unlock() }
    guard let cloud = cloudDirectory, let url = file(provider, in: localDirectory), let sealed = try? Data(contentsOf: url),
      let snapshot = open(sealed), let resealed = seal(snapshot)
    else { return }
    coordinatedWrite(resealed, provider: provider, in: cloud)
  }

  static func stripPasswords(_ provider: String) {
    guard var snapshot = load(provider), !snapshot.passwords.isEmpty || !(snapshot.totps ?? [:]).isEmpty else { return }
    snapshot.passwords = [:]
    snapshot.totps = [:]
    save(provider, snapshot)
  }

  static func delete(_ provider: String, fromCloud: Bool) {
    lock.lock()
    defer { lock.unlock() }
    if let url = file(provider, in: localDirectory) { try? FileManager.default.removeItem(at: url) }
    if fromCloud, let url = file(provider, in: cloudDirectory) { coordinatedDelete(url) }
  }

  private static func seal(_ snapshot: VaultCacheSnapshot) -> Data? {
    guard let key = VaultStoreKey.current(creating: true), let plain = try? JSONEncoder().encode(snapshot) else { return nil }
    return try? AES.GCM.seal(plain, using: key).combined
  }

  private static func open(_ sealed: Data) -> VaultCacheSnapshot? {
    guard let box = try? AES.GCM.SealedBox(combined: sealed) else { return nil }
    for key in VaultStoreKey.candidates() {
      guard let plain = try? AES.GCM.open(box, using: key) else { continue }
      guard let snapshot = try? JSONDecoder().decode(VaultCacheSnapshot.self, from: plain), (1...2).contains(snapshot.version) else {
        return nil
      }
      return snapshot
    }
    return nil
  }

  private static func write(_ sealed: Data, provider: String, in directory: URL?) -> Bool {
    guard let directory, let url = file(provider, in: directory) else { return false }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      try sealed.write(to: url, options: [.atomic])
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      var marked = url
      try? marked.setResourceValues(values)
      return true
    } catch {
      NSLog("[vaults] couldn't write the %@ store: %@", provider, error.localizedDescription)
      return false
    }
  }

  private static func coordinatedWrite(_ sealed: Data, provider: String, in directory: URL) {
    guard let url = file(provider, in: directory) else { return }
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var problem: NSError?
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: [.forReplacing], error: &problem) { target in
      do {
        try sealed.write(to: target, options: [.atomic])
      } catch {
        NSLog("[vaults] couldn't sync the %@ store to iCloud: %@", provider, error.localizedDescription)
      }
    }
    if let problem { NSLog("[vaults] couldn't reach iCloud Drive for %@: %@", provider, problem.localizedDescription) }
  }

  private static func coordinatedRead(_ url: URL) -> Data? {
    var data: Data?
    var problem: NSError?
    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [.withoutChanges], error: &problem) { source in
      data = try? Data(contentsOf: source)
    }
    return problem == nil ? data : nil
  }

  private static func coordinatedDelete(_ url: URL) {
    guard FileManager.default.fileExists(atPath: url.path) else { return }
    var problem: NSError?
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: [.forDeleting], error: &problem) { target in
      try? FileManager.default.removeItem(at: target)
    }
  }

  private static func removeOurFiles(in directory: URL) {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
    for name in names where name.hasSuffix(".vault") { coordinatedDelete(directory.appendingPathComponent(name)) }
  }
}

enum VaultStoreKey {
  private static let legacyAccount = "vault-cache-key"
  private static let syncedService = "Ardia Password Store"
  private static let syncedAccount = "local-store-key"
  private static let groupSuffix = ".passwords"
  private static let lock = NSLock()
  nonisolated(unsafe) private static var remembered: [SymmetricKey] = []

  private static let accessGroup: String? = {
    guard VaultSandbox.directory == nil, !LaunchConfig.shared.background, let task = SecTaskCreateFromSelf(nil),
      let groups = SecTaskCopyValueForEntitlement(task, "keychain-access-groups" as CFString, nil) as? [String]
    else { return nil }
    return groups.first { $0.hasSuffix(groupSuffix) }
  }()

  static var syncs: Bool { accessGroup != nil }

  static func current(creating: Bool) -> SymmetricKey? {
    lock.lock()
    defer { lock.unlock() }
    if let synced = readSynced() {
      remember(synced)
      return synced
    }
    if let legacy = readLegacy() {
      remember(legacy)
      if writeSynced(legacy) { VaultKeychain.delete(legacyAccount) }
      return legacy
    }
    guard creating else { return nil }
    let fresh = SymmetricKey(size: .bits256)
    guard writeSynced(fresh) || VaultKeychain.write(legacyAccount, encode(fresh)) else { return nil }
    remember(fresh)
    return fresh
  }

  static func candidates() -> [SymmetricKey] {
    _ = current(creating: false)
    lock.lock()
    defer { lock.unlock() }
    if let legacy = readLegacy() { remember(legacy, first: false) }
    return remembered
  }

  private static func remember(_ key: SymmetricKey, first: Bool = true) {
    let bytes = key.withUnsafeBytes { Data($0) }
    if !first, remembered.contains(where: { $0.withUnsafeBytes { Data($0) } == bytes }) { return }
    remembered.removeAll { $0.withUnsafeBytes { Data($0) } == bytes }
    if first { remembered.insert(key, at: 0) } else { remembered.append(key) }
  }

  private static func encode(_ key: SymmetricKey) -> String { key.withUnsafeBytes { Data($0).base64EncodedString() } }

  private static func decode(_ text: String?) -> SymmetricKey? {
    guard let text, let data = Data(base64Encoded: text), data.count == 32 else { return nil }
    return SymmetricKey(data: data)
  }

  private static func readLegacy() -> SymmetricKey? { decode(VaultKeychain.read(legacyAccount)) }

  private static func syncedQuery(_ group: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: syncedService, kSecAttrAccount as String: syncedAccount,
      kSecAttrAccessGroup as String: group, kSecUseDataProtectionKeychain as String: true,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]
  }

  private static func readSynced() -> SymmetricKey? {
    guard let group = accessGroup else { return nil }
    var query = syncedQuery(group)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return decode(String(data: data, encoding: .utf8))
  }

  private static func writeSynced(_ key: SymmetricKey) -> Bool {
    guard let group = accessGroup else { return false }
    SecItemDelete(syncedQuery(group) as CFDictionary)
    var add = syncedQuery(group)
    add[kSecAttrSynchronizable as String] = true
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    add[kSecAttrLabel as String] = "Ardia password store"
    add[kSecValueData as String] = Data(encode(key).utf8)
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }
}
