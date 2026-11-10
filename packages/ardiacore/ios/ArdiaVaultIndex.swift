import Foundation

actor ArdiaVaultIndex {
  static let shared = ArdiaVaultIndex()
  static let itemsLifetime: TimeInterval = 5

  private static let stateLock = NSLock()
  nonisolated(unsafe) private static var lastState = ArdiaVault.state(on: true)

  static var knownState: VaultProviderState {
    stateLock.lock()
    defer { stateLock.unlock() }
    return lastState
  }

  private var listed: [VaultItem] = []
  private var listedAt = Date.distantPast
  private var everListed = false
  private var reading: Task<[VaultItem], Never>?
  private var codes: [String: String]?

  func refreshState(explicit: Bool = false) async -> VaultProviderState {
    if explicit { listedAt = .distantPast }
    let state = ArdiaVault.state(on: await ArdiaVaultStore.isOn())
    publish(state)
    return state
  }

  func signInResult() async -> VaultSignInResult { ArdiaVault.signInResult(await refreshState()) }

  private func publish(_ state: VaultProviderState) {
    Self.stateLock.lock()
    let changed = Self.lastState != state
    Self.lastState = state
    Self.stateLock.unlock()
    guard changed else { return }
    listedAt = .distantPast
    let payload: [String: Any] = ["provider": state.jsonObject()]
    DispatchQueue.main.async { ArdiaEvents.emit("vaults.changed", data: payload) }
  }

  private func announceItems() {
    DispatchQueue.main.async { ArdiaEvents.emit("vaults.itemsChanged", data: ["provider": ArdiaVault.id]) }
  }

  func items() async -> [VaultItem] {
    if Date().timeIntervalSince(listedAt) < Self.itemsLifetime { return listed }
    if let reading { return await reading.value }
    let task = Task { await self.read() }
    reading = task
    let fresh = await task.value
    reading = nil
    return fresh
  }

  private func read() async -> [VaultItem] {
    let logins = await ArdiaVaultStore.offeredLogins()
    let known = loadedCodes()
    let fresh = logins.map { ArdiaVault.item($0, hasTotp: known[ArdiaVault.itemId($0)] != nil) }
    let changed = everListed && fresh != listed
    listed = fresh
    listedAt = Date()
    everListed = true
    if changed { announceItems() }
    return fresh
  }

  private func listedItem(_ id: String) async -> VaultItem? {
    if let found = await items().first(where: { $0.id == id }) { return found }
    listedAt = .distantPast
    return await items().first { $0.id == id }
  }

  func fillValues(id: String, fields: [String], origin: String, userChose: Bool, profile: String?) async
    -> Result<VaultFillValues, VaultFillError>
  {
    guard VaultOriginMatch.isSecure(origin) else { return .failure(.insecure) }
    guard let login = ArdiaVault.login(ofItem: id), let profile, login.profile == profile else { return .failure(.notFound) }
    guard await ArdiaVaultStore.offers(profile) else { return .failure(.locked) }
    guard let item = await listedItem(id) else { return .failure(.notFound) }
    guard userChose || VaultOriginMatch.matches(item.urls, origin: origin) else { return .failure(.originMismatch) }
    var wanted: [VaultField] = []
    for name in fields {
      let field: VaultField? = name == "otp" ? .totp : VaultField(rawValue: name)
      if let field, !wanted.contains(field) { wanted.append(field) }
    }
    let touched = VaultOwnerCheck.takeGrant()
    if wanted.contains(.password), !touched, !(await VaultBroker.shared.ownerAllows("fill your password")) { return .failure(.notAuthorized) }
    var values: [String: String] = [:]
    for field in wanted {
      switch field {
      case .username:
        if !item.username.isEmpty { values["username"] = item.username }
      case .password:
        guard let password = await ArdiaVaultStore.password(login), !password.isEmpty else { return .failure(.notFound) }
        values["password"] = password
      case .totp:
        guard let code = code(id) else {
          if wanted.count > 1 { continue }
          return .failure(.notFound)
        }
        values["otp"] = code.code
      }
    }
    return values.isEmpty ? .failure(.notFound) : .success(VaultFillValues(values: values, touched: touched))
  }

  func copy(id: String, field: VaultCopyField) async -> VaultCopyResult {
    guard let login = ArdiaVault.login(ofItem: id), await listedItem(id) != nil else { return .refused(.notFound) }
    var value = login.username
    if field == .password {
      guard await VaultBroker.shared.ownerAllows("copy your password") else { return .declined }
      value = await ArdiaVaultStore.password(login) ?? ""
    }
    guard !value.isEmpty else { return .refused(.notFound) }
    return await VaultClipboard.copy(value) ? .copied : .clipboardFailed
  }

  func totp(id: String) -> VaultTotp? { code(id) }

  private func code(_ id: String) -> VaultTotp? {
    loadedCodes()[id].flatMap { VaultTotpSecret($0) }?.totp()
  }

  func save(origin: String, username: String, password: String, profile: String?) async -> Result<VaultItem, VaultFillError> {
    guard let profile, !password.isEmpty else { return .failure(.failed) }
    guard VaultOriginMatch.isSecure(origin), ArdiaVault.isWebOrigin(origin) else { return .failure(.insecure) }
    guard await ArdiaVaultStore.offers(profile) else { return .failure(.locked) }
    let login = ArdiaVaultLogin(profile: profile, origin: origin, username: username)
    guard await ArdiaVaultStore.save(login, password: password) else { return .failure(.failed) }
    listedAt = .distantPast
    announceItems()
    return .success(ArdiaVault.item(login, hasTotp: loadedCodes()[ArdiaVault.itemId(login)] != nil))
  }

  func addTotp(id: String, uri: String) async -> VaultAddTotpResult {
    guard uri.lowercased().hasPrefix("otpauth://totp/"), VaultTotpSecret(uri) != nil else { return .failure(.invalid) }
    guard let listed = await listedItem(id) else { return .failure(.notFound) }
    guard await VaultOwnerCheck.confirm("add a verification code") else { return .failure(.declined) }
    var all = loadedCodes()
    all[id] = uri
    guard persist(all) else { return .failure(.failed, "Ardia couldn't keep the code.") }
    codes = all
    listedAt = .distantPast
    announceItems()
    var item = listed
    item.hasTotp = true
    item.totpPeriod = VaultTotp.period(fromURI: uri)
    return VaultAddTotpResult(item: item)
  }

  func export(profile: String?) async -> VaultExportResult {
    guard let destination = await VaultExportFile.destination("Ardia Passwords.csv") else { return VaultExportResult(declined: true) }
    return await ArdiaVaultStore.export(profile ?? "", to: destination.path)
  }

  private func loadedCodes() -> [String: String] {
    if let codes { return codes }
    let loaded = (VaultCache.load(ArdiaVault.id)?.totps ?? [:]).mapValues(\.value)
    codes = loaded
    return loaded
  }

  private func persist(_ all: [String: String]) -> Bool {
    let totps = all.mapValues { VaultCacheSnapshot.Password(value: $0, itemUpdatedAt: nil) }
    let snapshot = VaultCacheSnapshot(account: ArdiaVault.id, savedAt: Date().timeIntervalSince1970, entries: [], passwords: [:], totps: totps)
    return VaultCache.save(ArdiaVault.id, snapshot, toCloud: false)
  }
}
