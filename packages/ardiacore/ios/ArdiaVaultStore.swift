import Foundation

enum ArdiaVaultStore {
  static let readTimeout: TimeInterval = 15

  @MainActor
  private static func offersNow(_ profile: String) -> Bool { ArdiaServices.profileToggle(.passwordsOffered, profile: profile) }

  static func offers(_ profile: String) async -> Bool {
    await MainActor.run { offersNow(profile) }
  }

  static func offeredProfiles() async -> [String] {
    await MainActor.run { ArdiaHost.loadedProfiles.filter { offersNow($0) } }
  }

  static func isOn() async -> Bool {
    await MainActor.run {
      let loaded = ArdiaHost.loadedProfiles
      return loaded.isEmpty || loaded.contains { offersNow($0) }
    }
  }

  static func baseProfile(_ profile: String) async -> String {
    await MainActor.run { ArdiaHost.baseProfile(of: profile) }
  }

  static func offeredLogins() async -> [ArdiaVaultLogin] {
    var found: [ArdiaVaultLogin] = []
    for profile in await offeredProfiles() { found += await logins(profile) }
    return found
  }

  static func logins(_ profile: String) async -> [ArdiaVaultLogin] {
    await withCheckedContinuation { (done: CheckedContinuation<[ArdiaVaultLogin], Never>) in
      DispatchQueue.main.async {
        ArdiaServices.listPasswords(profile: profile) { value, error in
          done.resume(returning: error == nil ? loginsOf(value, profile: profile) : [])
        }
      }
    }
  }

  private static func loginsOf(_ value: Any?, profile: String) -> [ArdiaVaultLogin] {
    let entries = (value as? [String: Any])?["passwords"] as? [[String: Any]] ?? []
    var logins: [ArdiaVaultLogin] = []
    for entry in entries {
      guard let origin = entry["origin"] as? String, let username = entry["username"] as? String, ArdiaVault.isWebOrigin(origin) else { continue }
      let login = ArdiaVaultLogin(profile: profile, origin: origin, username: username)
      if !logins.contains(login) { logins.append(login) }
    }
    return logins
  }

  static func password(_ login: ArdiaVaultLogin) async -> String? {
    let read = await withCheckedContinuation { (done: CheckedContinuation<(readable: Bool, password: String?), Never>) in
      DispatchQueue.main.async {
        ArdiaEngineBridge.callForSecretReply("ac_passwords_logins", profile: login.profile, timeout: readTimeout) { reply in
          guard let entries = reply?["logins"] as? [[String: Any]] else { return done.resume(returning: (false, nil)) }
          done.resume(returning: (true, passwordOf(entries, login)))
        }
      }
    }
    if read.readable { return read.password }
    return await revealed(login)
  }

  private static func passwordOf(_ entries: [[String: Any]], _ login: ArdiaVaultLogin) -> String? {
    let match = entries.first { entry in
      guard (entry["username"] as? String) == login.username, let realm = entry["realm"] as? String else { return false }
      return ArdiaVault.originOfRealm(realm) == login.origin
    }
    return match?["password"] as? String
  }

  static func revealed(_ login: ArdiaVaultLogin) async -> String? {
    await withCheckedContinuation { (done: CheckedContinuation<String?, Never>) in
      DispatchQueue.main.async {
        ArdiaServices.password(profile: login.profile, origin: login.origin, username: login.username) { value, _ in
          done.resume(returning: (value as? [String: Any])?["password"] as? String)
        }
      }
    }
  }

  static func save(_ login: ArdiaVaultLogin, password: String) async -> Bool {
    await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
      DispatchQueue.main.async {
        ArdiaServices.savePassword(profile: login.profile, origin: login.origin, username: login.username, password: password) { _, error in
          if let error { NSLog("[vaults] ardia couldn't save a login: %@", error) }
          done.resume(returning: error == nil)
        }
      }
    }
  }

  static func export(_ profile: String, to path: String) async -> VaultExportResult {
    await withCheckedContinuation { (done: CheckedContinuation<VaultExportResult, Never>) in
      DispatchQueue.main.async {
        ArdiaServices.exportPasswords(profile: profile, path: path) { value, _ in
          let status = (value as? [String: Any])?["status"] as? String
          done.resume(returning: VaultExportResult(saved: status == "succeeded", count: 0, declined: status == "cancelled" || status == "reauthFailed"))
        }
      }
    }
  }
}
