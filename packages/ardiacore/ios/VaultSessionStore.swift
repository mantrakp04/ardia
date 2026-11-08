import Foundation

final class VaultSessionStore: @unchecked Sendable {
  static let shared = VaultSessionStore()

  private let lock = NSLock()
  private var sessions: [String: String] = [:]
  private var lastUse: [String: Date] = [:]
  private var scratch: [String: [String: String]] = [:]
  private var preferences: [String: [String: String]] = [:]
  private var running: [String: VaultCommand] = [:]
  private var idleMinutes = 30
  private var touchIDAllowed = true

  var touchID: Bool {
    lock.lock()
    defer { lock.unlock() }
    return touchIDAllowed
  }

  var unlockedProviders: [String] {
    lock.lock()
    defer { lock.unlock() }
    return Array(sessions.keys)
  }

  func setOptions(idleLockMinutes: Int, touchID: Bool) {
    lock.lock()
    idleMinutes = max(0, idleLockMinutes)
    touchIDAllowed = touchID
    lock.unlock()
  }

  func session(_ provider: String) -> String? {
    lock.lock()
    defer { lock.unlock() }
    return sessions[provider]
  }

  func remember(_ provider: String, session: String, persistent: Bool) {
    lock.lock()
    sessions[provider] = session
    lastUse[provider] = Date()
    let keep = persistent && touchIDAllowed
    lock.unlock()
    if keep { VaultKeychain.write(provider, session) }
  }

  func touch(_ provider: String) {
    lock.lock()
    if sessions[provider] != nil { lastUse[provider] = Date() }
    lock.unlock()
  }

  func forget(_ provider: String, keepStored: Bool) {
    lock.lock()
    sessions[provider] = nil
    lastUse[provider] = nil
    scratch[provider] = nil
    lock.unlock()
    if !keepStored { VaultKeychain.delete(provider) }
  }

  func signedOut(_ provider: String) {
    forget(provider, keepStored: false)
    lock.lock()
    preferences[provider] = nil
    lock.unlock()
  }

  func idleProviders(now: Date = Date()) -> [String] {
    lock.lock()
    defer { lock.unlock() }
    guard idleMinutes > 0 else { return [] }
    let limit = TimeInterval(idleMinutes * 60)
    return sessions.keys.filter { now.timeIntervalSince(lastUse[$0] ?? .distantPast) >= limit }
  }

  func hasStoredSession(_ provider: String) -> Bool { touchID && VaultKeychain.contains(provider) }

  func storedSession(_ provider: String, reason: String) async -> String? {
    guard hasStoredSession(provider), await VaultOwnerCheck.confirm(reason) else { return nil }
    return VaultKeychain.read(provider)
  }

  func dropStored(_ provider: String) { VaultKeychain.delete(provider) }

  func value(_ provider: String, _ key: String) -> String? {
    lock.lock()
    defer { lock.unlock() }
    return scratch[provider]?[key]
  }

  func setValue(_ provider: String, _ key: String, _ value: String?) {
    lock.lock()
    scratch[provider, default: [:]][key] = value
    lock.unlock()
  }

  func clearScratch(_ provider: String) {
    lock.lock()
    scratch[provider] = nil
    lock.unlock()
  }

  func preference(_ provider: String, _ key: String) -> String? {
    lock.lock()
    defer { lock.unlock() }
    return preferences[provider]?[key]
  }

  func setPreference(_ provider: String, _ key: String, _ value: String?) {
    lock.lock()
    preferences[provider, default: [:]][key] = value
    lock.unlock()
  }

  func setRunning(_ provider: String, _ command: VaultCommand) -> VaultCommand? {
    lock.lock()
    defer { lock.unlock() }
    let previous = running[provider]
    running[provider] = command
    return previous
  }

  func finishedRunning(_ provider: String, _ command: VaultCommand) {
    lock.lock()
    if running[provider] === command { running[provider] = nil }
    lock.unlock()
  }

  func isRunning(_ provider: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return running[provider] != nil
  }

  @discardableResult
  func cancelRunning(_ provider: String) -> Bool {
    lock.lock()
    let command = running.removeValue(forKey: provider)
    lock.unlock()
    command?.cancel()
    return command != nil
  }
}
