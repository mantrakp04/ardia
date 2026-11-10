import Foundation

extension VaultBroker {
  func sync() async -> VaultSyncResult {
    var result = VaultSyncResult()
    for provider in VaultRegistry.providers {
      let id = provider.id
      guard sessions.session(id) != nil || (storeOpen && cachedItems[id] != nil && !lockedWhileOpen.contains(id)) else { continue }
      pullFromCloud(id)
      if sessions.session(id) == nil { await reconnect(provider) }
      guard sessions.session(id) != nil else {
        VaultCache.pushToCloud(id)
        continue
      }
      sessions.setValue(id, "syncedAt", nil)
      switch await fetchResult(provider) {
      case .success:
        VaultCache.pushToCloud(id)
        result.synced.append(id)
      case .failure:
        result.failed.append(id)
      }
    }
    result.syncedAt = lastSyncedAt
    result.iCloud = VaultCache.syncsWithICloud
    return result
  }

  func syncStatus() -> VaultSyncResult {
    VaultSyncResult(syncedAt: lastSyncedAt, iCloud: VaultCache.syncsWithICloud)
  }

  var lastSyncedAt: Double? {
    fetchedAt.values.max().map { $0.timeIntervalSince1970 * 1000 }
  }

  func unlockFromStore(_ provider: any VaultProvider) async -> VaultSignInResult {
    let id = provider.id
    let current = states[id] ?? placeholder(provider)
    guard await VaultOwnerCheck.confirm("unlock your passwords") else {
      return VaultSignInResult(ok: false, state: current, error: "\(provider.name) stayed locked.")
    }
    openStore()
    lockedWhileOpen.remove(id)
    restoreFromDisk(id)
    guard cachedItems[id] != nil else {
      guard let cli = VaultCLI.make(for: provider, sessions: sessions) else { return await missingTool(provider) }
      let result = await lane(id).run { await provider.unlock(cli, password: nil) }
      let settled = await settle(provider, result)
      if settled.ok { VaultOwnerCheck.grant() }
      return settled
    }
    VaultOwnerCheck.grant()
    var state = current
    state.state = .unlocked
    state = publish(state)
    announceItems(id)
    reconnectInBackground()
    return VaultSignInResult(ok: true, state: state)
  }

  func openStore() {
    let wasOpen = storeOpen
    storeOpen = true
    storeUsedAt = Date()
    guard !wasOpen else { return }
    for provider in VaultRegistry.providers { restoreFromDisk(provider.id) }
    Task { self.pullAllFromCloud() }
  }

  func pullAllFromCloud() {
    guard storeOpen else { return }
    for provider in VaultRegistry.providers { pullFromCloud(provider.id) }
  }

  func reconnectInBackground() {
    guard reconnecting == nil else { return }
    reconnecting = Task {
      for provider in VaultRegistry.providers where self.isReady(provider.id) {
        if self.sessions.session(provider.id) == nil, self.reconnectsQuietly(provider) { await self.reconnect(provider) }
        if self.sessions.session(provider.id) != nil { _ = await self.currentState(provider) }
      }
      self.reconnecting = nil
    }
  }

  func reconnectsQuietly(_ provider: any VaultProvider) -> Bool {
    sessions.hasStoredSession(provider.id) || !provider.capabilities.masterPassword && provider.id != "1password"
  }

  func reconnect(_ provider: any VaultProvider) async {
    guard sessions.session(provider.id) == nil, let cli = VaultCLI.make(for: provider, sessions: sessions) else { return }
    guard sessions.hasStoredSession(provider.id) || !provider.capabilities.masterPassword else { return }
    _ = await lane(provider.id).run { await provider.unlock(cli, password: nil) }
    if sessions.session(provider.id) != nil, Date().timeIntervalSince(fetchedAt[provider.id] ?? .distantPast) >= Self.itemsLifetime {
      Task { _ = await self.fetchItems(provider) }
    }
  }

  func checkAccount(_ id: String, _ state: VaultProviderState) {
    guard state.state == .unlocked || state.state == .locked, state.account != nil else { return }
    let account = cacheAccount(state)
    guard let saved = snapshotAccounts[id], !saved.hasPrefix("@") else {
      if cachedItems[id] != nil { snapshotAccounts[id] = account }
      return
    }
    if saved != account { forgetSnapshot(id) }
  }

