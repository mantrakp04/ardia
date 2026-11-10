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
      if settled.ok { VaultOwnerCheck.passOn() }
      return settled
    }
    VaultOwnerCheck.passOn()
    let state = publishOpened(provider, current)
    for other in VaultRegistry.providers where other.id != id && isReady(other.id) {
      if let known = states[other.id], known.state == .locked { _ = publishOpened(other, known) }
    }
    reconnectInBackground()
    return VaultSignInResult(ok: true, state: state)
  }

  func resumeAfterQuit() {
    let open = Set(VaultLockPolicy.takeUnlockedAtQuit())
    guard !open.isEmpty, sessions.touchID else { return }
    VaultOwnerCheck.noteConfirmed()
    openStore()
    for provider in VaultRegistry.providers where !open.contains(provider.id) { lockedWhileOpen.insert(provider.id) }
    for provider in VaultRegistry.providers where open.contains(provider.id) && isReady(provider.id) {
      _ = publishOpened(provider, states[provider.id] ?? placeholder(provider))
    }
    mirrorOpenProviders()
    reconnectInBackground()
  }

  func mirrorOpenProviders() {
    VaultLockPolicy.noteOpen(storeOpen ? VaultRegistry.providers.map(\.id).filter { isReady($0) } : [])
  }

  func publishOpened(_ provider: any VaultProvider, _ known: VaultProviderState) -> VaultProviderState {
    var state = known
    state.state = .unlocked
    let published = publish(state)
    announceItems(provider.id)
    return published
  }

  func openStore() {
    let wasOpen = storeOpen
    storeOpen = true
    storeUsedAt = Date()
    guard !wasOpen else { return }
    for provider in VaultRegistry.providers { restoreFromDisk(provider.id) }
    mirrorOpenProviders()
    let wanted = VaultRegistry.providers.map(\.id).filter { cloudAccepts($0) != nil }
    let accounts = Dictionary(uniqueKeysWithValues: wanted.map { ($0, cloudAccepts($0) ?? "") })
    Task.detached {
      var pulled: [(String, VaultCacheSnapshot)] = []
      for id in wanted {
        if let snapshot = VaultCache.pullFromCloud(id, account: accounts[id] ?? "") { pulled.append((id, snapshot)) }
      }
      await self.adoptPulled(pulled)
    }
  }

  func adoptPulled(_ pulled: [(String, VaultCacheSnapshot)]) {
    guard storeOpen else { return }
    for (id, snapshot) in pulled {
      let changed = cachedItems[id] != snapshot.items
      adopt(id, snapshot)
      if changed { announceItems(id) }
    }
  }

  func cloudAccepts(_ id: String) -> String? {
    if let known = states[id]?.state, known == .signedOut || known == .notInstalled { return nil }
    if states[id]?.account != nil { return Self.normalizedAccount(cacheAccount(states[id])) }
    return snapshotAccounts[id].map(Self.normalizedAccount) ?? ""
  }

  static func normalizedAccount(_ account: String) -> String {
    let parts = account.lowercased().split(separator: "@", omittingEmptySubsequences: false)
    guard parts.count >= 2 else { return account.lowercased() }
    return parts.dropLast().joined(separator: "@")
  }

  func reconnectInBackground() {
    guard reconnecting == nil else { return }
    let generation = reconnectGeneration
    reconnecting = Task {
      for provider in VaultRegistry.providers where self.isReady(provider.id) {
        guard !Task.isCancelled, self.storeOpen, generation == self.reconnectGeneration, VaultOwnerCheck.recentlyConfirmed else { break }
        if self.sessions.session(provider.id) == nil, self.reconnectsQuietly(provider) { await self.reconnect(provider) }
        guard self.storeOpen, generation == self.reconnectGeneration else {
          self.sessions.forget(provider.id, keepStored: self.sessions.touchID)
          break
        }
        if self.sessions.session(provider.id) != nil { _ = await self.currentState(provider) }
      }
      if generation == self.reconnectGeneration { self.reconnecting = nil }
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
    if Self.normalizedAccount(saved) != Self.normalizedAccount(account) { forgetSnapshot(id) }
  }

  func persist(_ id: String, toCloud: Bool = true) {
    guard let items = cachedItems[id] else { return }
    let account = snapshotAccounts[id] ?? cacheAccount(states[id])
    snapshotAccounts[id] = account
    let snapshot = VaultCacheSnapshot(
      account: account, savedAt: (fetchedAt[id] ?? Date()).timeIntervalSince1970,
      entries: items.map { VaultCacheSnapshot.Entry(item: $0, totpPeriod: $0.totpPeriod) },
      passwords: cachedPasswords[id] ?? [:],
      totps: cachedTotps[id] ?? [:])
    VaultCache.save(id, snapshot, toCloud: toCloud)
  }

  func restoreFromDisk(_ id: String) {
    guard storeOpen || sessions.session(id) != nil, cachedItems[id] == nil, let snapshot = VaultCache.load(id) else { return }
    adopt(id, snapshot)
  }

  func pullFromCloud(_ id: String) {
    guard let account = cloudAccepts(id), let snapshot = VaultCache.pullFromCloud(id, account: account) else { return }
    guard storeOpen || sessions.session(id) != nil else { return }
    let changed = cachedItems[id] != snapshot.items
    adopt(id, snapshot)
    if changed { announceItems(id) }
  }

  func adopt(_ id: String, _ snapshot: VaultCacheSnapshot) {
    cachedItems[id] = snapshot.items
    cachedPasswords[id] = snapshot.passwords
    cachedTotps[id] = snapshot.totps ?? [:]
    fetchedAt[id] = Date(timeIntervalSince1970: snapshot.savedAt)
    snapshotAccounts[id] = snapshot.account
  }

  func mergeSecrets(_ id: String, _ fresh: VaultItemList) {
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
    cachedPasswords[id, default: [:]][item.id] = VaultCacheSnapshot.Password(value: password, itemUpdatedAt: item.updatedAt)
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
