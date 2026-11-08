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

  func copy(_ id: String, item: String, field: VaultField) async -> Bool {
    guard let provider = VaultRegistry.provider(id) else { return false }
    let outcome = await secret(provider, item: item, field: field)
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

  func setOptions(idleLockMinutes: Int, touchID: Bool) {
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

  private func items(of provider: any VaultProvider) async -> [VaultItem] {
    let id = provider.id
    guard sessions.session(id) != nil else { return [] }
    if let cached = cachedItems[id], let at = fetchedAt[id], Date().timeIntervalSince(at) < Self.itemsLifetime { return cached }
    if let pending = loading[id] { return (try? await pending.value) ?? [] }
    guard let cli = VaultCLI.make(for: provider, sessions: sessions) else { return [] }
    let queue = lane(id)
    let task = Task { try await queue.run { try await provider.items(cli) } }
    loading[id] = task
    defer { loading[id] = nil }
    do {
      let fresh = try await task.value
      guard sessions.session(id) != nil else { return [] }
      let previous = cachedItems[id]
      cachedItems[id] = fresh
      fetchedAt[id] = Date()
      sessions.touch(id)
      if previous != fresh { announceItems(id) }
      return fresh
    } catch {
      await fail(provider, error)
      return []
    }
  }

  private func freshItem(_ provider: any VaultProvider, _ itemId: String) async -> VaultItem? {
    if let at = fetchedAt[provider.id], Date().timeIntervalSince(at) < Self.itemsLifetime,
      let found = cachedItems[provider.id]?.first(where: { $0.id == itemId })
    {
      return found
    }
    fetchedAt[provider.id] = nil
    return await items(of: provider).first { $0.id == itemId }
  }

  private func secret(_ provider: any VaultProvider, item: String, field: VaultField) async -> Result<String, VaultFillError> {
    guard sessions.session(provider.id) != nil, let cli = VaultCLI.make(for: provider, sessions: sessions) else { return .failure(.locked) }
    do {
      let value = try await lane(provider.id).run { try await provider.secret(cli, id: item, field: field) }
      sessions.touch(provider.id)
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
      _ = await currentState(provider)
    default:
      break
    }
  }

  private func dropItems(_ id: String, announce: Bool) {
    let had = !(cachedItems.removeValue(forKey: id) ?? []).isEmpty
    fetchedAt[id] = nil
    if announce && had { announceItems(id) }
  }

  private func publish(_ state: VaultProviderState) -> VaultProviderState {
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
