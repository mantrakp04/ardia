import Foundation
import Security

enum VaultKeychain {
  private static let service = "Ardia Password Managers"
  private static let groupSuffix = ".passwords"
  private static let fileLock = NSLock()
  private static let cacheLock = NSLock()
  nonisolated(unsafe) private static var known: [String: String] = [:]
  nonisolated(unsafe) private static var absent: Set<String> = []

  static let passwordsGroup: String? = {
    guard VaultSandbox.directory == nil, !LaunchConfig.shared.background, let task = SecTaskCreateFromSelf(nil),
      let groups = SecTaskCopyValueForEntitlement(task, "keychain-access-groups" as CFString, nil) as? [String]
    else { return nil }
    return groups.first { $0.hasSuffix(groupSuffix) }
  }()

  private static var memoryOnly: Bool { LaunchConfig.shared.background && VaultSandbox.directory == nil }

  private static var isolatedFile: URL? {
    VaultSandbox.directory.map {
      URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent("Password Managers.json")
    }
  }

  static func contains(_ account: String) -> Bool {
    if memoryOnly { return false }
    if let file = isolatedFile { return locked { load(file)?[account] != nil } }
    if let remembered = cached(account) { return remembered != nil }
    return modernRead(account) != nil || legacyContains(account)
  }

  static func read(_ account: String) -> String? {
    if memoryOnly { return nil }
    if let file = isolatedFile { return locked { load(file)?[account] } }
    if let remembered = cached(account) { return remembered }
    var value = modernRead(account)
    if value == nil, legacyContains(account), let old = legacyRead(account) {
      value = old
      if modernWrite(account, old) { legacyDelete(account) }
    }
    remember(account, value)
    return value
  }

  @discardableResult
  static func write(_ account: String, _ secret: String) -> Bool {
    if memoryOnly { return false }
    if let file = isolatedFile { return locked { store(file, account, secret) } }
    let written: Bool
    if passwordsGroup != nil, modernWrite(account, secret) {
      written = true
      if legacyContains(account) { legacyDelete(account) }
    } else {
      written = legacyWrite(account, secret)
    }
    if written { remember(account, secret) }
    return written
  }

  static func delete(_ account: String) {
    if memoryOnly { return }
    if let file = isolatedFile {
      _ = locked { store(file, account, nil) }
      return
    }
    if passwordsGroup != nil { SecItemDelete(modernQuery(account) as CFDictionary) }
    if legacyContains(account) { legacyDelete(account) }
    remember(account, nil)
  }

  private static func cached(_ account: String) -> String?? {
    cacheLock.lock()
    defer { cacheLock.unlock() }
    if let value = known[account] { return .some(value) }
    return absent.contains(account) ? .some(nil) : nil
  }

  private static func remember(_ account: String, _ value: String?) {
    cacheLock.lock()
    if let value {
      known[account] = value
      absent.remove(account)
    } else {
      known[account] = nil
      absent.insert(account)
    }
    cacheLock.unlock()
  }

  private static func modernQuery(_ account: String) -> [String: Any] {
    var query = legacyQuery(account)
    query[kSecUseDataProtectionKeychain as String] = true
    query[kSecAttrAccessGroup as String] = passwordsGroup
    return query
  }

  private static func modernRead(_ account: String) -> String? {
    guard passwordsGroup != nil else { return nil }
    var query = modernQuery(account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func modernWrite(_ account: String, _ secret: String) -> Bool {
    guard passwordsGroup != nil else { return false }
    let match = modernQuery(account)
    let data = Data(secret.utf8)
    if SecItemUpdate(match as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecSuccess { return true }
    var add = match
    add[kSecValueData as String] = data
    add[kSecAttrLabel as String] = "Ardia: \(account) session"
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }

  private static func legacyQuery(_ account: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }

  private static func legacyContains(_ account: String) -> Bool {
    var query = legacyQuery(account)
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    return SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
  }

  private static func legacyRead(_ account: String) -> String? {
    var query = legacyQuery(account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    #if DEBUG
    query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
    #endif
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func legacyWrite(_ account: String, _ secret: String) -> Bool {
    SecItemDelete(legacyQuery(account) as CFDictionary)
    var add = legacyQuery(account)
    add[kSecValueData as String] = Data(secret.utf8)
    add[kSecAttrLabel as String] = "Ardia: \(account) session"
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    if SecItemAdd(add as CFDictionary, nil) == errSecSuccess { return true }
    add.removeValue(forKey: kSecAttrAccessible as String)
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }

  private static func legacyDelete(_ account: String) {
    SecItemDelete(legacyQuery(account) as CFDictionary)
  }

  private static func locked<T>(_ body: () -> T) -> T {
    fileLock.lock()
    defer { fileLock.unlock() }
    return body()
  }

  private static func load(_ file: URL) -> [String: String]? {
    guard FileManager.default.fileExists(atPath: file.path) else { return [:] }
    guard let data = try? Data(contentsOf: file) else { return nil }
    return try? JSONDecoder().decode([String: String].self, from: data)
  }

  private static func store(_ file: URL, _ account: String, _ secret: String?) -> Bool {
    guard var secrets = load(file) else { return false }
    secrets[account] = secret
    do {
      try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(secrets).write(to: file, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
      return true
    } catch {
      return false
    }
  }
}
