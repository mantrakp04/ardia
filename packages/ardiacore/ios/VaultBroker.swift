import Foundation

struct VaultFillValues: Sendable {
  let values: [String: String]
  let touched: Bool
}

actor VaultBroker {
  static let shared = VaultBroker()
  static let itemsLifetime: TimeInterval = 60

  let sessions = VaultSessionStore.shared
  var lanes: [String: VaultLane] = [:]
  var states: [String: VaultProviderState] = [:]
  var cachedItems: [String: [VaultItem]] = [:]
  var fetchedAt: [String: Date] = [:]
  var loading: [String: Task<Result<[VaultItem], Error>, Never>] = [:]
  var versions: [String: String] = [:]
  var refreshing: Task<Void, Never>?
  var ownerNeededForPasswords = true
  var loadPasswordsWhenUsed = false
  var cachedPasswords: [String: [String: VaultCacheSnapshot.Password]] = [:]
  var cachedTotps: [String: [String: VaultCacheSnapshot.Password]] = [:]
  var snapshotAccounts: [String: String] = [:]
  var storeOpen = false
  var storeUsedAt = Date.distantPast
  var lockedWhileOpen: Set<String> = []
  var reconnecting: Task<Void, Never>?
  var reconnectGeneration = 0

  func providerStates() -> [VaultProviderState] {
    if refreshing == nil {
      refreshing = Task { await self.refreshAll() }
    }
    return VaultRegistry.providers.map { states[$0.id] ?? placeholder($0) }
  }

  func refresh(_ id: String, explicit: Bool = false) async -> VaultProviderState? {
    guard let provider = VaultRegistry.provider(id) else { return nil }
    if explicit {
      sessions.clearScratch(id)
      if sessions.session(id) != nil { fetchedAt[id] = nil }
    }
    return await currentState(provider)
  }

  func items(_ id: String?) async -> [VaultItem] {
    let providers = VaultRegistry.providers.filter { id == nil || $0.id == id }
    let lists = await withTaskGroup(of: (String, [VaultItem]).self, returning: [String: [VaultItem]].self) { group in
      for provider in providers {
        group.addTask {
          let list = await self.items(of: provider)
          return (provider.id, list)
        }
      }
      var collected: [String: [VaultItem]] = [:]
      for await (providerId, list) in group { collected[providerId] = list }
      return collected
    }
    return providers.flatMap { lists[$0.id] ?? [] }
  }

  func lock(_ id: String) async -> VaultProviderState? {
    guard let provider = VaultRegistry.provider(id) else { return nil }
    if storeOpen { lockedWhileOpen.insert(id) }
    if sessions.session(id) != nil, let cli = VaultCLI.make(for: provider, sessions: sessions) {
      await lane(id).run { await provider.lock(cli) }
    }
    sessions.forget(id, keepStored: sessions.touchID)
    dropItems(id, announce: true)
    return await currentState(provider)
  }

  func lockAll() async {
    storeOpen = false
    lockedWhileOpen = []
    reconnectGeneration += 1
    reconnecting?.cancel()
    reconnecting = nil
    VaultOwnerCheck.reset()
    let open = Set(sessions.unlockedProviders).union(states.values.filter { $0.state == .unlocked }.map(\.id))
    for provider in VaultRegistry.providers where !open.contains(provider.id) { dropItems(provider.id, announce: true) }
    for id in open { _ = await lock(id) }
    lockedWhileOpen = []
  }

  func lockIdle() async {
    if storeOpen, sessions.isIdle(since: storeUsedAt) { return await lockAll() }
    for id in sessions.idleProviders() where !storeOpen { _ = await lock(id) }
  }

  func signOut(_ id: String) async -> VaultProviderState? {
    guard let provider = VaultRegistry.provider(id) else { return nil }
    sessions.cancelRunning(id)
    if let cli = VaultCLI.make(for: provider, sessions: sessions) {
      await lane(id).run { await provider.signOut(cli) }
    }
    sessions.signedOut(id)
    forgetSnapshot(id, everywhere: true)
    return await currentState(provider)
  }

  func configure(_ id: String, server: String?) async -> VaultProviderState? {
    guard let provider = VaultRegistry.provider(id) else { return nil }
    guard let cli = VaultCLI.make(for: provider, sessions: sessions) else { return await currentState(provider) }
    let problem = await lane(id).run { await provider.configure(cli, server: server) }
    var state = await currentState(provider)
    if let problem { state.message = problem }
    return state
  }

  func signIn(_ id: String, fields: VaultSignInFields) async -> VaultSignInResult? {
    guard let provider = VaultRegistry.provider(id) else { return nil }
    guard let cli = VaultCLI.make(for: provider, sessions: sessions) else { return await missingTool(provider) }
    let result = await lane(id).run { await provider.signIn(cli, fields: fields) }
    return await settle(provider, result)
  }

  func unlock(_ id: String, password: String?) async -> VaultSignInResult? {
    guard let provider = VaultRegistry.provider(id) else { return nil }
    if password == nil, opensFromStore(id) { return await unlockFromStore(provider) }
    guard let cli = VaultCLI.make(for: provider, sessions: sessions) else { return await missingTool(provider) }
    let confirmedBefore = VaultOwnerCheck.lastConfirmed
    let result = await lane(id).run { await provider.unlock(cli, password: password) }
    let settled = await settle(provider, result)
    if settled.ok, password == nil, VaultOwnerCheck.lastConfirmed != confirmedBefore { VaultOwnerCheck.passOn() }
    return settled
  }

  func cancelSignIn(_ id: String) async -> VaultProviderState? {
    guard let provider = VaultRegistry.provider(id) else { return nil }
    sessions.cancelRunning(id)
    return await currentState(provider)
  }

  func copy(_ id: String, item: String, field: VaultCopyField) async -> Bool? {
    guard let provider = VaultRegistry.provider(id) else { return false }
    if field == .password, !(await ownerAllows("copy your password")) { return nil }
    let outcome = await secret(provider, item: item, field: field.field)
    guard case .success(let value) = outcome else { return false }
    return await VaultClipboard.copy(value)
  }

  func totp(_ id: String, item: String) async -> VaultTotp? {
    guard let provider = VaultRegistry.provider(id) else { return nil }
    if let local = localTotp(id, item: item) { return local.totp() }
    let outcome = await secret(provider, item: item, field: .totp)
    guard case .success(let code) = outcome else { return nil }
    let period = cachedItems[id]?.first(where: { $0.id == item })?.totpPeriod ?? VaultTotp.defaultPeriod
    return VaultTotp.make(code: code, period: period)
  }

  func ownerAllows(_ reason: String) async -> Bool {
    guard ownerNeededForPasswords else { return true }
    return await VaultOwnerCheck.confirm(reason)
  }

  func setOptions(idleLockMinutes: Int, touchID: Bool, askBeforeFilling: Bool, loadPasswordsWhenUsed whenUsed: Bool, iCloudSync: Bool) {
    ownerNeededForPasswords = askBeforeFilling
    loadPasswordsWhenUsed = whenUsed
    VaultCache.setCloudEnabled(iCloudSync)
    if whenUsed {
      cachedPasswords = [:]
      cachedTotps = [:]
      for provider in VaultRegistry.providers {
        if cachedItems[provider.id] != nil { persist(provider.id) } else { VaultCache.stripPasswords(provider.id) }
      }
    }
    sessions.setOptions(idleLockMinutes: idleLockMinutes, touchID: touchID)
    guard !touchID else { return }
    for provider in VaultRegistry.providers { sessions.dropStored(provider.id) }
  }

  func fillValues(provider providerId: String, id itemId: String, fields: [String], origin: String, userChose: Bool) async
    -> Result<VaultFillValues, VaultFillError>
  {
    guard let provider = VaultRegistry.provider(providerId) else { return .failure(.notFound) }
    guard VaultOriginMatch.isSecure(origin) else { return .failure(.insecure) }
    guard isReady(provider.id) else { return .failure(.locked) }
    guard let item = await freshItem(provider, itemId) else {
      return .failure(isReady(provider.id) ? .notFound : .locked)
    }
    guard userChose || VaultOriginMatch.matches(item.urls, origin: origin) else { return .failure(.originMismatch) }
    var wanted: [VaultField] = []
    for name in fields {
      let field: VaultField? = name == "otp" ? .totp : VaultField(rawValue: name)
      if let field, !wanted.contains(field) { wanted.append(field) }
    }
    let touched = VaultOwnerCheck.takeGrant()
    if wanted.contains(.password), !touched, !(await ownerAllows("fill your password")) { return .failure(.notAuthorized) }
    var values: [String: String] = [:]
    for field in wanted {
      if field == .username && !item.username.isEmpty {
        values["username"] = item.username
        continue
      }
      if field == .totp, let local = localTotp(provider.id, item: item.id) {
        values["otp"] = local.code()
        continue
      }
      let outcome = await secret(provider, item: item.id, field: field)
      switch outcome {
      case .success(let value):
        values[field == .totp ? "otp" : field.rawValue] = value
      case .failure(let error):
        if error == .notFound && field != .password && wanted.count > 1 { continue }
        return .failure(error)
      }
    }
    return values.isEmpty ? .failure(.notFound) : .success(VaultFillValues(values: values, touched: touched))
  }

  func save(provider providerId: String, origin: String, username: String, password: String, title: String?) async
    -> Result<VaultItem, VaultFillError>
  {
    guard let provider = VaultRegistry.provider(providerId) else { return .failure(.notFound) }
    guard provider.capabilities.save, !password.isEmpty else { return .failure(.failed) }
    guard VaultOriginMatch.isSecure(origin) else { return .failure(.insecure) }
    if sessions.session(provider.id) == nil, isReady(provider.id) { await reconnect(provider) }
    guard sessions.session(provider.id) != nil, let cli = VaultCLI.make(for: provider, sessions: sessions) else { return .failure(.locked) }
    let named = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let host = VaultOriginMatch.host(of: origin) ?? origin
    let fallback = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    let login = VaultNewLogin(title: named.isEmpty ? fallback : named, username: username, password: password, url: origin)
    do {
      let item = try await lane(provider.id).run { try await provider.save(cli, login: login) }
      sessions.touch(provider.id)
      remember(item, password: password)
      Task { _ = await self.fetchItems(provider) }
      return .success(item)
    } catch {
      await fail(provider, error)
      return .failure(Self.fillError(error))
    }
  }

  func refreshAll() async {
    await withTaskGroup(of: Void.self) { group in
      for provider in VaultRegistry.providers {
        group.addTask { _ = await self.refresh(provider.id) }
      }
    }
    refreshing = nil
  }

  func placeholder(_ provider: any VaultProvider) -> VaultProviderState {
    guard VaultBinaryLocator.locate(provider.binaryName) != nil else { return provider.makeState(.notInstalled) }
    var state = provider.makeState(.locked)
    state.touchUnlock = opensFromStore(provider.id) || sessions.hasStoredSession(provider.id)
    return state
  }

  func lane(_ id: String) -> VaultLane {
    if let lane = lanes[id] { return lane }
    let lane = VaultLane()
    lanes[id] = lane
    return lane
  }

  func isReady(_ id: String) -> Bool {
    if sessions.session(id) != nil { return true }
    return storeOpen && !lockedWhileOpen.contains(id) && cachedItems[id] != nil
  }

  func opensFromStore(_ id: String) -> Bool {
    guard sessions.touchID, !isReady(id) else { return false }
    return cachedItems[id] != nil || VaultCache.exists(id)
  }

  func currentState(_ provider: any VaultProvider) async -> VaultProviderState {
    guard let cli = VaultCLI.make(for: provider, sessions: sessions) else {
      if sessions.session(provider.id) != nil { sessions.forget(provider.id, keepStored: true) }
      dropItems(provider.id, announce: true)
      return publish(provider.makeState(.notInstalled))
    }
    let installedVersion = await version(of: cli)
    var state = await lane(provider.id).run { await provider.state(cli) }
    state.cliPath = cli.path
    state.cliVersion = installedVersion
    reconcile(provider.id, with: state.state)
    checkAccount(provider.id, state)
    switch state.state {
    case .unlocked, .unavailable:
      break
    case .locked where isReady(provider.id):
      state.state = .unlocked
    case .signedOut:
      forgetSnapshot(provider.id)
    default:
      dropItems(provider.id, announce: true)
    }
    return publish(state)
  }

  func reconcile(_ id: String, with state: VaultState) {
    guard sessions.session(id) != nil else { return }
    switch state {
    case .signedOut: sessions.signedOut(id)
    case .locked: sessions.forget(id, keepStored: false)
    default: break
    }
  }

  func version(of cli: VaultCLI) async -> String? {
    let key = (cli.path as NSString).resolvingSymlinksInPath
    if let known = versions[key] { return known }
    guard let found = await cli.version() else { return nil }
    versions[key] = found
    return found
  }

  func missingTool(_ provider: any VaultProvider) async -> VaultSignInResult {
    let state = await currentState(provider)
    return VaultSignInResult(ok: false, state: state, error: "\(provider.name)'s command-line tool isn't installed.")
  }

  func settle(_ provider: any VaultProvider, _ outcome: VaultSignInResult) async -> VaultSignInResult {
    var result = outcome
    if result.ok {
      sessions.touch(provider.id)
      openStore()
      lockedWhileOpen.remove(provider.id)
      fetchedAt[provider.id] = nil
    }
    result.state = await currentState(provider)
    result.ok = result.ok && result.state.state == .unlocked
    if result.ok, cachedItems[provider.id] != nil {
      announceItems(provider.id)
      Task { _ = await self.fetchItems(provider) }
    }
    return result
  }

  func cacheAccount(_ state: VaultProviderState?) -> String { "\(state?.account ?? "")@\(state?.server ?? "")" }

  func items(of provider: any VaultProvider) async -> [VaultItem] {
    let id = provider.id
    guard isReady(id) || (sessions.session(id) == nil && storeOpen && !lockedWhileOpen.contains(id)) else { return [] }
    restoreFromDisk(id)
    if let cached = cachedItems[id] {
      let stale = Date().timeIntervalSince(fetchedAt[id] ?? .distantPast) >= Self.itemsLifetime
      if stale, sessions.session(id) != nil, loading[id] == nil {
        Task { _ = await self.fetchItems(provider) }
      }
      return cached
    }
    guard sessions.session(id) != nil else { return [] }
    return await fetchItems(provider)
  }

  func fetchItems(_ provider: any VaultProvider) async -> [VaultItem] {
    switch await fetchResult(provider) {
    case .success(let items): return items
    case .failure: return cachedItems[provider.id] ?? []
    }
  }

  func fetchResult(_ provider: any VaultProvider) async -> Result<[VaultItem], Error> {
    let id = provider.id
    if let pending = loading[id] { return await pending.value }
    guard let cli = VaultCLI.make(for: provider, sessions: sessions) else { return .failure(VaultError.locked) }
    let queue = lane(id)
    let task = Task { () -> Result<[VaultItem], Error> in
      do {
        let fresh = try await queue.run { try await provider.itemsAndPasswords(cli) }
        return await self.apply(provider, fresh)
      } catch {
        await self.fail(provider, error)
        return .failure(error)
      }
    }
    loading[id] = task
    let result = await task.value
    loading[id] = nil
    return result
  }

  func apply(_ provider: any VaultProvider, _ fresh: VaultItemList) -> Result<[VaultItem], Error> {
    let id = provider.id
    guard sessions.session(id) != nil else { return .failure(VaultError.locked) }
    let previous = cachedItems[id]
    let previousSecrets = (cachedPasswords[id] ?? [:]).mapValues(\.value)
    cachedItems[id] = fresh.items
    fetchedAt[id] = Date()
    if states[id]?.account != nil { snapshotAccounts[id] = cacheAccount(states[id]) }
    mergeSecrets(id, fresh)
    persist(id, toCloud: previous != fresh.items || previousSecrets != (cachedPasswords[id] ?? [:]).mapValues(\.value))
    sessions.touch(id)
    if previous != fresh.items { announceItems(id) }
    return .success(fresh.items)
  }

  func freshItem(_ provider: any VaultProvider, _ itemId: String) async -> VaultItem? {
    if let found = await items(of: provider).first(where: { $0.id == itemId }) { return found }
    guard sessions.session(provider.id) != nil else { return nil }
    return await fetchItems(provider).first { $0.id == itemId }
  }

  func secret(_ provider: any VaultProvider, item: String, field: VaultField) async -> Result<String, VaultFillError> {
    let id = provider.id
    guard isReady(id) else { return .failure(.locked) }
    let listed = cachedItems[id]?.first { $0.id == item }
    if field == .password, !loadPasswordsWhenUsed, let listed, let hit = cachedPasswords[id]?[item], hit.itemUpdatedAt == listed.updatedAt {
      storeUsedAt = Date()
      sessions.touch(id)
      return .success(hit.value)
    }
    if field == .username, let listed, !listed.username.isEmpty { return .success(listed.username) }
    if sessions.session(id) == nil { await reconnect(provider) }
    guard sessions.session(id) != nil, let cli = VaultCLI.make(for: provider, sessions: sessions) else { return .failure(.locked) }
    do {
      let value = try await lane(id).run { try await provider.secret(cli, id: item, field: field) }
      sessions.touch(id)
      if field == .password, !loadPasswordsWhenUsed, let listed {
        cachedPasswords[id, default: [:]][item] = VaultCacheSnapshot.Password(value: value, itemUpdatedAt: listed.updatedAt)
        persist(id)
      }
      return .success(value)
    } catch {
      await fail(provider, error)
      return .failure(Self.fillError(error))
    }
  }

  func fail(_ provider: any VaultProvider, _ error: Error) async {
    guard let error = error as? VaultError else { return }
    switch error {
    case .locked:
      sessions.forget(provider.id, keepStored: sessions.touchID)
      if !isReady(provider.id) { dropItems(provider.id, announce: true) }
      _ = await currentState(provider)
    case .signedOut:
      sessions.signedOut(provider.id)
      forgetSnapshot(provider.id)
      _ = await currentState(provider)
    default:
      break
    }
  }

  func dropItems(_ id: String, announce: Bool) {
    cachedPasswords[id] = nil
    cachedTotps[id] = nil
    let had = !(cachedItems.removeValue(forKey: id) ?? []).isEmpty
    fetchedAt[id] = nil
    if announce && had { announceItems(id) }
  }

  func publish(_ fresh: VaultProviderState) -> VaultProviderState {
    var state = fresh
    state.touchUnlock = state.state == .locked && (opensFromStore(state.id) || sessions.hasStoredSession(state.id))
    guard states[state.id] != state else { return state }
    states[state.id] = state
    let payload: [String: Any] = ["provider": state.jsonObject()]
    DispatchQueue.main.async { ArdiaEvents.emit("vaults.changed", data: payload) }
    return state
  }

  func announceItems(_ id: String) {
    DispatchQueue.main.async { ArdiaEvents.emit("vaults.itemsChanged", data: ["provider": id]) }
  }

  static func fillError(_ error: Error) -> VaultFillError {
    switch error as? VaultError {
    case .locked?, .signedOut?: return .locked
    case .notFound?: return .notFound
    default: return .failed
    }
  }
}
