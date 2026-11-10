import Foundation

enum VaultAddTotpError: String, Error, Sendable {
  case locked
  case notFound
  case unsupported
  case invalid
  case expired
  case declined
  case failed
}

struct VaultAddTotpResult: Sendable {
  var item: VaultItem?
  var error: VaultAddTotpError?
  var message: String?

  static func failure(_ error: VaultAddTotpError, _ message: String? = nil) -> VaultAddTotpResult {
    VaultAddTotpResult(item: nil, error: error, message: message)
  }

  func jsonObject() -> [String: Any] {
    var object: [String: Any] = ["added": item != nil]
    if let item { object["item"] = item.jsonObject() }
    if let error { object["error"] = error.rawValue }
    if let message { object["message"] = message }
    return object
  }
}

extension VaultBroker {
  func addTotp(provider providerId: String, id itemId: String, uri: String) async -> VaultAddTotpResult {
    if providerId == ArdiaVault.id { return await ArdiaVaultIndex.shared.addTotp(id: itemId, uri: uri) }
    guard let provider = VaultRegistry.provider(providerId) else { return .failure(.notFound) }
    guard provider.capabilities.addTotp else { return .failure(.unsupported) }
    guard uri.lowercased().hasPrefix("otpauth://totp/"), VaultTotpSecret(uri) != nil else { return .failure(.invalid) }
    guard isReady(provider.id) else { return .failure(.locked) }
    guard let listed = await freshItem(provider, itemId) else { return .failure(isReady(provider.id) ? .notFound : .locked) }
    guard await VaultOwnerCheck.confirm("add a verification code") else { return .failure(.declined) }
    if sessions.session(provider.id) == nil { await reconnect(provider) }
    let cli = VaultCLI.make(for: provider, sessions: sessions)
    do {
      let edited = try await lane(provider.id).run { try await provider.addTotp(cli, id: itemId, uri: uri) }
      sessions.touch(provider.id)
      let item = rememberTotp(uri, on: edited, listed: listed)
      Task { await self.pinTotpAfterRefetch(provider, itemId: itemId, uri: uri) }
      return VaultAddTotpResult(item: item)
    } catch {
      await fail(provider, error)
      return Self.addTotpFailure(error)
    }
  }

  func rememberTotp(_ uri: String, on edited: VaultItem, listed: VaultItem) -> VaultItem {
    let id = edited.provider
    var item = edited
    if item.title.isEmpty { item.title = listed.title }
    if item.username.isEmpty { item.username = listed.username }
    if item.urls.isEmpty { item.urls = listed.urls }
    if item.vault == nil { item.vault = listed.vault }
    if item.updatedAt == nil { item.updatedAt = Date().timeIntervalSince1970 * 1000 }
    item.hasTotp = true
    item.totpPeriod = VaultTotp.period(fromURI: uri)
    guard cachedItems[id] != nil else { return item }
    if let index = cachedItems[id]?.firstIndex(where: { $0.id == item.id }) {
      cachedItems[id]?[index] = item
    } else {
      cachedItems[id]?.append(item)
    }
    if let password = cachedPasswords[id]?[item.id], password.itemUpdatedAt == listed.updatedAt {
      cachedPasswords[id]?[item.id] = VaultCacheSnapshot.Password(value: password.value, itemUpdatedAt: item.updatedAt)
    }
    cachedTotps[id, default: [:]][item.id] = VaultCacheSnapshot.Password(value: uri, itemUpdatedAt: item.updatedAt)
    recentCodes["\(id)/\(item.id)"] = nil
    storeUsedAt = Date()
    persist(id)
    announceItems(id)
    return item
  }

  func pinTotpAfterRefetch(_ provider: any VaultProvider, itemId: String, uri: String) async {
    let id = provider.id
    guard sessions.session(id) != nil, case .success(let items) = await fetchResult(provider) else { return }
    guard let fresh = items.first(where: { $0.id == itemId }) else { return }
    let held = cachedTotps[id]?[itemId]
    let changed = held?.value != uri || held?.itemUpdatedAt != fresh.updatedAt || fresh.hasTotp != true
    guard changed, let index = cachedItems[id]?.firstIndex(where: { $0.id == itemId }) else { return }
    if cachedItems[id]?[index].hasTotp != false { cachedItems[id]?[index].hasTotp = true }
    if cachedItems[id]?[index].totpPeriod == nil { cachedItems[id]?[index].totpPeriod = VaultTotp.period(fromURI: uri) }
    cachedTotps[id, default: [:]][itemId] = VaultCacheSnapshot.Password(value: uri, itemUpdatedAt: fresh.updatedAt)
    persist(id)
    announceItems(id)
  }

  static func addTotpFailure(_ error: Error) -> VaultAddTotpResult {
    switch error as? VaultError {
    case .locked?, .signedOut?: return .failure(.locked)
    case .notFound?: return .failure(.notFound)
    case .unsupported?: return .failure(.unsupported)
    case .failed(let message)?: return .failure(.failed, message)
    default: return .failure(.failed)
    }
  }
}
