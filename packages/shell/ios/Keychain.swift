import ExpoModulesCore
import Foundation
import Security

public class KeychainModule: Module {
  private static let service = "Ardia Connected Accounts"

  public func definition() -> ModuleDefinition {
    Name("ArdiaKeychain")

    AsyncFunction("get") { (account: String) -> String? in
      if let store = IsolatedSecrets.shared { return store.get(account) }
      var query = Self.query(account)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      #if DEBUG
      query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
      #endif
      var item: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
      return String(data: data, encoding: .utf8)
    }

    AsyncFunction("set") { (account: String, secret: String) -> Bool in
      if let store = IsolatedSecrets.shared { return store.set(account, secret) }
      let added = [kSecAttrLabel as String: "Ardia: \(account)"]
      return writeKeychainItem(Data(secret.utf8), query: Self.query(account), adding: added) == errSecSuccess
    }

    AsyncFunction("delete") { (account: String) -> Bool in
      if let store = IsolatedSecrets.shared { return store.set(account, nil) }
      let status = SecItemDelete(Self.query(account) as CFDictionary)
      return status == errSecSuccess || status == errSecItemNotFound
    }

    Function("sealSecuritySettings") { (values: String) -> Bool in SecuritySettingsSeal.seal(values) }

    Function("securitySettingsSealed") { (values: String) -> Bool in SecuritySettingsSeal.matches(values) }
  }

  private static func query(_ account: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }
}

private func writeKeychainItem(_ data: Data, query: [String: Any], adding added: [String: Any]) -> OSStatus {
  let updated = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
  if updated == errSecSuccess { return updated }
  if updated != errSecItemNotFound { SecItemDelete(query as CFDictionary) }
  var add = query.merging(added) { kept, _ in kept }
  add[kSecValueData as String] = data
  return SecItemAdd(add as CFDictionary, nil)
}

private enum SecuritySettingsSeal {
  private static let service = "Ardia Security Settings"
  private static let account = "approved"

  private static var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
      kSecUseDataProtectionKeychain as String: true,
    ]
  }

  static func seal(_ values: String) -> Bool {
    if let store = IsolatedSecrets.securitySettings { return store.set(account, values) }
    let added: [String: Any] = [kSecAttrLabel as String: service, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    let status = writeKeychainItem(Data(values.utf8), query: query, adding: added)
    if status != errSecSuccess { NSLog("[settings] couldn't record the security settings in the Keychain: \(status)") }
    return status == errSecSuccess
  }

  static func matches(_ values: String) -> Bool {
    let approved: String?
    if let store = IsolatedSecrets.securitySettings {
      approved = store.get(account)
    } else {
      var lookup = query
      lookup[kSecReturnData as String] = true
      lookup[kSecMatchLimit as String] = kSecMatchLimitOne
      var item: CFTypeRef?
      let status = SecItemCopyMatching(lookup as CFDictionary, &item)
      approved = status == errSecSuccess ? (item as? Data).flatMap { String(data: $0, encoding: .utf8) } : nil
    }
    if approved == values { return true }
    NSLog("[settings] session.json has security settings Ardia didn't set (\(values)); turning them off")
    return false
  }
}

private final class IsolatedSecrets {
  static let shared = ACIsolatedDataDirectory().map {
    IsolatedSecrets(URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent("Connected Accounts.json"))
  }

  static let securitySettings = ACIsolatedDataDirectory().map {
    IsolatedSecrets(URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent("Security Settings.json"))
  }

  private let url: URL
  private let lock = NSLock()

  private init(_ url: URL) { self.url = url }

  private func load() -> [String: String]? {
    guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode([String: String].self, from: data)
  }

  func get(_ account: String) -> String? {
    lock.lock()
    defer { lock.unlock() }
    return load()?[account]
  }

  func set(_ account: String, _ secret: String?) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard var secrets = load() else { return false }
    secrets[account] = secret
    do {
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(secrets).write(to: url, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
      return true
    } catch {
      return false
    }
  }
}
