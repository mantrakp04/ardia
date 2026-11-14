import Foundation
import Security

public protocol SyncKeyStore {
  func load(account: String) -> Data?
  func save(_ secret: Data, account: String) -> Bool
  func delete(account: String)
}

public struct KeychainKeyStore: SyncKeyStore {
  public let service: String
  let calls: KeychainCalls

  public init(service: String = "Ardia Sync Key") { self.init(service: service, calls: SystemKeychain()) }

  init(service: String, calls: KeychainCalls) {
    self.service = service
    self.calls = calls
  }

  func query(_ account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrSynchronizable as String: false,
    ]
  }

  public func load(account: String) -> Data? {
    var q = query(account)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    #if DEBUG
    q[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
    #endif
    let found = calls.copy(q)
    return found.status == errSecSuccess ? found.data : nil
  }

  public func save(_ secret: Data, account: String) -> Bool {
    let status = calls.update(query(account), [kSecValueData as String: secret])
    if status == errSecSuccess { return true }
    guard status == errSecItemNotFound else { return false }
    var add = query(account)
    add[kSecValueData as String] = secret
    add[kSecAttrLabel as String] = service
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return calls.add(add) == errSecSuccess
  }

  public func delete(account: String) {
    _ = calls.delete(query(account))
  }
}

public struct FileKeyStore: SyncKeyStore {
  public let directory: URL

  public init(directory: URL) { self.directory = directory }

  func url(_ account: String) -> URL { directory.appendingPathComponent("sync-key-\(account)") }

  public func load(account: String) -> Data? { try? Data(contentsOf: url(account)) }

  public func save(_ secret: Data, account: String) -> Bool {
    guard (try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)) != nil else { return false }
    let staging = directory.appendingPathComponent(".sync-key-\(UUID().uuidString)").path
    let fd = open(staging, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard fd >= 0 else { return false }
    let written = fchmod(fd, 0o600) == 0 && Self.writeAll(secret, to: fd) && fsync(fd) == 0
    close(fd)
    guard written, rename(staging, url(account).path) == 0 else {
      unlink(staging)
      return false
    }
    return true
  }

  private static func writeAll(_ data: Data, to fd: Int32) -> Bool {
    data.withUnsafeBytes { raw in
      var offset = 0
      while offset < raw.count {
        let n = write(fd, raw.baseAddress! + offset, raw.count - offset)
        if n < 0 {
          if errno == EINTR { continue }
          return false
        }
        offset += n
      }
      return true
    }
  }

  public func delete(account: String) { try? FileManager.default.removeItem(at: url(account)) }
}

protocol KeychainCalls {
  func copy(_ query: [String: Any]) -> (status: OSStatus, data: Data?)
  func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus
  func add(_ attributes: [String: Any]) -> OSStatus
  func delete(_ query: [String: Any]) -> OSStatus
}

struct SystemKeychain: KeychainCalls {
  func copy(_ query: [String: Any]) -> (status: OSStatus, data: Data?) {
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    return (status, item as? Data)
  }

  func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus {
    SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
  }

  func add(_ attributes: [String: Any]) -> OSStatus {
    SecItemAdd(attributes as CFDictionary, nil)
  }

  func delete(_ query: [String: Any]) -> OSStatus {
    SecItemDelete(query as CFDictionary)
  }
}