  func persist(_ id: String, toCloud: Bool = true) {
    guard let items = cachedItems[id] else { return }
    let account = snapshotAccounts[id] ?? cacheAccount(states[id])
    snapshotAccounts[id] = account
    let snapshot = VaultCacheSnapshot(
      account: account, savedAt: (fetchedAt[id] ?? Date()).timeIntervalSince1970,
      entries: items.map { VaultCacheSnapshot.Entry(item: $0, totpPeriod: $0.totpPeriod) },
      passwords: loadPasswordsWhenUsed ? [:] : cachedPasswords[id] ?? [:],
      totps: loadPasswordsWhenUsed ? [:] : cachedTotps[id] ?? [:])
    VaultCache.save(id, snapshot, toCloud: toCloud)
  }

  func restoreFromDisk(_ id: String) {
    guard storeOpen || sessions.session(id) != nil, cachedItems[id] == nil, let snapshot = VaultCache.load(id) else { return }
    adopt(id, snapshot)
  }

  func pullFromCloud(_ id: String) {
    if let known = states[id]?.state, known == .signedOut || known == .notInstalled { return }
    guard let snapshot = VaultCache.pullFromCloud(id) else { return }
    guard storeOpen || sessions.session(id) != nil else { return }
    let changed = cachedItems[id] != snapshot.items
    adopt(id, snapshot)
    if changed { announceItems(id) }
  }

  func adopt(_ id: String, _ snapshot: VaultCacheSnapshot) {
    cachedItems[id] = snapshot.items
    cachedPasswords[id] = loadPasswordsWhenUsed ? [:] : snapshot.passwords
    cachedTotps[id] = loadPasswordsWhenUsed ? [:] : snapshot.totps ?? [:]
    fetchedAt[id] = Date(timeIntervalSince1970: snapshot.savedAt)
    snapshotAccounts[id] = snapshot.account
  }

  func mergeSecrets(_ id: String, _ fresh: VaultItemList) {
    guard !loadPasswordsWhenUsed else {
      cachedPasswords[id] = [:]
      cachedTotps[id] = [:]
      return
    }
    cachedPasswords[id] = Self.merged(fresh.items, fresh.passwords, old: cachedPasswords[id] ?? [:])
    cachedTotps[id] = Self.merged(fresh.items, fresh.totps, old: cachedTotps[id] ?? [:])
  }

  static func merged(_ items: [VaultItem], _ values: [String: String], old: [String: VaultCacheSnapshot.Password])
    -> [String: VaultCacheSnapshot.Password]
  {
    var kept: [String: VaultCacheSnapshot.Password] = [:]
    for item in items {
      if let value = values[item.id] {
        kept[item.id] = VaultCacheSnapshot.Password(value: value, itemUpdatedAt: item.updatedAt)
      } else if let cached = old[item.id], cached.itemUpdatedAt == item.updatedAt {
        kept[item.id] = cached
      }
    }
    return kept
  }

  func remember(_ item: VaultItem, password: String) {
    let id = item.provider
    guard cachedItems[id] != nil else { return }
    cachedItems[id]?.removeAll { $0.id == item.id }
    cachedItems[id]?.append(item)
    if !loadPasswordsWhenUsed {
      cachedPasswords[id, default: [:]][item.id] = VaultCacheSnapshot.Password(value: password, itemUpdatedAt: item.updatedAt)
    }
    persist(id)
    announceItems(id)
  }

  func localTotp(_ id: String, item: String) -> VaultTotpSecret? {
    guard isReady(id), let listed = cachedItems[id]?.first(where: { $0.id == item }), let hit = cachedTotps[id]?[item],
      hit.itemUpdatedAt == listed.updatedAt
    else { return nil }
    storeUsedAt = Date()
    return VaultTotpSecret(hit.value)
  }

  func forgetSnapshot(_ id: String, everywhere: Bool = false) {
    dropItems(id, announce: true)
    snapshotAccounts[id] = nil
    VaultCache.delete(id, fromCloud: everywhere)
  }
}
