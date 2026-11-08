import Foundation
import Security

enum VaultKeychain {
  private static let service = "Ardia Password Managers"
  private static let fileLock = NSLock()

  private static var memoryOnly: Bool { LaunchConfig.shared.background && LaunchConfig.shared.dataDirectory == nil }

  private static var isolatedFile: URL? {
    LaunchConfig.shared.dataDirectory.map {
      URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent("Password Managers.json")
    }
  }

  static func contains(_ account: String) -> Bool {
    if memoryOnly { return false }
    if let file = isolatedFile { return locked { load(file)?[account] != nil } }
    var query = baseQuery(account)
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    return SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
  }

  static func read(_ account: String) -> String? {
    if memoryOnly { return nil }
    if let file = isolatedFile { return locked { load(file)?[account] } }
    var query = baseQuery(account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    #if DEBUG
    query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
    #endif
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  @discardableResult
  static func write(_ account: String, _ secret: String) -> Bool {
    if memoryOnly { return false }
    if let file = isolatedFile { return locked { store(file, account, secret) } }
    SecItemDelete(baseQuery(account) as CFDictionary)
    var add = baseQuery(account)
    add[kSecValueData as String] = Data(secret.utf8)
    add[kSecAttrLabel as String] = "Ardia: \(account) session"
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    if SecItemAdd(add as CFDictionary, nil) == errSecSuccess { return true }
    add.removeValue(forKey: kSecAttrAccessible as String)
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }

  static func delete(_ account: String) {
    if memoryOnly { return }
    if let file = isolatedFile {
      _ = locked { store(file, account, nil) }
      return
    }
    SecItemDelete(baseQuery(account) as CFDictionary)
  }

  private static func baseQuery(_ account: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
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
