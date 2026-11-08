import Foundation

actor VaultBroker {
  static let shared = VaultBroker()
  static let itemsLifetime: TimeInterval = 60

  private let sessions = VaultSessionStore.shared
  private var lanes: [String: VaultLane] = [:]
  private var states: [String: VaultProviderState] = [:]
  private var cachedItems: [String: [VaultItem]] = [:]
  private var fetchedAt: [String: Date] = [:]
  private var loading: [String: Task<[VaultItem], Error>] = [:]
  private var versions: [String: String] = [:]
  private var refreshing: Task<Void, Never>?
  private var ownerNeededForPasswords = true
  private var loadPasswordsWhenUsed = false
  private var cachedPasswords: [String: [String: VaultCacheSnapshot.Password]] = [:]

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
      dropItems(id, announce: false)
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
    if sessions.session(id) != nil, let cli = VaultCLI.make(for: provider, sessions: sessions) {
      await lane(id).run { await provider.lock(cli) }
    }
    sessions.forget(id, keepStored: sessions.touchID)
    dropItems(id, announce: true)
    return await currentState(provider)
  }

  func lockAll() async {
    for id in sessions.unlockedProviders { _ = await lock(id) }
  }

  func lockIdle() async {
    for id in sessions.idleProviders() { _ = await lock(id) }
  }

  func signOut(_ id: String) async -> VaultProviderState? {
    guard let provider = VaultRegistry.provider(id) else { return nil }
    sessions.cancelRunning(id)
    if let cli = VaultCLI.make(for: provider, sessions: sessions) {
      await lane(id).run { await provider.signOut(cli) }
    }
    sessions.signedOut(id)
    dropItems(id, announce: true)
    VaultCache.delete(id)
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
    guard let cli = VaultCLI.make(for: provider, sessions: sessions) else { return await missingTool(provider) }
    let result = await lane(id).run { await provider.unlock(cli, password: password) }
    return await settle(provider, result)
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
    let outcome = await secret(provider, item: item, field: .totp)
    guard case .success(let code) = outcome else { return nil }
    let period = cachedItems[id]?.first(where: { $0.id == item })?.totpPeriod ?? VaultTotp.defaultPeriod
    return VaultTotp.make(code: code, period: period)
  }

  private func ownerAllows(_ reason: String) async -> Bool {
    guard ownerNeededForPasswords else { return true }
    return await VaultOwnerCheck.confirm(reason)
  }

  func setOptions(idleLockMinutes: Int, touchID: Bool, askBeforeFilling: Bool, loadPasswordsWhenUsed whenUsed: Bool) {
    ownerNeededForPasswords = askBeforeFilling
    loadPasswordsWhenUsed = whenUsed
    if whenUsed {
      cachedPasswords = [:]
      for provider in VaultRegistry.providers {
        if cachedItems[provider.id] != nil { persist(provider.id) } else { VaultCache.stripPasswords(provider.id) }
      }
    }
    sessions.setOptions(idleLockMinutes: idleLockMinutes, touchID: touchID)
    guard !touchID else { return }
    for provider in VaultRegistry.providers { sessions.dropStored(provider.id) }
  }

  func fillValues(provider providerId: String, id itemId: String, fields: [String], origin: String, userChose: Bool) async
    -> Result<[String: String], VaultFillError>
  {
    guard let provider = VaultRegistry.provider(providerId) else { return .failure(.notFound) }
    guard VaultOriginMatch.isSecure(origin) else { return .failure(.insecure) }
    guard sessions.session(provider.id) != nil else { return .failure(.locked) }
    guard let item = await freshItem(provider, itemId) else {
      return .failure(sessions.session(provider.id) == nil ? .locked : .notFound)
    }
    guard userChose || VaultOriginMatch.matches(item.urls, origin: origin) else { return .failure(.originMismatch) }
    var wanted: [VaultField] = []
    for name in fields {
      let field: VaultField? = name == "otp" ? .totp : VaultField(rawValue: name)
      if let field, !wanted.contains(field) { wanted.append(field) }
    }
    if wanted.contains(.password), !(await ownerAllows("fill your password")) { return .failure(.notAuthorized) }
    var values: [String: String] = [:]
    for field in wanted {
      if field == .username && !item.username.isEmpty {
        values["username"] = item.username
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
    return values.isEmpty ? .failure(.notFound) : .success(values)
  }

  func save(provider providerId: String, origin: String, username: String, password: String, title: String?) async
    -> Result<VaultItem, VaultFillError>
  {
    guard let provider = VaultRegistry.provider(providerId) else { return .failure(.notFound) }
    guard provider.capabilities.save, !password.isEmpty else { return .failure(.failed) }
    guard VaultOriginMatch.isSecure(origin) else { return .failure(.insecure) }
    guard sessions.session(provider.id) != nil, let cli = VaultCLI.make(for: provider, sessions: sessions) else { return .failure(.locked) }
    let named = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let host = VaultOriginMatch.host(of: origin) ?? origin
    let fallback = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    let login = VaultNewLogin(title: named.isEmpty ? fallback : named, username: username, password: password, url: origin)
    do {
      let item = try await lane(provider.id).run { try await provider.save(cli, login: login) }
      sessions.touch(provider.id)
      dropItems(provider.id, announce: false)
      announceItems(provider.id)
      return .success(item)
    } catch {
      await fail(provider, error)
      return .failure(Self.fillError(error))
    }
  }

  private func refreshAll() async {
    await withTaskGroup(of: Void.self) { group in
      for provider in VaultRegistry.providers {
        group.addTask { _ = await self.refresh(provider.id) }
      }
    }
    refreshing = nil
  }

  private func placeholder(_ provider: any VaultProvider) -> VaultProviderState {
    VaultBinaryLocator.locate(provider.binaryName) == nil ? provider.makeState(.notInstalled) : provider.makeState(.locked)
  }

  private func lane(_ id: String) -> VaultLane {
    if let lane = lanes[id] { return lane }
    let lane = VaultLane()
    lanes[id] = lane
    return lane
  }

  private func currentState(_ provider: any VaultProvider) async -> VaultProviderState {
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
    if state.state != .unlocked && state.state != .unavailable { dropItems(provider.id, announce: true) }
    return publish(state)
  }

  private func reconcile(_ id: String, with state: VaultState) {
    guard sessions.session(id) != nil else { return }
    switch state {
    case .signedOut: sessions.signedOut(id)
    case .locked: sessions.forget(id, keepStored: false)
    default: break
    }
  }

  private func version(of cli: VaultCLI) async -> String? {
    let key = (cli.path as NSString).resolvingSymlinksInPath
    if let known = versions[key] { return known }
    guard let found = await cli.version() else { return nil }
    versions[key] = found
    return found
  }

  private func missingTool(_ provider: any VaultProvider) async -> VaultSignInResult {
    let state = await currentState(provider)
    return VaultSignInResult(ok: false, state: state, error: "\(provider.name)'s command-line tool isn't installed.")
  }

  private func settle(_ provider: any VaultProvider, _ outcome: VaultSignInResult) async -> VaultSignInResult {
    var result = outcome
    if result.ok {
      sessions.touch(provider.id)
      dropItems(provider.id, announce: false)
    }
    result.state = await currentState(provider)
    result.ok = result.ok && result.state.state == .unlocked
    return result
  }

  private func cacheAccount(_ id: String) -> String {
    let state = states[id]
    return "\(state?.account ?? "")@\(state?.server ?? "")"
  }

  private func persist(_ id: String) {
    guard let items = cachedItems[id] else { return }
    let snapshot = VaultCacheSnapshot(
      account: cacheAccount(id), savedAt: (fetchedAt[id] ?? Date()).timeIntervalSince1970,
      entries: items.map { VaultCacheSnapshot.Entry(item: $0, totpPeriod: $0.totpPeriod) },
      passwords: loadPasswordsWhenUsed ? [:] : cachedPasswords[id] ?? [:])
    VaultCache.save(id, snapshot)
  }

  private func restoreFromDisk(_ id: String) {
    guard cachedItems[id] == nil, let snapshot = VaultCache.load(id, account: cacheAccount(id)) else { return }
    cachedItems[id] = snapshot.items
    cachedPasswords[id] = loadPasswordsWhenUsed ? [:] : snapshot.passwords
    fetchedAt[id] = Date(timeIntervalSince1970: snapshot.savedAt)
  }

  private func items(of provider: any VaultProvider) async -> [VaultItem] {
    let id = provider.id
    guard sessions.session(id) != nil else { return [] }
    restoreFromDisk(id)
    if let cached = cachedItems[id] {
      if Date().timeIntervalSince(fetchedAt[id] ?? .distantPast) >= Self.itemsLifetime, loading[id] == nil {
        Task { _ = await self.fetchItems(provider) }
      }
      return cached
    }
    return await fetchItems(provider)
  }

  private func fetchItems(_ provider: any VaultProvider) async -> [VaultItem] {
    let id = provider.id
    if let pending = loading[id] { return (try? await pending.value) ?? [] }
    guard let cli = VaultCLI.make(for: provider, sessions: sessions) else { return [] }
    let queue = lane(id)
    let listing = Task { try await queue.run { try await provider.itemsAndPasswords(cli) } }
    let task = Task { try await listing.value.items }
    loading[id] = task
    defer { loading[id] = nil }
    do {
      let fresh = try await listing.value
      guard sessions.session(id) != nil else { return [] }
      let previous = cachedItems[id]
      cachedItems[id] = fresh.items
      fetchedAt[id] = Date()
      mergePasswords(id, fresh)
      persist(id)
      sessions.touch(id)
      if previous != fresh.items { announceItems(id) }
      return fresh.items
    } catch {
      await fail(provider, error)
      return cachedItems[id] ?? []
    }
  }

  private func mergePasswords(_ id: String, _ fresh: VaultItemList) {
    guard !loadPasswordsWhenUsed else { return cachedPasswords[id] = [:] }
    let old = cachedPasswords[id] ?? [:]
    var kept: [String: VaultCacheSnapshot.Password] = [:]
    for item in fresh.items {
      if let password = fresh.passwords[item.id] {
        kept[item.id] = VaultCacheSnapshot.Password(value: password, itemUpdatedAt: item.updatedAt)
      } else if let cached = old[item.id], cached.itemUpdatedAt == item.updatedAt {
        kept[item.id] = cached
      }
    }
    cachedPasswords[id] = kept
  }

  private func freshItem(_ provider: any VaultProvider, _ itemId: String) async -> VaultItem? {
    if let found = await items(of: provider).first(where: { $0.id == itemId }) { return found }
    return await fetchItems(provider).first { $0.id == itemId }
  }

  private func secret(_ provider: any VaultProvider, item: String, field: VaultField) async -> Result<String, VaultFillError> {
    let id = provider.id
    guard sessions.session(id) != nil, let cli = VaultCLI.make(for: provider, sessions: sessions) else { return .failure(.locked) }
    let listed = cachedItems[id]?.first { $0.id == item }
    if field == .password, !loadPasswordsWhenUsed, let listed, let hit = cachedPasswords[id]?[item], hit.itemUpdatedAt == listed.updatedAt {
      sessions.touch(id)
      return .success(hit.value)
    }
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

  private func fail(_ provider: any VaultProvider, _ error: Error) async {
    guard let error = error as? VaultError else { return }
    switch error {
    case .locked:
      sessions.forget(provider.id, keepStored: sessions.touchID)
      dropItems(provider.id, announce: true)
      _ = await currentState(provider)
    case .signedOut:
      sessions.signedOut(provider.id)
      dropItems(provider.id, announce: true)
      VaultCache.delete(provider.id)
      _ = await currentState(provider)
    default:
      break
    }
  }

  private func dropItems(_ id: String, announce: Bool) {
    cachedPasswords[id] = nil
    let had = !(cachedItems.removeValue(forKey: id) ?? []).isEmpty
    fetchedAt[id] = nil
    if announce && had { announceItems(id) }
  }

  private func publish(_ fresh: VaultProviderState) -> VaultProviderState {
    var state = fresh
    state.touchUnlock = state.state == .locked && sessions.hasStoredSession(state.id)
    guard states[state.id] != state else { return state }
    states[state.id] = state
    let payload: [String: Any] = ["provider": state.jsonObject()]
    DispatchQueue.main.async { ArdiaEvents.emit("vaults.changed", data: payload) }
    return state
  }

  private func announceItems(_ id: String) {
    DispatchQueue.main.async { ArdiaEvents.emit("vaults.itemsChanged", data: ["provider": id]) }
  }

  private static func fillError(_ error: Error) -> VaultFillError {
    switch error as? VaultError {
    case .locked?, .signedOut?: return .locked
    case .notFound?: return .notFound
    default: return .failed
    }
  }
}
