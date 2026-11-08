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

  var version = 1
  var account: String
  var savedAt: Double
  var entries: [Entry]
  var passwords: [String: Password]

  var items: [VaultItem] {
    entries.map { entry in
      var item = entry.item
      item.totpPeriod = entry.totpPeriod
      return item
    }
  }
}

enum VaultCache {
  private static let keyAccount = "vault-cache-key"
  private static let lock = NSLock()

  private static var directory: URL? {
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

  private static func file(_ provider: String) -> URL? {
    directory?.appendingPathComponent("\(provider).vault")
  }

  private static func key(creating: Bool) -> SymmetricKey? {
    if let stored = VaultKeychain.read(keyAccount), let data = Data(base64Encoded: stored), data.count == 32 {
      return SymmetricKey(data: data)
    }
    guard creating else { return nil }
    let fresh = SymmetricKey(size: .bits256)
    let encoded = fresh.withUnsafeBytes { Data($0).base64EncodedString() }
    return VaultKeychain.write(keyAccount, encoded) ? fresh : nil
  }

  static func load(_ provider: String, account: String) -> VaultCacheSnapshot? {
    lock.lock()
    defer { lock.unlock() }
    guard let url = file(provider), let sealed = try? Data(contentsOf: url), let key = key(creating: false),
      let box = try? AES.GCM.SealedBox(combined: sealed), let plain = try? AES.GCM.open(box, using: key),
      let snapshot = try? JSONDecoder().decode(VaultCacheSnapshot.self, from: plain)
    else { return nil }
    guard snapshot.version == 1, snapshot.account == account else {
      try? FileManager.default.removeItem(at: url)
      return nil
    }
    return snapshot
  }

  @discardableResult
  static func save(_ provider: String, _ snapshot: VaultCacheSnapshot) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard let directory, let url = file(provider), let key = key(creating: true),
      let plain = try? JSONEncoder().encode(snapshot), let sealed = try? AES.GCM.seal(plain, using: key).combined
    else { return false }
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
      NSLog("[vaults] couldn't write the %@ cache: %@", provider, error.localizedDescription)
      return false
    }
  }

  static func stripPasswords(_ provider: String) {
    lock.lock()
    guard let url = file(provider), let sealed = try? Data(contentsOf: url), let key = key(creating: false),
      let box = try? AES.GCM.SealedBox(combined: sealed), let plain = try? AES.GCM.open(box, using: key),
      var snapshot = try? JSONDecoder().decode(VaultCacheSnapshot.self, from: plain)
    else { return lock.unlock() }
    lock.unlock()
    guard !snapshot.passwords.isEmpty else { return }
    snapshot.passwords = [:]
    save(provider, snapshot)
  }

  static func delete(_ provider: String) {
    lock.lock()
    defer { lock.unlock() }
    if let url = file(provider) { try? FileManager.default.removeItem(at: url) }
  }
}
