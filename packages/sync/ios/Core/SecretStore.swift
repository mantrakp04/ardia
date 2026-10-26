import Foundation
import Security

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
