import CryptoKit
import Foundation
import OSLog
import Security
import SwiftData

public struct HistoryFingerprint: Sendable {
  private let key: SymmetricKey

  public init(key: SymmetricKey) {
    self.key = key
  }

  public func of(_ url: String) -> String {
    HMAC<SHA256>.authenticationCode(for: Data(url.utf8), using: key).map { String(format: "%02x", $0) }.joined()
  }

  public static func ephemeral() -> HistoryFingerprint {
    HistoryFingerprint(key: SymmetricKey(size: .bits256))
  }

  @MainActor
  public static func forStore(_ container: ModelContainer) -> HistoryFingerprint {
    container.configurations.contains { $0.isStoredInMemoryOnly } ? ephemeral() : device
  }

  @MainActor
  static let device = HistoryFingerprint(key: HistoryKeychain.loadOrCreate() ?? SymmetricKey(size: .bits256))
}

enum HistoryKeychain {
  static let service = "com.ardia.browser.ios.history"
  static let account = "visit-fingerprint-key"
  static let keyLength = 32
  static let log = Logger(subsystem: "com.ardia.browser.ios", category: "history")

  static func loadOrCreate() -> SymmetricKey? {
    if let stored = read() { return SymmetricKey(data: stored) }
    let key = SymmetricKey(size: .bits256)
    return save(key.withUnsafeBytes { Data($0) }) ? key : nil
  }

  private static var identity: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }

  private static func read() -> Data? {
    let query = identity.merging([kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]) { $1 }
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data, data.count == keyLength { return data }
    if status != errSecItemNotFound { log.error("Couldn't read the history key: \(status, privacy: .public)") }
    return nil
  }

  private static func save(_ data: Data) -> Bool {
    let attributes = identity.merging([
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]) { $1 }
    let status = SecItemAdd(attributes as CFDictionary, nil)
    guard status == errSecSuccess else {
      log.error("Couldn't save the history key: \(status, privacy: .public)")
      return false
    }
    return true
  }
}
