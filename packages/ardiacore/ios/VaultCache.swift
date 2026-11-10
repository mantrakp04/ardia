import CryptoKit
import Foundation
import Security

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
  private static let cloudQueue = DispatchQueue(label: "ardia.vaults.icloud", qos: .utility)
  nonisolated(unsafe) private static var cloudChoice: Bool?

  private static var cloudEnabled: Bool { cloudChoice ?? false }

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
    let turnedOff = cloudChoice == true && !enabled
    let directory = cloudDirectory
    cloudChoice = enabled
    lock.unlock()
    if turnedOff, let directory { cloudQueue.async { removeOurFiles(in: directory) } }
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
    return open(sealed)
  }

  @discardableResult
  static func save(_ provider: String, _ snapshot: VaultCacheSnapshot, toCloud: Bool = true) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard let sealed = seal(snapshot), write(sealed, provider: provider, in: localDirectory) else { return false }
    if toCloud, let cloud = cloudDirectory { pushLater(sealed, savedAt: snapshot.savedAt, provider: provider, in: cloud) }
    return true
  }

  static func pullFromCloud(_ provider: String, account: String) -> VaultCacheSnapshot? {
    lock.lock()
    let cloud = cloudDirectory
    lock.unlock()
    guard let cloud, let url = file(provider, in: cloud), isDownloaded(url), let sealed = coordinatedRead(url),
      let remote = open(sealed)
    else { return nil }
    guard account.isEmpty || VaultBroker.normalizedAccount(remote.account) == account else { return nil }
    lock.lock()
    defer { lock.unlock() }
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
    pushLater(resealed, savedAt: snapshot.savedAt, provider: provider, in: cloud)
  }

  private static func pushLater(_ sealed: Data, savedAt: Double, provider: String, in cloud: URL) {
    cloudQueue.async {
      guard let url = file(provider, in: cloud) else { return }
      if FileManager.default.fileExists(atPath: url.path) || FileManager.default.fileExists(atPath: placeholder(url).path) {
        guard isDownloaded(url) else { return }
        if let remote = coordinatedRead(url).flatMap(open), remote.savedAt >= savedAt { return }
      }
      coordinatedWrite(sealed, provider: provider, in: cloud)
    }
  }

  private static func placeholder(_ url: URL) -> URL {
    url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).icloud")
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
    if fromCloud, let url = file(provider, in: cloudDirectory) { cloudQueue.async { coordinatedDelete(url) } }
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
  private static let lock = NSLock()
  nonisolated(unsafe) private static var remembered: [SymmetricKey] = []
  nonisolated(unsafe) private static var resolved: SymmetricKey?
  nonisolated(unsafe) private static var legacyLoaded = false

  private static var accessGroup: String? { VaultKeychain.passwordsGroup }

  static var syncs: Bool { accessGroup != nil }

  static func current(creating: Bool) -> SymmetricKey? {
    lock.lock()
    defer { lock.unlock() }
    if let resolved { return resolved }
    resolved = resolve(creating: creating)
    return resolved
  }

  private static func resolve(creating: Bool) -> SymmetricKey? {
    let synced = readSynced()
    if case .found(let key) = synced {
      remember(key)
      return key
    }
    let legacy = readLegacy()
    if let legacy { remember(legacy, first: false) }
    if case .failed = synced { return legacy ?? remembered.first }
    if let legacy {
      if accessGroup != nil, let adopted = addSynced(legacy) { remember(adopted) }
      return remembered.first
    }
    guard creating else { return remembered.first }
    let fresh = SymmetricKey(size: .bits256)
    if accessGroup != nil {
      guard let stored = addSynced(fresh) else { return nil }
      remember(stored)
      return stored
    }
    guard VaultKeychain.write(legacyAccount, encode(fresh)) else { return nil }
    remember(fresh)
    return fresh
  }

  static func candidates() -> [SymmetricKey] {
    _ = current(creating: false)
    lock.lock()
    defer { lock.unlock() }
    if !legacyLoaded, let legacy = readLegacy() { remember(legacy, first: false) }
    legacyLoaded = true
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

  private static func readLegacy() -> SymmetricKey? {
    legacyLoaded = true
    return decode(VaultKeychain.read(legacyAccount))
  }

  private static func syncedQuery(_ group: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: syncedService, kSecAttrAccount as String: syncedAccount,
      kSecAttrAccessGroup as String: group, kSecUseDataProtectionKeychain as String: true,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]
  }

  private enum SyncedRead {
    case found(SymmetricKey)
    case missing
    case failed
  }

  private static func readSynced() -> SyncedRead {
    guard let group = accessGroup else { return .missing }
    var query = syncedQuery(group)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return .missing }
    guard status == errSecSuccess, let data = item as? Data, let key = decode(String(data: data, encoding: .utf8)) else { return .failed }
    return .found(key)
  }

  private static func addSynced(_ key: SymmetricKey) -> SymmetricKey? {
    guard let group = accessGroup else { return nil }
    var add = syncedQuery(group)
    add[kSecAttrSynchronizable as String] = true
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    add[kSecAttrLabel as String] = "Ardia password store"
    add[kSecValueData as String] = Data(encode(key).utf8)
    switch SecItemAdd(add as CFDictionary, nil) {
    case errSecSuccess: return key
    case errSecDuplicateItem:
      if case .found(let existing) = readSynced() { return existing }
      return nil
    default: return nil
    }
  }
}
